<p align="center">
  <img src="docs/cover.webp" alt="Social Mirror: your network as a Mii island" width="100%" />
</p>

<h1 align="center">Social Mirror 🚿</h1>

<p align="center"><b>Your whole social network as a Mii-style 3D island.</b><br/>
Every person you know is a little sim standing on a stack of cash. The crowd is the data.</p>

---

Sign up, drop in your LinkedIn / X / Instagram / GitHub, and we scrape your profiles, estimate your net worth (always a range, never a number), and render you on an island with your followers around you. Switch the lens and the crowd walks into new groups: **tribes**, **wealth tiers**, **schools**, **cities**, **industries**, **platforms**. Click anyone for their card. Walk around. See who never followed you back.

Built in ~8 hours at Shower Hacks.

## How it works

1. **Onboard** – three questions and your social links (`/onboarding`).
2. **Scrape** – a job lands in Supabase `scrape_jobs`; a Python worker with `browser-harness` reads your profiles and followers.
3. **Estimate** – rules (role + company + years) plus salary evidence plus an LLM review produce a net worth range.
4. **Render** – React Three Fiber draws the island; sims pop in live over Supabase Realtime (`/world?me=<id>`).

## Stack

Next.js (App Router) · TypeScript · React Three Fiber + drei · Supabase (Postgres, Realtime) · Python worker · Firecrawl · Claude via Vercel AI SDK

## Run it

```bash
pnpm install
cp .env.example .env.local   # Supabase keys; or set NEXT_PUBLIC_WORLD_SEED=1 for the fake seed world
pnpm dev
```

`PLAN.md` holds every design decision. `DB_SCHEMA.md` explains the tables. `worker/README.md` explains the scraper.
