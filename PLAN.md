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

Schema: `supabase/migrations/`. Helpers: `src/lib/db.ts`. Reads are public. Users write their own rows. The worker and API routes write with the secret key.

- `people`: id, user_id (set = signed-up user), name, headline, company, role, location, photo_url, linkedin_url, x_url, instagram_url, raw (jsonb)
- `follows`: follower_id → person_id
- `scrape_jobs`: id, person_id, platform, status (`queued` | `running` | `done` | `failed`), error, created_at
- `net_worth`: person_id, low, high (USD), reasoning, sources (jsonb)
- `onboarding_answers`: user_id, answers (jsonb)

**Proposed additions** (for Platforms / Second degree / Visualizations; agree as a team first):

- `people`: + school, industry, city, country, github_url, interests (jsonb, e.g. `["🎵 Daft Punk", "💻 Python"]`)
- `follows`: + platform, degree (1 = direct contact, 2 = contact of a contact)

## Net worth

1. **Rules**: role + company + years of experience give a base salary. Firecrawl salary search fills gaps.
2. **LLM**: Claude reads the work history and the base number. It returns `{ low, high, reasoning }`.
3. **Always show a range**, never one exact number.

How it is built (`src/lib/networth/`):

- **Input**: `people` + `experiences` + `education` + `social_profiles`. Falls back to scraper output in `people.raw` (harness, Zo, seed shapes) and to "Role at Company" headlines.
- **Rules** (no keys needed): each job gets a kind (full-time, internship, part-time, club), level, role family and company tier. Pay comes from a built-in table (93 companies, tier fallbacks, BLS occupations), then a year-by-year simulation: taxes, cost of living, savings, real S&P 500 returns, student debt, home equity, founder equity. Low / mid / high scenarios.
- **Salary evidence**: levels.fyi `.md` pages (levels.fyi publishes them for AI agents), then Firecrawl search snippets if `FIRECRAWL_API_KEY` is set. Never Firecrawl on levels.fyi pages (their robots.txt blocks it).
- **LLM** (`FEATHERLESS_API_KEY` for open models on Featherless, our sponsor, default `deepseek-ai/DeepSeek-V3.2`; or Claude via `ANTHROPIC_API_KEY` / `AI_GATEWAY_API_KEY`): parses headline-only people into jobs, then reviews the rules range. Its answer is clamped to a band around the rules range. Scraped text is passed as data, never as instructions.
- **No data** (no job, school or age) = no row = grey sim.
- **Run**: `POST /api/net-worth { personId }` after a scrape job is done, or `pnpm networth <id> | --all --missing | --watch | --file seed.json --dry`. `pnpm networth:check` runs the calibration cases.

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
