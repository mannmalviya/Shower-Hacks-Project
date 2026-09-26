"""Disk cache of scrape results: worker/.cache/<platform>/<handle>.json.

Scraping takes 30-90 s per profile and risks bans, so every success is cached and
reused. Warm the cache before the demo and the worker never touches the network."""

from __future__ import annotations

import json
from pathlib import Path

from .models import Profile, handle

CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"


def _path(platform: str, url: str) -> Path:
    return CACHE_DIR / platform / f"{handle(url)}.json"


def get(platform: str, url: str) -> Profile | None:
    p = _path(platform, url)
    if not p.exists():
        return None
    return Profile.from_dict(json.loads(p.read_text()))


def put(profile: Profile) -> None:
    p = _path(profile.platform, profile.url)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(profile.to_dict(), indent=2, ensure_ascii=False))
