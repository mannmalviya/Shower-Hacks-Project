// POST /api/net-worth: estimate net worth and upsert `net_worth` rows.
//
// Body (JSON), one of:
//   { "personId": "<uuid>" }                 one person (call this after their scrape job is done)
//   { "personIds": ["<uuid>", ...] }         up to 25 people
//   { "missing": true, "limit": 10 }         people with no estimate yet
// Options: "force": true re-estimates even if the person hasn't changed since the last estimate,
//          "dry": true returns the estimate without saving,
//          "deep": true lets Claude look up more salaries itself (slower; founders, unknown companies).
//
// Auth: anyone may send { personId }. It only runs when the person has no estimate yet or changed
// since the last one, and at most once an hour while nothing changes. personIds, missing, force,
// dry and deep need "Authorization: Bearer <NETWORTH_API_SECRET>" (disabled when it isn't set).
import { createHash, timingSafeEqual } from "node:crypto";
import { estimateNetWorth, mapLimit } from "@/lib/networth";
import { estimatedAt, lastChange, listTargets, loadBundles, saveEstimate, type AnyDB } from "@/lib/networth/db";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const MAX_BATCH = 25;
const RETRY_MS = 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Person id -> when we last tried and what the person looked like then. People who get no
// estimate have no row, so without this they'd be re-run on every call. Per server instance.
const tried = new Map<string, { at: number; changedAt: string }>();

function recentlyTried(id: string, changedAt: string) {
  const t = tried.get(id);
  return !!t && Date.now() - t.at < RETRY_MS && t.changedAt === changedAt;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest();

function authorized(request: Request) {
  const secret = process.env.NETWORTH_API_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !auth.startsWith("Bearer ")) return false;
  // Hash both sides so the compare is constant time whatever the lengths.
  return timingSafeEqual(sha256(auth.slice(7)), sha256(secret));
}

const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad("Body must be JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Body must be a JSON object");

  const force = body.force === true;
  const dry = body.dry === true;
  const deep = body.deep === true;
  const privileged = force || dry || deep || body.missing === true || body.personIds !== undefined || body.limit !== undefined;
  const authed = authorized(request);
  if (privileged && !authed) {
    if (!process.env.NETWORTH_API_SECRET) return bad("personIds, missing, force, dry and deep are disabled: NETWORTH_API_SECRET is not set", 403);
    return bad("unauthorized", 401);
  }
  // A wrong secret is a config bug; say so instead of quietly running as a public call.
  if (!authed && process.env.NETWORTH_API_SECRET && request.headers.has("authorization")) return bad("unauthorized", 401);

  let db: AnyDB;
  try {
    // The generated DB types predate the live schema; the networth module checks rows itself.
    db = createAdminClient() as unknown as AnyDB;
  } catch (e) {
    return bad((e as Error).message, 500);
  }

  // Unique ids; bad ones get their own error result and never reach the DB.
  let raw: unknown[];
  if (body.personId !== undefined) raw = [body.personId];
  else if (body.personIds !== undefined) {
    if (!Array.isArray(body.personIds)) return bad("personIds must be an array");
    raw = body.personIds;
  } else if (body.missing === true) {
    const limit = body.limit ?? 10;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) return bad("limit must be a positive integer");
    try {
      raw = await listTargets(db, "missing", Math.min(limit, MAX_BATCH), (t) => recentlyTried(t.id, t.changedAt));
    } catch (e) {
      return bad((e as Error).message, 502);
    }
  } else return bad("Pass personId, personIds or missing: true");

  const ids = [...new Set(raw.map((x) => (typeof x === "string" && UUID.test(x) ? x.toLowerCase() : String(x))))];
  if (ids.length > MAX_BATCH) return bad(`At most ${MAX_BATCH} people per call`);

  let bundles: Awaited<ReturnType<typeof loadBundles>>;
  try {
    bundles = await loadBundles(db, ids.filter((id) => UUID.test(id)));
  } catch (e) {
    return bad((e as Error).message, 502);
  }

  const now = Date.now();
  for (const [id, t] of tried) if (now - t.at >= RETRY_MS) tried.delete(id);

  const results = await mapLimit(ids, 3, async (id) => {
    if (!UUID.test(id)) return { personId: id, error: "invalid id" };
    const bundle = bundles.get(id);
    if (!bundle) return { personId: id, error: "not found" };
    const changedAt = lastChange(bundle);
    if (!force && recentlyTried(id, changedAt)) return { personId: id, skipped: "tried in the last hour, no change since" };
    // Set before any await so parallel calls for the same person don't both run it.
    if (!dry) tried.set(id, { at: Date.now(), changedAt });
    try {
      if (!force) {
        const at = await estimatedAt(db, id);
        if (at && Date.parse(changedAt) <= at.getTime()) {
          if (!dry) tried.delete(id);
          return { personId: id, skipped: "up to date" };
        }
      }
    } catch (e) {
      if (!dry) tried.delete(id); // a failed read isn't an attempt
      return { personId: id, error: (e as Error).message };
    }
    try {
      const est = await estimateNetWorth(bundle, { deep });
      if (!est) return { personId: id, skipped: "not enough information" };
      if (!dry) {
        await saveEstimate(db, id, est);
        tried.delete(id); // it has a row now; the up-to-date check covers it
      }
      return { personId: id, low: est.low, high: est.high, reasoning: est.reasoning, sources: est.sources };
    } catch (e) {
      return { personId: id, error: (e as Error).message };
    }
  });
  return Response.json({ results });
}
