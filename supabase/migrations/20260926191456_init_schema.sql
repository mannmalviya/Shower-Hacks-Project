-- Core schema. See PLAN.md "Data".
-- Reads: anyone (the demo shows everyone's sims).
-- Writes: users write their own rows; the worker and API routes use the service role (skips RLS).

create table public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null, -- set = this person is a signed-up user
  name text not null,
  headline text,
  location text, -- as shown on the profile, e.g. "San Francisco Bay Area"
  country text,  -- where they live now
  photo_url text,
  raw jsonb not null default '{}'::jsonb, -- untouched scraper output
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Social accounts. One row per platform.
create table public.social_profiles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  platform text not null check (platform in ('linkedin', 'x', 'instagram', 'github')),
  url text not null unique,
  handle text,
  bio text,
  follower_count integer,
  avatar_url text,
  raw jsonb not null default '{}'::jsonb, -- untouched scraper output
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, platform)
);

-- Work history. One row per job. The primary job is the one "group by company" uses.
create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  company text not null,
  title text,
  start_date date,
  end_date date, -- null = still works there
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index experiences_person_id_idx on public.experiences (person_id);
create index experiences_company_idx on public.experiences (company);
create unique index experiences_one_primary_idx on public.experiences (person_id) where is_primary;

-- Education history. One row per school.
create table public.education (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  school text not null,
  degree text, -- e.g. "BS"
  field text,  -- e.g. "Computer Science"
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);
create index education_person_id_idx on public.education (person_id);

create table public.follows (
  follower_id uuid not null references public.people(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, person_id)
);
create index follows_person_id_idx on public.follows (person_id);

create table public.scrape_jobs (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  platform text not null check (platform in ('linkedin', 'x', 'instagram')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index scrape_jobs_status_idx on public.scrape_jobs (status, created_at);
create index scrape_jobs_person_id_idx on public.scrape_jobs (person_id);

create table public.net_worth (
  person_id uuid primary key references public.people(id) on delete cascade,
  low bigint not null,  -- USD
  high bigint not null, -- USD
  reasoning text,
  sources jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.onboarding_answers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Keep updated_at fresh.
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger people_updated_at before update on public.people for each row execute function public.set_updated_at();
create trigger social_profiles_updated_at before update on public.social_profiles for each row execute function public.set_updated_at();
create trigger scrape_jobs_updated_at before update on public.scrape_jobs for each row execute function public.set_updated_at();
create trigger net_worth_updated_at before update on public.net_worth for each row execute function public.set_updated_at();
create trigger onboarding_answers_updated_at before update on public.onboarding_answers for each row execute function public.set_updated_at();

-- RLS
alter table public.people enable row level security;
alter table public.social_profiles enable row level security;
alter table public.experiences enable row level security;
alter table public.education enable row level security;
alter table public.follows enable row level security;
alter table public.scrape_jobs enable row level security;
alter table public.net_worth enable row level security;
alter table public.onboarding_answers enable row level security;

-- Public reads
create policy "people: anyone reads" on public.people for select to anon, authenticated using (true);
create policy "social_profiles: anyone reads" on public.social_profiles for select to anon, authenticated using (true);
create policy "experiences: anyone reads" on public.experiences for select to anon, authenticated using (true);
create policy "education: anyone reads" on public.education for select to anon, authenticated using (true);
create policy "follows: anyone reads" on public.follows for select to anon, authenticated using (true);
create policy "scrape_jobs: anyone reads" on public.scrape_jobs for select to anon, authenticated using (true);
create policy "net_worth: anyone reads" on public.net_worth for select to anon, authenticated using (true);

-- people: a user creates and edits only their own row
create policy "people: user inserts own" on public.people for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "people: user updates own" on public.people for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- social_profiles: a user adds and edits only their own socials
create policy "social_profiles: user inserts own" on public.social_profiles for insert to authenticated
  with check (exists (select 1 from public.people p where p.id = person_id and p.user_id = (select auth.uid())));
create policy "social_profiles: user updates own" on public.social_profiles for update to authenticated
  using (exists (select 1 from public.people p where p.id = person_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.people p where p.id = person_id and p.user_id = (select auth.uid())));

-- scrape_jobs: a user queues jobs only for their own person row
create policy "scrape_jobs: user queues own" on public.scrape_jobs for insert to authenticated
  with check (
    status = 'queued'
    and exists (select 1 from public.people p where p.id = person_id and p.user_id = (select auth.uid()))
  );

-- onboarding_answers: private to the user
create policy "onboarding: user reads own" on public.onboarding_answers for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "onboarding: user inserts own" on public.onboarding_answers for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "onboarding: user updates own" on public.onboarding_answers for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Data API access (RLS above still limits rows)
grant select on public.people, public.social_profiles, public.experiences, public.education, public.follows, public.scrape_jobs, public.net_worth to anon, authenticated;
grant insert, update on public.people, public.social_profiles to authenticated;
grant insert on public.scrape_jobs to authenticated;
grant select, insert, update on public.onboarding_answers to authenticated;
grant all on public.people, public.social_profiles, public.experiences, public.education, public.follows, public.scrape_jobs, public.net_worth, public.onboarding_answers to service_role;

-- Realtime: the 3D page listens for new sims, net worth and job progress
alter publication supabase_realtime add table public.people, public.social_profiles, public.experiences, public.follows, public.scrape_jobs, public.net_worth;
