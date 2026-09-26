// Supabase reads/writes for the net worth step. Used by the API route and the CLI.
//
// The generated types in src/lib/supabase/database.types.ts predate the live schema
// (experiences, education, social_profiles, people.country), so this module takes an
// untyped client and checks rows itself. Missing tables (an older DB) read as empty.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PersonBundle } from "./normalize";
import type { Estimate } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDB = SupabaseClient<any, any, any>;
type Row = Record<string, unknown>;
type Page = { data: unknown[] | null; error: { code?: string; message: string } | null };

const CHUNK = 100; // keeps `in (...)` filters short
// PostgREST cuts every read at max_rows (1000 on Supabase) without an error, so big reads go
// page by page. Must not be more than max_rows.
const PAGE = 1000;

function isMissingTable(error: { code?: string; message?: string } | null) {
  return !!error && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|could not find the table/i.test(error.message ?? ""));
}

/** Every row of a query, one page at a time. `page` must order by a unique column last. */
async function readAll(table: string, page: (from: number, to: number) => PromiseLike<Page>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (isMissingTable(error)) return [];
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

async function rowsFor(db: AnyDB, table: string, ids: string[], newestFirst = false): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const rows = await readAll(table, (from, to) => {
      let q = db.from(table).select("*").in("person_id", chunk);
      // Newest first (no end date = current). The timeline reads rows in this order.
      if (newestFirst) q = q.order("start_date", { ascending: false, nullsFirst: false }).order("end_date", { ascending: false, nullsFirst: true });
      return q.order("id").range(from, to);
    });
    out.push(...rows);
  }
  return out;
}

/** People + their experiences / education / social profiles, keyed by person id. */
export async function loadBundles(db: AnyDB, personIds: string[]): Promise<Map<string, PersonBundle>> {
  const ids = [...new Set(personIds)];
  const people: Row[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await db.from("people").select("*").in("id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`people: ${error.message}`);
    people.push(...((data ?? []) as Row[]));
  }
  const [experiences, education, socials] = await Promise.all([
    rowsFor(db, "experiences", ids, true),
    rowsFor(db, "education", ids, true),
    rowsFor(db, "social_profiles", ids),
  ]);
  const by = (rows: Row[], id: string) => rows.filter((r) => r.person_id === id);
  const out = new Map<string, PersonBundle>();
  for (const person of people) {
    const id = String(person.id);
    out.set(id, {
      person,
      experiences: by(experiences, id),
      education: by(education, id),
      social_profiles: by(socials, id),
    });
  }
  return out;
}

export async function loadBundle(db: AnyDB, personId: string): Promise<PersonBundle | null> {
  return (await loadBundles(db, [personId])).get(personId) ?? null;
}

const ms = (v: unknown) => {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? t : 0;
};

/**
 * When the person last changed: people.updated_at, or a newer experiences / education row
 * (work history lands after the people row). ISO string; listTargets gives the same value.
 */
export function lastChange(bundle: PersonBundle): string {
  let t = ms(bundle.person.updated_at);
  for (const r of [...(bundle.experiences ?? []), ...(bundle.education ?? [])]) t = Math.max(t, ms(r.created_at));
  return new Date(t).toISOString();
}

/** Newest experiences / education row per person id, in ms. */
async function latestWork(db: AnyDB): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const table of ["experiences", "education"]) {
    const rows = await readAll(table, (from, to) => db.from(table).select("person_id, created_at").order("id").range(from, to));
    for (const r of rows) {
      const id = String(r.person_id);
      out.set(id, Math.max(out.get(id) ?? 0, ms(r.created_at)));
    }
  }
  return out;
}

export type Target = { id: string; changedAt: string };

/**
 * Person ids to estimate, oldest person first.
 * - "all": everyone
 * - "missing": no net_worth row yet
 * - "stale": no row, or the person changed after the last estimate
 * `skip` drops people before `limit` applies (e.g. ones that got no estimate and haven't
 * changed since), so they can't fill every batch.
 */
export async function listTargets(
  db: AnyDB,
  mode: "all" | "missing" | "stale",
  limit = 1000,
  skip?: (t: Target) => boolean,
): Promise<string[]> {
  const people = await readAll("people", (from, to) => db.from("people").select("id, updated_at").order("created_at").order("id").range(from, to));

  const done = new Map<string, number>();
  if (mode !== "all") {
    const rows = await readAll("net_worth", (from, to) => db.from("net_worth").select("person_id, updated_at").order("person_id").range(from, to));
    for (const r of rows) done.set(String(r.person_id), ms(r.updated_at));
  }
  const work = mode === "stale" || skip ? await latestWork(db) : new Map<string, number>();

  const out: string[] = [];
  for (const p of people) {
    if (out.length >= limit) break;
    const id = String(p.id);
    const changed = Math.max(ms(p.updated_at), work.get(id) ?? 0);
    const at = done.get(id);
    if (at !== undefined && !(mode === "stale" && changed > at)) continue;
    if (skip?.({ id, changedAt: new Date(changed).toISOString() })) continue;
    out.push(id);
  }
  return out;
}

/** When the person's current estimate was written, or null. */
export async function estimatedAt(db: AnyDB, personId: string): Promise<Date | null> {
  const { data, error } = await db.from("net_worth").select("updated_at").eq("person_id", personId).maybeSingle();
  if (error) throw new Error(`net_worth: ${error.message}`);
  return data?.updated_at ? new Date(String(data.updated_at)) : null;
}

export async function saveEstimate(db: AnyDB, personId: string, est: Estimate) {
  const { error } = await db.from("net_worth").upsert({
    person_id: personId,
    low: Math.round(est.low),
    high: Math.round(est.high),
    reasoning: est.reasoning,
    sources: est.sources,
  });
  if (error) throw new Error(`net_worth upsert: ${error.message}`);
}
