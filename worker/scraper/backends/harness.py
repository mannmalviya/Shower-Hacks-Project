"""Traditional backend: a scripted browser-harness run. No LLM in the loop.

browser-harness (https://github.com/browser-use/browser-harness) attaches over CDP
to a real Chrome that is already signed in (the user's own account: LinkedIn's
User Agreement forbids fake accounts). We pipe it a small Python script that opens its own background
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

from ..models import LoginRequired, Profile, ScrapeError, clean, handle

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


# ---------- Instagram followers (list data only: username, name, photo) ----------

# Opens the profile, clicks "N followers" (the /followers/ URL alone does not open
# the list), and scrolls the dialog until it holds `limit` people or stops growing. Instagram only
# shows the list to a signed-in account, and a private account's list only to its
# followers.
FOLLOWERS_SCRIPT = """
import json
LIMIT = {limit!r}
EXTRACTOR = {extractor!r}
SCROLL = {scroll!r}
OPEN = {open_list!r}
tid = cdp("Target.createTarget", url="about:blank", background=True)["targetId"]
switch_tab(tid)
cdp("Emulation.setFocusEmulationEnabled", enabled=True)
out = {{"rows": [], "blocked": None}}
try:
    goto_url({url!r})
    wait_for_load(timeout=25)
    rows = []
    for _ in range(8):
        wait(1.5)
        js(OPEN)
        if "/accounts/login" in js("location.href"):
            out["blocked"] = "login wall: sign in to Instagram in the harness Chrome"
            break
        rows = json.loads(js(EXTRACTOR))
        if rows:
            break
    if not rows and not out["blocked"]:
        out["blocked"] = "followers list not visible (private account, or the page layout changed)"
    stale = 0
    while rows and len(rows) < LIMIT and stale < 3:
        js(SCROLL)
        wait(1.5)
        grown = json.loads(js(EXTRACTOR))
        stale = stale + 1 if len(grown) <= len(rows) else 0
        rows = grown if len(grown) > len(rows) else rows
    out["rows"] = rows[:LIMIT]
finally:
    try:
        close_tab(tid)
    except Exception:
        pass
print({sentinel!r} + json.dumps(out))
"""

# One row per profile link in the dialog. The row is the biggest box around the
# link that holds no other profile. Its text lines: username, full name, buttons.
_FOLLOWER_ROWS_JS = """JSON.stringify((() => {
  const dlg = document.querySelector('div[role="dialog"]');
  if (!dlg) return [];
  const skip = /^(follow|following|remove|message|requested|verified|·)$/i;
  const seen = new Map();
  for (const a of dlg.querySelectorAll('a[href^="/"]')) {
    const m = a.getAttribute('href').match(/^\\/([A-Za-z0-9_.]+)\\/?$/);
    if (!m || seen.has(m[1])) continue;
    let row = a;
    while (row.parentElement && row.parentElement !== dlg &&
           new Set([...row.parentElement.querySelectorAll('a[href^="/"]')].map(x => x.getAttribute('href'))).size <= 1) row = row.parentElement;
    const lines = row.innerText.split('\\n').map(s => s.trim()).filter(s => s && !skip.test(s) && s !== m[1]);
    const img = row.querySelector('img');
    seen.set(m[1], {username: m[1], full_name: lines[0] || null, photo_url: img ? img.src : null});
  }
  return [...seen.values()];
})())"""

_OPEN_FOLLOWERS_JS = """(() => {
  if (document.querySelector('div[role="dialog"]')) return true;
  const a = [...document.querySelectorAll('header a, main a')].find(a => /followers$/i.test(a.innerText.trim()));
  if (a) a.click();
  return !!a;
})()"""

_SCROLL_DIALOG_JS = """(() => {
  const dlg = document.querySelector('div[role="dialog"]');
  const box = dlg && [...dlg.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(d).overflowY));
  if (box) box.scrollTop = box.scrollHeight;
  return !!box;
})()"""


def scrape_followers(url: str, limit: int = 100) -> list[dict]:
    """-> [{username, full_name, photo_url}] in the order Instagram lists them."""
    _throttle("instagram")
    script = FOLLOWERS_SCRIPT.format(
        url=f"https://www.instagram.com/{handle(url)}/", limit=limit,
        extractor=_FOLLOWER_ROWS_JS, scroll=_SCROLL_DIALOG_JS, open_list=_OPEN_FOLLOWERS_JS, sentinel=SENTINEL,
    )
    data = _run_script(script, timeout=90 + limit)
    if data.get("blocked"):
        raise LoginRequired(data["blocked"]) if "login" in data["blocked"] else ScrapeError(data["blocked"])
    return [{**r, "full_name": clean(r.get("full_name"))} for r in data["rows"]]
