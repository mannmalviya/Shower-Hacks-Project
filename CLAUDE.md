# CLAUDE.md

Hackathon project. ~8 hours, 3 people, all using Claude. Read `PLAN.md` first. It holds every design decision.


## Tech Stack
### Frontend
- Next.js
- TypeScript
- React Three Fiber + drei

### Backend
- Potentially a Zo cloud instance that does computer use scraping

### Database
- Hosted Cloud Supabase
- Schema explained in words: `DB_SCHEMA.md`. Source of truth is `supabase/migrations/`.

## Rules

- **Speed over polish.** Build the smallest thing that works for the demo.
- **Stay in your area.** Do not edit files that belong to another teammate's feature unless asked.
- **The data shape is a contract.** Do not change a Supabase table or a shared type without telling the team. Update `PLAN.md` when you do.
- **Do not change the stack.** No new frameworks or services without asking. The stack is in `PLAN.md`.
- **Keep the core flow working.** Build stretch goals only after it works.
- **Use a branch per feature.** Make a new branch for each feature. Commit to that branch first. Merge into `main` only after that.

## Stack

Next.js (App Router) + TypeScript · React Three Fiber + drei · Supabase · Python scraper worker with `browser-harness` · Firecrawl · Claude Sonnet 5 via Vercel AI SDK.

## Secrets

Keep keys in `.env.local` (app) and `.env` (worker). Never commit them.
