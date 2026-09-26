"""Scraper worker CLI.

    uv run python -m scraper run                          # poll scrape_jobs forever
    uv run python -m scraper scrape <url> [-b harness]    # one profile -> JSON on stdout (no DB)
    uv run python -m scraper enqueue <person_id> linkedin # queue a job by hand
    uv run python -m scraper import-linkedin-csv Connections.csv --user <person_id> [--enqueue 15]
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from . import db as dbm  # noqa: E402
from .backends import scrape  # noqa: E402
from .models import PLATFORMS, URL_COLUMN, ScrapeError  # noqa: E402

log = logging.getLogger("scraper")


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
    profile = scrape(url)
    dbm.save_profile(db, person, profile)
    log.info("saved %s %s -> %s (%s)", platform, url, profile.name, profile.backend)


def cmd_run(args) -> None:
    db = dbm.client()
    log.info("worker polling scrape_jobs every %ss", args.interval)
    while True:
        job = dbm.claim_next_job(db)
        if not job:
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
    p.add_argument("--interval", type=float, default=2.0)
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
