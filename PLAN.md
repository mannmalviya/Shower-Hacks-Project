# PLAN

Hackathon: Shower Hacks. Time: ~8 hours. Team: 3.

## Idea

A user signs up and gives us their socials. We scrape them, estimate their net worth, and show them as a 3D sim standing on a stack of cash. Their followers show up as sims too. You can group sims by company.

## Core flow (must work for the demo)

1. **Sign up**: the user answers onboarding questions.
2. **Socials**: the user enters LinkedIn, X and Instagram URLs.
3. **Scrape**: a job goes into `scrape_jobs`. The worker scrapes the profiles and writes them to Supabase.
4. **Compute**: net worth estimate plus any other stats, saved to Supabase.
5. **Render**: a 3D world with the user's sim on a cash stack. Sims pop in live through Supabase realtime.

**Stretch goals** (only after the core flow works):

- Scrape ~15–20 followers and render them as sims.
- Group by company filter.
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
- **Account bans**: LinkedIn may ban the scraper account. Use a spare account.
- **Live demo failure**: seed the database with pre-scraped people as a backup.

## Work split

To decide as a team. First step: agree on the `people` table and a fake seed data file, so the 3D work does not wait for scraping.
