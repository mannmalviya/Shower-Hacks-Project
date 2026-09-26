"""Supabase access, matching supabase/migrations/ and DB_SCHEMA.md:
people(user_id set = signed-up user, name, headline, location, photo_url, raw),
social_profiles(person_id, platform, url unique; one row per platform per person),
experiences / education (one row per job / school), follows(follower_id, person_id;
a LinkedIn connection is mutual = 2 rows), scrape_jobs(person_id, platform in
linkedin|x|instagram, status, error).
The worker uses the secret key, which skips RLS."""

from __future__ import annotations

import os
import re

from supabase import Client, create_client

from .models import Profile, handle, profile_url
from .shapes import contact_row, merged_top, raw_entry

# people columns the worker fills from raw (the rest come from onboarding)
PEOPLE_TOP = ("name", "headline", "location", "photo_url")
MONTHS = {m: i for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun",
                                      "jul", "aug", "sep", "oct", "nov", "dec"), 1)}


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
    """The people row plus `urls`: {platform: url} from social_profiles."""
    rows = (db.table("people").select("*, social_profiles(platform, url)")
            .eq("id", person_id).limit(1).execute().data)
    if not rows:
        return None
    person = rows[0]
    person["urls"] = {s["platform"]: s["url"] for s in person.pop("social_profiles") or []}
    return person


def save_profile(db: Client, person: dict, profile: Profile) -> None:
    raw = dict(person.get("raw") or {})
    entry = raw_entry(profile)
    raw[profile.platform] = {**(raw.get(profile.platform) or {}), **entry}
    top = merged_top(raw)
    db.table("people").update({"raw": raw, **{k: top[k] for k in PEOPLE_TOP if k in top}}).eq("id", person["id"]).execute()

    r = profile.raw or {}
    db.table("social_profiles").upsert({
        "person_id": person["id"], "platform": profile.platform,
        "url": person["urls"].get(profile.platform) or profile_url(profile.platform, profile.url),
        "handle": handle(profile.url), "bio": r.get("about") or r.get("bio") or profile.headline,
        "follower_count": r.get("follower_count"), "avatar_url": profile.photo_url, "raw": entry,
    }, on_conflict="person_id,platform").execute()

    if profile.platform == "linkedin":
        exps, edus = work_rows(person["id"], raw["linkedin"])
        # Replace the history only when the scrape found one (keeps the onboarding company otherwise).
        if exps:
            db.table("experiences").delete().eq("person_id", person["id"]).execute()
            db.table("experiences").insert(exps).execute()
        if edus:
            db.table("education").delete().eq("person_id", person["id"]).execute()
            db.table("education").insert(edus).execute()


def to_date(s: str | None) -> str | None:
    """'Jun 2026' -> '2026-06-01', '2026' -> '2026-01-01', 'Present' / junk -> None."""
    m = re.fullmatch(r"(?:([A-Za-z]{3})\w*\s+)?(\d{4})", (s or "").strip())
    if not m:
        return None
    return f"{m.group(2)}-{MONTHS.get((m.group(1) or 'jan').lower(), 1):02d}-01"


def work_rows(person_id, entry: dict) -> tuple[list[dict], list[dict]]:
    """raw.linkedin experiences / educations -> experiences / education rows.
    The primary job is the first current one ('Present'), else the first listed."""
    exps = [{"person_id": person_id, "company": e["institution_name"], "title": e.get("position_title"),
             "start_date": to_date(e.get("from_date")), "end_date": to_date(e.get("to_date")),
             "is_primary": False, "_current": (e.get("to_date") or "").lower() == "present"}
            for e in entry.get("experiences") or [] if e.get("institution_name")]
    if exps:
        next((e for e in exps if e["_current"]), exps[0])["is_primary"] = True
    for e in exps:
        del e["_current"]
    edus = []
    for e in entry.get("educations") or []:
        if not e.get("institution_name"):
            continue
        degree, _, field = (e.get("degree") or "").partition(",")  # "BS, Computer Science"
        edus.append({"person_id": person_id, "school": e["institution_name"], "degree": degree.strip() or None,
                     "field": field.strip() or None, "start_date": to_date(e.get("from_date")),
                     "end_date": to_date(e.get("to_date"))})
    return exps, edus


def enqueue(db: Client, person_id, platform: str) -> dict:
    return db.table("scrape_jobs").insert(
        {"person_id": person_id, "platform": platform, "status": "queued"}
    ).execute().data[0]


def upsert_contacts(db: Client, user_id, contacts: list[dict], source: str, enqueue_top: int = 0) -> dict:
    """Add a user's first-degree LinkedIn contacts: one people row each (deduped on the
    unique social_profiles.url) and two follows rows (a connection is mutual). contacts
    are in LinkedIn's order (most recent first); the first `enqueue_top` get a
    full-profile `linkedin` scrape job (~25 s each, so keep it small)."""
    def url_of(row: dict) -> str:
        return row["raw"]["linkedin"]["linkedin_url"]

    rows = list({url_of(r): r for r in (contact_row(c, source) for c in contacts
                                        if c.get("linkedin_url") and c.get("name"))}.values())
    urls = [url_of(r) for r in rows]

    def ids_for(batch: list[str]) -> dict:
        return {s["url"]: s["person_id"] for s in
                db.table("social_profiles").select("person_id, url").in_("url", batch).execute().data}

    existing: dict = {}
    for i in range(0, len(urls), 200):  # keep the IN (...) filter short
        existing.update(ids_for(urls[i:i + 200]))
    new = [r for r in rows if url_of(r) not in existing]
    for i in range(0, len(new), 500):
        people = db.table("people").insert(new[i:i + 500]).execute().data
        # ignore_duplicates: another worker may add the same profile meanwhile (url is unique)
        db.table("social_profiles").upsert(
            [{"person_id": p["id"], "platform": "linkedin", "url": url_of(p), "handle": handle(url_of(p)),
              "avatar_url": p.get("photo_url"), "raw": p["raw"]["linkedin"]} for p in people],
            on_conflict="url", ignore_duplicates=True).execute()
        exps, edus = [], []
        for p in people:
            e, s = work_rows(p["id"], p["raw"]["linkedin"])
            exps += e
            edus += s
        if exps:
            db.table("experiences").insert(exps).execute()
        if edus:
            db.table("education").insert(edus).execute()
        existing.update({url_of(p): p["id"] for p in people})

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
