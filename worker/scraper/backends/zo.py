"""Agent backend: ask Zo Computer to read the profile in its own logged-in browser.

Zo's cloud browser keeps sessions (sign in to LinkedIn / X / Instagram once in
Zo > Settings > Tools > "Open Zo's browser"). We send a prompt plus a JSON schema
to POST https://api.zo.computer/zo/ask and get structured JSON back. The agent
clicks, scrolls and reads like a person does, which gets past LinkedIn's DOM
churn and authwall better than a fixed script. It is slower (often 1-3 min).
Docs: https://docs.zocomputer.com/api-reference/ai/ask-zo.md
"""

from __future__ import annotations

import json
import os

import httpx

from ..models import LoginRequired, Profile, ScrapeError, clean

ZO_ASK_URL = "https://api.zo.computer/zo/ask"

_str = {"type": "string"}
_num = {"type": "number"}

OUTPUT_SCHEMA = {
    "type": "object",
    "description": "One social media profile, read from the live page.",
    "properties": {
        "found": {"type": "boolean"},
        "blocked_reason": _str,
        "name": _str,
        "headline": _str,
        "current_company": _str,
        "current_role": _str,
        "location": _str,
        "photo_url": _str,
        "about": _str,
        "follower_count": _num,
        "following_count": _num,
        "experience": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"title": _str, "company": _str, "dates": _str, "location": _str},
                "required": ["title", "company", "dates", "location"],
            },
        },
        "education": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"school": _str, "degree": _str, "dates": _str},
                "required": ["school", "degree", "dates"],
            },
        },
    },
    "required": [
        "found", "blocked_reason", "name", "headline", "current_company", "current_role",
        "location", "photo_url", "about", "follower_count", "following_count",
        "experience", "education",
    ],
}

_RULES = """
Rules:
- READ ONLY. Do not connect, follow, message, like, comment, endorse or change any setting.
- If you hit a login wall, captcha, "sign in to view" page or security checkpoint, stop and return found=false with blocked_reason describing it. Do not try to get around it.
- Use "" for unknown text fields, -1 for unknown counts, [] for missing lists. Never guess.
- photo_url must be the direct image URL (src of the profile picture <img>), not the page URL.
"""

PROMPTS = {
    "linkedin": """Use your web browser (you are signed in to LinkedIn) to open this LinkedIn profile:
{url}

Read the top card (name, headline, location, profile photo), the About section, and the full
Experience and Education sections. If a section has a "Show all" link, open it to read every entry,
then come back. For grouped roles at one company, list each role as its own experience entry.
current_company / current_role come from the most recent experience entry without an end date.
follower_count is the "N followers" number on the profile.
""" + _RULES,
    "x": """Use your web browser (you are signed in to X) to open this X / Twitter profile:
{url}

Read the display name (name), bio (headline and about), location, profile photo, and the
followers / following counts. If the bio names an employer or role ("SWE @acme", "CEO of X"),
put it in current_company / current_role. experience and education are [] unless the bio lists them.
""" + _RULES,
    "instagram": """Use your web browser (you are signed in to Instagram) to open this Instagram profile:
{url}

Read the full name (name), bio (headline and about), profile photo, and the followers / following
counts. If the bio or category names an employer or role, put it in current_company / current_role.
location is only filled when the profile states it. experience and education are [].
""" + _RULES,
}


def scrape(platform: str, url: str) -> Profile:
    key = os.environ.get("ZO_API_KEY")
    if not key:
        raise ScrapeError("ZO_API_KEY is not set")

    body = {
        "input": PROMPTS[platform].format(url=url),
        "output_format": OUTPUT_SCHEMA,
        "memory_mode": "off",
    }
    try:
        r = httpx.post(
            ZO_ASK_URL,
            headers={"Authorization": f"Bearer {key}"},
            json=body,
            # The agent drives a real browser; give it room.
            timeout=httpx.Timeout(600.0, connect=15.0),
        )
    except httpx.HTTPError as e:
        raise ScrapeError(f"zo request failed: {e}") from e
    if r.status_code != 200:
        raise ScrapeError(f"zo HTTP {r.status_code}: {r.text[:300]}")

    data = r.json()
    if data.get("error"):
        raise ScrapeError(f"zo error: {data['error']}")
    out = data.get("output")
    if isinstance(out, str):
        try:
            out = json.loads(out)
        except json.JSONDecodeError as e:
            raise ScrapeError(f"zo returned non-JSON output: {out[:300]}") from e
    if not isinstance(out, dict):
        raise ScrapeError(f"zo returned unexpected output: {out!r:.300}")
    if not out.get("found"):
        raise LoginRequired(f"zo could not read the profile: {out.get('blocked_reason') or 'unknown'}")

    counts = {k: out[k] for k in ("follower_count", "following_count") if (out.get(k) or -1) >= 0}
    return Profile(
        platform=platform,
        url=url,
        backend="zo",
        name=clean(out.get("name")),
        headline=clean(out.get("headline")),
        company=clean(out.get("current_company")),
        role=clean(out.get("current_role")),
        location=clean(out.get("location")),
        photo_url=clean(out.get("photo_url")),
        raw={
            "about": clean(out.get("about")),
            "experience": out.get("experience") or [],
            "education": out.get("education") or [],
            **counts,
            "zo_conversation_id": data.get("conversation_id"),
        },
    )
