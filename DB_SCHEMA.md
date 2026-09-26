# DB Schema

Source of truth: `supabase/migrations/`. This file explains it in words. If you change a table, update this file and `PLAN.md`.

Every table has `id` or a key made of ids. All ids are UUIDs. Times are `timestamptz`. Money is in USD.

## people

One row per person shown as a sim. This includes the signed-up user and everyone we scrape.

| Column | Meaning |
| --- | --- |
| `id` | Primary key. |
| `user_id` | Link to a Supabase auth user. Unique. Null means "scraped person, not a signed-up user". Set to null if the auth user is deleted. |
| `name` | Full name. Required. |
| `headline` | Short profile line, e.g. "Software Engineer at XYZ". |
| `location` | Location text as shown on the profile, e.g. "San Francisco Bay Area". |
| `country` | Country where they live now. |
| `photo_url` | Profile photo. Goes on the sim's face. |
| `raw` | Untouched scraper output (jsonb). Keep it so we can re-parse later. |
| `net_worth_guess` | What the person thinks they are worth, in USD. Answer to the one onboarding question. Added in the second migration. |
| `created_at`, `updated_at` | Times. `updated_at` changes by itself on every update. |

## social_profiles

One row per social account. A person has at most one row per platform.

| Column | Meaning |
| --- | --- |
| `id` | Primary key. |
| `person_id` | Owner. Points to `people`. Deleting the person deletes this row. |
| `platform` | One of `linkedin`, `x`, `instagram`, `github`. |
| `url` | Profile URL. Unique across the table. |
| `handle` | Username on that platform. |
| `bio` | Bio text. |
| `follower_count` | Number of followers. |
| `avatar_url` | Avatar image on that platform. |
| `raw` | Untouched scraper output (jsonb). |
| `created_at`, `updated_at` | Times. |

## experiences

Work history. One row per job.

| Column | Meaning |
| --- | --- |
| `id` | Primary key. |
| `person_id` | Owner. Points to `people`. |
| `company` | Company name. Required. "Group by company" uses this. |
| `title` | Job title. |
| `start_date`, `end_date` | Dates. Null `end_date` means they still work there. |
| `is_primary` | True for the main current job. Only one per person is allowed. "Group by company" uses the primary job. |
| `created_at` | Time. |

## education

School history. One row per school.

| Column | Meaning |
| --- | --- |
| `id` | Primary key. |
| `person_id` | Owner. Points to `people`. |
| `school` | School name. Required. |
| `degree` | Degree, e.g. "BS". |
| `field` | Field of study, e.g. "Computer Science". |
| `start_date`, `end_date` | Dates. |
| `created_at` | Time. |

## follows

Who follows whom. One row per follow. No `id`. The pair is the key.

| Column | Meaning |
| --- | --- |
| `follower_id` | The person who follows. Points to `people`. |
| `person_id` | The person being followed. Points to `people`. |
| `created_at` | Time. |

## scrape_jobs

The queue for the Python worker. The app adds a row. The worker polls, scrapes, and updates it.

| Column | Meaning |
| --- | --- |
| `id` | Primary key. |
| `person_id` | Person to scrape. Points to `people`. |
| `platform` | One of `linkedin`, `x`, `instagram`. (No `github` here.) |
| `status` | `queued` (new), `running`, `done`, or `failed`. Default `queued`. |
| `error` | Error text when `failed`. |
| `created_at`, `updated_at` | Times. |

## net_worth

The net worth estimate. One row per person. Always a range, never one number.

| Column | Meaning |
| --- | --- |
| `person_id` | Primary key. Points to `people`. |
| `low` | Low end of the range, USD. |
| `high` | High end of the range, USD. |
| `reasoning` | Why Claude chose this range. |
| `sources` | List of sources used (jsonb array), e.g. salary pages. |
| `updated_at` | Time. |

## Access rules (RLS)

- Everyone can read: `people`, `social_profiles`, `experiences`, `education`, `follows`, `scrape_jobs`, `net_worth`.
- Writes go through the server with the secret key (`SUPABASE_SECRET_KEY`). It skips RLS. The worker uses it too.
- The first migration added user-write policies and an `onboarding_answers` table. The second migration dropped that table. Version 1 has no sign-in, so those user-write policies are unused.

## Realtime

The 3D page listens for changes on `people`, `social_profiles`, `experiences`, `follows`, `scrape_jobs`, and `net_worth`. New sims pop in live.
