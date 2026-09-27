# Scraper worker

Polls Supabase `scrape_jobs`, scrapes the person's LinkedIn / X / Instagram URL with `browser-harness`, and writes `people` and `follows`. It matches the schema in `supabase/migrations/` and the data conventions in `seed/README.md`. No schema changes.

## How a job runs

The app queues jobs with `queueScrapeJobs()` (`src/lib/db.ts`). The worker claims the oldest `queued` job, with signed-up users' jobs first, and sets `running`, then `done` or `failed` (with `error`).

Each job scrapes that person's profile on the job's platform.

An `instagram` job also reads the person's **followers** (their audience). The worker opens the profile, clicks "N followers", and scrolls the list up to `FOLLOWERS_LIMIT` (100). Each follower becomes a `people` row, a `social_profiles` row and one `follows` row (they follow the person). The first `FOLLOWERS_VISIT` (10) also get a full profile visit (bio, follower count). Instagram shows the list only to a signed-in account, and a private account's list only to its followers. In that case the job ends `failed` with the reason, after the profile itself is saved.

We never read LinkedIn connections.

## What gets written

- **`people.raw.<platform>`**: shapes from `seed/README.md`. LinkedIn: `linkedin_url, name, headline, location, photo_url, experiences[{position_title, institution_name, from_date, to_date}], educations[{institution_name, degree, from_date, to_date}]`, plus `follower_count`, `connected_on`, `page_text` (full visible text for the net worth LLM). X: twscrape field names. Instagram: `web_profile_info` field names. Only platform names are keys of `raw`.
- **`people` columns** (`name, headline, location, photo_url`): the first platform with a value in LinkedIn > GitHub > X > Facebook > Instagram.
- **`social_profiles`**: one row per platform (url, handle, bio, follower_count, avatar_url, raw). The worker reads the URL to scrape from here. The onboarding form writes it.
- **`experiences` / `education`**: rebuilt from `raw.linkedin` after a LinkedIn scrape. The primary job is the first current one. If the scrape finds no jobs, the onboarding company stays.
- **Followers** from the list carry only username, name and photo (`raw.instagram.source = "followers"`) until their profile is visited.
- **URLs** use the app's form (`src/lib/socials.ts`), e.g. `https://www.linkedin.com/in/<handle>`. `social_profiles.url` is unique, so the same person is never inserted twice.

## Setup

```bash
cd worker
uv sync
uv tool install --python 3.12 browser-harness
```

- **Keys:** the worker reads `worker/.env`, and falls back to the app's `../.env.local`. It needs `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) and `SUPABASE_SECRET_KEY`. See `.env.example`.
- **Chrome:** open `chrome://inspect/#remote-debugging`, tick "Allow remote debugging", and stay signed in to LinkedIn and Instagram with **your own** accounts. LinkedIn's User Agreement forbids fake accounts. Check the connection with `browser-harness <<< 'print(page_info())'`.
- **Before any deep profile scrapes:** turn on LinkedIn Private mode (Settings > Visibility > Profile viewing options). Otherwise every scraped contact sees that you viewed their profile.

## Commands

```bash
uv run python -m scraper run                                   # the worker loop (--once: exit when the queue is empty)
uv run python -m scraper scrape https://www.linkedin.com/in/<handle>/   # one profile -> JSON, no DB
uv run python -m scraper followers https://www.instagram.com/<handle> --limit 30   # followers list -> JSON, no DB
uv run python -m scraper enqueue <person_id> linkedin          # queue a job by hand
```

## Run on Zo

The app never calls the worker. Both talk to Supabase: the app adds `scrape_jobs` rows, the worker polls them. So the worker runs the same on a laptop or on Zo.

1. On the Zo machine: `git clone` the repo, `cd worker`, then run the Setup steps above.
2. Copy `worker/.env` there (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`).
3. Open Chrome on Zo, sign in to LinkedIn, and allow remote debugging. Check with `browser-harness --doctor`.
4. Start the loop in `tmux` so it survives logout: `tmux new -s worker 'uv run python -m scraper run'`.
5. Test: submit `/onboarding`. The done page shows each job go `queued` → `running` → `done`.

## Backends

`harness` is the default for every platform. The others are opt-in through `SCRAPE_ORDER_<PLATFORM>` (e.g. `SCRAPE_ORDER_LINKEDIN=harness,zo`). Every success is cached in `worker/.cache/` (git-ignored), and cache hits skip the network.

| Backend | How | Status |
| --- | --- | --- |
| `harness` | Scripted `browser-harness` over CDP against your logged-in Chrome, with fixed JS extractors (`scraper/extractors/*.js`). No LLM. Opens its own background tab and closes it. | Verified on LinkedIn's 2026 layout: LinkedIn profile ~25 s; Instagram 30 followers ~15 s |
| `zo` | `POST api.zo.computer/zo/ask` with a JSON schema; Zo's agent reads the page in its own logged-in browser. | Untested; slow (1–3 min) |
| `http` | Instagram's public `web_profile_info` endpoint. | Answers 401 logged out |

## Demo safety

- **Warm the cache:** run `scrape` on every demo profile before judging. The worker then serves them from `.cache/` without touching LinkedIn.
- **Don't commit data:** never commit `.cache/`, seed dumps or exports, because the repo is public. Delete the demo network's rows after the event.
- **Stop on pushback:** stop at the first sign of LinkedIn pushing back (rate limit or security checkpoint). Don't retry.

## Tested

Tested against a local Supabase built from `supabase/migrations/`. A signed-up user's `linkedin` job wrote 30 contacts and 60 mutual `follows` rows, and a re-run added nothing. A mismatched Chrome account was refused, the user's job was claimed ahead of contact jobs, and the publishable key could read every row. `analyze()` from `src/lib/analysis.ts` ran on the result (30 first-degree nodes, circles such as "🎓 UC Berkeley").
