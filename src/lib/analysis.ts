// Social mirror analysis. Pure function: people + follows + net_worth -> stats for the viz.
// No DB, no network. Works on Supabase rows (src/lib/worldData.ts) and on seed/alex.json (converted there).
// Conventions (degree, circles, platforms are derived, not stored): see seed/README.md.
import type { Json } from "./supabase/database.types";

// ---------- inputs (subset of the Supabase rows) ----------

export type PersonIn = {
  id: string;
  name: string;
  headline: string | null;
  location: string | null;
  raw: Json;
  // joined rows (supabase-js nested select, see src/lib/worldData.ts)
  experiences?: { company: string; title: string | null; end_date: string | null; is_primary: boolean }[];
  education?: { school: string }[];
  social_profiles?: { platform: string; follower_count: number | null }[];
};

/** The primary job: is_primary, else the first current one, else the first listed. */
export const jobOf = (p: PersonIn) => {
  const xs = p.experiences ?? [];
  return xs.find((e) => e.is_primary) ?? xs.find((e) => !e.end_date) ?? xs[0] ?? null;
};
export type FollowIn = { follower_id: string; person_id: string };
export type NetWorthIn = { person_id: string; low: number; high: number };

// ---------- outputs ----------

export type Era = "past" | "present" | "unknown";
/** mutual = both follow; aspiration = you follow them, no follow back; audience = they follow you only */
export type Tie = "self" | "mutual" | "aspiration" | "audience" | "indirect";

export type Node = {
  id: string;
  name: string;
  tribe: string; // primary tribe (color, main pull)
  tribes: string[]; // secondary tribes (badges, extra pull -> you end up between groups)
  degree: 0 | 1 | 2;
  tie: Tie;
  circle: string;
  era: Era;
  platforms: string[];
  city: string | null;
  country: string | null;
  school: string | null;
  company: string | null;
  industry: string;
  interests: string[];
  wealth: { low: number; high: number; mid: number } | null;
  wealthTier: string;
  isStudent: boolean; // students and interns: left out of "what your group earns"
  isBridge: boolean;
  audience: number; // followers across Instagram + X + GitHub (who a post relayed by them could reach)
};

export type Dimension = "tribe" | "city" | "country" | "school" | "company" | "industry" | "platform" | "wealthTier" | "circle" | "interest";

export type Bubble = {
  dimension: Dimension;
  groups: { value: string; count: number; share: number }[]; // known values only, biggest first
  topShare: number; // share of the biggest group, 0-1
  top2Share: number;
  diversity: number; // Gini-Simpson x 100: 0 = everyone the same, ~100 = all different
  unknownShare: number;
  fact: string; // one line of truth, shown when the filter is clicked
};

export type CircleStat = {
  name: string;
  era: Era;
  size: number;
  mutualShare: number;
  medianWealth: number | null;
  topTraits: string[]; // aggregates only: used to let Claude name unlabeled groups
};

export type Tribe = {
  name: string;
  size: number;
  confidence: number; // 0-1: graph density + trait purity + number of platforms backing it
  era: Era;
  topTraits: string[];
  medianWealth: number | null;
};

export type NetworkValue = {
  money: { total: number; median: number | null; knownShare: number; yourPercentile: number | null };
  reach: { known: number; audience: number };
  doors: { oneHop: { company: string; count: number }[]; twoHop: { company: string; count: number }[] };
  byTribe: Record<string, { moneyShare: number; reachShare: number; doors: string[] }>;
  byPerson: Record<string, { doors: string[] }>; // companies this person brings you closer to
  top: { money: string[]; reach: string[]; doors: string[] }; // biggest contributors (ids), lit when you click a facet
};

export type Analysis = {
  egoId: string;
  egoTribe: string | null;
  tribes: Tribe[];
  nodes: Node[];
  bubbles: Record<Dimension, Bubble>;
  circles: CircleStat[];
  ties: { mutual: number; aspiration: number; audience: number; mutualShare: number };
  class: {
    ego: { low: number; high: number; mid: number } | null;
    projected: { mid: number; basis: string } | null; // ghost cash stack
    networkMedian: number | null;
    workingMedian: number | null; // excluding students: "what your group earns"
    percentileInNetwork: number | null; // share of known network poorer than you, 0-1
    vsUsMedian: number | null; // working median / US median net worth
    unknownShare: number;
  };
  pastVsPresent: {
    past: EraStat;
    present: EraStat;
    bridges: number;
    leftBehind: string[]; // past circles, biggest first
  };
  secondDegree: { count: number; topCompanies: { value: string; count: number }[] };
  /** Everything Claude gets for the portrait. Aggregates only, no names. */
  portraitInput: Record<string, unknown>;
  value: NetworkValue;
};

type EraStat = { size: number; medianWealth: number | null; medianWealthWorking: number | null; diversity: number; topIndustries: string[]; circles: string[] };

// Reference values for "what your group represents" (hard-coded, sources in comments)
export const BASELINES = {
  usMedianNetWorth: 192_900, // Fed Survey of Consumer Finances 2022, median family net worth
  worldMedianWealthPerAdult: 8_654, // UBS Global Wealth Report 2023
};

const WEALTH_TIERS: [number, string][] = [
  [10_000, "💸 Broke"], [50_000, "🙂 Getting by"], [250_000, "💼 Comfortable"],
  [1_000_000, "💰 Well-off"], [5_000_000, "🏝️ Rich"], [Infinity, "👑 Ultra-rich"],
];

const INTERESTS: [RegExp, string][] = [
  [/⚽|soccer|futbol|football/i, "⚽ Soccer"], [/🎹|piano|pianist|music|conservatory/i, "🎹 Music"],
  [/✏️|illustrat|\bart\b|draw|design/i, "🎨 Art"], [/🤖|robot|\bfrc\b/i, "🤖 Robotics"],
  [/🛹|skate|sk8/i, "🛹 Skate"],
  [/📈|finance|\bvc\b|consult|startup|haas|econ|business/i, "💼 Business"],
  [/\bcs\b|eecs|swe|software|engineer|hack|shipping|build|indie|dev\b|agi|code/i, "💻 Tech"],
];
const PRESENT_INTERESTS = new Set(["💻 Tech", "💼 Business"]);
const TECH_COMPANIES = /stripe|google|meta|apple|nvidia|openai|tesla|figma|databricks|loopwise|microsoft|amazon/i;
const INDUSTRIES: [RegExp, string][] = [
  [/nurse|kaiser|health|hospital|medical/i, "Health"], [/pwc|account|bank|finance|capital/i, "Finance"],
  [/kitchen|restaurant|starbucks|barista|food/i, "Food"], [/target|safeway|retail|store|sales|clerk/i, "Retail"],
  [/teacher|school district|professor/i, "Education"], [/county|city of|government|public/i, "Public sector"],
  [/art|design|music|conservatory|illustrat/i, "Arts"],
  [/engineer|software|developer|founder|product|technical|swe|data|research/i, "Tech"],
  [/student|university|college|\buc\b|school/i, "Student"],
];

// ---------- raw helpers (shapes documented in seed/README.md) ----------

type Obj = { [k: string]: Json | undefined };
const obj = (v: Json | undefined): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: Json | undefined): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: Json | undefined): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const uniq = <T,>(xs: (T | null | undefined)[]) => [...new Set(xs.filter((x): x is T => x != null))];
const uniqBy = (key: (s: string) => string, xs: (string | null | undefined)[]) => {
  const seen = new Set<string>();
  return xs.filter((x): x is string => !!x && !seen.has(key(x)) && !!seen.add(key(x)));
};
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const pct = (x: number) => `${Math.round(x * 100)}%`;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type Features = {
  platforms: string[];
  schools: string[];
  companies: string[];
  city: string | null;
  country: string | null;
  hometown: string | null;
  bio: string;
  lastName: string | null;
  languages: string[];
  verified: boolean;
  bigAudience: boolean;
  audience: number;
};

function features(p: PersonIn): Features {
  const raw = obj(p.raw);
  const li = obj(raw.linkedin), ig = obj(raw.instagram), fb = obj(raw.facebook), x = obj(raw.x), gh = obj(raw.github);
  const places = arr(fb["Places Lived"]);
  const place = (type: string) => str(places.find((pl) => str(pl.type) === type)?.text);
  const loc = p.location ?? str(li.location) ?? str(gh.location) ?? str(x.location) ?? place("Current City");
  const parts = (loc ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const followers = Math.max(Number(obj(ig.edge_followed_by).count ?? 0) || Number(x.followersCount ?? 0),
    ...(p.social_profiles ?? []).map((s) => s.follower_count ?? 0));
  // total reach: social_profiles counts (live rows) when we have them, else the raw scraper shapes (seed)
  const listed = (p.social_profiles ?? []).reduce((a, s) => a + (s.follower_count ?? 0), 0);
  const audience = listed || Number(obj(ig.edge_followed_by).count ?? 0) + Number(x.followersCount ?? 0) + Number(gh.followers ?? 0);
  const words = p.name.trim().split(/\s+/);
  return {
    platforms: uniq([...Object.keys(raw).filter((k) => raw[k] && typeof raw[k] === "object"), ...(p.social_profiles ?? []).map((s) => s.platform)]),
    schools: uniqBy(norm, [...(p.education ?? []).map((e) => e.school), ...arr(li.educations).map((e) => str(e.institution_name)), ...arr(fb.Education).map((e) => str(e.text))]),
    companies: uniqBy(norm, [
      jobOf(p)?.company,
      ...(p.experiences ?? []).map((e) => e.company),
      ...arr(li.experiences).map((e) => str(e.institution_name)),
      str(gh.company)?.replace(/^@/, "") ?? null,
      ...arr(fb.Work).map((e) => str(e.text)),
    ]),
    city: parts[0] ?? null,
    country: parts.length > 1 ? parts[parts.length - 1] : null,
    hometown: place("Hometown")?.split(",")[0].trim() ?? null,
    bio: [p.headline, str(ig.biography), str(x.rawDescription), str(gh.bio)].filter(Boolean).join(" "),
    lastName: words.length > 1 ? words[words.length - 1] : null,
    languages: Array.isArray(gh.top_languages) ? gh.top_languages.filter((l): l is string => typeof l === "string") : [],
    verified: ig.is_verified === true || x.verified === true,
    bigAudience: followers > 50_000,
    audience,
  };
}

const industryOf = (p: PersonIn, f: Features): string => {
  const job = jobOf(p);
  const text = `${job?.title ?? ""} ${job?.company ?? ""} ${p.headline ?? ""}`;
  if (TECH_COMPANIES.test(text)) return "Tech";
  for (const [re, name] of INDUSTRIES) if (re.test(text)) return name;
  if (f.schools.length && !job) return "Student";
  return "Unknown";
};
const tierOf = (mid: number | null) => (mid == null ? "❓ Unknown" : WEALTH_TIERS.find(([max]) => mid < max)![1]);

// ---------- main ----------

export function analyze(input: { people: PersonIn[]; follows: FollowIn[]; netWorth: NetWorthIn[]; egoId: string }): Analysis {
  const { people, follows, netWorth, egoId } = input;
  const byId = new Map(people.map((p) => [p.id, p]));
  const ego = byId.get(egoId);
  if (!ego) throw new Error(`egoId ${egoId} not in people`);

  const out = new Map<string, Set<string>>(), inn = new Map<string, Set<string>>(), und = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, a: string, b: string) => (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
  for (const { follower_id: a, person_id: b } of follows) {
    add(out, a, b); add(inn, b, a); add(und, a, b); add(und, b, a);
  }
  const nb = (id: string) => und.get(id) ?? new Set<string>();

  // degree: 1 = linked to the user, 2 = linked only through a 1st-degree person
  const degree = new Map<string, 0 | 1 | 2>([[egoId, 0]]);
  for (const id of nb(egoId)) degree.set(id, 1);
  for (const id of [...degree.keys()]) if (degree.get(id) === 1) for (const j of nb(id)) if (!degree.has(j)) degree.set(j, 2);

  const feat = new Map(people.map((p) => [p.id, features(p)]));
  const egoF = feat.get(egoId)!;
  const wealthOf = new Map(netWorth.map((n) => [n.person_id, { low: n.low, high: n.high, mid: Math.round((n.low + n.high) / 2) }]));

  // ego timeline: current institutions = present, older ones + hometown = past
  const egoLi = obj(obj(ego.raw).linkedin);
  const current = (to: string | null) => !to || /present/i.test(to) || Number(to.match(/\d{4}/)?.[0] ?? 0) >= new Date().getFullYear();
  const presentPlaces = new Set(uniq([
    ...arr(egoLi.educations).filter((e) => current(str(e.to_date))).map((e) => str(e.institution_name)),
    ...arr(egoLi.experiences).filter((e) => current(str(e.to_date)) || arr(egoLi.experiences).indexOf(e) === 0).map((e) => str(e.institution_name)),
  ]).map(norm));
  const egoSchools = egoF.schools, egoCompanies = egoF.companies.filter((c) => !egoSchools.includes(c));
  const egoHome = egoF.hometown ? norm(egoF.hometown) : null;
  const shortName = (s: string) => s.replace(/ High School$/i, " HS");

  const tieOf = (id: string): Tie => {
    if (id === egoId) return "self";
    const iFollow = out.get(egoId)?.has(id), theyFollow = out.get(id)?.has(egoId);
    return iFollow && theyFollow ? "mutual" : iFollow ? "aspiration" : theyFollow ? "audience" : "indirect";
  };

  const circleOf = (p: PersonIn, f: Features, tie: Tie): { circle: string; era: Era } => {
    if (tie === "aspiration" && (f.verified || f.bigAudience)) return { circle: "⭐ Idols", era: "present" };
    const job = f.companies.find((c) => egoCompanies.some((e) => norm(e) === norm(c)));
    if (job) return { circle: `💼 Colleagues · ${job}`, era: presentPlaces.has(norm(job)) ? "present" : "past" };
    const hobby = INTERESTS.find(([re]) => re.test(f.bio));
    if (hobby && !PRESENT_INTERESTS.has(hobby[1])) return { circle: hobby[1], era: "past" };
    const school = f.schools.find((s) => egoSchools.some((e) => norm(e) === norm(s)))
      ?? egoSchools.find((e) => f.bio.toLowerCase().includes(e.split(" ")[0].toLowerCase()));
    if (school) return { circle: `🎓 ${shortName(school)}`, era: presentPlaces.has(norm(school)) ? "present" : "past" };
    const fromHome = !!egoHome && (norm(f.hometown ?? "") === egoHome || norm(f.city ?? "") === egoHome);
    if (egoF.lastName && f.lastName === egoF.lastName && fromHome) return { circle: "🏠 Family", era: "past" };
    if (hobby) return { circle: hobby[1], era: "present" };
    if (fromHome) return { circle: "📍 Hometown", era: "past" };
    return { circle: "❔ Unlabeled", era: "unknown" };
  };

  // ---------- nodes ----------
  const nodes: Node[] = people.filter((p) => degree.has(p.id)).map((p) => {
    const f = feat.get(p.id)!;
    const d = degree.get(p.id)!;
    const tie = tieOf(p.id);
    const { circle, era } = d === 1 ? circleOf(p, f, tie) : d === 0 ? { circle: "🙋 You", era: "present" as Era } : { circle: "🌫️ 2nd degree", era: "unknown" as Era };
    const w = wealthOf.get(p.id) ?? null;
    return {
      id: p.id, name: p.name, degree: d, tie, circle, era, tribe: d === 0 ? "🙋 You" : "🌫️ 2nd degree", tribes: [],
      platforms: f.platforms, city: f.city, country: f.country,
      school: f.schools[0] ?? null,
      company: f.companies.find((c) => !f.schools.includes(c)) ?? null,
      industry: industryOf(p, f),
      interests: uniq([...INTERESTS.filter(([re]) => re.test(f.bio)).map(([, n]) => n), ...f.languages.map((l) => `💻 ${l}`)]),
      wealth: w, wealthTier: tierOf(w?.mid ?? null), isBridge: false, audience: f.audience,
      isStudent: /student|intern|undergrad/i.test(`${jobOf(p)?.title ?? ""} ${p.headline ?? ""}`) || industryOf(p, f) === "Student",
    };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const first = nodes.filter((n) => n.degree === 1);

  // bridges: 1st-degree people linked to both your past and your present
  for (const n of first) {
    const eras = new Set([...nb(n.id)].map((j) => nodeById.get(j)).filter((m) => m?.degree === 1).map((m) => m!.era));
    n.isBridge = (eras.has("past") || n.era === "past") && (eras.has("present") || n.era === "present") && eras.size > 0;
  }

  // ---------- tribes ----------
  const { tribes, egoTribe } = detectTribes(first, feat, und, egoF);

  // ---------- bubbles ----------
  const valuesOf = (n: Node, dim: Dimension): string[] => {
    switch (dim) {
      case "platform": return n.platforms;
      case "interest": return n.interests;
      case "wealthTier": return n.wealth ? [n.wealthTier] : [];
      case "industry": return n.industry === "Unknown" ? [] : [n.industry];
      default: { const v = n[dim]; return v && !String(v).startsWith("❔") ? [String(v)] : []; }
    }
  };
  const bubble = (dim: Dimension, pool: Node[]): Bubble => {
    const counts = new Map<string, number>();
    let known = 0;
    for (const n of pool) {
      const vs = valuesOf(n, dim);
      if (vs.length) known++;
      for (const v of vs) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
    const groups = [...counts].map(([value, count]) => ({ value, count, share: count / known || 0 })).sort((a, b) => b.count - a.count);
    const diversity = Math.round(100 * (1 - [...counts.values()].reduce((s, c) => s + (c / total) ** 2, 0)));
    const topShare = groups[0]?.share ?? 0, top2Share = (groups[0]?.share ?? 0) + (groups[1]?.share ?? 0);
    return { dimension: dim, groups, topShare, top2Share, diversity, unknownShare: pool.length ? 1 - known / pool.length : 0, fact: factFor(dim, groups, top2Share, pool.length ? 1 - known / pool.length : 0) };
  };
  const DIMS: Dimension[] = ["tribe", "city", "country", "school", "company", "industry", "platform", "wealthTier", "circle", "interest"];
  const bubbles = Object.fromEntries(DIMS.map((d) => [d, bubble(d, first)])) as Record<Dimension, Bubble>;

  // ---------- circles ----------
  const circleNames = uniq(first.map((n) => n.circle));
  const circles: CircleStat[] = circleNames.map((name) => {
    const members = first.filter((n) => n.circle === name);
    const traits = (["school", "company", "city", "industry"] as Dimension[])
      .map((d) => bubble(d, members).groups[0]).filter(Boolean).map((g) => `${g!.value} (${pct(g!.share)})`);
    return {
      name, era: members[0].era, size: members.length,
      mutualShare: members.filter((m) => m.tie === "mutual").length / members.length,
      medianWealth: median(members.flatMap((m) => (m.wealth ? [m.wealth.mid] : []))),
      topTraits: traits,
    };
  }).sort((a, b) => b.size - a.size);

  // ---------- ties ----------
  const count = (t: Tie) => first.filter((n) => n.tie === t).length;
  const ties = { mutual: count("mutual"), aspiration: count("aspiration"), audience: count("audience"), mutualShare: count("mutual") / (first.length || 1) };

  // ---------- class ----------
  const egoW = wealthOf.get(egoId) ?? null;
  const known = first.flatMap((n) => (n.wealth ? [n.wealth.mid] : []));
  const netMedian = median(known);
  const workingMedian = median(first.flatMap((n) => (n.wealth && !n.isStudent ? [n.wealth.mid] : [])));
  // ghost stack: what the people one step ahead of you in your present circles have (non-students)
  const ahead = first.filter((n) => n.era === "present" && n.wealth && !n.isStudent && n.wealth.mid > (egoW?.mid ?? 0)).map((n) => n.wealth!.mid);
  const projMid = median(ahead);
  const klass = {
    ego: egoW,
    projected: projMid != null ? { mid: projMid, basis: `median net worth of ${ahead.length} people ahead of you in your current circles` } : null,
    networkMedian: netMedian,
    workingMedian,
    // mid-rank: ties count half
    percentileInNetwork: egoW && known.length
      ? (known.filter((m) => m < egoW.mid).length + known.filter((m) => m === egoW.mid).length / 2) / known.length : null,
    vsUsMedian: workingMedian != null ? workingMedian / BASELINES.usMedianNetWorth : null,
    unknownShare: first.length ? 1 - known.length / first.length : 0,
  };

  // ---------- past vs present ----------
  const eraStat = (era: Era): EraStat => {
    const members = first.filter((n) => n.era === era);
    return {
      size: members.length,
      medianWealth: median(members.flatMap((m) => (m.wealth ? [m.wealth.mid] : []))),
      medianWealthWorking: median(members.flatMap((m) => (m.wealth && !m.isStudent ? [m.wealth.mid] : []))),
      diversity: Math.round((bubble("industry", members).diversity + bubble("city", members).diversity + bubble("interest", members).diversity) / 3),
      topIndustries: bubble("industry", members).groups.slice(0, 3).map((g) => g.value),
      circles: circles.filter((c) => c.era === era).map((c) => c.name),
    };
  };
  const past = eraStat("past"), present = eraStat("present");

  const second = nodes.filter((n) => n.degree === 2);
  const secondCompanies = bubble("company", second).groups.slice(0, 5).map(({ value, count }) => ({ value, count }));

  const analysis: Analysis = {
    egoId, egoTribe, tribes, nodes, bubbles, circles, ties, class: klass,
    pastVsPresent: { past, present, bridges: first.filter((n) => n.isBridge).length, leftBehind: past.circles },
    secondDegree: { count: second.length, topCompanies: secondCompanies },
    portraitInput: {},
    value: {} as NetworkValue,
  };
  analysis.value = networkValue(first, second, und, egoW, nodeById);
  analysis.portraitInput = portraitInput(analysis, ego);
  return analysis;
}

// ---------- facts (truth lines per filter; Claude writes the roast on top) ----------

function factFor(dim: Dimension, groups: { value: string; share: number }[], top2: number, unknown: number): string {
  const g = groups[0];
  if (!g) return "Not enough data here. Your network is a mystery.";
  switch (dim) {
    case "school": return `${pct(top2)} of your network went to ${groups.slice(0, 2).map((x) => x.value).join(" or ")}.`;
    case "city": return `${pct(g.share)} of your network lives in ${g.value}.`;
    case "country": return groups.length === 1 ? `Your whole network is in ${g.value}.` : `${pct(g.share)} of your network is in ${g.value}.`;
    case "industry": return g.value === "Student"
      ? `${pct(g.share)} of the people you know are students. ${groups[1] ? `Next: ${groups[1].value} (${pct(groups[1].share)}).` : ""}`.trim()
      : `${pct(g.share)} of the people you know work in ${g.value}.`;
    case "company": return `${g.value} is the biggest employer in your life (${pct(g.share)}).`;
    case "platform": return `${pct(g.share)} of your people are on ${g.value}.`;
    case "wealthTier": return `Most of your network is "${g.value}". ${pct(unknown)} are invisible to the algorithm.`;
    case "circle": return `Your biggest circle is ${g.value} (${pct(g.share)}).`;
    case "tribe": return `${groups.length} tribes. The biggest: ${g.value} (${pct(g.share)}).${groups[1] ? ` Then ${groups[1].value} (${pct(groups[1].share)}).` : ""}`;
    case "interest": return `Your crowd's #1 thing: ${g.value} (${pct(g.share)}).`;
  }
}

// ---------- portrait input: aggregates only, never names ----------

function portraitInput(a: Analysis, ego: PersonIn): Record<string, unknown> {
  const top = (d: Dimension, n = 3) => a.bubbles[d].groups.slice(0, n).map((g) => `${g.value} ${pct(g.share)}`);
  return {
    you: { headline: ego.headline, role: jobOf(ego)?.title ?? null, company: jobOf(ego)?.company ?? null, location: ego.location },
    networkSize: a.nodes.filter((n) => n.degree === 1).length,
    bubble: {
      school: { top: top("school"), diversity: a.bubbles.school.diversity },
      city: { top: top("city"), diversity: a.bubbles.city.diversity },
      industry: { top: top("industry"), diversity: a.bubbles.industry.diversity },
      wealth: { top: top("wealthTier"), unknownShare: pct(a.bubbles.wealthTier.unknownShare) },
      interests: top("interest", 5),
      platforms: top("platform", 5),
    },
    ties: { mutualShare: pct(a.ties.mutualShare), followWithoutFollowBack: a.ties.aspiration, audience: a.ties.audience },
    class: {
      you: a.class.ego?.mid ?? null, projected: a.class.projected?.mid ?? null, networkMedian: a.class.networkMedian,
      workingMedian: a.class.workingMedian,
      percentileInNetwork: a.class.percentileInNetwork, networkVsUsMedian: a.class.vsUsMedian,
    },
    circles: a.circles.map((c) => ({ name: c.name, era: c.era, size: c.size, traits: c.topTraits })),
    tribes: a.tribes.map((t) => ({ name: t.name, era: t.era, size: t.size, confidence: t.confidence, traits: t.topTraits })),
    yourTribe: a.egoTribe,
    pastVsPresent: {
      past: { size: a.pastVsPresent.past.size, diversity: a.pastVsPresent.past.diversity, medianWealthWorking: a.pastVsPresent.past.medianWealthWorking, industries: a.pastVsPresent.past.topIndustries },
      present: { size: a.pastVsPresent.present.size, diversity: a.pastVsPresent.present.diversity, medianWealthWorking: a.pastVsPresent.present.medianWealthWorking, industries: a.pastVsPresent.present.topIndustries },
      bridges: a.pastVsPresent.bridges,
    },
  };
}

// ---------- tribes: graph communities, named by their traits ----------

const TRIBE_NAMES: Record<string, string> = {
  "🛹 Skate": "🛹 Skaters", "💻 Tech": "💻 Hackers", "💼 Business": "💼 Business", "⚽ Soccer": "⚽ Soccer",
  "🎹 Music": "🎹 Music", "🎨 Art": "🎨 Art", "🤖 Robotics": "🤖 Robotics",
};

function tokensOf(city: string | null, f: Features): [string, number][] {
  const t: [string, number][] = [];
  for (const s of f.schools) t.push([`school:${s}`, 1]);
  for (const c of f.companies) if (!f.schools.includes(c)) t.push([`company:${c}`, 1]);
  for (const [re, name] of INTERESTS) if (re.test(f.bio)) t.push([`kw:${name}`, 1.3]);
  if (f.hometown) t.push([`home:${f.hometown}`, 0.5]);
  if (f.lastName) t.push([`last:${f.lastName}`, 0.4]);
  if (city) t.push([`city:${city}`, 0.2]);
  return t;
}

function tokenLabel(tok: string): string {
  const kind = tok.slice(0, tok.indexOf(":")), value = tok.slice(tok.indexOf(":") + 1);
  if (kind === "school") return value === "UC Berkeley" ? "🐻 Cal" : `🎓 ${value.replace(/ High School$/i, " HS")}`;
  if (kind === "company") return `💼 ${value} crew`;
  if (kind === "kw") return TRIBE_NAMES[value] ?? value;
  if (kind === "last") return "🏠 Family";
  if (kind === "home") return `🏡 From ${value}`;
  return `📍 ${value} crew`;
}

function hashStr(s: string) {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function detectTribes(first: Node[], feat: Map<string, Features>, und: Map<string, Set<string>>, egoF: Features) {
  const N = first.length;
  const idx = new Map(first.map((n, i) => [n.id, i]));
  const toks = first.map((n) => tokensOf(n.city, feat.get(n.id)!));
  const df = new Map<string, number>();
  toks.forEach((ts) => new Set(ts.map(([t]) => t)).forEach((t) => df.set(t, (df.get(t) ?? 0) + 1)));

  // weights = social links + shared traits (a rarer trait is a stronger signal)
  const W = new Map<number, Map<number, number>>();
  const bump = (a: number, b: number, w: number) => {
    const m = W.get(a) ?? W.set(a, new Map()).get(a)!;
    m.set(b, (m.get(b) ?? 0) + w);
  };
  const addW = (a: number, b: number, w: number) => {
    if (a === b) return;
    bump(a, b, w);
    bump(b, a, w);
  };
  first.forEach((n, i) => (und.get(n.id) ?? new Set<string>()).forEach((j) => {
    const k = idx.get(j);
    if (k != null && k > i) addW(i, k, 1.5);
  }));
  const byTok = new Map<string, [number, number][]>();
  toks.forEach((ts, i) => ts.forEach(([t, w]) => (byTok.get(t) ?? byTok.set(t, []).get(t)!).push([i, w])));
  for (const [t, members] of byTok) {
    const d = df.get(t)!;
    if (d < 2 || d / N > 0.45) continue;
    const idf = Math.log(N / d);
    for (let a = 0; a < members.length; a++)
      for (let b = a + 1; b < members.length; b++) addW(members[a][0], members[b][0], idf * Math.min(members[a][1], members[b][1]));
  }

  // keep each person's 8 strongest neighbors, so big groups don't swallow small ones
  const knn = first.map((_, i) => [...(W.get(i) ?? new Map<number, number>())].sort((a, b) => b[1] - a[1]).slice(0, 8));
  const idol = first.map((n) => n.circle === "⭐ Idols");

  // label propagation, deterministic order
  const label = first.map((_, i) => i);
  const order = first.map((_, i) => i).sort((a, b) => hashStr(first[a].id) - hashStr(first[b].id));
  for (let it = 0; it < 30; it++) {
    let changed = 0;
    for (const i of order) {
      if (idol[i]) continue;
      const score = new Map<number, number>();
      for (const [j, w] of knn[i]) if (!idol[j]) score.set(label[j], (score.get(label[j]) ?? 0) + w);
      let best = label[i], bestS = score.get(label[i]) ?? 0;
      for (const [l, sc] of score) if (sc > bestS || (sc === bestS && l < best)) { best = l; bestS = sc; }
      if (best !== label[i]) { label[i] = best; changed++; }
    }
    if (!changed) break;
  }

  // merge tiny groups into their strongest neighbor group
  const sizeOf = () => label.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<number, number>());
  const sizes = sizeOf();
  first.forEach((_, i) => {
    if (idol[i] || sizes.get(label[i])! >= 3) return;
    const score = new Map<number, number>();
    for (const [j, w] of W.get(i) ?? []) if (!idol[j] && sizes.get(label[j])! >= 3) score.set(label[j], (score.get(label[j]) ?? 0) + w);
    const best = [...score].sort((a, b) => b[1] - a[1])[0];
    if (best) label[i] = best[0];
  });
  // still-tiny groups (people we know nothing about, e.g. followers from a list) become ONE loners group
  const after = sizeOf();
  first.forEach((_, i) => { if (!idol[i] && after.get(label[i])! < 3) label[i] = -1; });

  // name each group by its most characteristic trait (lift), then score confidence
  const groups = new Map<number, number[]>();
  first.forEach((_, i) => { if (!idol[i]) (groups.get(label[i]) ?? groups.set(label[i], []).get(label[i])!).push(i); });
  const used = new Set<string>(["⭐ Idols"]);
  const tribes: Tribe[] = [];
  const nameOf = new Map<number, string>();
  for (const [l, members] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const cnt = new Map<string, number>();
    members.forEach((i) => new Set(toks[i].map(([t]) => t)).forEach((t) => cnt.set(t, (cnt.get(t) ?? 0) + 1)));
    const lift = [...cnt].map(([t, c]) => {
      const share = c / members.length, base = df.get(t)! / N;
      const bonus = (t.startsWith("kw:") ? 0.15 : 0) - (t.startsWith("city:") ? 0.2 : 0);
      return { t, share, score: share * Math.log(share / base + 1e-9) + bonus };
    }).filter((x) => x.share >= 0.35 && !(x.t.startsWith("last:") && x.share < 0.5))
      .sort((a, b) => Number(b.share >= 0.5) - Number(a.share >= 0.5) || b.score - a.score);
    let name = l === -1 ? "❔ Loners" : lift[0] ? tokenLabel(lift[0].t) : "❔ Mystery crew";
    if (used.has(name) && lift[1]) name = `${name} · ${tokenLabel(lift[1].t).replace(/^\S+ /, "")}`;
    while (used.has(name)) name += "'";
    used.add(name);
    nameOf.set(l, name);

    const set = new Set(members);
    let internal = 0;
    members.forEach((i) => (und.get(first[i].id) ?? new Set<string>()).forEach((j) => {
      const k = idx.get(j);
      if (k != null && set.has(k)) internal++;
    }));
    const density = members.length > 1 ? internal / (members.length * (members.length - 1)) : 0;
    const platforms = new Set(members.flatMap((i) => first[i].platforms));
    const eras = members.map((i) => first[i].era);
    const past = eras.filter((e) => e === "past").length, present = eras.filter((e) => e === "present").length;
    tribes.push({
      name, size: members.length,
      era: past > present ? "past" : present > 0 ? "present" : "unknown",
      confidence: Math.round(((Math.min(1, density * 3) + (lift[0]?.share ?? 0) + Math.min(1, platforms.size / 3)) / 3) * 100) / 100,
      topTraits: lift.slice(0, 3).map((x) => `${tokenLabel(x.t)} ${Math.round(x.share * 100)}%`),
      medianWealth: median(members.flatMap((i) => (first[i].wealth ? [first[i].wealth!.mid] : []))),
    });
  }
  const idolCount = idol.filter(Boolean).length;
  if (idolCount) tribes.push({ name: "⭐ Idols", size: idolCount, era: "present", confidence: 1, topTraits: ["you follow them, no follow back"], medianWealth: null });

  first.forEach((n, i) => { n.tribe = idol[i] ? "⭐ Idols" : nameOf.get(label[i]) ?? "❔ Loners"; });
  // secondary tribes: >= 25% of your ties and traits point there
  first.forEach((n, i) => {
    const by = new Map<string, number>();
    let total = 0;
    for (const [j, w] of W.get(i) ?? []) { by.set(first[j].tribe, (by.get(first[j].tribe) ?? 0) + w); total += w; }
    n.tribes = [...by].filter(([t, w]) => t !== n.tribe && total > 0 && w / total >= 0.25).map(([t]) => t);
  });

  // your own tribe: the one that shares the most of your traits
  const egoToks = new Set(tokensOf(null, egoF).map(([t]) => t));
  let egoTribe: string | null = null, bestScore = 0;
  for (const t of tribes) {
    if (t.name === "⭐ Idols") continue;
    const members = first.filter((n) => n.tribe === t.name);
    const share = members.filter((m) => tokensOf(null, feat.get(m.id)!).some(([k]) => egoToks.has(k))).length / members.length;
    const score = share * Math.sqrt(members.length);
    if (score > bestScore) { bestScore = score; egoTribe = t.name; }
  }
  tribes.sort((a, b) => b.size - a.size);
  return { tribes, egoTribe };
}

// ---------- the value of your network: money, reach, doors ----------

const NOTABLE = /google|meta|apple|nvidia|openai|stripe|figma|databricks|tesla|microsoft|amazon|goldman|mckinsey|loopwise/i;
const isSchool = (c: string) => /university|college|school|\buc\b|stanford|berkeley|conservatory|academy/i.test(c);

function networkValue(first: Node[], second: Node[], und: Map<string, Set<string>>, egoW: { mid: number } | null,
  byId: Map<string, Node>): NetworkValue {
  const mids = first.flatMap((n) => (n.wealth ? [n.wealth.mid] : []));
  const total = mids.reduce((a, b) => a + b, 0);
  // reach only counts people who would relay you: not the idols you follow who don't follow back
  const relays = (n: Node) => (n.tie === "aspiration" ? 0 : n.audience);
  const audience = first.reduce((a, n) => a + relays(n), 0);
  const job = (n: Node) => (n.company && !isSchool(n.company) ? n.company : null);

  // doors: companies 1 contact away (your circle) and 2 contacts away (N+1), notable ones first
  const count = (list: Node[]) => {
    const m = new Map<string, number>();
    for (const n of list) { const c = job(n); if (c) m.set(c, (m.get(c) ?? 0) + 1); }
    return [...m].map(([company, c]) => ({ company, count: c }))
      .sort((a, b) => Number(NOTABLE.test(b.company)) - Number(NOTABLE.test(a.company)) || b.count - a.count);
  };
  const oneHop = count(first);
  const near = new Set(oneHop.map((d) => d.company));
  const twoHop = count(second).filter((d) => !near.has(d.company));

  // what each person brings: their job + the jobs of the friends of friends they connect you to
  const byPerson: NetworkValue["byPerson"] = {};
  for (const n of first) {
    const doors = new Set<string>();
    const own = job(n);
    if (own) doors.add(own);
    for (const j of und.get(n.id) ?? []) { const m = byId.get(j); const c = m && m.degree === 2 ? job(m) : null; if (c) doors.add(c); }
    byPerson[n.id] = { doors: [...doors].sort((a, b) => Number(NOTABLE.test(b)) - Number(NOTABLE.test(a))) };
  }

  const byTribe: NetworkValue["byTribe"] = {};
  for (const n of first) {
    const t = (byTribe[n.tribe] ??= { moneyShare: 0, reachShare: 0, doors: [] });
    t.moneyShare += total ? (n.wealth?.mid ?? 0) / total : 0;
    t.reachShare += audience ? relays(n) / audience : 0;
    for (const d of byPerson[n.id].doors) if (!t.doors.includes(d)) t.doors.push(d);
  }
  for (const t of Object.values(byTribe)) t.doors.sort((a, b) => Number(NOTABLE.test(b)) - Number(NOTABLE.test(a)));

  const topBy = (score: (n: Node) => number) => [...first].filter((n) => score(n) > 0).sort((a, b) => score(b) - score(a)).slice(0, 15).map((n) => n.id);
  return {
    money: {
      total, median: median(mids), knownShare: first.length ? mids.length / first.length : 0,
      // mid-rank: people exactly as rich as you count half
      yourPercentile: egoW && mids.length ? (mids.filter((m) => m < egoW.mid).length + mids.filter((m) => m === egoW.mid).length / 2) / mids.length : null,
    },
    reach: { known: first.length + second.filter((n) => job(n)).length, audience },
    doors: { oneHop, twoHop },
    byTribe, byPerson,
    top: {
      money: topBy((n) => n.wealth?.mid ?? 0),
      reach: topBy(relays),
      doors: topBy((n) => byPerson[n.id].doors.filter((d) => NOTABLE.test(d)).length * 10 + byPerson[n.id].doors.length),
    },
  };
}
