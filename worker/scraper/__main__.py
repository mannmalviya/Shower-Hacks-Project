"""Scraper worker CLI.

    uv run python -m scraper run                          # poll scrape_jobs forever
    uv run python -m scraper scrape <url> [-b harness]    # one profile -> JSON on stdout (no DB)
    uv run python -m scraper enqueue <person_id> linkedin # queue a job by hand
    uv run python -m scraper connections [--user <person_id>] [--limit 50] [--enqueue 15]
    uv run python -m scraper import-linkedin-csv Connections.csv --user <person_id> [--enqueue 15]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env.local")  # the app's file, as a fallback

from . import db as dbm  # noqa: E402
from .backends import harness, scrape  # noqa: E402
from .cache import CACHE_DIR  # noqa: E402
from .models import PLATFORMS, URL_COLUMN, ScrapeError, handle  # noqa: E402

log = logging.getLogger("scraper")

# First-degree LinkedIn connections are synced inside a signed-up user's `linkedin`
# job (scrape_jobs.platform only allows linkedin | x | instagram). Cache dir name:
CONNECTIONS_JOB = "linkedin_connections"
CONNECTIONS_LIMIT = int(os.environ.get("CONNECTIONS_LIMIT", "50"))
CONNECTIONS_ENQUEUE = int(os.environ.get("CONNECTIONS_ENQUEUE", "15"))


def get_connections(limit: int, use_cache: bool = True, expected_owner: str | None = None) -> tuple[str, list[dict]]:
    """Connections of the account signed in to the harness Chrome, cached per owner.
    expected_owner (a LinkedIn handle) guards against attaching the wrong network."""
    if use_cache and expected_owner:
        path = CACHE_DIR / CONNECTIONS_JOB / f"{expected_owner}.json"
        if path.exists() and len(cached := json.loads(path.read_text())) >= limit:
            log.info("cache hit: %d connections of %s", len(cached), expected_owner)
            return expected_owner, cached[:limit]
    owner, contacts = harness.scrape_connections(limit)
    if expected_owner and owner != expected_owner:
        raise ScrapeError(f"harness Chrome is signed in as {owner!r}, not {expected_owner!r}; "
                          "a connections list can only be read from its owner's session")
    path = CACHE_DIR / CONNECTIONS_JOB / f"{owner}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(contacts, indent=2, ensure_ascii=False))
    log.info("scraped %d connections of %s", len(contacts), owner)
    return owner, contacts


def sync_connections(db, person: dict) -> None:
    """Best effort: a failure here (e.g. the harness Chrome is signed in as someone
    else) is logged and must not fail the user's own profile job."""
    try:
        _, contacts = get_connections(CONNECTIONS_LIMIT, expected_owner=handle(person["linkedin_url"]))
        stats = dbm.upsert_contacts(db, person["id"], contacts, source=CONNECTIONS_JOB,
                                    enqueue_top=CONNECTIONS_ENQUEUE)
        log.info("connections for %s: %s", person.get("name") or person["id"], stats)
    except ScrapeError as e:
        log.warning("skipped connections for %s: %s", person.get("name") or person["id"], e)


def run_job(db, job: dict) -> None:
    person = dbm.get_person(db, job["person_id"])
    if not person:
        raise ScrapeError(f"person {job['person_id']} not found")
    platform = job["platform"]
    if platform not in PLATFORMS:
        raise ScrapeError(f"unknown platform {platform!r}")
    url = person.get(URL_COLUMN[platform])
    if not url:
        raise ScrapeError(f"person has no {URL_COLUMN[platform]}")
    if platform == "linkedin" and person.get("user_id"):
        # A signed-up user: pull their network first, since the crowd is what the 3D page shows.
        sync_connections(db, person)
        person = dbm.get_person(db, person["id"])
    profile = scrape(url)
    dbm.save_profile(db, person, profile)
    log.info("saved %s %s -> %s (%s)", platform, url, profile.name, profile.backend)


def cmd_run(args) -> None:
    db = dbm.client()
    log.info("worker polling scrape_jobs every %ss", args.interval)
    while True:
        job = dbm.claim_next_job(db)
        if not job:
            if args.once:
                return
            time.sleep(args.interval)
            continue
        log.info("job %s: %s for person %s", job["id"], job["platform"], job["person_id"])
        try:
            run_job(db, job)
            dbm.finish_job(db, job["id"])
        except Exception as e:  # one bad job must not kill the worker
            log.exception("job %s failed", job["id"])
            dbm.finish_job(db, job["id"], error=f"{type(e).__name__}: {e}")


def cmd_scrape(args) -> None:
    backends = args.backend.split(",") if args.backend else None
    profile = scrape(args.url, backends=backends, use_cache=not args.no_cache)
    json.dump(profile.to_dict(), sys.stdout, indent=2, ensure_ascii=False)
    print()


def cmd_enqueue(args) -> None:
    print(json.dumps(dbm.enqueue(dbm.client(), args.person_id, args.platform), indent=2, default=str))


def cmd_connections(args) -> None:
    if not args.user:
        owner, contacts = get_connections(args.limit, use_cache=False)
        json.dump({"owner": owner, "count": len(contacts), "connections": contacts},
                  sys.stdout, indent=2, ensure_ascii=False)
        print()
        return
    db = dbm.client()
    person = dbm.get_person(db, args.user)
    if not person:
        raise SystemExit(f"person {args.user} not found")
    _, contacts = get_connections(args.limit, use_cache=not args.no_cache,
                                  expected_owner=handle(person["linkedin_url"]))
    print(json.dumps(dbm.upsert_contacts(db, person["id"], contacts, CONNECTIONS_JOB, args.enqueue), indent=2))


def cmd_import_csv(args) -> None:
    from .linkedin_export import import_connections
    print(json.dumps(import_connections(dbm.client(), Path(args.path), args.user, args.enqueue), indent=2))


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    for noisy in ("httpx", "httpcore", "hpack"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    ap = argparse.ArgumentParser(prog="scraper")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("run", help="poll scrape_jobs and process them")
    p.add_argument("--interval", type=float, default=1.0)
    p.add_argument("--once", action="store_true", help="exit when the queue is empty (for tests)")
    p.set_defaults(fn=cmd_run)

    p = sub.add_parser("scrape", help="scrape one URL and print JSON (no database)")
    p.add_argument("url")
    p.add_argument("-b", "--backend", help="comma list: zo,harness,http (default: SCRAPE_ORDER_<PLATFORM>)")
    p.add_argument("--no-cache", action="store_true")
    p.set_defaults(fn=cmd_scrape)

    p = sub.add_parser("enqueue", help="insert a queued scrape_jobs row")
    p.add_argument("person_id")
    p.add_argument("platform", choices=PLATFORMS)
    p.set_defaults(fn=cmd_enqueue)

    p = sub.add_parser("connections", help="first-degree LinkedIn connections of the signed-in account")
    p.add_argument("--user", help="people.id of the signed-in user: write people + follows (omit to print JSON)")
    p.add_argument("--limit", type=int, default=CONNECTIONS_LIMIT)
    p.add_argument("--enqueue", type=int, default=CONNECTIONS_ENQUEUE, help="queue full scrapes for the N most recent")
    p.add_argument("--no-cache", action="store_true")
    p.set_defaults(fn=cmd_connections)

    p = sub.add_parser("import-linkedin-csv", help="import LinkedIn's official Connections.csv")
    p.add_argument("path")
    p.add_argument("--user", required=True, help="people.id of the user who owns the export")
    p.add_argument("--enqueue", type=int, default=0, help="also queue full scrapes for the N most recent connections")
    p.set_defaults(fn=cmd_import_csv)

    args = ap.parse_args()
    try:
        args.fn(args)
    except ScrapeError as e:
        sys.exit(f"scrape failed: {e}")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
