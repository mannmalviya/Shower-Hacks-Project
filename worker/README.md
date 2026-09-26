# Scraper worker

Polls Supabase `scrape_jobs`, scrapes the person's LinkedIn / X / Instagram URL, and writes the result to `people`. It only touches the tables and columns in `PLAN.md > Data`.

## Backends

Each platform tries backends in order until one works (`SCRAPE_ORDER_<PLATFORM>` in `.env`). Every success is cached in `worker/.cache/`, and cache hits skip the network.

| Backend | How | Good at | Weak at |
| --- | --- | --- | --- |
| `zo` | `POST api.zo.computer/zo/ask` with a JSON schema. Zo's agent reads the profile in **its own logged-in cloud browser**. | LinkedIn: clicks "Show all", survives markup changes, runs off our laptops | Slow (1–3 min), costs Zo credits, less predictable |
| `harness` | Scripted `browser-harness` over CDP against a logged-in Chrome, then a fixed JS extractor (`scraper/extractors/*.js`). No LLM. | Fast (~25 s for LinkedIn), deterministic, free. Verified on LinkedIn's 2026 layout | Selectors break when the site changes; needs a Chrome with a spare account signed in |
| `http` | Plain HTTP, no browser. Instagram only (`web_profile_info`). | Instant | Instagram rate-limits it fast (HTTP 401 "wait a few minutes") |

Defaults: LinkedIn `zo,harness` · X `zo,harness` · Instagram `http,zo,harness`.

LinkedIn contacts come from the official export (no scraping): `import-linkedin-csv`.

## Setup

```bash
cd worker
cp .env.example .env        # fill SUPABASE_*, ZO_API_KEY
uv sync
```

**Zo:** in Zo, open Settings > Tools > "Open Zo's browser" and sign in to LinkedIn (spare account), X and Instagram once. Sessions persist. Create an API key in Settings > Advanced and put it in `ZO_API_KEY`.

**browser-harness** (traditional path):

```bash
uv tool install --python 3.12 browser-harness
# Chrome: open chrome://inspect/#remote-debugging, tick "Allow remote debugging"
browser-harness <<< 'print(page_info())'   # prints the current tab = connected
```

Sign in to LinkedIn in that Chrome with the **spare** account, not your real one.

## Commands

```bash
uv run python -m scraper scrape https://www.linkedin.com/in/<handle>/ -b harness   # one profile -> JSON, no DB
uv run python -m scraper scrape https://www.linkedin.com/in/<handle>/ -b zo --no-cache
uv run python -m scraper run                                   # the worker loop
uv run python -m scraper enqueue <person_id> linkedin          # queue a job by hand
uv run python -m scraper import-linkedin-csv Connections.csv --user <person_id> --enqueue 15
```

To run the worker on Zo instead of a laptop, SSH into Zo, clone the repo, and register `uv run python -m scraper run` as a Zo Service.

## What gets written

- `scrape_jobs.status`: `queued` → `running` → `done` | `failed` (with `error`). The app can listen for `done` over realtime to trigger the net worth step.
- `people.name, headline, company, role, location, photo_url`: filled from `raw` with priority LinkedIn > X > Instagram, so a later Instagram scrape never overwrites a LinkedIn job title.
- `people.raw[<platform>]`: the full scrape (`experience`, `education`, `about`, follower counts, and for `harness` LinkedIn scrapes `page_text`, the page's visible text for the net worth LLM to re-read).
- `import-linkedin-csv`: one `people` row per connection (`is_user=false`, email dropped) and a `follows` row with `follower_id = connection, person_id = user`.

## Demo safety

Warm the cache before the demo: run `scrape` on every demo profile. The worker then serves them from `.cache/` without touching LinkedIn.
