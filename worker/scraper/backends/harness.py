"""Traditional backend: a scripted browser-harness run. No LLM in the loop.

browser-harness (https://github.com/browser-use/browser-harness) attaches over CDP
to a real Chrome that is already signed in (use a SPARE LinkedIn/X account, see
PLAN.md > Risks). We pipe it a small Python script that opens its own background
tab, visits the profile (for LinkedIn also /details/experience/ and
/details/education/), runs a fixed JS extractor (extractors/<platform>.js) and
prints JSON. ~25 s per LinkedIn profile and deterministic, but selectors can break
when the site changes its markup. The Zo backend is the fallback for that.

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

from ..models import LoginRequired, Profile, ScrapeError, clean, handle, linkedin_profile_url

EXTRACTORS = Path(__file__).resolve().parent.parent / "extractors"
SENTINEL = "__SCRAPE_RESULT__"
SCROLLS = {"linkedin": 2, "x": 1, "instagram": 1}

_last_run: dict[str, float] = {}

# Runs inside browser-harness. Opens its OWN background tab (never touches the
# user's tabs), emulates focus so the site renders while hidden, visits each page,
# retries the extractor until the page has rendered, then closes the tab.
SCRIPT = """
import json
PAGES = {pages!r}
EXTRACTOR = {extractor!r}
tid = cdp("Target.createTarget", url="about:blank", background=True)["targetId"]
switch_tab(tid)
cdp("Emulation.setFocusEmulationEnabled", enabled=True)
out = {{}}
try:
    for key, url in PAGES:
        goto_url(url)
        wait_for_load(timeout=25)
        wait(2.5)
        for _ in range({scrolls}):
            js("window.scrollBy(0, Math.round(window.innerHeight * 0.9))")
            wait(0.8)
        for attempt in range(5):
            res = json.loads(js(EXTRACTOR))
            if "login wall" in (res.get("blocked") or "") or (not res.get("blocked") and res.get("items", [1])):
                break
            wait(2)
        out[key] = res
        if key == "top" and res.get("blocked"):
            break
finally:
    try:
        close_tab(tid)
    except Exception:
        pass
print({sentinel!r} + json.dumps(out))
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


def _pages(platform: str, url: str) -> list[tuple[str, str]]:
    if platform != "linkedin":
        return [("top", url)]
    base = f"https://www.linkedin.com/in/{handle(url)}/"
    return [("top", base), ("experience", base + "details/experience/"), ("education", base + "details/education/")]


def _run_script(script: str, timeout: int) -> dict:
    env = {**os.environ, "BH_TAB_MARKER": "0"}
    try:
        p = subprocess.run([_bin()], input=script, capture_output=True, text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired as e:
        raise ScrapeError(f"browser-harness timed out after {timeout} s") from e
    line = next((l for l in p.stdout.splitlines() if l.startswith(SENTINEL)), None)
    if line is None:
        tail = (p.stderr or p.stdout)[-600:]
        raise ScrapeError(f"browser-harness exited {p.returncode} without a result: {tail}")
    return json.loads(line[len(SENTINEL):])


def run_extractor(platform: str, url: str) -> dict:
    """-> {"top": {...}, "experience": {"items": [...]}, ...} (one key per page visited)."""
    _throttle(platform)
    script = SCRIPT.format(
        pages=_pages(platform, url),
        scrolls=SCROLLS[platform],
        sentinel=SENTINEL,
        extractor=(EXTRACTORS / f"{platform}.js").read_text(),
    )
    data = _run_script(script, timeout=150)
    if (data.get("top") or {}).get("blocked"):
        raise LoginRequired(data["top"]["blocked"])
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


def _linkedin(url: str, pages: dict) -> Profile:
    d = pages["top"]
    exp = _parse_experience((pages.get("experience") or {}).get("items") or [])
    edu = _parse_education((pages.get("education") or {}).get("items") or [])
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
            "experience": exp,
            "education": edu,
            "follower_count": _count(d.get("followers")),
            "connections": clean(d.get("connections")),
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
    pages = run_extractor(platform, url)
    return PARSERS[platform](url, pages if platform == "linkedin" else pages["top"])


# ---------- LinkedIn connections (the signed-in account's first-degree network) ----------

# LinkedIn only shows a connections list to its owner, so this reads the connections
# of whoever is signed in to the harness Chrome. The script first resolves /in/me/
# to the signed-in handle, so the caller can refuse to attach one person's network
# to someone else. The list shows 10 cards and grows via a "Load more" button.
CONNECTIONS_SCRIPT = """
import json
LIMIT = {limit!r}
EXTRACTOR = {extractor!r}
CLICK_MORE = {click_more!r}
tid = cdp("Target.createTarget", url="about:blank", background=True)["targetId"]
switch_tab(tid)
cdp("Emulation.setFocusEmulationEnabled", enabled=True)
out = {{"owner": None, "cards": [], "blocked": None}}
try:
    goto_url("https://www.linkedin.com/in/me/")
    wait_for_load(timeout=25)
    wait(2)
    out["owner"] = js("location.href")
    goto_url("https://www.linkedin.com/mynetwork/invite-connect/connections/")
    wait_for_load(timeout=25)
    cards = []
    for _ in range(8):
        wait(1.5)
        cards = json.loads(js(EXTRACTOR))
        if cards:
            break
    if not cards:
        out["blocked"] = "no connection cards (logged out, or the page layout changed): " + js("location.href")
    while cards and len(cards) < LIMIT:
        if not js(CLICK_MORE):
            break
        grown = cards
        for _ in range(10):
            wait(1.2)
            grown = json.loads(js(EXTRACTOR))
            if len(grown) > len(cards):
                break
        if len(grown) <= len(cards):
            break
        cards = grown
        wait(0.8)
    out["cards"] = cards[:LIMIT]
finally:
    try:
        close_tab(tid)
    except Exception:
        pass
print({sentinel!r} + json.dumps(out))
"""

_CONNECTION_CARDS_JS = """JSON.stringify([...document.querySelectorAll('[componentkey^="ConnectionCard_"]')].map(c => {
  const a = c.querySelector('a[href*="/in/"]');
  const img = [...c.querySelectorAll('img')].find(i => /media\\.licdn\\.com/.test(i.src));
  return {url: a ? a.href.split('?')[0] : null,
          lines: c.innerText.split('\\n').map(s => s.trim()).filter(Boolean).slice(0, 4),
          photo_url: img ? img.src : null};
}).filter(c => c.url))"""

_CLICK_MORE_JS = """(() => {
  const b = [...document.querySelectorAll('main button')].find(b => /^(load|show) more/i.test(b.innerText.trim()));
  if (!b) return false;
  b.scrollIntoView({block: 'center'});
  b.click();
  return true;
})()"""


def _split_headline(headline: str | None) -> tuple[str | None, str | None]:
    """'SWE at Acme' / 'SWE @ Acme | ...' -> ('SWE', 'Acme'). Otherwise (None, None)."""
    m = re.match(r"^\s*(.+?)\s+(?:at|@)\s+([^|·,]+)", headline or "", re.I)
    return (clean(m.group(1)), clean(m.group(2))) if m else (None, None)


def scrape_connections(limit: int = 50) -> tuple[str, list[dict]]:
    """-> (signed-in owner's handle, [{name, headline, role, company, linkedin_url, photo_url, connected_on}])."""
    _throttle("linkedin")
    script = CONNECTIONS_SCRIPT.format(
        limit=limit, extractor=_CONNECTION_CARDS_JS, click_more=_CLICK_MORE_JS, sentinel=SENTINEL,
    )
    data = _run_script(script, timeout=60 + limit * 3)
    owner = data.get("owner") or ""
    if "/in/" not in owner:
        raise LoginRequired(f"not signed in to LinkedIn in the harness Chrome ({owner or 'no page'})")
    if data.get("blocked"):
        raise ScrapeError(data["blocked"])

    contacts = []
    for c in data["cards"]:
        lines = c.get("lines") or []
        connected = next((l for l in lines if l.lower().startswith("connected on")), None)
        headline = next((l for l in lines[1:] if l != connected and l.lower() != "message"), None)
        role, company = _split_headline(headline)
        contacts.append({
            "name": clean(lines[0]) if lines else None,
            "headline": clean(headline),
            "role": role,
            "company": company,
            "linkedin_url": linkedin_profile_url(c["url"]),
            "photo_url": c.get("photo_url"),
            "connected_on": connected[len("connected on"):].strip() if connected else None,
        })
    return handle(owner), [c for c in contacts if c["name"]]
