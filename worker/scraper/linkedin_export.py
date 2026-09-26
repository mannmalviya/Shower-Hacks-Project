"""Import LinkedIn's official export (Connections.csv). Backup for `connections`
(the live scrape of the signed-in account's list). No scraping, no ban risk.

The user gets it from LinkedIn > Settings > Data privacy > Get a copy of your data >
"Connections" (arrives by email in ~10 min). The file starts with a few "Notes:" lines,
then: First Name,Last Name,URL,Email Address,Company,Position,Connected On

Each connection becomes a people row plus two follows rows (a connection is
mutual), via db.upsert_contacts. Emails are dropped on purpose.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime
from pathlib import Path

from supabase import Client

from .db import upsert_contacts
from .models import linkedin_profile_url


def parse(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig")
    lines = text.splitlines()
    start = next((i for i, l in enumerate(lines) if l.startswith("First Name,")), None)
    if start is None:
        raise SystemExit(f"{path} does not look like LinkedIn's Connections.csv (no 'First Name,' header)")
    rows = []
    for r in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
        name = f"{r.get('First Name', '').strip()} {r.get('Last Name', '').strip()}".strip()
        if not name or not (r.get("URL") or "").strip():
            continue  # LinkedIn blanks out members who hid their data from exports
        rows.append({
            "name": name,
            "company": (r.get("Company") or "").strip() or None,
            "role": (r.get("Position") or "").strip() or None,
            "linkedin_url": linkedin_profile_url(r["URL"].strip()),
            "connected_on": (r.get("Connected On") or "").strip() or None,
        })
    return list({r["linkedin_url"]: r for r in rows}.values())  # dedupe by profile URL


def import_connections(db: Client, path: Path, user_id, enqueue_top: int = 0) -> dict:
    rows = sorted(parse(path), key=lambda r: _date_key(r["connected_on"]), reverse=True)
    for r in rows:
        r["headline"] = f"{r['role']} at {r['company']}" if r["role"] and r["company"] else r["role"]
    return upsert_contacts(db, user_id, rows, source="linkedin_export", enqueue_top=enqueue_top)


def _date_key(s: str | None) -> datetime:
    for fmt in ("%d %b %Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(s or "", fmt)
        except ValueError:
            pass
    return datetime.min
