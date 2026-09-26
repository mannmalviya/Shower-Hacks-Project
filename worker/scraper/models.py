"""Normalized scrape result. Every backend returns a Profile, so the DB code never
cares which backend (Zo, browser-harness, plain HTTP) produced it."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from urllib.parse import urlparse

PLATFORMS = ("linkedin", "x", "instagram")

# people.<column> that holds each platform's profile URL (see PLAN.md > Data)
URL_COLUMN = {"linkedin": "linkedin_url", "x": "x_url", "instagram": "instagram_url"}


class ScrapeError(Exception):
    pass


class LoginRequired(ScrapeError):
    """The site showed a login wall / auth wall / checkpoint instead of the profile."""


@dataclass
class Profile:
    platform: str
    url: str
    backend: str = ""
    name: str | None = None
    headline: str | None = None
    company: str | None = None
    role: str | None = None
    location: str | None = None
    photo_url: str | None = None
    # Everything else (experience, education, bio, follower counts, page text...).
    # Goes into people.raw[platform]; the net worth step reads work history from here.
    raw: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Profile":
        return cls(**{k: d.get(k) for k in cls.__dataclass_fields__ if k in d})


def detect_platform(url: str) -> str:
    host = (urlparse(url).hostname or "").removeprefix("www.")
    if host.endswith("linkedin.com"):
        return "linkedin"
    if host in ("x.com", "twitter.com", "mobile.twitter.com"):
        return "x"
    if host.endswith("instagram.com"):
        return "instagram"
    raise ScrapeError(f"unsupported profile URL: {url}")


def handle(url: str) -> str:
    """linkedin.com/in/jane-doe-123/ -> jane-doe-123, x.com/jane -> jane."""
    parts = [p for p in urlparse(url).path.split("/") if p]
    if parts and parts[0] == "in":
        parts = parts[1:]
    if not parts:
        raise ScrapeError(f"no profile handle in URL: {url}")
    return re.sub(r"[^A-Za-z0-9_.-]", "", parts[0]).lower()


def clean(s) -> str | None:
    if s is None:
        return None
    s = re.sub(r"\s+", " ", str(s)).strip()
    return s or None
