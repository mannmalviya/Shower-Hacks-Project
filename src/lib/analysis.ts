// Social mirror analysis. Pure function: people + follows + net_worth -> stats for the viz.
// No DB, no network. Works on Supabase rows (src/lib/db.ts) and on seed/alex.json.
// Conventions (degree, circles, platforms are derived, not stored): see seed/README.md.
import type { Json } from "./supabase/database.types";

// ---------- inputs (subset of the Supabase rows) ----------

export type PersonIn = {
  id: string;
  name: string;
  headline: string | null;
  company: string | null;
  role: string | null;
  location: string | null;
  raw: Json;
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
};

export type Dimension = "city" | "country" | "school" | "company" | "industry" | "platform" | "wealthTier" | "circle" | "interest";

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

export type Analysis = {
  egoId: string;
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
  [/\bcs\b|eecs|swe|software|engineer|hack|shipping|build|indie|dev\b|agi|code/i, "💻 Tech"],
];
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
};

function features(p: PersonIn): Features {
  const raw = obj(p.raw);
  const li = obj(raw.linkedin), ig = obj(raw.instagram), fb = obj(raw.facebook), x = obj(raw.x), gh = obj(raw.github);
  const places = arr(fb["Places Lived"]);
  const place = (type: string) => str(places.find((pl) => str(pl.type) === type)?.text);
  const loc = p.location ?? str(li.location) ?? str(gh.location) ?? str(x.location) ?? place("Current City");
  const parts = (loc ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const followers = Number(obj(ig.edge_followed_by).count ?? 0) || Number(x.followersCount ?? 0);
  const words = p.name.trim().split(/\s+/);
  return {
    platforms: Object.keys(raw).filter((k) => raw[k] && typeof raw[k] === "object"),
    schools: uniq([...arr(li.educations).map((e) => str(e.institution_name)), ...arr(fb.Education).map((e) => str(e.text))]),
    companies: uniq([
      p.company,
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
  };
}

const industryOf = (p: PersonIn, f: Features): string => {
  const text = `${p.role ?? ""} ${p.company ?? ""} ${p.headline ?? ""}`;
  if (TECH_COMPANIES.test(text)) return "Tech";
  for (const [re, name] of INDUSTRIES) if (re.test(text)) return name;
  if (f.schools.length && !p.company) return "Student";
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
    if (hobby && hobby[1] !== "💻 Tech") return { circle: hobby[1], era: "past" };
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
      id: p.id, name: p.name, degree: d, tie, circle, era,
      platforms: f.platforms, city: f.city, country: f.country,
      school: f.schools[0] ?? null,
      company: [p.company, ...f.companies].find((c) => c && !f.schools.includes(c)) ?? null,
      industry: industryOf(p, f),
      interests: uniq([...INTERESTS.filter(([re]) => re.test(f.bio)).map(([, n]) => n), ...f.languages.map((l) => `💻 ${l}`)]),
      wealth: w, wealthTier: tierOf(w?.mid ?? null), isBridge: false,
      isStudent: /student|intern|undergrad/i.test(`${p.role ?? ""} ${p.headline ?? ""}`) || industryOf(p, f) === "Student",
    };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const first = nodes.filter((n) => n.degree === 1);

  // bridges: 1st-degree people linked to both your past and your present
  for (const n of first) {
    const eras = new Set([...nb(n.id)].map((j) => nodeById.get(j)).filter((m) => m?.degree === 1).map((m) => m!.era));
    n.isBridge = (eras.has("past") || n.era === "past") && (eras.has("present") || n.era === "present") && eras.size > 0;
  }

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
  const DIMS: Dimension[] = ["city", "country", "school", "company", "industry", "platform", "wealthTier", "circle", "interest"];
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
    egoId, nodes, bubbles, circles, ties, class: klass,
    pastVsPresent: { past, present, bridges: first.filter((n) => n.isBridge).length, leftBehind: past.circles },
    secondDegree: { count: second.length, topCompanies: secondCompanies },
    portraitInput: {},
  };
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
    case "interest": return `Your crowd's #1 thing: ${g.value} (${pct(g.share)}).`;
  }
}

// ---------- portrait input: aggregates only, never names ----------

function portraitInput(a: Analysis, ego: PersonIn): Record<string, unknown> {
  const top = (d: Dimension, n = 3) => a.bubbles[d].groups.slice(0, n).map((g) => `${g.value} ${pct(g.share)}`);
  return {
    you: { headline: ego.headline, role: ego.role, company: ego.company, location: ego.location },
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
    pastVsPresent: {
      past: { size: a.pastVsPresent.past.size, diversity: a.pastVsPresent.past.diversity, medianWealthWorking: a.pastVsPresent.past.medianWealthWorking, industries: a.pastVsPresent.past.topIndustries },
      present: { size: a.pastVsPresent.present.size, diversity: a.pastVsPresent.present.diversity, medianWealthWorking: a.pastVsPresent.present.medianWealthWorking, industries: a.pastVsPresent.present.topIndustries },
      bridges: a.pastVsPresent.bridges,
    },
  };
}
