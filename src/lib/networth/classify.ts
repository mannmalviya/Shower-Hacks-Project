// Title / company / timeline classification. Pure keyword rules: fast, free, explainable.
// The LLM step can overrule them, but the baseline must be sane on its own.
import { findCompany } from "./comp";
import { monthsBetween, nowYM, toMonths } from "./dates";
import type { CareerProfile, Family, JobKind, Level, Position, School, Tier, YM } from "./types";

export type ClassifiedPosition = Position & {
  kind: JobKind;
  level: Level;
  family: Family;
  tier: Tier;
  /** Canonical company name in the built-in comp table, when known. */
  companyKey: string | null;
  /** [from, to) month indexes (toMonths), clipped to asOf. Null when undated. */
  from: number | null;
  to: number | null;
  /** True when the title states the level ("Senior ..."); false = inferred from years of experience. */
  levelFromTitle: boolean;
  /** Years of full-time work before this job started. */
  yoeAtStart: number;
};

export type Timeline = {
  asOf: YM;
  positions: ClassifiedPosition[];
  current: ClassifiedPosition | null; // most relevant current paid job
  student: boolean; // in school right now (and no full-time job)
  highSchool: boolean;
  gradYM: YM | null; // expected / actual end of the latest degree
  age: number | null; // estimated
  ageBasis: string | null;
  /** Full-time months worked (for YoE), by the estimator's rules. */
  fulltimeMonths: number;
  /** Months the person has been in an internship at a paying company. */
  internMonths: number;
};

const has = (re: RegExp, s: string | null | undefined) => !!s && re.test(s);

// ---------- companies ----------

const SCHOOL_RE = /\b(university|college|school|academy|institute of technology|polytechnic|\bUC\s|UCLA|UCSD|USC|MIT|Stanford|Berkeley|district|high school|gymnasium|lyc[eé]e)\b/i;
const STUDENT_ORG_RE = /\b(club|society|association|council|chapter|fraternity|sorority|robotics|hackathon|hacks|student|undergraduate|ASUC|FRC|FTC|debate|model un|mun|consulting group at|blueprint|launchpad|codebase|team \d+|scouts?|4-h|volunteer)\b/i;

export function companyTier(company: string): { tier: Tier; key: string | null } {
  const hit = findCompany(company);
  if (hit) return { tier: hit.tier, key: hit.name };
  const c = company.toLowerCase();
  if (SCHOOL_RE.test(company)) return { tier: "nonprofit_gov_edu", key: null };
  if (/\b(government|city of|county|state of|department of|federal|army|navy|air force|marines|police|fire department|usps|nasa|national lab|foundation|non-?profit|church|ngo)\b/.test(c))
    return { tier: "nonprofit_gov_edu", key: null };
  if (/\b(hospital|health|medical|clinic|kaiser|pharma|pharmaceutical|biotech|therapeutics|dental|medicine)\b/.test(c))
    return { tier: "healthcare", key: null };
  if (/\b(ventures|capital|partners|asset management|investments?|fund|holdings|equity|advisors)\b/.test(c))
    return { tier: "finance_buyside", key: null };
  if (/\b(bank|bancorp|securities|financial|credit union|insurance)\b/.test(c)) return { tier: "enterprise", key: null };
  if (/\b(consulting|consultancy)\b/.test(c)) return { tier: "enterprise", key: null };
  // Explicit early-stage signals only. Unknown established tech firms (e.g. Chelsio) stay "other":
  // their pay is closer to the market median than to funded-startup offers.
  if (/\b(stealth|y combinator|\(yc|yc [sfw]\d{2})\b|\.ai\b|\bai$/.test(c)) return { tier: "startup", key: null };
  return { tier: "other", key: null };
}

// ---------- titles ----------

// "CS Major", "majoring in": a student. "Major Account Executive" is a sales job.
const STUDENT_TITLE_RE = /\bstudent\b|\bundergrad(uate)?\b(?! research)|\bcandidate\b|\bmajoring\b|\bmajor in\b|\b\w+ major\s*($|@|\bat\b|[,|•·(])|\bclass of\b|\bfreshman\b|\bsophomore\b/i;
// A bare field of study as the title ("EECS @ UC Berkeley") only means student at a school.
const FIELD_TITLE_RE = /^((master|bachelor|doctor)('?s)?( of| in)?|b\.?s\.?|b\.?a\.?|m\.?s\.?|m\.?eng|mba|eecs|cs|computer science|computer engineering|(electrical|mechanical|civil|chemical|biomedical|industrial|aerospace|materials) engineering|bioengineering|economics|data science|business|mathematics|math|applied math(ematics)?|statistics|physics|biology|chemistry|neuroscience|cognitive science|psychology|political science|design)\b[^,]*$/i;
const JOB_WORD_RE = /\b(assistant|researcher|tutor|intern|worker|employee|teacher|professor|lecturer|instructor|analyst|engineer|scientist|developer|manager|director|staff|coordinator|executive|officer|representative|specialist|associate|consultant|designer|lead|technician|nurse|attorney|accountant|clerk|cashier|(team|crew) member)s?\b/i;
// Titles of people employed by a school ("Professor @ Stanford"), as opposed to its students.
const SCHOOL_STAFF_RE = /professor|lecturer|postdoc|staff|director|manager|coordinator|administrat|researcher|scientist|engineer\b|\bswe\b|\bsde\b|developer|analyst|teacher|instructor|dean|officer|specialist|counsel|librarian|nurse|physician|surgeon|psychologist|therapist|social worker|superintendent|\bprincipal\b|coach/i;

/** "Data Science @ UC Berkeley", "Student @ UCLA": enrollment written as a job title + company. */
export function isEnrollment(title: string | null, company: string): boolean {
  const t = title ?? "";
  return (STUDENT_TITLE_RE.test(t) || FIELD_TITLE_RE.test(t) || /&\s*\w+$/.test(t)) && SCHOOL_RE.test(company) && !JOB_WORD_RE.test(t);
}

/** A headline fragment that names a school rather than a job ("Stanford GSB", "CS @ UCLA"). */
export function namesSchool(text: string): boolean {
  return SCHOOL_RE.test(text) && !JOB_WORD_RE.test(text) && !SCHOOL_STAFF_RE.test(text);
}

export function jobKind(title: string | null, company: string, duringSchool: boolean): JobKind {
  const t = title ?? "";
  // "Computer Engineering Student @ UC Berkeley" is enrollment, not a job ("student_org" = unpaid).
  // PhD students / GSRs are paid a stipend: a (low-paid) job, priced by the graduate_student occupation.
  if (/\b(graduate student (researcher|instructor)|gsr|gsi|ph\.?d\.? (student|candidate)|doctoral (student|candidate))\b/i.test(t)) return "fulltime";
  if ((STUDENT_TITLE_RE.test(t) || (FIELD_TITLE_RE.test(t) && SCHOOL_RE.test(company))) && !JOB_WORD_RE.test(t)) return "student_org";
  // Founders only. A shop "Owner" is a paid small-business job, a "Product Owner" a normal one.
  if (has(/\b(co-?)?founder\b|\bfounding (partner|member)\b/i, t)) return "founder";
  if (has(/\bintern(ship)?\b|\bco-?op\b|summer (analyst|associate|intern)|\bextern\b|\bapprentice\b|\btrainee\b/i, t))
    return "internship";
  // Unpaid roles, by title: "Member of Technical Staff" and "Team Member" are jobs.
  if (has(/\bvolunteer\b|\bambassador\b|\bdelegate\b|campus rep|\b(club|board|committee|chapter|society|fraternity|sorority|general|active) member\b|^member$/i, t)) return "volunteer";
  if (has(/job simulation|virtual (experience|internship)|\bforage\b/i, `${t} ${company}`)) return "volunteer";
  // Club-like names ("... Robotics", "... Association"): a club while in school or with no title.
  // After school a job title there is a job ("Software Engineer @ Agility Robotics"); "President" is not.
  if (STUDENT_ORG_RE.test(company) && !findCompany(company)) {
    if (duringSchool || !title) return "student_org";
    if (!JOB_WORD_RE.test(t)) return "volunteer";
  }
  // Campus jobs are part-time whenever they happen. Barista / cashier jobs only while in school.
  if (has(/\btutor\b|teaching assistant|\bTA\b|\breader\b|\bgrader\b|research assistant|undergraduate research|student (worker|assistant|researcher)|part[- ]time|resident assistant|peer (advisor|mentor)/i, t))
    return "parttime";
  if (duringSchool) return "parttime";
  return "fulltime";
}

const OCCUPATION_TITLE_RE = /\b(warehouse|fulfillment|retail|store|shift|crew|guest|patient care) (associate|member|lead)\b|\bteam (member|associate)\b|\bsales (associate|floor)\b|attorney|paralegal|\blegal\b|security (officer|guard)/;
// Role owners ("Process Owner") are ordinary jobs.
const OPS_RE = /operations|\bops\b|program manag|project manag|recruit|talent|people|\bhr\b|human resources|marketing|communications|coordinator|administrat|chief of staff|strategy|growth|community|content|policy|\b(process|service|system|risk|control|business|data|platform|technical) owner\b/;

export function roleFamily(title: string | null): Family {
  const t = (title ?? "").toLowerCase();
  if (!t) return "other";
  if (/product manag|\bpm\b|\bapm\b|product owner|product lead|technical program|\btpm\b|group product/.test(t)) return "pm";
  if (/hardware|electrical|mechanical|\basic\b|fpga|silicon|\bchip\b|firmware|embedded|civil engineer|aerospace|manufacturing engineer|process engineer|rf engineer|physical design|verification engineer/.test(t))
    return "hardware";
  if (/data scien|data analy|analytics|business intelligence|\bbi\b|machine learning scien|applied scien|statistic/.test(t)) return "data";
  if (/research scien|research engineer|research (associate|assistant)|researcher|\bscientist\b|member of technical staff|postdoc|professor|lecturer|phd|quant(itative)? research/.test(t)) return "research";
  if (/software|developer|\bswe\b|\bsde\b|engineer|programmer|devops|\bsre\b|full[- ]?stack|front[- ]?end|back[- ]?end|\bml\b|machine learning|infrastructure|(cyber|information|application|network|cloud|product|data) security|security (engineer|analyst|researcher|architect|operations)|(software|solutions?|cloud|data|systems|enterprise|security|technical|platform|infrastructure) architect|\bcto\b/.test(t))
    return "swe";
  // Store, warehouse, legal and guard jobs stay "other" so the occupation table prices them.
  if (OCCUPATION_TITLE_RE.test(t)) return "other";
  if (/design|\bux\b|\bui\b|creative|artist|illustrat/.test(t)) return "design";
  if (/sales|account exec|account manag|account owner|business development|\bbdr\b|\bsdr\b|partnerships|customer success|solutions? (engineer|consultant)|go-to-market|\bgtm\b/.test(t))
    return "sales";
  if (/consult|advisory|engagement manager|strategy analyst/.test(t)) return "consulting";
  // A bare "Analyst" / "Associate" is not finance by itself: buildTimeline moves it by employer.
  if (/invest|banking|banker|trader|trading|portfolio|private equity|venture|equity research|capital markets|\bm&a\b|credit|wealth|\bcfa\b|finance|financial|accountant|accounting|audit|tax|actuar|underwrit/.test(t))
    return "finance";
  // Lawyers, doctors, teachers... stay "other" so the occupation table prices them.
  if (OPS_RE.test(t)) return "ops";
  if (/\banalyst\b/.test(t)) return "ops"; // business analyst
  return "other";
}

/** Level from the title alone. null = no signal (then years of experience decide). */
export function titleLevel(title: string | null, family: Family, tier: Tier): Level | null {
  const t = (title ?? "").toLowerCase();
  if (!t) return null;
  const finance = tier === "finance_ib" || tier === "finance_buyside" || family === "finance";
  const consulting = tier === "consulting_mbb" || tier === "consulting_big4" || family === "consulting";

  if (/\bintern\b|\binternship\b|summer (analyst|associate)|\bco-?op\b/.test(t)) return "intern";
  if (/\b(ceo|cto|cfo|coo|cmo|cpo|cro|ciso|chief(?! of staff)\b|president\b|managing partner|general partner)\b/.test(t) && !/vice president/.test(t))
    return "exec";
  // "MD" at a bank or fund is a managing director.
  // Bank / fund MDs sit at the table's "vp" row (~$1-2.5M), not "exec" (C-suite).
  if (/managing director/.test(t) || (finance && /\bmd\b/.test(t))) return finance ? "vp" : "director";
  // Firm partners. "Partner Engineer", "Partner Solutions Architect", "HR Business Partner" are ordinary roles.
  if (/(^|[,&/|]\s*|\band )partner\b|\b(senior|equity|founding|venture|operating|investment|associate) partner\b/.test(t) &&
      !/business partner|partner (engineer|solutions|manager|marketing|success|development|account|sales|relations|program|operations|integrations?|technology)|partnership/.test(t))
    // Consulting / finance partners: the table's "vp" row (McKinsey partner ~$900k, PE partner ~$2.5M).
    return (consulting || finance) && !/associate partner/.test(t) ? "vp" : "director";
  // Assistant VPs sit below VP.
  if (/assistant vice president|\bavp\b/.test(t)) return finance ? "mid" : "senior";
  if (/(vice president|\bvp\b|\bsvp\b|\bevp\b)/.test(t)) return finance ? "senior" : "vp";
  if (/\bdirector\b|\bhead of\b/.test(t)) return finance && /executive director/.test(t) ? "staff" : "director";
  if (/\bprincipal\b|\bdistinguished\b|\b(technical|senior|distinguished) fellow\b/.test(t)) return consulting ? "staff" : "principal";
  if (/\bfellow\b/.test(t)) return "entry"; // "Venture Fellow", "Research Fellow"
  // Big 4 "Audit Staff" / "Staff Consultant" is the first rank.
  if (/\b(audit|tax|advisory|assurance|consulting) staff\b|\bstaff (consultant|auditor|accountant|research associate)\b/.test(t)) return /\bsenior\b|\bsr\b/.test(t) ? "mid" : "entry";
  // "Member of Technical Staff" is every level at OpenAI / Anthropic: years decide.
  if (/\bstaff\b/.test(t) && !/staff (nurse|writer|assistant|member)|technical staff|chief of staff/.test(t)) return "staff";
  if (/(engineering|software|development|data science|research|design|analytics|people|general|store|branch|restaurant|office|operations|site|plant) manager|\bmanager,|manager of|\bsupervisor\b|engagement manager|project leader/.test(t))
    return consulting ? "senior" : "manager";
  if (/\bsenior\b|\bsr\.?\b|\blead\b|\biii\b|\bl5\b|\be5\b|\bic4\b/.test(t)) return "senior";
  if (/\bjunior\b|\bjr\.?\b|new grad|\bgraduate\b|\bl3\b|\be3\b|\bassociate (software|engineer|product|consultant)|\bapm\b|\bi\b$/.test(t)) return "entry";
  if (finance && /\banalyst\b/.test(t)) return "entry";
  if (finance && /\bassociate\b/.test(t)) return "mid";
  if (consulting && /\banalyst\b|\bassociate\b/.test(t)) return "entry";
  if (/\bii\b|\bl4\b|\be4\b/.test(t)) return "mid";
  if (/\bassistant\b/.test(t)) return "entry";
  return null;
}

export function levelFromYears(years: number): Level {
  if (years < 2) return "entry";
  if (years < 5) return "mid";
  if (years < 10) return "senior";
  return "staff";
}

/** Rank-only titles ("Analyst", "Associate", "VP", "Manager") take the family of a bank / fund or consulting firm. */
function employerFamily(title: string | null, family: Family, tier: Tier): Family {
  const t = (title ?? "").toLowerCase();
  const bare = family === "other" ? !OCCUPATION_TITLE_RE.test(t) : family === "ops" && !OPS_RE.test(t);
  if (!bare) return family;
  if ((tier === "finance_ib" || tier === "finance_buyside") && /\b(analyst|associate|vice president|vp|avp|svp|director|managing director|md|principal|partner)\b/.test(t)) return "finance";
  if ((tier === "consulting_mbb" || tier === "consulting_big4") && /\b(analyst|associate|consultant|manager|principal|partner|director)\b/.test(t)) return "consulting";
  return family;
}

// ---------- timeline ----------

export function buildTimeline(profile: CareerProfile, asOf?: Date): Timeline {
  const now = nowYM(asOf);
  const nowM = toMonths(now);

  // School: when does (did) the latest degree end? High school only = teenager.
  const degrees = profile.education.filter((e) => !/high school|secondary|gymnasium|lyc[eé]e|middle school/i.test(`${e.school} ${e.degree ?? ""}`));
  const highSchools = profile.education.filter((e) => !degrees.includes(e));
  const gradYM =
    degrees.map((e) => e.end).filter(Boolean).sort((a, b) => toMonths(b!) - toMonths(a!))[0] ??
    null;
  const hsEnd = highSchools.map((e) => e.end).filter(Boolean).sort((a, b) => toMonths(b!) - toMonths(a!))[0] ?? null;

  // "Data Science @ Berkeley": a school after the "@" and no staff title before it.
  const atPart = (profile.headline ?? "").split(/\s[|•·]\s/).find((s) => s.includes("@")) ?? "";
  const atSchool = !!atPart && SCHOOL_RE.test(atPart.slice(atPart.indexOf("@") + 1)) && !SCHOOL_STAFF_RE.test(atPart.slice(0, atPart.indexOf("@")));
  const headlineStudent = atSchool || has(/\bstudent\b|\bundergrad|\bcandidate\b|class of 20\d\d|\bfreshman|\bsophomore|\bjunior @|\bsenior @|\bmajoring\b|\bmajor in\b|\b\w+ major\s*($|@|\bat\b|[,|•·(])|studying|\bB\.?S\.? (student|candidate)|'2\d\b/i, profile.headline);
  // Executive, online and part-time programs are done next to a job: they do not make it a student job.
  const partTimeProgram = (e: School) => /executive|\bemba\b|online|part[- ]time|omscs|evening|weekend/i.test(`${e.school} ${e.degree ?? ""}`);
  const enrolled = (e: School) => (e.end ? toMonths(e.end) > nowM : !!e.start && monthsBetween(e.start, now) < 60 && !e.end) && (!e.start || toMonths(e.start) <= nowM);
  const inDegree = degrees.some(enrolled);
  const inHighSchool = highSchools.some((e) => !!e.end && toMonths(e.end) > nowM) && !degrees.length;

  // A school-as-company "job" ("Data Science @ UC Berkeley") also means student.
  const schoolJob = profile.positions.some((p) => p.current && SCHOOL_RE.test(p.company) && (roleFamily(p.title) === "other" || isEnrollment(p.title, p.company)) && !has(SCHOOL_STAFF_RE, p.title));

  // School periods (high school included), one interval per school. Missing ends are filled with a
  // typical length. A job inside one of them is a student job (part-time / internship), not a career.
  const schoolIntervals: [number, number][] = [];
  for (const e of profile.education) {
    if (partTimeProgram(e)) continue;
    const text = `${e.school} ${e.degree ?? ""}`;
    const len = /ph\.?d|doctor/i.test(text) ? 60 : /master|m\.?s\.?\b|m\.?eng|mba/i.test(text) ? 24 : /\bj\.?d\b|law/i.test(text) ? 36 : 48;
    const s = e.start ? toMonths(e.start) : e.end ? toMonths(e.end) - len : null;
    const end = e.end ? toMonths(e.end) : s != null ? Math.min(s + len, nowM) : null;
    if (s != null && end != null) schoolIntervals.push([s - 3, end + 1]); // the summer before counts
  }
  if ((headlineStudent || degrees.some((e) => enrolled(e) && !partTimeProgram(e))) && !schoolIntervals.some(([, e]) => e >= nowM)) {
    // In school now but the degree has no dates ("Student @ UC Berkeley").
    schoolIntervals.push([hsEnd ? toMonths(hsEnd) : nowM - 48, nowM + 1]);
  }
  // A job counts as a student job when at least half of it falls inside a school period.
  const duringSchool = (from: number | null, to: number | null) => {
    if (from == null) return false;
    const end = Math.max(to ?? from + 1, from + 1);
    let inside = 0;
    for (let m = from; m < end; m++) if (schoolIntervals.some(([s, e]) => m >= s && m <= e)) inside++;
    return inside / (end - from) >= 0.5;
  };

  // Classify positions. Month ranges are [from, to): LinkedIn's "Jun 2025 - Sep 2025" is 4 months.
  const earliest = nowM - 55 * 12; // older start dates are typos: no one works 55+ years
  let ftMonthsSoFar = 0;
  let careerMonths = 0; // full-time months outside school
  const chronological = [...profile.positions].reverse(); // oldest first for YoE
  const classified: ClassifiedPosition[] = [];
  for (const p of chronological) {
    const from = p.start ? Math.max(toMonths(p.start), earliest) : null;
    let to = p.end ? toMonths(p.end) + 1 : p.current ? nowM + 1 : from != null ? from + 1 : null;
    if (to != null && to > nowM + 1) to = nowM + 1; // future end dates (intern until Aug) clip to now
    if (from != null && from > nowM) {
      // Starts in the future (signed offer): keep it but it adds no wealth yet.
      to = from;
    }
    const { tier, key } = companyTier(p.company);
    const family = employerFamily(p.title, roleFamily(p.title), tier);
    // A job in school is a student job, unless the person already has a career (2+ years
    // full-time) and studies on the side (OMSCS, part-time MBA).
    const inSchool = careerMonths < 24 && (duringSchool(from, to) || (p.current && (inDegree || inHighSchool) && !findCompany(p.company) && !has(/engineer|analyst|developer|manager|scientist/i, p.title)));
    const kind = jobKind(p.title, p.company, inSchool);
    let level = titleLevel(p.title, family, tier);
    const levelFromTitle = level != null || kind === "internship";
    if (kind === "internship") level = "intern";
    if (!level) level = kind === "fulltime" || kind === "founder" ? levelFromYears(ftMonthsSoFar / 12) : "entry";
    const months = from != null && to != null ? Math.max(1, to - from) : 0;
    const yoeAtStart = ftMonthsSoFar / 12;
    if (kind === "fulltime" || kind === "founder") ftMonthsSoFar += months;
    if (kind === "fulltime" && !duringSchool(from, to)) careerMonths += months;
    classified.push({ ...p, kind, level, family, tier, companyKey: key, from, to, levelFromTitle, yoeAtStart });
  }
  classified.reverse(); // back to newest first

  const paid = (k: JobKind) => k === "fulltime" || k === "founder";
  // A founder who is still enrolled ("Founder (stealth) @ UC Berkeley") is a student with a side project.
  const inSchoolNow = inDegree || inHighSchool || headlineStudent || schoolJob;
  const studentFounder = (p: ClassifiedPosition) => p.kind === "founder" && (inSchoolNow || SCHOOL_RE.test(p.company));
  const currentFull = classified.find((p) => p.current && paid(p.kind) && !studentFounder(p) && (p.from == null || p.from <= nowM));
  const currentAny = classified.find((p) => p.current && p.kind !== "student_org" && p.kind !== "volunteer");
  const student = !currentFull && inSchoolNow;

  // Age: HS grad ~18, BA start ~18, BA end ~22, masters end ~24, PhD end ~29, first full-time job ~22.
  let age: number | null = null;
  let ageBasis: string | null = null;
  const firstBA = [...degrees].reverse().find((e) => e.start || e.end);
  if (hsEnd) {
    age = now.y - hsEnd.y + 18;
    ageBasis = `high school ended ${hsEnd.y}`;
  } else if (firstBA?.start) {
    age = now.y - firstBA.start.y + 18;
    ageBasis = `first degree started ${firstBA.start.y}`;
  } else if (firstBA?.end) {
    const extra = /ph\.?d|doctor/i.test(firstBA.degree ?? "") ? 7 : /master|m\.?s\.?|mba|m\.?eng/i.test(firstBA.degree ?? "") ? 2 : 0;
    age = now.y - firstBA.end.y + 22 + extra;
    ageBasis = `first degree ended ${firstBA.end.y}`;
  } else {
    const firstJob = chronological.find((p) => p.start && (p.end || p.current));
    if (firstJob?.start) {
      const y = Math.max(firstJob.start.y, now.y - 55);
      age = now.y - y + 22;
      ageBasis = `first job started ${y}`;
    }
  }
  if (age != null) age = Math.max(14, Math.min(85, age));

  const internMonths = classified
    .filter((p) => p.kind === "internship" && p.from != null && p.to != null)
    .reduce((s, p) => s + Math.max(1, p.to! - p.from!), 0);

  return {
    asOf: now,
    positions: classified,
    current: currentFull ?? (student ? null : currentAny ?? null),
    student,
    highSchool: inHighSchool,
    gradYM,
    age,
    ageBasis,
    fulltimeMonths: ftMonthsSoFar,
    internMonths,
  };
}
