# PLAN

Hackathon: Shower Hacks. Time: ~8 hours. Team: 3.

## Concept

Your whole social network as a Mii-style 3D world (think Nintendo DS/Wii Miis). Every person is a small sim, and the crowd itself is the data viz.

A user signs up and gives us their socials. We scrape them, estimate their net worth, and show them as a 3D sim standing on a stack of cash. Their contacts show up as sims around them.

## Focus

The **network and its patterns**, not only the user: where people come from, where they studied, where they work, how rich they are, and how they are connected. The user's own sim and cash stack are the entry point. The crowd is the show.

## Platforms

| Platform | What it gives us | How |
| --- | --- | --- |
| LinkedIn | Contacts, company, role, school, location | Scraper worker. Backup: official export (`Connections.csv`) |
| Instagram | Followers / following, mutual follows, close friends | Scraper worker. Backup: official "Download your information" export (JSON) |
| X | Followers / following | Scraper worker |
| Facebook | Friends list | Official "Download your information" export (`your_friends.json`) |
| GitHub | Followers / following, location, company, top languages | Public REST API (free token) |
| Spotify | Top artists and genres (interest layer) | Spotify Web API (user OAuth) |

Each platform is its own layer in the world (color / continent), so a user can toggle platforms on and off.

## Second degree

See the connections of your first layer (your contacts' contacts), capped to keep it fast.

- **Open graphs** (GitHub, X if scraped): fetch the following list of your top ~15 contacts.
- **Multiplayer**: every user who signs up adds their own graph. When two users share contacts, their worlds connect, so second-degree links appear between people who joined.
- Second-degree sims are smaller and dimmer than first-degree ones.

## Visualizations

Group-by filters. Sims walk to "islands", one island per group:

- **Company** (in the core flow)
- **Wealth**: islands as a podium, from broke to ultra-rich. Top tier gets a crown 👑
- **Origin**: city / country
- **School**
- **Industry**
- **Platform**: where the contact comes from
- **Interests**: music (Spotify), tech (GitHub languages)

Also: a toggle to draw network links between sims, click a sim to see their card, and search to highlight matching sims.

## Core flow (must work for the demo)

1. **Sign up**: the user answers onboarding questions.
2. **Socials**: the user enters LinkedIn, X and Instagram URLs.
3. **Scrape**: a job goes into `scrape_jobs`. The worker scrapes the profiles and writes them to Supabase.
4. **Compute**: net worth estimate plus any other stats, saved to Supabase.
5. **Render**: a 3D world with the user's sim on a cash stack. Sims pop in live through Supabase realtime.

**Stretch goals** (only after the core flow works):

- Scrape ~15–20 followers and render them as sims.
- Group by company filter, then the other filters in **Visualizations**.
- Extra platforms (Facebook, GitHub, Spotify) and **Second degree**.
- Search anyone ("John Doe at XYZ"). The app finds, scrapes and renders them.

## Stack

| Part | Choice |
| --- | --- |
| App | Next.js (App Router) + TypeScript, on Vercel |
| 3D | React Three Fiber + drei |
| DB / auth / live updates | Supabase (Postgres, Auth, Realtime) |
| Social scraping | Python worker + `browser-harness` (a browser agent). Runs on a laptop in dev, on Zo in prod. |
| Salary data | Firecrawl (search levels.fyi, Glassdoor, etc.) |
| LLM | Claude Sonnet 5 (`claude-sonnet-5`) via Vercel AI SDK, structured JSON output |

## Architecture

```text
Next.js app ──writes job──▶ Supabase `scrape_jobs`
                               │
Scraper worker (Zo) ◀──polls───┘
   └─ browser-harness → LinkedIn / X / Instagram
   └─ writes → `people`, `follows`, job status
                               │
Next.js API route ◀────────────┘
   └─ Firecrawl salary search
   └─ rules → base number → Claude adjusts → `net_worth`
                               │
3D page ◀── Supabase realtime ─┘
```

## Data

Schema: `supabase/migrations/`. Helpers: `src/lib/db.ts`. Reads are public. v1 has no sign-in: onboarding (`src/app/onboarding/actions.ts`), the worker and API routes write with the secret key.

- `people`: id, user_id (set = signed-up user), name, headline, location, country, photo_url, net_worth_guess (USD, from onboarding), raw (jsonb)
- `social_profiles`: id, person_id, platform (linkedin | x | instagram | github), url (unique), handle, bio, follower_count, avatar_url, raw (jsonb). One row per platform per person.
- `experiences`: id, person_id, company, title, start_date, end_date (empty = current), is_primary (max one per person; used for "group by company")
- `education`: id, person_id, school, degree, field, start_date, end_date
- `follows`: follower_id → person_id
- `scrape_jobs`: id, person_id, platform, status (`queued` | `running` | `done` | `failed`), error, created_at
- `net_worth`: person_id, low, high (USD), reasoning, sources (jsonb)

**Proposed additions** (for Platforms / Second degree / Visualizations; agree as a team first):

- `people`: + school, industry, city, country, github_url, interests (jsonb, e.g. `["🎵 Daft Punk", "💻 Python"]`)
- `follows`: + platform, degree (1 = direct contact, 2 = contact of a contact)

## Net worth

1. **Rules**: role + company + years of experience give a base salary. Firecrawl salary search fills gaps.
2. **LLM**: Claude reads the work history and the base number. It returns `{ low, high, reasoning }`.
3. **Always show a range**, never one exact number.

## Sims

- Simple, stylized and blocky. The profile photo goes on the face.
- The sim stands on a stack of 3D cash blocks. Stack height depends on net worth.
- Must stay fast with 50+ sims on screen.

## Risks

- **Scraping is slow**: ~30–90 s per profile. Cap followers. Cache everything.
- **Account bans**: LinkedIn may ban the scraper account. Use a spare account. Fallback: official data exports (LinkedIn, Instagram, Facebook), which carry no ban risk.
- **Live demo failure**: seed the database with pre-scraped people as a backup.

## Work split

To decide as a team. First step: agree on the `people` table and a fake seed data file, so the 3D work does not wait for scraping.
