// Net worth CLI. Runs the same estimator as POST /api/net-worth, from a terminal.
//
//   pnpm networth <personId...>                 estimate + save to net_worth
//   pnpm networth --all [--missing|--stale]     everyone (or only people without / with an old estimate)
//   pnpm networth --watch [--interval 20]       keep estimating people who have no estimate yet (interval >= 5s)
//   pnpm networth --file seed.json [--id X]     offline: seed file, worker cache profile, or connections list
//
// Flags: --dry (print, don't save)  --no-llm  --no-search  --deep  --limit N  --concurrency N  --json  --verbose
// Value flags also take --flag=value.
// Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, and optionally
// ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY (Claude step), FIRECRAWL_API_KEY (salary search).
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { estimateNetWorth, type EstimateOptions } from "../src/lib/networth";
import { lastChange, listTargets, loadBundles, saveEstimate, type AnyDB } from "../src/lib/networth/db";
import type { PersonBundle } from "../src/lib/networth/normalize";
import type { Estimate } from "../src/lib/networth/types";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

function die(msg: string): never {
  console.error(`${msg}\nSee the header of scripts/networth.ts for usage.`);
  process.exit(1);
}

const bool = { type: "boolean" } as const;
const str = { type: "string" } as const;
function parse() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        all: bool, missing: bool, stale: bool, watch: bool, dry: bool, deep: bool, json: bool, verbose: bool,
        "no-llm": bool, "no-search": bool,
        file: str, id: str, limit: str, concurrency: str, interval: str,
      },
    });
  } catch (e) {
    die((e as Error).message);
  }
}
const { values: args, positionals: positional } = parse();

// Integer flag >= min, or the default when it isn't given.
function int(name: "limit" | "concurrency" | "interval", def: number, min = 1) {
  const raw = args[name];
  if (raw === undefined) return def;
  const v = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(v) || v < min) die(`--${name} must be a whole number >= ${min} (got "${raw}")`);
  return v;
}

const limit = int("limit", 1000);
const concurrency = int("concurrency", 3);
const intervalSec = int("interval", 20, 5);
const dry = !!args.dry || !!args.file;
const json = !!args.json;
const verbose = !!args.verbose;
if (args.watch && dry) die("--watch saves estimates, so it can't run with --dry or --file.");
const estOpts: EstimateOptions = {
  llm: !args["no-llm"],
  search: !args["no-search"],
  deep: !!args.deep,
  log: verbose ? (m) => console.error(`  · ${m}`) : undefined,
};

const usd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;

function print(b: PersonBundle, est: Estimate | null) {
  if (!est) {
    if (json) console.log(JSON.stringify({ person_id: b.person.id ?? null, name: b.person.name, skipped: "not enough information" }));
    else console.log(`\n${b.person.name}  →  (no estimate: not enough information)`);
    return;
  }
  if (json) {
    console.log(JSON.stringify({ person_id: b.person.id ?? null, name: b.person.name, ...est }));
    return;
  }
  const guess = typeof b.person.net_worth_guess === "number" ? `  (they guessed ${usd(b.person.net_worth_guess)})` : "";
  console.log(`\n${b.person.name}  →  ${usd(est.low)} – ${usd(est.high)}${guess}`);
  console.log(`  ${est.reasoning}`);
  if (verbose) {
    for (const s of est.sources) console.log(`  - [${s.type}] ${s.label}${s.url ? `  ${s.url}` : ""}`);
    if (est.debug) console.log(`  debug: ${JSON.stringify(est.debug)}`);
  }
}

/** Estimates (and saves) everyone. Returns the people who got no estimate, and who failed. */
async function runAll(bundles: PersonBundle[], db: AnyDB | null) {
  let i = 0;
  let estimated = 0;
  let saved = 0;
  const none: PersonBundle[] = [];
  const failed: PersonBundle[] = [];
  const worker = async () => {
    while (i < bundles.length) {
      const b = bundles[i++];
      try {
        const est = await estimateNetWorth(b, estOpts);
        print(b, est);
        if (!est) {
          none.push(b);
          continue;
        }
        estimated++;
        if (db && !dry) {
          await saveEstimate(db, String(b.person.id), est);
          saved++;
        }
      } catch (e) {
        failed.push(b);
        console.error(`\n${b.person.name}: FAILED ${(e as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, bundles.length) }, worker));
  // A person whose save failed counts as estimated and failed.
  const savedNote = db && !dry ? ` (${saved} saved)` : "";
  if (!json) console.error(`\n${bundles.length} people: ${estimated} estimated${savedNote}, ${none.length} no estimate, ${failed.length} failed.`);
  return { none, failed };
}

// ---------- offline: files ----------

function bundlesFromFile(path: string): PersonBundle[] {
  const data = JSON.parse(readFileSync(path, "utf8"));
  // seed/alex.json: { people, net_worth, ... }
  if (Array.isArray(data?.people)) return data.people.map((person: Record<string, unknown>) => ({ person }));
  // worker cache: .cache/linkedin/<handle>.json = one Profile dict
  if (data?.platform && data?.raw) {
    return [{ person: { id: data.url, name: data.name ?? "Unknown", headline: data.headline, location: data.location, raw: { [data.platform]: data } } }];
  }
  // worker cache: .cache/linkedin_connections/<handle>.json = connection cards
  if (Array.isArray(data)) {
    return data.map((c: Record<string, unknown>) => ({
      person: { id: c.linkedin_url, name: c.name, headline: c.headline, company: c.company, role: c.role, raw: { linkedin_connections: c } },
    }));
  }
  throw new Error(`Unrecognized file shape: ${path}`);
}

// ---------- main ----------

async function main() {
  if (args.file) {
    let bundles = bundlesFromFile(args.file);
    const id = args.id;
    if (id) bundles = bundles.filter((b) => b.person.id === id || String(b.person.name).toLowerCase() === id.toLowerCase());
    await runAll(bundles.slice(0, limit), null);
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local (or use --file for offline runs).");
    process.exit(1);
  }
  const db: AnyDB = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  if (args.watch) {
    const every = intervalSec * 1000;
    const mode = args.stale ? "stale" : "missing";
    // People with no estimate or a failure have no row, so they'd be re-run (and re-sent to
    // Claude) every cycle. Skip them until they change (lastChange); retry failures after an hour.
    const tried = new Map<string, { changedAt: string; until: number }>();
    let errors = 0;
    console.error(`Watching for people without an estimate (every ${intervalSec}s). Ctrl+C to stop.`);
    for (;;) {
      try {
        const skip = (t: { id: string; changedAt: string }) => {
          const x = tried.get(t.id);
          return !!x && x.changedAt === t.changedAt && Date.now() < x.until;
        };
        const ids = await listTargets(db, mode, limit, skip);
        if (ids.length) {
          const { none, failed } = await runAll([...(await loadBundles(db, ids)).values()], db);
          for (const b of none) tried.set(String(b.person.id), { changedAt: lastChange(b), until: Infinity });
          for (const b of failed) tried.set(String(b.person.id), { changedAt: lastChange(b), until: Date.now() + 3600_000 });
        }
        errors = 0;
      } catch (e) {
        errors++;
        console.error(`Watch cycle failed (${errors} in a row): ${(e as Error).message}`);
      }
      // Back off after errors: 2x, 4x, ... the interval, at most 5 minutes (or the interval if longer).
      const wait = errors ? Math.min(every * 2 ** errors, Math.max(every, 300_000)) : every;
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const badIds = positional.filter((id) => !UUID.test(id));
  if (badIds.length) die(`Not person ids (uuid): ${badIds.join(", ")}`);
  const ids = args.all
    ? await listTargets(db, args.missing ? "missing" : args.stale ? "stale" : "all", limit)
    : [...new Set(positional.map((id) => id.toLowerCase()))];
  if (!ids.length) {
    console.error("Nothing to do. Pass person ids, --all, --watch or --file. See the header of scripts/networth.ts.");
    process.exit(args.all ? 0 : 1);
  }
  const bundles = await loadBundles(db, ids);
  const missing = ids.filter((id) => !bundles.has(id));
  if (missing.length) console.error(`Not found in people: ${missing.join(", ")}`);
  await runAll([...bundles.values()], db);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
