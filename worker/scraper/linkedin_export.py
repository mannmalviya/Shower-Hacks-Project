"""Import LinkedIn's official export (Connections.csv). No scraping, no ban risk.

The user gets it from LinkedIn > Settings > Data privacy > Get a copy of your data >
"Connections" (arrives by email in ~10 min). The file starts with a few "Notes:" lines,
then: First Name,Last Name,URL,Email Address,Company,Position,Connected On

Each connection becomes a people row (is_user=false) plus a follows row
(follower_id = connection, person_id = the user). Emails are dropped on purpose.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime
from pathlib import Path

from supabase import Client


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
            "linkedin_url": (r.get("URL") or "").strip().rstrip("/") or None,
            "connected_on": (r.get("Connected On") or "").strip() or None,
        })
    return list({r["linkedin_url"]: r for r in rows}.values())  # dedupe by profile URL


def import_connections(db: Client, path: Path, user_id, enqueue_top: int = 0) -> dict:
    rows = parse(path)
    urls = [r["linkedin_url"] for r in rows]
    existing = {}
    for i in range(0, len(urls), 200):  # keep the IN (...) filter short
        for p in db.table("people").select("id, linkedin_url").in_("linkedin_url", urls[i:i + 200]).execute().data:
            existing[p["linkedin_url"]] = p["id"]

    new = [{
        "name": r["name"], "company": r["company"], "role": r["role"],
        "headline": f"{r['role']} at {r['company']}" if r["role"] and r["company"] else r["role"],
        "linkedin_url": r["linkedin_url"], "is_user": False,
        "raw": {"linkedin_export": {"connected_on": r["connected_on"]}},
    } for r in rows if r["linkedin_url"] not in existing]
    for i in range(0, len(new), 500):
        for p in db.table("people").insert(new[i:i + 500]).execute().data:
            existing[p["linkedin_url"]] = p["id"]

    ids = list(dict.fromkeys(existing[u] for u in urls if u in existing))
    have = {f["follower_id"] for f in db.table("follows").select("follower_id").eq("person_id", user_id).execute().data}
    follows = [{"follower_id": pid, "person_id": user_id} for pid in ids if pid not in have and pid != user_id]
    for i in range(0, len(follows), 500):
        db.table("follows").insert(follows[i:i + 500]).execute()

    # Queue full-profile scrapes for the most recent connections (capped: 30-90 s each).
    queued = 0
    if enqueue_top:
        recent = sorted(rows,
                        key=lambda r: _date_key(r["connected_on"]), reverse=True)[:enqueue_top]
        jobs = [{"person_id": existing[r["linkedin_url"]], "platform": "linkedin", "status": "queued"} for r in recent]
        if jobs:
            db.table("scrape_jobs").insert(jobs).execute()
            queued = len(jobs)

    return {"connections": len(rows), "new_people": len(new), "new_follows": len(follows), "jobs_queued": queued}


def _date_key(s: str | None) -> datetime:
    for fmt in ("%d %b %Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(s or "", fmt)
        except ValueError:
            pass
    return datetime.min
