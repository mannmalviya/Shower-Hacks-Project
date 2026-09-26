"""Map scraper output onto the team's data contract (seed/README.md).

people.raw[<platform>] uses the field names of common scraper tools (LinkedIn:
experiences[].position_title / institution_name / from_date / to_date, ...), so
src/lib/analysis.ts reads real and seed data the same way. The keys of raw are the
person's platforms, so only platform names go there. Top-level columns come from
the first platform in PRIORITY that has a value.
"""

from __future__ import annotations

import re

from .models import Profile, clean, handle, linkedin_profile_url

PRIORITY = ("linkedin", "github", "x", "facebook", "instagram")
TOP_FIELDS = ("name", "headline", "company", "role", "location", "photo_url")

# Headline orgs that are schools, not employers ("Student at UC Berkeley").
SCHOOL_RE = re.compile(
    r"universit|college|school|institute|academy|polytechnic|conservatory|\bUC\s|\bUC$|"
    r"\b(UCLA|UCSD|UCSC|UCSB|UCI|UIUC|USC|MIT|CMU|NYU|NJIT|RPI|WPI|CUHK|HKUST|NUS|ETH|EPFL)\b|"
    r"berkeley|stanford|harvard|yale|princeton|caltech|georgia tech",
    re.I,
)


def canon_school(name: str | None) -> str | None:
    """Spell schools the way the seed and analysis do, so circles match across sources:
    'University of California, Berkeley' / 'Berkeley' / 'Cal' -> 'UC Berkeley'."""
    name = clean(name)
    if not name:
        return name
    m = re.match(r"^(?:the\s+)?university of california,?\s+(.+)$", name, re.I)
    if m:
        return f"UC {m.group(1).strip()}"
    if re.fullmatch(r"(u\.?\s?c\.?\s*)?berkeley|cal", name, re.I):
        return "UC Berkeley"
    return name


def _drop_empty(d: dict) -> dict:
    return {k: v for k, v in d.items() if v not in (None, "", [], {})}


def split_dates(s: str | None) -> tuple[str | None, str | None]:
    """'Sep 2025 - Present · 1 yr 1 mo' -> ('Sep 2025', 'Present'); '2022 – 2025' -> ('2022', '2025')."""
    if not s:
        return None, None
    parts = re.split(r"\s+[-–—]\s+", s.split(" · ")[0].strip(), maxsplit=1)
    return clean(parts[0]), clean(parts[1]) if len(parts) > 1 else None


def split_headline(headline: str | None) -> tuple[str | None, str | None, str | None]:
    """-> (role, company, school). 'SWE at Stripe | ex-Meta' -> ('SWE', 'Stripe', None);
    'Student @ UC Berkeley | Building' -> ('Student', None, 'UC Berkeley')."""
    m = re.match(r"^\s*(.+?)(?:\s+at\s+|\s*@\s*)([^|·]+)", headline or "", re.I)
    if m:
        role, org = clean(m.group(1)), clean(m.group(2))
        if org and not re.match(r"(the\s+)?university of california,", org, re.I):
            org = clean(org.split(",")[0])  # "Stripe, ex-Meta" -> "Stripe"
        return (role, None, canon_school(org)) if SCHOOL_RE.search(org or "") else (role, org, None)
    school = next((clean(p) for p in re.split(r"[|·,]", headline or "") if SCHOOL_RE.search(p)), None)
    return None, None, canon_school(school)


# ---------- one scraped profile -> raw[platform] ----------

def raw_entry(p: Profile) -> dict:
    r = p.raw or {}
    if p.platform == "linkedin":
        exps = []
        for e in r.get("experience") or []:
            start, end = split_dates(e.get("dates"))
            exps.append(_drop_empty({"position_title": e.get("title"), "institution_name": e.get("company"),
                                     "from_date": start, "to_date": end, "location": e.get("location")}))
        edus = []
        for e in r.get("education") or []:
            start, end = split_dates(e.get("dates"))
            edus.append(_drop_empty({"institution_name": canon_school(e.get("school")), "degree": e.get("degree"),
                                     "from_date": start, "to_date": end}))
        return _drop_empty({
            "linkedin_url": linkedin_profile_url(p.url), "name": p.name, "headline": p.headline,
            "location": p.location, "photo_url": p.photo_url, "about": r.get("about"),
            "experiences": exps, "educations": edus,
            "follower_count": r.get("follower_count"), "connections": r.get("connections"),
            "page_text": r.get("page_text"), "scraped_by": p.backend,
        })
    if p.platform == "instagram":
        return _drop_empty({
            "username": r.get("username") or handle(p.url), "full_name": p.name,
            "biography": r.get("bio") or p.headline,
            "edge_followed_by": {"count": r["follower_count"]} if r.get("follower_count") is not None else None,
            "edge_follow": {"count": r["following_count"]} if r.get("following_count") is not None else None,
            "is_private": r.get("is_private"), "is_verified": r.get("is_verified"),
            "category_name": r.get("category"), "external_url": r.get("external_url"),
            "profile_pic_url": p.photo_url, "scraped_by": p.backend,
        })
    if p.platform == "x":
        return _drop_empty({
            "username": handle(p.url), "displayname": p.name, "rawDescription": r.get("bio") or p.headline,
            "location": p.location, "followersCount": r.get("follower_count"),
            "friendsCount": r.get("following_count"), "url": r.get("website"),
            "profile_image_url": p.photo_url, "scraped_by": p.backend,
        })
    raise ValueError(f"unknown platform {p.platform}")


def top_fields(platform: str, e: dict) -> dict:
    """Top-level people columns that one raw[platform] entry can fill."""
    if platform == "linkedin":
        exps = e.get("experiences") or []
        cur = next((x for x in exps if (x.get("to_date") or "").lower() == "present"), exps[0] if exps else {})
        role, company = cur.get("position_title"), cur.get("institution_name")
        if not company:
            role, company, _ = split_headline(e.get("headline"))
        return {"name": e.get("name"), "headline": e.get("headline"), "company": company, "role": role,
                "location": e.get("location"), "photo_url": e.get("photo_url")}
    if platform == "x":
        return {"name": e.get("displayname"), "headline": e.get("rawDescription"), "location": e.get("location"),
                "photo_url": e.get("profile_image_url")}
    if platform == "instagram":
        return {"name": e.get("full_name"), "headline": e.get("biography"), "photo_url": e.get("profile_pic_url")}
    if platform == "github":
        return {"name": e.get("name"), "headline": e.get("bio"), "location": e.get("location"),
                "company": (e.get("company") or "").lstrip("@") or None}
    if platform == "facebook":
        return {"name": e.get("Name")}
    return {}


def merged_top(raw: dict) -> dict:
    out = {}
    for f in TOP_FIELDS:
        for platform in PRIORITY:
            if isinstance(raw.get(platform), dict) and (v := top_fields(platform, raw[platform]).get(f)):
                out[f] = v
                break
    return out
