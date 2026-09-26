"""Supabase access, matching supabase/migrations/ and seed/README.md:
people(user_id set = signed-up user, name, headline, company, role, location, photo_url,
*_url, raw), follows(follower_id, person_id; a LinkedIn connection is mutual = 2 rows),
scrape_jobs(person_id, platform in linkedin|x|instagram, status, error).
The worker uses the secret key, which skips RLS."""

from __future__ import annotations

import os

from supabase import Client, create_client

from .models import URL_COLUMN, Profile, linkedin_profile_url
from .shapes import contact_row, merged_top, raw_entry


def client() -> Client:
    # Same variable names as the app's .env.local, so one file can serve both.
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_SECRET_KEY in worker/.env (or the repo's .env.local)")
    return create_client(url, key)


def claim_next_job(db: Client) -> dict | None:
    """Oldest queued job -> running, signed-up users' jobs first. The status=queued
    guard makes the claim safe when two workers poll the same table."""
    queued = (db.table("scrape_jobs").select("*, people(user_id)").eq("status", "queued")
              .order("created_at").limit(50).execute().data)
    # A signed-up user's own job jumps ahead of queued contact deep-scrapes.
    queued.sort(key=lambda j: (j.get("people") or {}).get("user_id") is None)
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
    raw[profile.platform] = {**(raw.get(profile.platform) or {}), **raw_entry(profile)}
    update: dict = {"raw": raw, **merged_top(raw)}
    col = URL_COLUMN[profile.platform]
    if not person.get(col):
        update[col] = linkedin_profile_url(profile.url) if profile.platform == "linkedin" else profile.url
    return db.table("people").update(update).eq("id", person["id"]).execute().data[0]


def enqueue(db: Client, person_id, platform: str) -> dict:
    return db.table("scrape_jobs").insert(
        {"person_id": person_id, "platform": platform, "status": "queued"}
    ).execute().data[0]


def upsert_contacts(db: Client, user_id, contacts: list[dict], source: str, enqueue_top: int = 0) -> dict:
    """Add a user's first-degree LinkedIn contacts: one people row each (deduped on the
    unique linkedin_url) and two follows rows (a connection is mutual). contacts are in
    LinkedIn's order (most recent first); the first `enqueue_top` get a full-profile
    `linkedin` scrape job (~25 s each, so keep it small)."""
    rows = list({r["linkedin_url"]: r for r in (contact_row(c, source) for c in contacts
                                                 if c.get("linkedin_url") and c.get("name"))}.values())
    urls = [r["linkedin_url"] for r in rows]

    def ids_for(batch: list[str]) -> dict:
        return {p["linkedin_url"]: p["id"] for p in
                db.table("people").select("id, linkedin_url").in_("linkedin_url", batch).execute().data}

    existing: dict = {}
    for i in range(0, len(urls), 200):  # keep the IN (...) filter short
        existing.update(ids_for(urls[i:i + 200]))
    new = [r for r in rows if r["linkedin_url"] not in existing]
    for i in range(0, len(new), 500):
        # ignore_duplicates: another worker may insert the same person meanwhile (linkedin_url is unique)
        db.table("people").upsert(new[i:i + 500], on_conflict="linkedin_url", ignore_duplicates=True).execute()
        existing.update(ids_for([r["linkedin_url"] for r in new[i:i + 500]]))

    ids = [existing[u] for u in urls if u in existing and existing[u] != user_id]
    follows = [row for pid in ids for row in ({"follower_id": pid, "person_id": user_id},
                                              {"follower_id": user_id, "person_id": pid})]
    for i in range(0, len(follows), 500):
        db.table("follows").upsert(follows[i:i + 500], on_conflict="follower_id,person_id",
                                   ignore_duplicates=True).execute()

    jobs = [{"person_id": pid, "platform": "linkedin", "status": "queued"} for pid in ids[:enqueue_top]]
    if jobs:
        db.table("scrape_jobs").insert(jobs).execute()

    return {"contacts": len(rows), "new_people": len(new), "follow_rows": len(follows), "jobs_queued": len(jobs)}
