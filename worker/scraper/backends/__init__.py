"""Scrape a profile URL by trying backends in order, with the disk cache in front.

Order per platform comes from SCRAPE_ORDER_<PLATFORM> (see .env.example)."""

from __future__ import annotations

import logging
import os

from .. import cache
from ..models import Profile, ScrapeError, detect_platform
from . import harness, http, zo

log = logging.getLogger("scraper")

BACKENDS = {"zo": zo.scrape, "harness": harness.scrape, "http": http.scrape}
# harness is the only verified backend. zo (slow, 1-3 min) and http (Instagram answers
# 401 logged out) stay opt-in: SCRAPE_ORDER_LINKEDIN=harness,zo
DEFAULT_ORDER = {"linkedin": "harness", "instagram": "harness", "x": "harness"}


def order_for(platform: str) -> list[str]:
    raw = os.environ.get(f"SCRAPE_ORDER_{platform.upper()}") or DEFAULT_ORDER[platform]
    return [b.strip() for b in raw.split(",") if b.strip()]


def scrape(url: str, backends: list[str] | None = None, use_cache: bool = True) -> Profile:
    platform = detect_platform(url)
    if use_cache and (hit := cache.get(platform, url)):
        log.info("cache hit %s %s (%s)", platform, url, hit.backend)
        return hit

    errors = []
    for name in backends or order_for(platform):
        if name not in BACKENDS:
            raise ScrapeError(f"unknown backend {name!r}; options: {', '.join(BACKENDS)}")
        log.info("scraping %s via %s", url, name)
        try:
            profile = BACKENDS[name](platform, url)
        except ScrapeError as e:
            log.warning("%s failed for %s: %s", name, url, e)
            errors.append(f"{name}: {e}")
            continue
        cache.put(profile)
        return profile
    raise ScrapeError("; ".join(errors) or "no backends configured")
