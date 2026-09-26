"""Traditional backend: a scripted browser-harness run. No LLM in the loop.

browser-harness (https://github.com/browser-use/browser-harness) attaches over CDP
to a real Chrome that is already signed in (use a SPARE LinkedIn/X account, see
PLAN.md > Risks). We pipe it a small Python script: open the profile, scroll so
lazy sections render, then run a fixed JS extractor (extractors/<platform>.js)
and print JSON. Fast (~10-20 s) and deterministic, but selectors can break when
the site changes its markup. The Zo backend is the fallback for that.

Setup, once per machine:
    uv tool install --python 3.12 browser-harness
    open chrome://inspect/#remote-debugging and tick "Allow remote debugging"
    browser-harness <<< 'print(page_info())'    # should print the current tab
"""

from __future__ import annotations

import json
import os
import random
import re
import shutil
import subprocess
import time
from pathlib import Path

from ..models import LoginRequired, Profile, ScrapeError, clean

EXTRACTORS = Path(__file__).resolve().parent.parent / "extractors"
SENTINEL = "__SCRAPE_RESULT__"
HOSTS = {"linkedin": "linkedin.com", "x": "x.com", "instagram": "instagram.com"}
SCROLLS = {"linkedin": 6, "x": 1, "instagram": 1}

_last_run: dict[str, float] = {}

SCRIPT = """
import json
URL = {url!r}
HOST = {host!r}
tab = next((t for t in list_tabs(include_chrome=False) if HOST in t["url"]), None)
if tab:
    switch_tab(tab)
    goto_url(URL)
else:
    new_tab(URL)
wait_for_load(timeout=25)
wait(2.5)
for _ in range({scrolls}):
    js("window.scrollBy(0, Math.round(window.innerHeight * 0.9))")
    wait(0.9)
js("window.scrollTo(0, 0)")
wait(0.5)
print({sentinel!r} + js({extractor!r}))
"""


def _bin() -> str:
    b = os.environ.get("BROWSER_HARNESS_BIN") or shutil.which("browser-harness")
    if not b:
        raise ScrapeError("browser-harness is not installed (uv tool install --python 3.12 browser-harness)")
    return b


def _throttle(platform: str) -> None:
    """Space out hits on the same site with jitter so the scraper account looks human."""
    min_delay = float(os.environ.get("HARNESS_MIN_DELAY", "8"))
    wait_s = _last_run.get(platform, 0) + min_delay + random.uniform(0, min_delay / 2) - time.time()
    if wait_s > 0:
        time.sleep(wait_s)
    _last_run[platform] = time.time()


def run_extractor(platform: str, url: str) -> dict:
    _throttle(platform)
    script = SCRIPT.format(
        url=url,
        host=HOSTS[platform],
        scrolls=SCROLLS[platform],
        sentinel=SENTINEL,
        extractor=(EXTRACTORS / f"{platform}.js").read_text(),
    )
    env = {**os.environ, "BH_TAB_MARKER": "0"}
    try:
        p = subprocess.run([_bin()], input=script, capture_output=True, text=True, timeout=150, env=env)
    except subprocess.TimeoutExpired as e:
        raise ScrapeError("browser-harness timed out after 150 s") from e
    line = next((l for l in p.stdout.splitlines() if l.startswith(SENTINEL)), None)
    if line is None:
        tail = (p.stderr or p.stdout)[-600:]
        raise ScrapeError(f"browser-harness exited {p.returncode} without a result: {tail}")
    data = json.loads(line[len(SENTINEL):])
    if data.get("blocked"):
        raise LoginRequired(data["blocked"])
    return data


# ---------- per-platform parsing ----------

_YEAR = re.compile(r"\b(19|20)\d{2}\b|Present", re.I)
_DURATION_ONLY = re.compile(r"^((Full-time|Part-time|Internship|Contract|Self-employed|Freelance)\s*·\s*)?\d+\s*(yr|yrs|mo|mos)\b", re.I)


def _count(s: str | None) -> int | None:
    """'1,234 followers' -> 1234, '12.5K Followers' -> 12500."""
    m = re.search(r"([\d.,]+)\s*([KkMm])?", s or "")
    if not m:
        return None
    n = float(m.group(1).replace(",", ""))
    return int(n * {"k": 1e3, "m": 1e6}.get((m.group(2) or "").lower(), 1))


def _parse_experience(items: list[list[str]]) -> list[dict]:
    out = []
    for lines in items:
        if len(lines) >= 3 and _DURATION_ONLY.match(lines[1]):
            # Grouped block: [Company, "Full-time · 3 yrs", <Role>, <dates>, ...]
            company, rest = lines[0], lines[2:]
        else:
            company, rest = (lines[1].split(" · ")[0] if len(lines) > 1 else None), lines
        out.append({
            "title": rest[0] if rest else None,
            "company": company,
            "dates": next((l for l in rest[1:] if _YEAR.search(l)), None),
        })
    return out


def _parse_education(items: list[list[str]]) -> list[dict]:
    return [{
        "school": lines[0],
        "degree": next((l for l in lines[1:2] if not _YEAR.search(l)), None),
        "dates": next((l for l in lines[1:] if _YEAR.search(l)), None),
    } for lines in items]


def _linkedin(url: str, d: dict) -> Profile:
    exp = _parse_experience(d.get("experience_lines") or [])
    edu = _parse_education(d.get("education_lines") or [])
    current = next((e for e in exp if e["dates"] and "present" in e["dates"].lower()), exp[0] if exp else None)
    role, company = (current or {}).get("title"), (current or {}).get("company")
    headline = clean(d.get("headline"))
    if not company and headline and " at " in headline:  # "Software Engineer at Acme"
        role, company = (s.strip() for s in headline.split(" at ", 1))
    return Profile(
        platform="linkedin", url=url, backend="harness",
        name=clean(d.get("name")), headline=headline, company=clean(company), role=clean(role),
        location=clean(d.get("location")), photo_url=d.get("photo_url"),
        raw={
            "about": clean(d.get("about")),
            "experience": exp,
            "education": edu,
            "follower_count": _count(d.get("followers")),
            # Full visible text, so the net worth LLM can re-read anything the selectors missed.
            "page_text": d.get("page_text"),
        },
    )


def _x(url: str, d: dict) -> Profile:
    return Profile(
        platform="x", url=url, backend="harness",
        name=clean(d.get("name")), headline=clean(d.get("bio")), location=clean(d.get("location")),
        photo_url=d.get("photo_url"),
        raw={"bio": clean(d.get("bio")), "website": clean(d.get("website")),
             "follower_count": _count(d.get("followers")), "following_count": _count(d.get("following"))},
    )


def _instagram(url: str, d: dict) -> Profile:
    title, desc = d.get("og_title") or "", d.get("og_description") or ""
    name = clean(title.split(" (@")[0]) if " (@" in title else None
    m = re.search(r"([\d.,]+[KkMm]?)\s+Followers,\s*([\d.,]+[KkMm]?)\s+Following", desc)
    return Profile(
        platform="instagram", url=url, backend="harness",
        name=name, headline=clean(d.get("bio")), photo_url=d.get("photo_url"),
        raw={"bio": clean(d.get("bio")),
             "follower_count": _count(m.group(1)) if m else None,
             "following_count": _count(m.group(2)) if m else None},
    )


PARSERS = {"linkedin": _linkedin, "x": _x, "instagram": _instagram}


def scrape(platform: str, url: str) -> Profile:
    return PARSERS[platform](url, run_extractor(platform, url))
