// Total compensation lookup: occupation (teacher, nurse...) -> company table -> tier x role-family fallback.
// Values are US tech-hub medians (comp-table.json), then scaled by place and deflated for older years.
import table from "./comp-table.json";
import { WAGE_GROWTH } from "./assumptions";
import type { Place } from "./place";
import type { Family, Level, Tier } from "./types";

type LevelTable = Partial<Record<Level, number>>;
type CompanyEntry = { aliases: string[]; tier: Tier; tc: LevelTable; family?: Family; note?: string };
type Occupation = { keywords: string[]; median: number; p90: number };

const COMPANIES = table.companies as unknown as Record<string, CompanyEntry>;
const TIERS = table.tiers as unknown as Record<Tier, Record<Family, LevelTable>>;
const OCCUPATIONS = table.occupations as unknown as Record<string, Occupation>;

// ---------- company names ----------

// Legal forms only. "Company", "Group", "Holdings" and a leading "The" stay, so "Merrill Corporation",
// "Chase Group" and "The Citadel" do not collapse onto a known alias.
const LEGAL = new Set(["inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "corp", "co", "plc", "gmbh", "ag", "sa"]);

export function normCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\s*&\s*co\b\.?/g, " ") // "Goldman Sachs & Co. LLC"
    .replace(/&/g, " and ")
    .replace(/[.,'’]/g, "")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter((w, i) => w && (i === 0 || !LEGAL.has(w)))
    .join(" ");
}

let index: Map<string, { name: string } & CompanyEntry> | null = null;
function companyIndex() {
  if (index) return index;
  index = new Map();
  for (const [name, entry] of Object.entries(COMPANIES)) {
    for (const alias of [name, ...entry.aliases]) {
      const k = normCompany(alias);
      if (k && !index.has(k)) index.set(k, { name, ...entry });
    }
  }
  return index;
}

// Words that can follow a known name without changing the employer ("Meta AI", "IBM Research", "Tesla Energy").
const NEUTRAL = new Set([
  "ai", "research", "labs", "lab", "cloud", "platform", "platforms", "technologies", "technology", "services", "web",
  "reality", "energy", "robotics", "payments", "corporation", "us", "usa", "america", "americas",
  // Divisions and bank entities: "Microsoft Azure", "Amazon Prime Video", "Oracle Cloud Infrastructure",
  // "JPMorgan Chase Bank, N.A.", "Morgan Stanley Wealth Management", "Capital One Bank".
  "azure", "prime", "video", "logistics", "fresh", "health", "infrastructure", "x", "devices", "ads", "advertising",
  "maps", "music", "games", "studios", "pay", "commerce", "security", "software", "systems", "data", "digital",
  "asset", "management", "wealth", "bank", "banking", "securities", "markets", "financial", "na", "n", "a",
]);
// Everyday words and initials: exact match only ("Square Enix", "Jump Technologies", "Scale Corporation").
const EXACT_ONLY = new Set([
  "x", "ms", "gs", "ey", "sig", "hrt", "pan", "oci", "jump", "scale", "block", "square", "ramp", "chase", "merrill",
  "millennium", "tidal", "lark",
]);

/**
 * Built-in table entry for an employer name. Exact alias match after dropping legal forms
 * ("Meta Platforms, Inc." -> meta), also without a leading "The" ("The Goldman Sachs Group").
 * A longer name that starts with a known alias matches only when every extra word is neutral
 * ("Google Cloud Platform", "IBM Research"), so "Google Developer Groups" and "Millennium Health" do not.
 */
export function findCompany(company: string): ({ name: string } & CompanyEntry) | null {
  const n = normCompany(company);
  if (!n) return null;
  const idx = companyIndex();
  const names = [n];
  if (n.startsWith("the ") && n.split(" ").length > 2) names.push(n.slice(4));
  for (const name of names) {
    const exact = idx.get(name);
    if (exact) return exact;
  }
  for (const name of names) {
    const words = name.split(" ");
    for (let len = words.length - 1; len >= 1; len--) {
      const key = words.slice(0, len).join(" ");
      const hit = idx.get(key);
      const distinctive = len > 1 || (key.length >= 3 && !EXACT_ONLY.has(key));
      if (hit && distinctive && words.slice(len).every((w) => NEUTRAL.has(w))) return hit;
    }
  }
  return null;
}

// ---------- occupations ----------

// Broad buckets that overlap with tech role families: only used when the title has no tech family.
const GENERIC = new Set([
  "software_developer_general", "data_scientist_general", "engineer_non_software", "management_consultant_general",
  "financial_analyst", "executive_general", "student", "marketing_manager", "hr_recruiter",
]);
// Keywords that also show up in tech / finance titles ("Driver Engineer", "Software Engineer (Contractor)",
// "MD, Investment Banking", "Product Owner"): only used when the title has no role family either.
const AMBIGUOUS = new Set([
  "owner", "driver", "contractor", "technician", "construction", "md", "developer", "consultant", "creator", "vet", "rn",
  "np", "retail", "federal", "government", "controller",
]);

// Every keyword, longest first, so "nurse practitioner" beats "nurse" and "physician assistant" beats "physician".
let keywordIndex: { key: string; keyword: string; re: RegExp }[] | null = null;
function occupationKeywords() {
  keywordIndex ??= Object.entries(OCCUPATIONS)
    .flatMap(([key, o]) => o.keywords.map((keyword) => ({ key, keyword, re: new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i") })))
    .sort((a, b) => b.keyword.length - a.keyword.length);
  return keywordIndex;
}

const occCache = new Map<string, { key: string; median: number; p90: number } | null>();
export function findOccupation(title: string | null, family: Family): { key: string; median: number; p90: number } | null {
  if (!title) return null;
  const cacheKey = `${family}|${title}`;
  if (occCache.has(cacheKey)) return occCache.get(cacheKey)!;
  let found: { key: string; median: number; p90: number } | null = null;
  for (const { key, keyword, re } of occupationKeywords()) {
    if (family !== "other" && (GENERIC.has(key) || AMBIGUOUS.has(keyword))) continue;
    if (re.test(title)) {
      found = { key, median: OCCUPATIONS[key].median, p90: OCCUPATIONS[key].p90 };
      break;
    }
  }
  if (occCache.size > 5000) occCache.clear();
  occCache.set(cacheKey, found);
  return found;
}

// ---------- levels ----------

const LADDER: Level[] = ["intern", "entry", "mid", "senior", "staff", "principal", "manager", "director", "vp", "exec"];

/** tc at `level`; a missing level borrows the tier's shape around the nearest known level. */
function atLevel(t: LevelTable, level: Level, shape: LevelTable): number | null {
  if (t[level]) return t[level]!;
  const known = LADDER.filter((l) => t[l] && shape[l]);
  if (!known.length || !shape[level]) return null;
  const near = known.sort((a, b) => Math.abs(LADDER.indexOf(a) - LADDER.indexOf(level)) - Math.abs(LADDER.indexOf(b) - LADDER.indexOf(level)))[0];
  return (t[near]! * shape[level]!) / shape[near]!;
}

const TECH_TIERS: Tier[] = ["ai_lab", "quant", "bigtech", "top_private", "public_tech", "startup"];
// Hourly / frontline work pays the occupation rate even at Amazon, Apple or Google (warehouse, retail, drivers...).
const FRONTLINE = new Set([
  "retail_service", "driver_delivery", "skilled_trades", "chef_cook", "personal_care", "childcare_caregiver", "public_safety",
  "admin_assistant",
]);

export type CompQuote = {
  tc: number; // median for that year and place (USD)
  p90: number | null; // when known (occupations)
  basis: string;
  source: "table" | "occupation" | "tier";
};

/** Median total comp for one job, at the person's place, in the year it was held. */
export function quoteComp(args: {
  companyKey: string | null;
  tier: Tier;
  family: Family;
  level: Level;
  title: string | null;
  place: Place;
  yearsAgo: number;
}): CompQuote {
  const { companyKey, tier, family, level, title, place } = args;
  const tech = TECH_TIERS.includes(tier) || ["swe", "data", "pm", "design", "hardware", "research"].includes(family);
  const growth = tech ? WAGE_GROWTH.tech : WAGE_GROWTH.general;
  const deflate = Math.pow(1 + growth, -Math.max(0, args.yearsAgo));
  const k = (n: number) => `$${Math.round(n / 1000)}k`;

  // 1. Professions by title (teacher, nurse, physician, barista...). BLS national medians.
  const occ = findOccupation(title, family);
  const frontline = !!occ && FRONTLINE.has(occ.key);
  if (occ && (frontline || !(companyKey && tech && family !== "other"))) {
    const boost = level === "director" || level === "vp" || level === "exec" ? 1.5 : level === "manager" ? 1.3 : level === "senior" || level === "staff" ? 1.15 : 1;
    let tc = occ.median * boost * place.generalMult;
    // A profession (not frontline work) at a big tech / AI lab / quant employer still gets that employer's floor.
    if (companyKey && !frontline && ["bigtech", "ai_lab", "quant", "top_private"].includes(tier)) tc = Math.max(tc, (TIERS[tier].other[level] ?? 0) * place.techMult);
    return { tc: tc * deflate, p90: occ.p90 * boost * place.generalMult * deflate, basis: `${occ.key.replace(/_/g, " ")} median ${k(occ.median)}`, source: "occupation" };
  }

  const mult = tech ? place.techMult : place.generalMult / 1.35; // tier tables assume a Bay Area-like hub
  const shape = TIERS[tier]?.[family] ?? TIERS.other[family] ?? TIERS.other.other;

  // 2. Company table. Non-core families use the tier row scaled by the company's premium over its tier.
  const entry = companyKey ? COMPANIES[companyKey] : null;
  if (entry) {
    const core: Family = entry.family ?? "swe";
    const coreTC = atLevel(entry.tc, level, TIERS[entry.tier][core]);
    if (coreTC) {
      let base = coreTC;
      let how = `${companyKey} ${level} ${k(coreTC)}`;
      if (family !== core) {
        const tierCore = TIERS[entry.tier][core][level] ?? coreTC;
        const premium = Math.min(1.5, Math.max(0.7, coreTC / tierCore));
        base = (TIERS[entry.tier][family]?.[level] ?? tierCore) * premium;
        how = `${companyKey} ${family} ${level} ~${k(base)}`;
      }
      return { tc: base * mult * deflate, p90: null, basis: how, source: "table" };
    }
  }

  // 3. Tier x family x level.
  const base = atLevel(shape, level, TIERS.other.other) ?? TIERS.other.other[level] ?? 60_000;
  return { tc: base * mult * deflate, p90: null, basis: `${tier.replace(/_/g, " ")} ${family} ${level} ~${k(base)}`, source: "tier" };
}
