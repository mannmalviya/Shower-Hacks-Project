// Salary evidence from the web for one job.
//
// 1. levels.fyi markdown pages (https://www.levels.fyi/companies/<co>/salaries/<family>.md). levels.fyi
//    publishes these for AI agents (see its robots.txt / llms.txt). We fetch them directly with an
//    honest bot User-Agent, a few at most per person, cached. Never through Firecrawl: levels.fyi's
//    robots.txt disallows FirecrawlAgent.
// 2. Firecrawl search snippets (levels.fyi + glassdoor.com), only when FIRECRAWL_API_KEY is set.
//    Search results only, no page scraping. 2 credits per search.
// Every number found is returned as evidence (sources + LLM context); `pick` is the one the model uses.
import { normCompany } from "./comp";
import { roleFamily, type ClassifiedPosition } from "./classify";
import type { CompEvidence, Level } from "./types";

const UA = "Mozilla/5.0 (compatible; ShowerHacksNetWorth/0.1; +https://github.com/mannmalviya/Shower-Hacks-Project)";
const LEVELS = "https://www.levels.fyi";

export type EvidencePick = { tc: number; basis: string; url: string | null; source: CompEvidence["source"] };
export type EvidenceResult = { evidence: CompEvidence[]; pick: EvidencePick | null };

// ---------- money ----------

const MONEY = String.raw`\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?([KkMm])?(?![a-zA-Z])`;
function money(num: string, suffix?: string): number {
  const n = parseFloat(num.replace(/,/g, ""));
  const mult = suffix ? (suffix.toLowerCase() === "m" ? 1e6 : 1e3) : 1;
  return Math.round(n * mult);
}
const decode = (s: string) => s.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ");

// ---------- levels.fyi markdown ----------

export type LevelsPage = {
  url: string;
  median: number | null;
  levels: { level: string; tc: number; yoe: [number, number] | null }[];
};

export function parseLevelsMarkdown(md: string, url: string): LevelsPage | null {
  if (!/levels\.fyi/i.test(md)) return null;
  const currency = md.match(/\*\*Currency:\*\*\s*([A-Z]{3})/)?.[1];
  if (currency && currency !== "USD") return null;
  const med = md.match(new RegExp(String.raw`(?:Median|Average) Total Compensation:\s*${MONEY}`));
  const levels: LevelsPage["levels"] = [];
  for (const m of md.matchAll(new RegExp(String.raw`^\|\s*([^|]+?)\s*\|\s*${MONEY}\s*\|\s*$`, "gm"))) {
    if (/^(level|rank|-+)$/i.test(m[1])) continue;
    levels.push({ level: m[1], tc: money(m[2], m[3]), yoe: null });
  }
  // "Software Engineers at Airbnb G8 in United States typically have 1–3 / around 4 / 10+ years of experience".
  // "<company> <level>" ends with the level name; the longest one wins, so a "Senior Director" line never
  // counts for "Director".
  const YOE_RE = /^[^\n]*? at ([^\n]+?) in [^\n]+? typically have (?:(\d+)\s?[–-]\s?(\d+)|around (\d+)|(\d+)\+|less than (?:1|one)) years? of experience/gm;
  for (const y of md.matchAll(YOE_RE)) {
    const l = levels.filter((l) => y[1] === l.level || y[1].endsWith(` ${l.level}`)).sort((a, b) => b.level.length - a.level.length)[0];
    if (!l || l.yoe) continue;
    l.yoe = y[2] ? [+y[2], +y[3]] : y[4] ? [+y[4], +y[4]] : y[5] ? [+y[5], +y[5] + 5] : [0, 0];
  }
  const median = med ? money(med[1], med[2]) : null;
  if (!median && !levels.length) return null;
  return { url, median, levels };
}

const LEAD_RE = /director|\bvp\b|vice president|\bhead\b/i;

/** Pick the level a person with `yoe` years of experience (and title level `level`) most likely holds. */
export function pickLevel(page: LevelsPage, yoe: number, level: Level) {
  if (!page.levels.length) return null;
  // Directors and up are not priced by yoe on IC rows. A director takes the lowest-paid leadership row (else
  // null: keep the table); vp / exec the highest-paid one, else the top row.
  const lead = page.levels.filter((l) => LEAD_RE.test(l.level));
  if (level === "director" || level === "vp" || level === "exec") {
    if (!lead.length) return level === "director" ? null : page.levels.at(-1)!;
    return lead.reduce((a, b) => ((level === "director" ? b.tc < a.tc : b.tc > a.tc) ? b : a));
  }
  // Everyone else: IC / manager rows only, so 20 years of experience never lands on a Director row.
  const rows = page.levels.filter((l) => !lead.includes(l));
  if (!rows.length) return null;
  // Manager pages (software-engineering-manager...) start at the first manager level; on IC pages a manager
  // sits at senior or above.
  const mgrPage = /-(engineering|science|design)-manager$/.test(page.url);
  const floorIdx = ({ entry: 0, mid: 1, senior: 2, staff: 3, principal: 4, manager: mgrPage ? 0 : 2 } as Partial<Record<Level, number>>)[level] ?? 0;
  let idx = 0;
  if (rows.some((l) => l.yoe)) {
    let best = Infinity;
    rows.forEach((l, i) => {
      if (!l.yoe) return;
      const d = yoe < l.yoe[0] ? l.yoe[0] - yoe : yoe > l.yoe[1] ? yoe - l.yoe[1] : 0;
      if (d < best) {
        best = d;
        idx = i;
      }
    });
  } else {
    idx = floorIdx;
  }
  idx = Math.min(rows.length - 1, Math.max(idx, Math.min(floorIdx, rows.length - 1)));
  return rows[idx];
}

// levels.fyi company slugs that don't follow the lowercase-hyphen rule.
const SLUG_ALIASES: Record<string, string> = {
  facebook: "meta", "meta-platforms": "meta", alphabet: "google", youtube: "google", aws: "amazon",
  "amazon-web-services": "amazon", "mckinsey-and-company": "mckinsey", "mckinsey-company": "mckinsey",
  "boston-consulting-group": "bcg", "the-boston-consulting-group": "bcg", "bain-and-company": "bain", "bain-company": "bain",
  jpmorgan: "jpmorgan-chase", "jp-morgan": "jpmorgan-chase", "jpmorgan-chase-and-co": "jpmorgan-chase",
  "bytedance-tiktok": "bytedance", tiktok: "bytedance", "x-twitter": "twitter", x: "twitter",
  "susquehanna-sig": "susquehanna-international-group", sig: "susquehanna-international-group",
  "d-e-shaw": "de-shaw", "google-deepmind": "google", "walmart-global-tech": "walmart", "imc-trading": "imc",
};

export function toSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function allCompanySlugs(...names: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    if (!raw) continue;
    const noParen = raw.replace(/\s*\([^)]*\)\s*/g, " ").trim();
    const stripped = noParen.replace(/[,\s]+(inc|llc|corp|corporation|co|company|ltd|limited|plc|gmbh|lp|llp|group|holdings)\.?$/i, "");
    for (const s of [toSlug(raw), toSlug(noParen), toSlug(stripped)]) {
      if (!s) continue;
      out.push(SLUG_ALIASES[s] ?? s);
    }
  }
  return [...new Set(out)];
}

/** levels.fyi slug candidates to fetch, most likely first. */
export function companySlugs(...names: (string | null | undefined)[]): string[] {
  return allCompanySlugs(...names).slice(0, 3);
}

/** levels.fyi job family slug for a classified job, or null when levels.fyi won't have it. */
export function familySlug(p: Pick<ClassifiedPosition, "family" | "level" | "title" | "tier">): string | null {
  const t = (p.title ?? "").toLowerCase();
  const mgr = p.level === "manager" || p.level === "director";
  switch (p.family) {
    case "swe":
    case "research":
      return mgr ? "software-engineering-manager" : "software-engineer";
    case "data":
      return mgr ? "data-science-manager" : /analyst/.test(t) ? "data-analyst" : "data-scientist";
    case "pm":
      return /program|tpm/.test(t) ? "technical-program-manager" : "product-manager";
    case "design":
      return mgr ? "product-design-manager" : "product-designer";
    case "hardware":
      return /mechanical/.test(t) ? "mechanical-engineer" : /electrical/.test(t) ? "electrical-engineer" : "hardware-engineer";
    case "sales":
      return /solutions? engineer|sales engineer/.test(t) ? "sales-engineer" : "sales";
    case "finance":
      if (p.tier === "finance_ib") return "investment-banker";
      if (/venture/.test(t)) return "venture-capitalist";
      if (/account|audit|tax/.test(t)) return "accountant";
      return "financial-analyst";
    case "consulting":
      return "management-consultant";
    case "ops":
      return /recruit|talent/.test(t) ? "recruiter" : /market/.test(t) ? "marketing" : /program/.test(t) ? "program-manager" : /project/.test(t) ? "project-manager" : null;
    default:
      return null;
  }
}

// ---------- fetching (throttled + cached per process) ----------

let nextSlot = 0;
async function throttle(ms: number) {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + ms;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

/** One shared request per key. Results with keep=false (failures, empty bodies) are dropped so the next call retries. */
function cached<T>(map: Map<string, Promise<T>>, key: string, load: () => Promise<{ value: T; keep: boolean }>): Promise<T> {
  const hit = map.get(key);
  if (hit) return hit;
  const r = load();
  const p = r.then((x) => x.value);
  map.set(key, p);
  r.then((x) => {
    if (!x.keep && map.get(key) === p) map.delete(key);
  });
  return p;
}

/** `p`, or `fallback` as soon as the caller's signal aborts. The shared request itself keeps running for other callers. */
function orAbort<T>(p: Promise<T>, signal: AbortSignal | undefined, fallback: T): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    const onAbort = () => resolve(fallback);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, () => resolve(fallback)).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

const cache = new Map<string, Promise<LevelsPage | null>>();

async function loadLevelsPage(url: string): Promise<{ value: LevelsPage | null; keep: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1_500));
    await throttle(400);
    try {
      const res = await fetch(`${url}.md`, {
        headers: { "User-Agent": UA, Accept: "text/markdown,text/plain;q=0.9,*/*;q=0.1" },
        redirect: "follow",
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
      // 404 = no such company or job family: a real answer, cached. 429 / 5xx are not.
      if (res.status === 404) return { value: null, keep: true };
      if (!res.ok) return { value: null, keep: false };
      const md = await res.text();
      // An empty 200 (no markdown content-type) is levels.fyi's bot filter on a CDN miss: wait, retry once.
      if (!(res.headers.get("content-type") ?? "").includes("markdown") || !md.trim()) continue;
      return { value: parseLevelsMarkdown(md, url), keep: true };
    } catch {
      return { value: null, keep: false }; // timeout / network error
    }
  }
  return { value: null, keep: false };
}

async function fetchLevelsPage(slug: string, family: string, signal?: AbortSignal): Promise<LevelsPage | null> {
  if (signal?.aborted) return null;
  const url = `${LEVELS}/companies/${slug}/salaries/${family}`;
  return orAbort(cached(cache, url, () => loadLevelsPage(url)), signal, null);
}

// ---------- Firecrawl search (snippets only) ----------

type SearchHit = { url: string; title: string; description: string };

const searchCache = new Map<string, Promise<SearchHit[]>>();
export async function firecrawlSearch(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key || signal?.aborted) return [];
  const search = async (): Promise<{ value: SearchHit[]; keep: boolean }> => {
    try {
      const res = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.slice(0, 500), limit: 5, includeDomains: ["levels.fyi", "glassdoor.com"], highlights: false, timeout: 15_000 }),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      if (!res.ok) return { value: [], keep: false };
      const json = (await res.json()) as { data?: { web?: SearchHit[] } };
      return { value: (json.data?.web ?? []).map((r) => ({ url: r.url, title: String(r.title ?? ""), description: String(r.description ?? "") })), keep: true };
    } catch {
      return { value: [], keep: false };
    }
  };
  return orAbort(cached(searchCache, query, search), signal, []);
}

// ---------- snippet parsers ----------

const LV_TITLE_RE = new RegExp(String.raw`^(.+?) Salary(?: in (.+?))? \| ${MONEY}\s?-\s?${MONEY}\+? \| Levels\.fyi`, "i");
const LV_MEDIAN_RE = new RegExp(String.raw`median (?:yearly )?(?:total )?compensation[^.$]{0,60}?(?:totals|is) ${MONEY}`, "i");
const LV_LEVEL_MEDIAN_RE = new RegExp(String.raw`median total compensation package for an? (.+?) at (.+?) is ${MONEY}`, "i");
const LV_INTERN_RE = new RegExp(String.raw`interns at (.+?) make ${MONEY} per hour|\| ${MONEY} \/ hr \|`, "i");
const GD_TOTAL_RANGE_RE = new RegExp(String.raw`estimated total pay range for an? (.+?) at (.+?) is ${MONEY}\s?[-–]\s?${MONEY} per year`, "i");
const GD_TOTAL_RE = new RegExp(String.raw`estimated total pay for an? (.+?) at (.+?) is ${MONEY} per year`, "i");
const GD_AVG_RE = new RegExp(String.raw`Average salar(?:y|ies) for (.+?)(?: in [^:]+)?:\s*(?:US)?${MONEY}`, "i");

/** The job a search hit must match: same employer, same job family, same intern-or-not. */
export type HitPosition = Pick<ClassifiedPosition, "company" | "companyKey" | "title" | "family" | "level" | "tier" | "kind">;

/** Role part of "<company> <role>" text when the company is this employer (whole words: "Google Cloud" is Google, "Dropbox" is not Box); else null. */
function afterCompany(text: string, p: HitPosition): string | null {
  const n = normCompany(text);
  for (const c of [p.company, p.companyKey]) {
    const k = c ? normCompany(c) : "";
    if (k && (n === k || n.startsWith(`${k} `))) return n.slice(k.length).trim();
  }
  return null;
}

const INTERN_WORD = /\bintern(ship)?s?\b/i;
const sameRole = (role: string, p: HitPosition) => roleFamily(role) === p.family && INTERN_WORD.test(role) === (p.kind === "internship");

export function parseHit(hit: SearchHit, p: HitPosition): CompEvidence | null {
  const text = decode(`${hit.title} ${hit.description}`);
  const base = { company: p.company, title: p.title, url: hit.url, snippet: decode(hit.description).slice(0, 300) };
  const intern = p.kind === "internship";
  if (/levels\.fyi/i.test(hit.url)) {
    // The URL names the company and job family: /companies/<co>/salaries/<family>, /internships/<Co>/<Role>/.
    const u = hit.url.match(/levels\.fyi\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(companies|internships)\/([^/?#]+)(?:\/([^/?#]+))?(?:\/([^/?#]+))?/i);
    if (!u) return null;
    const co = toSlug(u[2]);
    if (!allCompanySlugs(p.companyKey, p.company).includes(SLUG_ALIASES[co] ?? co)) return null;
    if (u[1].toLowerCase() === "internships") {
      if (!intern || !u[3] || !sameRole(u[3].replace(/-/g, " "), p)) return null;
    } else {
      const fam = familySlug(p);
      const urlFam = u[3]?.toLowerCase() === "salaries" ? u[4]?.toLowerCase() : undefined;
      const titleFam = toSlug(decode(hit.title).split(/ Salar(?:y|ies)\b/i)[0]);
      if (!fam || !(urlFam ? urlFam === fam : titleFam === fam || titleFam.endsWith(`-${fam}`))) return null;
    }
    // Intern pay only for interns; a full-time page's median never prices an intern.
    const hourly = text.match(LV_INTERN_RE);
    if (intern) {
      if (!hourly) return null;
      return { ...base, source: "levels.fyi", medianTC: Math.round(money(hourly[2] ?? hourly[4], hourly[3] ?? hourly[5]) * 2080), low: null, high: null };
    }
    const lvl = text.match(LV_LEVEL_MEDIAN_RE);
    const med = text.match(LV_MEDIAN_RE);
    const range = decode(hit.title).match(LV_TITLE_RE);
    const medianTC = lvl ? money(lvl[3], lvl[4]) : med ? money(med[1], med[2]) : null;
    const low = range ? money(range[3], range[4]) : null;
    const high = range ? money(range[5], range[6]) : null;
    if (!medianTC && !low) return null;
    // Without a stated median the range (lowest level to an open-ended top) is evidence only, never a pick.
    return { ...base, source: "levels.fyi", medianTC, low, high };
  }
  if (/^(https?:\/\/)?(www\.)?glassdoor\.com\//i.test(hit.url)) {
    const r = text.match(GD_TOTAL_RANGE_RE);
    if (r && afterCompany(r[2], p) != null && sameRole(r[1], p)) {
      const low = money(r[3], r[4]);
      const high = money(r[5], r[6]);
      return { ...base, source: "glassdoor", medianTC: Math.round((low + high) / 2), low, high };
    }
    const t = text.match(GD_TOTAL_RE);
    if (t && afterCompany(t[2], p) != null && sameRole(t[1], p)) return { ...base, source: "glassdoor", medianTC: money(t[3], t[4]), low: null, high: null };
    const a = text.match(GD_AVG_RE);
    const role = a ? afterCompany(a[1], p) : null; // "Average salary for Deloitte Consultant"
    // "Average salary" is mostly base pay: a floor, not total comp.
    if (a && role && sameRole(role, p)) return { ...base, source: "glassdoor", medianTC: null, low: money(a[2], a[3]), high: null };
  }
  return null;
}

// ---------- main ----------

/**
 * Salary evidence for one job. `tableTC` is the built-in estimate (US, today); a web number far from it
 * (wrong company, wrong currency, a max instead of a median) is kept as evidence but not picked.
 */
export async function findCompEvidence(
  p: ClassifiedPosition,
  ctx: { yoe: number; tableTC: number; companyKey: string | null; log?: (m: string) => void; signal?: AbortSignal },
): Promise<EvidenceResult> {
  const evidence: CompEvidence[] = [];
  const sane = (tc: number) => tc > ctx.tableTC * 0.4 && tc < ctx.tableTC * 2.5;
  let pick: EvidencePick | null = null;

  // 1. levels.fyi markdown (not for interns: those pages list full-time levels only).
  const fam = p.kind === "internship" ? null : familySlug(p);
  const leader = p.level === "director" || p.level === "vp" || p.level === "exec";
  if (fam) {
    for (const slug of companySlugs(ctx.companyKey, p.company)) {
      if (ctx.signal?.aborted) break;
      const page = await fetchLevelsPage(slug, fam, ctx.signal);
      if (!page) continue;
      const lvl = pickLevel(page, ctx.yoe, p.level);
      // A director with no director row: the overall median is IC pay, so it is evidence only (the table stays).
      const tc = lvl?.tc ?? (leader ? null : page.median);
      const yrs = lvl?.yoe ? (lvl.yoe[0] === lvl.yoe[1] ? `${lvl.yoe[0]}` : `${lvl.yoe[0]}–${lvl.yoe[1]}`) : null;
      const label = lvl ? `${lvl.level}${yrs ? ` (typically ${yrs} yrs)` : ""}` : tc ? "median" : `no ${p.level} level listed`;
      evidence.push({ source: "levels.fyi", company: p.company, title: p.title, url: page.url, snippet: `${label}${tc ? `: $${tc.toLocaleString("en-US")}` : ""}; overall median $${(page.median ?? 0).toLocaleString("en-US")}`, medianTC: tc, low: page.levels[0]?.tc ?? null, high: page.levels.at(-1)?.tc ?? null });
      if (tc && sane(tc)) pick = { tc, basis: `levels.fyi ${slug} ${fam.replace(/-/g, " ")} ${label}`, url: page.url, source: "levels.fyi" };
      ctx.log?.(`levels.fyi ${slug}/${fam}: ${label}${tc ? ` $${tc}` : ""}`);
      break;
    }
  }

  // 2. Firecrawl search snippets.
  if (!pick && process.env.FIRECRAWL_API_KEY && !ctx.signal?.aborted) {
    const role = p.kind === "internship" ? `${p.title ?? "software engineer"} intern` : p.title ?? p.family;
    const hits = await firecrawlSearch(`${p.company} ${role} salary total compensation`, ctx.signal);
    ctx.log?.(`firecrawl: ${hits.length} results`);
    for (const h of hits) {
      const e = parseHit(h, p);
      if (e) evidence.push(e);
    }
    const lv = evidence.find((e) => e.source === "levels.fyi" && e.medianTC && sane(e.medianTC));
    const gd = evidence.find((e) => e.source === "glassdoor" && e.medianTC && sane(e.medianTC));
    const best = lv ?? gd;
    if (best?.medianTC) pick = { tc: best.medianTC, basis: `${best.source} search result`, url: best.url, source: best.source };
  }

  return { evidence, pick };
}
