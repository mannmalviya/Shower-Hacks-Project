"""Plain HTTP backend (no browser, no login). Only Instagram has a usable public
endpoint: the JSON that instagram.com's own web app calls for a profile header.
It works for public accounts and gets rate-limited (HTTP 401/429) after a burst,
so it is first in line for Instagram and the browser backends are the fallback.
LinkedIn and X have no logged-out equivalent, so they are not supported here.
"""

from __future__ import annotations

import httpx

from ..models import LoginRequired, Profile, ScrapeError, clean, handle

IG_URL = "https://i.instagram.com/api/v1/users/web_profile_info/"
IG_HEADERS = {
    # Public app id of instagram.com's web client; the endpoint rejects requests without it.
    "x-ig-app-id": "936619743392459",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    "Accept": "application/json",
}


def _instagram(url: str) -> Profile:
    try:
        r = httpx.get(IG_URL, params={"username": handle(url)}, headers=IG_HEADERS, timeout=20)
    except httpx.HTTPError as e:
        raise ScrapeError(f"instagram request failed: {e}") from e
    if r.status_code in (401, 403, 429):
        raise LoginRequired(f"instagram rate-limited / login required (HTTP {r.status_code})")
    if r.status_code == 404:
        raise ScrapeError("instagram profile not found")
    if r.status_code != 200:
        raise ScrapeError(f"instagram HTTP {r.status_code}")
    try:
        u = r.json()["data"]["user"]
    except (ValueError, KeyError, TypeError) as e:
        raise ScrapeError("instagram returned an unexpected payload") from e
    if u is None:
        raise ScrapeError("instagram profile not found")

    return Profile(
        platform="instagram", url=url, backend="http",
        name=clean(u.get("full_name")) or u.get("username"),
        headline=clean(u.get("biography")),
        company=clean(u.get("business_category_name")) if u.get("is_business_account") else None,
        photo_url=u.get("profile_pic_url_hd") or u.get("profile_pic_url"),
        raw={
            "username": u.get("username"),
            "bio": clean(u.get("biography")),
            "category": u.get("category_name"),
            "external_url": u.get("external_url"),
            "is_private": u.get("is_private"),
            "is_verified": u.get("is_verified"),
            "follower_count": (u.get("edge_followed_by") or {}).get("count"),
            "following_count": (u.get("edge_follow") or {}).get("count"),
            "post_count": (u.get("edge_owner_to_timeline_media") or {}).get("count"),
        },
    )


def scrape(platform: str, url: str) -> Profile:
    if platform != "instagram":
        raise ScrapeError(f"http backend does not support {platform}")
    return _instagram(url)
