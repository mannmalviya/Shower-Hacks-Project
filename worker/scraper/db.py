"""Supabase access. Only the tables/columns agreed in PLAN.md > Data are written:
people(name, headline, company, role, location, photo_url, *_url, raw, is_user),
follows(follower_id, person_id), scrape_jobs(id, person_id, platform, status, error)."""

from __future__ import annotations

import os

from supabase import Client, create_client

from .models import URL_COLUMN, Profile

# When several platforms are scraped for one person, top-level fields come from
# the first platform in this order that has a value (LinkedIn is the most "real").
FIELD_PRIORITY = ("linkedin", "x", "instagram")
FIELDS = ("name", "headline", "company", "role", "location", "photo_url")


def client() -> Client:
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in worker/.env")
    return create_client(url, key)


def claim_next_job(db: Client) -> dict | None:
    """Oldest queued job -> running. The status=queued guard makes the claim safe
    when two workers (laptop + Zo) poll the same table."""
    queued = (db.table("scrape_jobs").select("*").eq("status", "queued")
              .order("created_at").limit(5).execute().data)
    for job in queued:
        claimed = (db.table("scrape_jobs").update({"status": "running", "error": None})
                   .eq("id", job["id"]).eq("status", "queued").execute().data)
        if claimed:
            return claimed[0]
    return None


def finish_job(db: Client, job_id, error: str | None = None) -> None:
    db.table("scrape_jobs").update(
        {"status": "failed" if error else "done", "error": (error or None) and error[:1000]}
    ).eq("id", job_id).execute()


def get_person(db: Client, person_id) -> dict | None:
    rows = db.table("people").select("*").eq("id", person_id).limit(1).execute().data
    return rows[0] if rows else None


def save_profile(db: Client, person: dict, profile: Profile) -> dict:
    raw = dict(person.get("raw") or {})
    raw[profile.platform] = profile.to_dict()

    update: dict = {"raw": raw, URL_COLUMN[profile.platform]: person.get(URL_COLUMN[profile.platform]) or profile.url}
    for f in FIELDS:
        value = next((raw[p].get(f) for p in FIELD_PRIORITY if isinstance(raw.get(p), dict) and raw[p].get(f)), None)
        if value:
            update[f] = value
    return db.table("people").update(update).eq("id", person["id"]).execute().data[0]


def enqueue(db: Client, person_id, platform: str) -> dict:
    return db.table("scrape_jobs").insert(
        {"person_id": person_id, "platform": platform, "status": "queued"}
    ).execute().data[0]
