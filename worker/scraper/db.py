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


def upsert_contacts(db: Client, user_id, contacts: list[dict], source: str, enqueue_top: int = 0) -> dict:
    """Add a user's first-degree contacts: one people row per contact (deduped on
    linkedin_url) and a follows row (follower_id = contact, person_id = user).
    contacts: [{name, headline, role, company, linkedin_url, photo_url, connected_on}] in
    the order LinkedIn lists them (most recent first); the first `enqueue_top` get a
    full-profile scrape job (30-90 s each, so keep it small)."""
    contacts = list({c["linkedin_url"]: c for c in contacts if c.get("linkedin_url")}.values())
    urls = [c["linkedin_url"] for c in contacts]

    existing: dict[str, object] = {}
    for i in range(0, len(urls), 200):  # keep the IN (...) filter short
        for p in db.table("people").select("id, linkedin_url").in_("linkedin_url", urls[i:i + 200]).execute().data:
            existing[p["linkedin_url"]] = p["id"]

    new = [{
        "name": c["name"], "headline": c.get("headline"), "role": c.get("role"), "company": c.get("company"),
        "photo_url": c.get("photo_url"), "linkedin_url": c["linkedin_url"], "is_user": False,
        "raw": {source: {"connected_on": c.get("connected_on")}},
    } for c in contacts if c["linkedin_url"] not in existing]
    for i in range(0, len(new), 500):
        for p in db.table("people").insert(new[i:i + 500]).execute().data:
            existing[p["linkedin_url"]] = p["id"]

    have = {f["follower_id"] for f in db.table("follows").select("follower_id").eq("person_id", user_id).execute().data}
    follows = [{"follower_id": existing[u], "person_id": user_id}
               for u in urls if existing[u] not in have and existing[u] != user_id]
    for i in range(0, len(follows), 500):
        db.table("follows").insert(follows[i:i + 500]).execute()

    jobs = [{"person_id": existing[u], "platform": "linkedin", "status": "queued"} for u in urls[:enqueue_top]]
    if jobs:
        db.table("scrape_jobs").insert(jobs).execute()

    return {"contacts": len(contacts), "new_people": len(new), "new_follows": len(follows), "jobs_queued": len(jobs)}
