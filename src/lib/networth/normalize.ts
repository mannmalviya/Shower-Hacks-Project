// Turn whatever we have about a person into one CareerProfile.
//
// Priority: the `experiences` / `education` / `social_profiles` tables (live schema), then the
// scraper output in `people.raw` or `social_profiles.raw`, in any of the shapes we have seen:
//   - worker Profile dict (harness / zo backend): { headline, company, role, raw: { experience: [{ title, company, dates }], education: [{ school, degree, dates }] } }
//   - seed / joeyism linkedin_scraper: { experiences: [{ position_title, institution_name, from_date, to_date }], educations: [...] }
//   - github { company: "@stripe", bio }, x { rawDescription }, instagram { biography }, facebook { Work: [{ text }] }
//   - legacy people columns (company, role) and "Role at Company" headlines as a last resort.
import { isEnrollment, namesSchool } from "./classify";
import { parseRange, parseYM, toMonths } from "./dates";
import type { CareerProfile, Position, School, Social, YM } from "./types";

type Row = Record<string, unknown>;

export type PersonBundle = {
  person: Row; // a `people` row
  experiences?: Row[];
  education?: Row[];
  social_profiles?: Row[];
};

const GITHUB_TITLE = "Engineer (from GitHub profile)";
const JOB_TITLE_RE =
  /\b(engineer|developer|swe|sde|mts|scientist|analyst|manager|pm|designer|founder|intern|associate|consultant|director|lead|researcher|teacher|nurse|officer|specialist|architect|recruiter|accountant|attorney|lawyer|physician|owner|president|vp|head of|partner|trader|banker)s?\b/i;
// Past, future or wished-for roles ("Former SWE", "Incoming Analyst", "Aspiring PM"): not a current job.
const NOT_CURRENT = /^(ex[- ]|former\b|prev(ious(ly)?)?\b|past\b|incoming\b|upcoming\b|future\b|aspiring\b|seeking\b|looking\b|open to\b)/i;

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s : null;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const arr = (v: unknown): Row[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Row[]) : []);
const obj = (v: unknown): Row | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null);

export function normalize(bundle: PersonBundle): CareerProfile {
  const p = bundle.person;
  const raw = obj(p.raw) ?? {};
  const inputs: string[] = [];

  // Every platform blob we can find: people.raw[platform] and social_profiles[].raw.
  const blobs: { platform: string; data: Row }[] = [];
  for (const [platform, v] of Object.entries(raw)) {
    const o = obj(v);
    if (o) blobs.push({ platform, data: o });
  }
  for (const sp of bundle.social_profiles ?? []) {
    const o = obj(sp.raw);
    if (o && Object.keys(o).length) blobs.push({ platform: String(sp.platform), data: o });
  }

  // ---------- positions ----------
  let positions: Position[] = [];
  if (bundle.experiences?.length) {
    positions = bundle.experiences.map((e) => {
      const start = parseYM(e.start_date);
      const end = parseYM(e.end_date);
      return {
        company: str(e.company) ?? "Unknown",
        title: str(e.title),
        start: start === "present" ? null : start,
        end: end === "present" ? null : end,
        current: e.end_date == null || end === "present",
      };
    });
    inputs.push("experiences");
  } else {
    // Richest LinkedIn-like blob wins.
    let best: { platform: string; list: Position[] } | null = null;
    for (const b of blobs) {
      const list = positionsFromBlob(b.data);
      if (list.length && (!best || list.length > best.list.length)) best = { platform: b.platform, list };
    }
    if (best) {
      positions = best.list;
      inputs.push(`raw.${best.platform}.experience`);
    }
  }
  if (!positions.length) {
    const guess = currentJobGuess(p, blobs);
    if (guess) {
      // A GitHub profile next to an untitled employer: almost always an engineer there.
      if (!guess.position.title && blobs.some((b) => b.platform === "github")) guess.position.title = GITHUB_TITLE;
      positions = [guess.position];
      inputs.push(guess.from);
    }
  }
  positions = dedupe(positions, (x) => `${x.company}|${x.title}|${x.start?.y}-${x.start?.m}`);
  positions = sortNewestFirst(positions);

  // ---------- education ----------
  let education: School[] = [];
  if (bundle.education?.length) {
    education = bundle.education.map((e) => {
      const start = parseYM(e.start_date, 9);
      const end = parseYM(e.end_date, 6);
      return {
        school: str(e.school) ?? "Unknown",
        degree: str(e.degree),
        field: str(e.field),
        start: start === "present" ? null : start,
        end: end === "present" ? null : end,
      };
    });
    inputs.push("education");
  } else {
    // Prefer the list with the most dated schools (LinkedIn), then the longest (Facebook has no dates).
    let best: School[] = [];
    let from = "";
    const score = (l: School[]) => l.filter((e) => e.start || e.end).length * 100 + l.length;
    for (const b of blobs) {
      const list = schoolsFromBlob(b.data);
      if (score(list) > score(best)) {
        best = list;
        from = `raw.${b.platform}.education`;
      }
    }
    if (best.length) {
      education = best;
      inputs.push(from);
    }
  }
  education = dedupe(education, (x) => `${x.school}|${x.degree}`);
  education = sortNewestFirst(education);

  // ---------- socials ----------
  const socials: Social[] = [];
  const seen = new Set<string>();
  for (const sp of bundle.social_profiles ?? []) {
    const platform = String(sp.platform);
    seen.add(platform);
    socials.push({
      platform,
      handle: str(sp.handle),
      bio: str(sp.bio),
      followers: num(sp.follower_count) ?? followersFromBlob(obj(sp.raw) ?? {}),
      verified: verifiedFromBlob(obj(sp.raw) ?? {}),
    });
  }
  for (const b of blobs) {
    if (seen.has(b.platform) || b.platform === "linkedin_connections") continue;
    seen.add(b.platform);
    socials.push({
      platform: b.platform,
      handle: str(b.data.username ?? b.data.login ?? b.data.handle),
      bio: bioFromBlob(b.data),
      followers: followersFromBlob(b.data),
      verified: verifiedFromBlob(b.data),
    });
  }

  const li = blobs.find((b) => b.platform === "linkedin")?.data;
  const about = str(li?.about) ?? str(obj(li?.raw)?.about) ?? null;

  return {
    id: str(p.id),
    name: str(p.name) ?? "Unknown",
    headline: str(p.headline) ?? str(li?.headline),
    location: str(p.location) ?? str(li?.location) ?? locationFromBlobs(blobs),
    country: str(p.country),
    about,
    positions,
    education,
    socials,
    inputs,
  };
}

// ---------- blob readers ----------

function locationFromBlobs(blobs: { platform: string; data: Row }[]): string | null {
  for (const b of blobs) {
    const loc = str(b.data.location) ?? str(obj(b.data.raw)?.location);
    if (loc) return loc;
    const city = arr(b.data["Places Lived"]).find((x) => /current/i.test(String(x.type ?? "")));
    if (city && str(city.text)) return str(city.text);
  }
  return null;
}

function positionsFromBlob(b: Row): Position[] {
  const inner = obj(b.raw) ?? {};
  // worker Profile dict: raw.experience; zo/harness written straight into social_profiles.raw: experience
  const workerList = arr(inner.experience).length ? arr(inner.experience) : arr(b.experience);
  if (workerList.length) {
    return workerList
      .map((e) => {
        const r = parseRange(e.dates);
        return { company: str(e.company) ?? "", title: str(e.title), ...r };
      })
      .filter((x) => x.company);
  }
  // seed / joeyism
  const seedList = arr(b.experiences);
  return seedList
    .map((e) => {
      const start = parseYM(e.from_date, 9);
      const end = parseYM(e.to_date, 6);
      return {
        company: str(e.institution_name ?? e.company) ?? "",
        title: str(e.position_title ?? e.title),
        start: start === "present" ? null : start,
        end: end === "present" ? null : end,
        current: end === "present" || (e.to_date == null && start !== null),
      };
    })
    .filter((x) => x.company);
}

function schoolsFromBlob(b: Row): School[] {
  const inner = obj(b.raw) ?? {};
  const workerList = arr(inner.education).length ? arr(inner.education) : arr(b.education);
  if (workerList.length) {
    return workerList
      .map((e) => {
        const r = parseRange(e.dates);
        return { school: str(e.school) ?? "", degree: str(e.degree), field: null, start: r.start, end: r.end };
      })
      .filter((x) => x.school);
  }
  const seedList = arr(b.educations);
  if (seedList.length) {
    return seedList
      .map((e) => {
        const start = parseYM(e.from_date, 9);
        const end = parseYM(e.to_date, 6);
        return {
          school: str(e.institution_name ?? e.school) ?? "",
          degree: str(e.degree),
          field: null,
          start: start === "present" ? null : start,
          end: end === "present" ? null : end,
        };
      })
      .filter((x) => x.school);
  }
  // facebook
  return arr(b.Education)
    .map((e) => ({ school: str(e.text) ?? "", degree: null, field: null, start: null, end: null }))
    .filter((x) => x.school);
}

function bioFromBlob(b: Row): string | null {
  return str(b.headline ?? b.bio ?? b.rawDescription ?? b.biography ?? b.about);
}

function followersFromBlob(b: Row): number | null {
  const inner = obj(b.raw) ?? {};
  return (
    num(b.followers) ??
    num(b.followersCount) ??
    num(b.follower_count) ??
    num(inner.follower_count) ??
    num(obj(b.edge_followed_by)?.count) ??
    num(b.Friend_count)
  );
}

function verifiedFromBlob(b: Row): boolean {
  return b.verified === true || b.is_verified === true;
}

/** No work history: guess one current job from legacy columns, the worker's top-level fields, bios or headlines. */
function currentJobGuess(p: Row, blobs: { platform: string; data: Row }[]): { position: Position; from: string } | null {
  const mk = (company: string | null, title: string | null, from: string) =>
    company ? { position: { company, title, start: null, end: null, current: true }, from } : null;

  // A role parsed from a headline can carry the rest of it ("EECS | AI/ML | SWE @ Google"): the job is
  // the part next to the company. Past / future roles and school lines ("Data Science @ Berkeley") are not.
  // Prefer the last segment that reads like a job title ("AI Engineer | Building agents @ X" -> "AI Engineer").
  let enrolled = false;
  const job = (company: string | null, role: string | null, from: string) => {
    const segments = role?.split(/\s*[|•·]\s*/).filter(Boolean) ?? [];
    const title = [...segments].reverse().find((seg) => JOB_TITLE_RE.test(seg)) ?? segments.at(-1) ?? null;
    if (title && (NOT_CURRENT.test(title) || namesSchool(title))) return null;
    if (company && isEnrollment(title, company)) {
      enrolled = true;
      return null;
    }
    return mk(company, title, from);
  };

  // Legacy people.company / people.role (old schema, connections import).
  const legacy = job(str(p.company), str(p.role), "people.company");
  if (legacy) return legacy;
  // Worker Profile dict top-level (company, role) or LinkedIn "company" fields.
  for (const b of blobs) {
    const g = job(str(b.data.company), str(b.data.role), `raw.${b.platform}.company`);
    if (g && !String(g.position.company).startsWith("@")) return g;
  }
  // Their own card says they are enrolled ("Economics Student @ UC Berkeley"): don't turn a club in a bio into a job.
  if (enrolled) return null;
  // "Software Engineer at Stripe" / "SWE @ Stripe" headlines.
  for (const h of [str(p.headline), ...blobs.map((b) => bioFromBlob(b.data))]) {
    const g = h ? parseHeadline(h) : null;
    if (g) return mk(g.company, g.title, "headline");
  }
  // GitHub "@stripe", Facebook Work.
  for (const b of blobs) {
    if (b.platform === "github" && str(b.data.company)) {
      // A GitHub profile listing an employer is almost always an engineer there.
      const company = String(b.data.company).replace(/^@/, "").trim();
      return mk(company ? company[0].toUpperCase() + company.slice(1) : null, GITHUB_TITLE, "raw.github.company");
    }
    if (b.platform === "facebook") {
      const w = arr(b.data.Work)[0];
      if (w && str(w.text)) return mk(str(w.text), null, "raw.facebook.Work");
    }
  }
  return null;
}

/** "Senior SWE at Google | ex-Meta" -> { title: "Senior SWE", company: "Google" }. Past and future roles ("Ex-Google", "Incoming ...") are skipped. */
export function parseHeadline(h: string): { title: string | null; company: string } | null {
  const first = h.split(/\s[|•·]\s|\s\|\s?|\s-\s/)[0];
  const m = first.match(/^(.{2,80}?)\s+(?:at|@)\s+(.{2,60})$/i) ?? first.match(/^(.{2,80}?)\s*@\s*(.{2,60})$/);
  if (!m) return null;
  const title = m[1].trim();
  const company = m[2].replace(/[^\p{L}\p{N}&.,'()\- ]/gu, "").trim();
  if (!company || NOT_CURRENT.test(title)) return null;
  // "Student @ UC Berkeley" / "Electrical Engineering @ Stanford" is school, not a job.
  if (isEnrollment(title, company) || namesSchool(title)) return null;
  return { title, company };
}

function dedupe<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Newest first by start (or end when the start is missing). Undated current rows go first, undated
 * past rows last. Ties keep the source order (LinkedIn lists newest first); DB rows come unordered. */
function sortNewestFirst<T extends { start: YM | null; end: YM | null; current?: boolean }>(xs: T[]): T[] {
  const key = (x: T) => {
    const d = x.start ?? x.end;
    return d ? toMonths(d) : x.current ? Infinity : -Infinity;
  };
  return xs
    .map((x, i) => ({ x, i, k: key(x) }))
    .sort((a, b) => (a.k === b.k ? a.i - b.i : b.k - a.k))
    .map((e) => e.x);
}
