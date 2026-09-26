# Seed data (fake world for the viz)

```bash
python seed/generate.py   # -> seed/alex.json
```

`alex.json` holds rows for the tables in `supabase/migrations/` (`people`, `follows`, `net_worth`). **No schema change.** The viz and analysis read these rows. Real scraper output plugs in by writing the same shape.

Persona: **Alex Chen**, 20, CS junior at UC Berkeley, grew up in San Jose. As a kid: soccer, piano, drawing, scouts, robotics. Now: all-in on CS, SWE intern at Stripe.

| | Count |
| --- | --- |
| People | 316 (Alex + 165 first degree + 150 second degree) |
| follows | 957 |
| net_worth | 137 (≈48% of first degree have no row = unknown wealth, grey Mii) |

`_meta.ego_id` is Alex's `people.id` (in the real app: the row with `user_id` set).

## Conventions (for the scraper worker)

- **`follows`**: `follower_id` follows `person_id`. A mutual link (LinkedIn connection, Facebook friend, mutual follow) = two rows.
- **Degree** is not stored. The analysis computes it from `follows`: linked to the user = 1, linked only to a 1st-degree person = 2.
- **Platforms of a person** = the keys of `raw`. A person found on Instagram has `raw.instagram`.
- **Circles** (family, high school, colleagues…) are not stored. The analysis infers them from `raw` (shared school, company, hometown…).
- **Top-level columns** (`headline`, `company`, `role`, `location`) are filled with this priority: LinkedIn > GitHub > X > Facebook > Instagram.
- **`net_worth`**: no row when we cannot estimate (Instagram / Facebook only). Students get `0–15k`. GitHub-only company = wider range.

## `people.raw`: one key per platform, untouched tool output

Shapes copied from the tools we are likely to use, so real output drops in as is. Only the fields below are read by the analysis. Extra fields are fine.

### `raw.linkedin`: joeyism/linkedin_scraper v3, linkedin-mcp-server `get_person_profile`
```json
{
  "linkedin_url": "https://www.linkedin.com/in/…", "name": "…", "headline": "…", "location": "Berkeley, California, United States",
  "experiences": [{ "position_title": "Software Engineer Intern", "institution_name": "Stripe", "from_date": "Jun 2026", "to_date": "Aug 2026" }],
  "educations": [{ "institution_name": "UC Berkeley", "degree": "BS, Computer Science", "from_date": "2023", "to_date": "2027" }]
}
```

### `raw.instagram`: Instaloader `Profile` / `web_profile_info` user node
```json
{ "username": "…", "full_name": "…", "biography": "…", "edge_followed_by": { "count": 612 }, "edge_follow": { "count": 740 },
  "is_private": false, "is_verified": false, "category_name": null }
```

### `raw.facebook`: kevinzg/facebook-scraper `get_profile`
```json
{ "id": "…", "Name": "…", "Work": [{ "text": "Kaiser Permanente" }], "Education": [{ "text": "Lynbrook High School" }],
  "Places Lived": [{ "type": "Current City", "text": "San Jose, California" }, { "type": "Hometown", "text": "San Jose, California" }] }
```

### `raw.x`: twscrape `User`
```json
{ "username": "…", "displayname": "…", "rawDescription": "…", "location": "Berkeley, CA", "followersCount": 318, "friendsCount": 590, "verified": false }
```

### `raw.github`: GitHub REST `GET /users/{login}` + `top_languages`
```json
{ "login": "…", "name": "…", "company": "@stripe", "location": "Berkeley, CA", "bio": "…", "followers": 64, "top_languages": ["Python", "TypeScript"] }
```
`top_languages` is not in `/users/{login}`. Compute it from `GET /users/{login}/repos` (most common `language`).

Second-degree people usually come from a following list, so most only have `login` (`name` null). About 40% are enriched.
