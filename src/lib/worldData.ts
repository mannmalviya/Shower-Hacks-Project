"use client";
// Everything the 3D world reads, live. One load, then a reload on any change (Supabase Realtime).
// NEXT_PUBLIC_WORLD_SEED=1 swaps in the fake Alex world (seed/alex.json) instead.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import type { FollowIn, NetWorthIn, PersonIn } from "@/lib/analysis";

export type Social = { platform: string; url: string; handle: string | null; follower_count: number | null; bio: string | null };
export type PersonRow = Omit<PersonIn, "experiences" | "education" | "social_profiles"> & {
  photo_url: string | null;
  created_at: string;
  experiences: { company: string; title: string | null; start_date: string | null; end_date: string | null; is_primary: boolean }[];
  education: { school: string; degree: string | null; field: string | null; start_date: string | null; end_date: string | null }[];
  social_profiles: Social[];
};
export type JobRow = { person_id: string; platform: string; status: string; created_at: string };
export type WorldRows = { people: PersonRow[]; follows: FollowIn[]; netWorth: NetWorthIn[]; jobs: JobRow[]; egoId?: string };

const PEOPLE = `id, name, headline, location, photo_url, raw, created_at,
  experiences(company, title, start_date, end_date, is_primary),
  education(school, degree, field, start_date, end_date),
  social_profiles(platform, url, handle, follower_count, bio)`;
const TABLES = ["people", "social_profiles", "experiences", "education", "follows", "scrape_jobs", "net_worth"];
const PAGE = 1000; // PostgREST returns at most 1000 rows per request

type Db = ReturnType<typeof createClient>;
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

async function load(db: Db): Promise<WorldRows> {
  const [people, follows, netWorth, jobs] = await Promise.all([
    all((a, b) => db.from("people").select(PEOPLE).order("created_at").range(a, b)),
    all((a, b) => db.from("follows").select("follower_id, person_id").range(a, b)),
    all((a, b) => db.from("net_worth").select("person_id, low, high").range(a, b)),
    all((a, b) => db.from("scrape_jobs").select("person_id, platform, status, created_at").order("created_at").range(a, b)),
  ]);
  return { people: people as unknown as PersonRow[], follows, netWorth, jobs };
}

/** Live rows. null until the first load. */
export function useWorldRows(seed: boolean): WorldRows | null {
  const [rows, setRows] = useState<WorldRows | null>(null);
  useEffect(() => {
    if (seed) {
      import("../../seed/alex.json").then((m) => setRows(fromSeed(m.default as unknown as SeedFile)));
      return;
    }
    const db = createClient();
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => load(db).then((r) => !stopped && setRows(r)).catch((e) => console.error("world load", e));
    // The worker writes in bursts (100 followers at once): wait for the burst to settle, then reload once.
    const soon = () => { clearTimeout(timer); timer = setTimeout(reload, 700); };
    // one channel per table: a table missing from the realtime publication fails only its own channel
    const channels = TABLES.map((table) => db.channel(`world-${table}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, soon)
      .subscribe((status, err) => { if (err) console.warn(`realtime ${table}: ${status}`, err.message); }));
    reload();
    return () => { stopped = true; clearTimeout(timer); channels.forEach((c) => db.removeChannel(c)); };
  }, [seed]);
  return rows;
}

// ---------- seed (old column shape) -> the live shape ----------

type SeedPerson = {
  id: string; name: string; headline: string | null; company: string | null; role: string | null; location: string | null;
  photo_url: string | null; linkedin_url: string | null; x_url: string | null; instagram_url: string | null; raw: Json;
};
type SeedFile = { _meta: { ego_id: string }; people: SeedPerson[]; follows: FollowIn[]; net_worth: NetWorthIn[] };

function fromSeed(s: SeedFile): WorldRows {
  const raw = (p: SeedPerson) => (p.raw && typeof p.raw === "object" && !Array.isArray(p.raw) ? p.raw : {}) as Record<string, Record<string, unknown>>;
  const people: PersonRow[] = s.people.map((p) => {
    const r = raw(p);
    const count = (platform: string) => platform === "instagram" ? Number((r.instagram?.edge_followed_by as { count?: number })?.count ?? 0) || null
      : platform === "x" ? Number(r.x?.followersCount ?? 0) || null : null;
    return {
      id: p.id, name: p.name, headline: p.headline, location: p.location, photo_url: p.photo_url, raw: p.raw, created_at: "",
      experiences: p.company ? [{ company: p.company, title: p.role, start_date: null, end_date: null, is_primary: true }] : [],
      education: [],
      social_profiles: (["linkedin", "x", "instagram"] as const).flatMap((platform) => {
        const url = p[`${platform}_url`];
        return url ? [{ platform, url, handle: null, follower_count: count(platform), bio: null }] : [];
      }),
    };
  });
  // the seed ego counts as "signed up" (a done job), so the open world shows them as a hub
  return { people, follows: s.follows, netWorth: s.net_worth, jobs: [{ person_id: s._meta.ego_id, platform: "linkedin", status: "done", created_at: "" }], egoId: s._meta.ego_id };
}
