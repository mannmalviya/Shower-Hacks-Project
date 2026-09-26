// Typed read/write helpers. These are the app's "endpoints".
// Pass in a client:
//   browser:   createClient() from "@/lib/supabase/client"
//   server:    await createClient() from "@/lib/supabase/server"
//   admin:     createAdminClient() from "@/lib/supabase/admin" (skips RLS, server only)
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables, TablesInsert } from "./supabase/database.types";

type DB = SupabaseClient<Database>;

export type Person = Tables<"people">;
export type NetWorth = Tables<"net_worth">;
export type ScrapeJob = Tables<"scrape_jobs">;
export type SocialProfile = Tables<"social_profiles">;
export type Experience = Tables<"experiences">;
export type Education = Tables<"education">;
export type Platform = "linkedin" | "x" | "instagram" | "github";
export type ScrapePlatform = Exclude<Platform, "github">;
export type PersonFull = Person & { net_worth: NetWorth | null; experiences: Experience[]; education: Education[]; social_profiles: SocialProfile[] };

const FULL = "*, net_worth(*), experiences(*), education(*), social_profiles(*)";

/** The job "group by company" uses. Falls back to the newest current job. */
export function primaryJob(p: PersonFull): Experience | undefined {
  return p.experiences.find((e) => e.is_primary) ?? p.experiences.find((e) => !e.end_date);
}

// ---------- Reads (anyone) ----------

export async function getPerson(db: DB, id: string) {
  const { data, error } = await db.from("people").select(FULL).eq("id", id).single();
  if (error) throw error;
  return data as PersonFull;
}

/** Everyone in the world, with net worth and jobs. The 3D scene renders this. Group by company with primaryJob(). */
export async function listPeople(db: DB) {
  const { data, error } = await db.from("people").select(FULL);
  if (error) throw error;
  return data as PersonFull[];
}

/** People who follow `personId`. */
export async function listFollowers(db: DB, personId: string) {
  const { data, error } = await db
    .from("follows")
    .select("follower:people!follows_follower_id_fkey(*, net_worth(*), experiences(*), education(*), social_profiles(*))")
    .eq("person_id", personId);
  if (error) throw error;
  return data.map((r) => r.follower) as PersonFull[];
}

export async function listJobs(db: DB, personId: string) {
  const { data, error } = await db.from("scrape_jobs").select("*").eq("person_id", personId).order("created_at");
  if (error) throw error;
  return data;
}

// ---------- User writes (signed-in user, RLS checks ownership) ----------

/** The signed-in user's own person row, or null. */
export async function getMyPerson(db: DB) {
  const { data: claims } = await db.auth.getClaims();
  const uid = claims?.claims.sub;
  if (!uid) return null;
  const { data, error } = await db.from("people").select(FULL).eq("user_id", uid).maybeSingle();
  if (error) throw error;
  return data as PersonFull | null;
}

/** Create or update the signed-in user's person row. */
export async function upsertMyPerson(db: DB, fields: Omit<TablesInsert<"people">, "id" | "user_id">) {
  const { data: claims } = await db.auth.getClaims();
  const uid = claims?.claims.sub;
  if (!uid) throw new Error("Not signed in");
  const { data, error } = await db
    .from("people")
    .upsert({ ...fields, user_id: uid }, { onConflict: "user_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveOnboarding(db: DB, answers: Json) {
  const { data: claims } = await db.auth.getClaims();
  const uid = claims?.claims.sub;
  if (!uid) throw new Error("Not signed in");
  const { error } = await db.from("onboarding_answers").upsert({ user_id: uid, answers });
  if (error) throw error;
}

/** Save the user's social URLs (one per platform). Pass the user's own person id. */
export async function saveMySocials(db: DB, personId: string, socials: { platform: Platform; url: string }[]) {
  const { error } = await db
    .from("social_profiles")
    .upsert(socials.map((s) => ({ ...s, person_id: personId })), { onConflict: "person_id,platform" });
  if (error) throw error;
}

/** Queue one scrape job per platform. The worker picks them up. */
export async function queueScrapeJobs(db: DB, personId: string, platforms: ScrapePlatform[]) {
  const { data, error } = await db
    .from("scrape_jobs")
    .insert(platforms.map((platform) => ({ person_id: personId, platform })))
    .select();
  if (error) throw error;
  return data;
}

// ---------- Admin writes (admin client only: API routes) ----------
// The Python worker writes the same tables with supabase-py and the secret key.

/** Replace a person's whole work history. */
export async function saveExperiences(db: DB, personId: string, rows: Omit<TablesInsert<"experiences">, "person_id">[]) {
  const del = await db.from("experiences").delete().eq("person_id", personId);
  if (del.error) throw del.error;
  const { error } = await db.from("experiences").insert(rows.map((r) => ({ ...r, person_id: personId })));
  if (error) throw error;
}

/** Replace a person's whole education history. */
export async function saveEducation(db: DB, personId: string, rows: Omit<TablesInsert<"education">, "person_id">[]) {
  const del = await db.from("education").delete().eq("person_id", personId);
  if (del.error) throw del.error;
  const { error } = await db.from("education").insert(rows.map((r) => ({ ...r, person_id: personId })));
  if (error) throw error;
}

export async function saveNetWorth(db: DB, row: TablesInsert<"net_worth">) {
  const { error } = await db.from("net_worth").upsert(row);
  if (error) throw error;
}

// ---------- Realtime ----------

/** Calls `onChange` when people, social_profiles, experiences, follows, net_worth or scrape_jobs change. Returns an unsubscribe function. */
export function subscribeWorld(db: DB, onChange: (table: string) => void) {
  const channel = db.channel("world");
  for (const table of ["people", "social_profiles", "experiences", "follows", "net_worth", "scrape_jobs"]) {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, () => onChange(table));
  }
  channel.subscribe();
  return () => {
    db.removeChannel(channel);
  };
}
