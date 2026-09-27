// Rules baseline: career timeline -> yearly income -> taxes -> savings -> investment growth.
// Three scenarios (low / mid / high). The saved range is low..high; mid goes to the LLM as context.
// No network, no LLM. Constants and sources: assumptions.ts.
import {
  DEBT_INTEREST,
  FOUNDER,
  HOUSING,
  PRIVATE_EQUITY,
  SAVINGS,
  STUDENT,
  STUDENT_DEBT,
  scfForAge,
  yearReturn,
  type Scenario,
} from "./assumptions";
import { levelFromYears, type ClassifiedPosition, type Timeline } from "./classify";
import { quoteComp } from "./comp";
import { fromMonths, toMonths } from "./dates";
import { resolvePlace, type Place } from "./place";
import type { CareerProfile, Level } from "./types";

const SCENARIOS: Scenario[] = ["low", "mid", "high"];
type Triple = Record<Scenario, number>;

export type Stream = {
  label: string;
  from: number; // month index
  to: number; // month index (exclusive)
  monthly: Triple; // gross pay per month by scenario
  kind: ClassifiedPosition["kind"] | "assumed";
  basis: string;
  /** The job this stream prices (none for assumed years). */
  pos?: ClassifiedPosition;
};

export type Baseline = Triple & {
  notes: string[]; // short reasons, most important first
  streams: Stream[];
  current: { title: string | null; company: string; tc: number; basis: string } | null;
  place: Place;
  confidence: "low" | "medium" | "high";
};

/** Round to 2 significant digits. */
export function round2(n: number): number {
  if (n <= 0) return 0;
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(n)) - 1));
  return Math.round(n / mag) * mag;
}

export const usd = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;

// Pay spread around the median for each scenario, by how we priced the job.
// Kept narrow: the savings / returns scenarios already carry most of the spread.
const SPREAD: Record<"table" | "tier" | "occupation", Triple> = {
  table: { low: 0.95, mid: 1, high: 1.05 },
  tier: { low: 0.85, mid: 1, high: 1.15 },
  occupation: { low: 0.9, mid: 1, high: 1.15 },
};

export type SimOptions = {
  /** Web evidence for the current job's median total comp (beats the table). */
  currentTC?: { tc: number; basis: string } | null;
};

export function simulate(profile: CareerProfile, tl: Timeline, opts: SimOptions = {}): Baseline | null {
  const nowM = toMonths(tl.asOf);
  const place = resolvePlace(profile.location, profile.country);
  const notes: string[] = [];
  const streams: Stream[] = [];
  let current: Baseline["current"] = null;
  let undated = false;

  // ---------- income streams ----------
  for (const p of tl.positions) {
    if (p.kind === "student_org" || p.kind === "volunteer") continue;
    let from = p.from;
    let to = p.to;
    if (from == null) {
      if (!p.current) continue; // undated past jobs: unknown length, skip
      const years = tl.age != null ? Math.min(Math.max(tl.age - 23, 1), 6) : 2;
      from = nowM - Math.round(years * 12);
      to = nowM + 1;
      undated = true;
      if (p.kind === "fulltime") notes.push(`${p.company} start date unknown, assumed ~${years} yrs`);
    }
    if (to == null || to <= from) to = from + 1;
    if (from > nowM) continue; // starts in the future
    to = Math.min(to, nowM + 1);

    if (p.kind === "parttime") {
      const m = STUDENT.parttimeMonthly;
      streams.push({ label: `${p.title ?? "?"} @ ${p.company}`, from, to, monthly: { low: m * 0.7, mid: m, high: m * 1.4 }, kind: p.kind, basis: "part-time job", pos: p });
      continue;
    }

    // Jobs whose title gives no level are split into yearly chunks, so pay rises with experience.
    const chunks: [number, number, Level][] = [];
    if (!p.levelFromTitle && (p.kind === "fulltime" || p.kind === "founder") && to - from > 12) {
      for (let a = from; a < to; a += 12) {
        const b = Math.min(a + 12, to);
        chunks.push([a, b, levelFromYears(p.yoeAtStart + ((a + b) / 2 - from) / 12)]);
      }
    } else {
      chunks.push([from, to, p.level]);
    }

    const isCurrent = p === tl.current;
    const quote = (level: Level, yearsAgo: number) =>
      quoteComp({ companyKey: p.companyKey, tier: p.tier, family: p.family, level, title: p.title, place, yearsAgo });
    // Web evidence for the current job: carry its premium over the table across the whole job.
    let ratio = 1;
    if (isCurrent && opts.currentTC) {
      ratio = Math.min(2, Math.max(0.5, opts.currentTC.tc / quote(chunks[chunks.length - 1][2], 0).tc));
    }
    for (const [a, b, level] of chunks) {
      const q = quote(level, (nowM - (a + b) / 2) / 12);
      const tc = q.tc * ratio;
      const basis = ratio !== 1 && opts.currentTC ? opts.currentTC.basis : q.basis;
      const spread = { ...SPREAD[ratio !== 1 ? "table" : q.source] };
      if (q.source === "occupation" && q.p90) spread.high = Math.min(1.3, Math.max(1.1, 1 + (q.p90 / q.tc - 1) / 3));
      const eq = p.tier === "ai_lab" || p.tier === "top_private" ? PRIVATE_EQUITY : { low: 1, mid: 1, high: 1 };
      // Founders pay themselves little; student founders nothing.
      const fs = p.kind !== "founder" ? { low: 1, mid: 1, high: 1 } : tl.student ? { low: 0, mid: 0, high: 0 } : FOUNDER.salaryShare;
      const monthly: Triple = {
        low: (tc * spread.low * eq.low * fs.low) / 12,
        mid: (tc * spread.mid * eq.mid * fs.mid) / 12,
        high: (tc * spread.high * eq.high * fs.high) / 12,
      };
      streams.push({ label: `${p.title ?? "?"} @ ${p.company}${chunks.length > 1 ? ` (${level})` : ""}`, from: a, to: b, monthly, kind: p.kind, basis, pos: p });
      if (isCurrent && b === to) current = { title: p.title, company: p.company, tc, basis };
    }
  }

  // A lone undated job with no title and no idea of age (e.g. a parent's Facebook "Work") says too little.
  if (streams.length === 1 && undated && tl.age == null && !tl.current?.title) streams.length = 0;

  // Scrapes often list only recent jobs. If the first full-time job starts well after school, fill the gap.
  // Priced by year from the first job's company tier and role family, with pay rising with experience up to
  // senior: that job's own title (director, VP...) says nothing about the years before it.
  const firstFT = streams.filter((s) => s.kind === "fulltime" || s.kind === "founder").sort((a, b) => a.from - b.from)[0];
  if (firstFT?.pos && tl.age != null && tl.age >= 28) {
    const careerStart = nowM - Math.round((tl.age - 22) * 12);
    const start = Math.max(careerStart, tl.gradYM ? toMonths(tl.gradYM) : careerStart);
    const gapYears = (firstFT.from - start) / 12;
    if (gapYears >= 2) {
      const { tier, family } = firstFT.pos;
      const sp = SPREAD.tier;
      for (let a = start; a < firstFT.from; a += 12) {
        const b = Math.min(a + 12, firstFT.from);
        const byYears = levelFromYears(((a + b) / 2 - start) / 12);
        const level: Level = byYears === "staff" ? "senior" : byYears;
        const q = quoteComp({ companyKey: null, tier, family, level, title: null, place, yearsAgo: (nowM - (a + b) / 2) / 12 });
        streams.push({
          label: `earlier career (assumed, ${level})`,
          from: a,
          to: b,
          monthly: { low: (q.tc * sp.low) / 12, mid: (q.tc * sp.mid) / 12, high: (q.tc * sp.high) / 12 },
          kind: "assumed",
          basis: `${q.basis}, ~${Math.round(gapYears)} yrs before the first listed job`,
        });
      }
      notes.push(`~${Math.round(gapYears)} earlier working years assumed`);
    }
  }

  // ---------- nothing to go on ----------
  if (!streams.length) {
    if (tl.highSchool) return fixed(STUDENT.highSchool, ["high school student"], "medium");
    if (tl.student) return fixed(STUDENT.base, ["student, no paid work listed"], "medium");
    if (tl.age != null && tl.age >= 25) {
      const s = scfForAge(tl.age);
      return fixed({ low: s.p25, mid: s.median, high: s.p75 }, [`no work history; typical US household at age ~${tl.age}`], "low");
    }
    return null; // unknown: no row, grey sim
  }

  // ---------- year by year, per scenario ----------
  const startM = Math.min(...streams.map((s) => s.from));
  const gradM = tl.gradYM ? toMonths(tl.gradYM) : null;
  const degree = debtKind(profile);
  const housingPrice = place.hcol ? HOUSING.price.hcol : HOUSING.price.us * place.priceLevel;
  let boughtHome = false;
  const out = {} as Triple;

  for (const s of SCENARIOS) {
    let bal = 0;
    let debtAdded = false;
    let bought: number | null = null;
    for (let y = fromMonths(startM).y; y <= tl.asOf.y; y++) {
      const yStart = y * 12;
      const yEnd = Math.min(yStart + 12, nowM + 1);
      if (yEnd <= yStart) break;
      const frac = (yEnd - yStart) / 12;

      // Income: best full-time job each month; internships / part-time only when there is none.
      let gross = 0;
      let internGross = 0;
      let worked = 0;
      let mainMonths = 0;
      for (let m = yStart; m < yEnd; m++) {
        const active = streams.filter((st) => m >= st.from && m < st.to);
        const main = active.filter((st) => st.kind === "fulltime" || st.kind === "founder" || st.kind === "assumed");
        const pool = main.length ? main : active;
        if (!pool.length) continue;
        const best = pool.reduce((a, b) => (b.monthly[s] > a.monthly[s] ? b : a));
        gross += best.monthly[s];
        if (best.kind === "internship") internGross += best.monthly[s];
        worked++;
        if (main.length) mainMonths++;
      }

      // Student debt lands in the graduation year (or at the start if school ended before the history does).
      if (!debtAdded && gradM != null && gradM <= nowM && !tl.student && gradM < yEnd) {
        bal += STUDENT_DEBT[degree][s];
        debtAdded = true;
      }

      let save = 0;
      if (gross > 0) {
        const afterTax = gross * (1 - place.taxRate(gross));
        const ageThen = tl.age != null ? tl.age - (tl.asOf.y - y) : 30;
        // Undergrad years: rent is mostly covered (parents, aid, intern housing), so they save a share of pay.
        const studentYear = mainMonths === 0 && ageThen < 24 && (tl.student || (gradM != null && yStart < gradM));
        if (studentYear) {
          const internShare = internGross / gross;
          save = afterTax * (internShare * SAVINGS.internRate[s] + (1 - internShare) * SAVINGS.studentRate[s]);
        } else {
          const floor =
            (place.hcol ? SAVINGS.floor.hcol[s] : SAVINGS.floor.us[s]) *
            place.priceLevel *
            Math.pow(1 - SAVINGS.floorDeflator, tl.asOf.y - y) *
            interpolateStep(SAVINGS.family[s], ageThen) *
            (worked / 12);
          const raw = (1 - SAVINGS.mpc[s]) * (afterTax - floor);
          save = Math.min(SAVINGS.maxRate * afterTax, Math.max(SAVINGS.minRate * afterTax, raw));
        }
      }

      // Students keep savings in cash-like accounts, so their years grow like the low scenario.
      const r = yearReturn(y, gross > 0 && mainMonths === 0 && tl.student ? "low" : s);
      bal = bal * (1 + (bal < 0 ? DEBT_INTEREST : r) * frac) + save * (1 + (r * frac) / 2);

      // High case only: buy a home once there is a 20% down payment; gain on the borrowed part.
      if (s === "high" && tl.age != null) {
        const ageThen = tl.age - (tl.asOf.y - y);
        if (bought == null && ageThen >= HOUSING.minAge && bal >= HOUSING.downPayment * housingPrice) bought = y;
        if (bought != null && y > bought) bal += (1 - HOUSING.downPayment) * housingPrice * HOUSING.appreciation * frac;
      }
    }
    if (s === "high" && bought != null) boughtHome = true;
    out[s] = bal + (tl.student ? STUDENT.base[s] : 0); // today's cash cushion, not invested since high school
  }

  // ---------- overlays ----------
  const cur = tl.current;
  // Only a founder job that has started: a signed-for-next-year company adds nothing yet.
  const founding = tl.positions.find((p) => p.current && p.kind === "founder" && (p.from == null || p.from <= nowM));
  if (founding) {
    const early = tl.student || /stealth|pre-?seed|side project/i.test(`${founding.title ?? ""} ${founding.company}`);
    const paper = early ? FOUNDER.earlyPaperValue : FOUNDER.paperValue;
    for (const s of SCENARIOS) out[s] += paper * FOUNDER.paperMultiplier[s];
    notes.push(early ? `early-stage founder (${founding.title ?? founding.company})` : "founder: equity could be worth a lot, or nothing");
  }

  // ---------- notes ----------
  const ftYears = Math.round(tl.fulltimeMonths / 12);
  if (current) notes.unshift(`${current.title ? `${current.title} at` : "Works at"} ${current.company} (~${usd(current.tc)}/yr total comp)`);
  else if (cur?.kind === "parttime") notes.unshift(`${cur.title ?? "Part-time"} at ${cur.company}`);
  if (tl.student) notes.unshift("student");
  if (ftYears >= 1) notes.push(`~${ftYears} yrs full-time`);
  const interns = [...new Set(tl.positions.filter((p) => p.kind === "internship" && p.from != null && p.from <= nowM).map((p) => p.companyKey ?? p.company))];
  if (interns.length && tl.fulltimeMonths < 24) notes.push(`${tl.internMonths} months of internships (${interns.slice(0, 3).join(", ")})`);
  if (tl.student && streams.some((st) => st.kind === "parttime")) notes.push("some part-time work");
  if (gradM != null && !tl.student && gradM > nowM - 10 * 12 && gradM <= nowM) notes.push("maybe some student debt");
  if (boughtHome) notes.push("high end assumes home equity");
  if (!place.known) notes.push(place.label);
  else if (place.country !== "us") notes.push(`${place.label} pay levels`);

  const low = Math.max(0, out.low);
  const mid = Math.max(low, out.mid);
  const high = Math.max(mid, out.high, low * 1.3, 5_000);
  const assumed = streams.some((st) => st.kind === "assumed") || undated;
  const confidence: Baseline["confidence"] = assumed ? "low" : current && cur?.companyKey ? "high" : "medium";
  return { low: round2(low), mid: round2(mid), high: round2(high), notes, streams, current, place, confidence };

  function fixed(t: Triple, why: string[], confidence: Baseline["confidence"]): Baseline {
    return { low: round2(t.low), mid: round2(t.mid), high: round2(Math.max(t.high, 1_000)), notes: why, streams: [], current: null, place, confidence };
  }
}

function interpolateStep(steps: [number, number][], age: number): number {
  for (const [maxAge, m] of steps) if (age < maxAge) return m;
  return steps[steps.length - 1][1];
}

// The degree decides ("Bachelor of Business Administration" is not an MBA; a BS at a school of
// medicine is not an MD). The school name only counts when no degree is listed.
function debtKind(profile: CareerProfile): keyof typeof STUDENT_DEBT {
  const degrees = profile.education.map((e) => e.degree?.trim() ?? "").filter(Boolean).join(" | ").toLowerCase();
  const schools = profile.education.filter((e) => !e.degree?.trim()).map((e) => e.school).join(" | ").toLowerCase();
  if (/\bm\.?d\b|doctor of medicine/.test(degrees) || /medical school|school of medicine/.test(schools)) return "md";
  if (/\bj\.?d\b|juris doctor/.test(degrees) || /law school|school of law/.test(schools)) return "jd";
  if (/\bm\.?b\.?a\b|master'?s? (of|in) business administration/.test(degrees)) return "mba";
  return "ba";
}

