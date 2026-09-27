"""Scraper worker CLI.

    uv run python -m scraper run                          # poll scrape_jobs forever
    uv run python -m scraper scrape <url> [-b harness]    # one profile -> JSON on stdout (no DB)
    uv run python -m scraper followers <instagram url> [--limit 100]  # followers list -> JSON (no DB)
    uv run python -m scraper enqueue <person_id> linkedin # queue a job by hand
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
from .models import PLATFORMS, ScrapeError  # noqa: E402

log = logging.getLogger("scraper")

# Instagram followers of the job's person: how many to read from the list, and how
# many of those get a full profile visit (~10 s each, the rest keep list data only).
FOLLOWERS_LIMIT = int(os.environ.get("FOLLOWERS_LIMIT", "100"))
FOLLOWERS_VISIT = int(os.environ.get("FOLLOWERS_VISIT", "10"))


def sync_followers(db, person: dict, url: str) -> None:
    """Followers list -> people + social_profiles + follows (they follow the person).
    Raises ScrapeError when the list is not visible (private account, logged out)."""
    followers = harness.scrape_followers(url, FOLLOWERS_LIMIT)
    ids = dbm.upsert_followers(db, person["id"], followers)
    log.info("%d followers for %s", len(ids), person.get("name") or person["id"])
    for f_url, pid in list(ids.items())[:FOLLOWERS_VISIT]:
        try:
            dbm.save_profile(db, dbm.get_person(db, pid), scrape(f_url))
        except ScrapeError as e:  # one bad profile must not stop the rest
            log.warning("follower %s: %s", f_url, e)


def run_job(db, job: dict) -> None:
    person = dbm.get_person(db, job["person_id"])
    if not person:
        raise ScrapeError(f"person {job['person_id']} not found")
    platform = job["platform"]
    if platform not in PLATFORMS:
        raise ScrapeError(f"unknown platform {platform!r}")
    url = person["urls"].get(platform)
    if not url:
        raise ScrapeError(f"person has no {platform} social_profiles row")
    profile = scrape(url)
    dbm.save_profile(db, person, profile)
    log.info("saved %s %s -> %s (%s)", platform, url, profile.name, profile.backend)
    if platform == "instagram":
        sync_followers(db, person, url)


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


def cmd_followers(args) -> None:
    followers = harness.scrape_followers(args.url, args.limit)
    json.dump({"count": len(followers), "followers": followers}, sys.stdout, indent=2, ensure_ascii=False)
    print()


def cmd_enqueue(args) -> None:
    print(json.dumps(dbm.enqueue(dbm.client(), args.person_id, args.platform), indent=2, default=str))


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

    p = sub.add_parser("followers", help="read an Instagram followers list and print JSON (no database)")
    p.add_argument("url")
    p.add_argument("--limit", type=int, default=FOLLOWERS_LIMIT)
    p.set_defaults(fn=cmd_followers)

    p = sub.add_parser("enqueue", help="insert a queued scrape_jobs row")
    p.add_argument("person_id")
    p.add_argument("platform", choices=PLATFORMS)
    p.set_defaults(fn=cmd_enqueue)

    args = ap.parse_args()
    try:
        args.fn(args)
    except ScrapeError as e:
        sys.exit(f"scrape failed: {e}")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
