// Net worth estimator types. See PLAN.md "Net worth".
// Everything here is pure data: no DB, no network. The estimator runs the same in an
// API route, the CLI (scripts/networth.ts) and offline against seed files.

/** Year + month (1-12). */
export type YM = { y: number; m: number };

export type Position = {
  company: string;
  title: string | null;
  start: YM | null;
  end: YM | null; // null = still there (if `current`) or unknown
  current: boolean;
};

export type School = {
  school: string;
  degree: string | null;
  field: string | null;
  start: YM | null;
  end: YM | null;
};

export type Social = {
  platform: string;
  handle: string | null;
  bio: string | null;
  followers: number | null;
  verified: boolean;
};

/** One person, normalized from whatever the scrapers or tables gave us. */
export type CareerProfile = {
  id: string | null;
  name: string;
  headline: string | null;
  location: string | null;
  country: string | null;
  about: string | null;
  positions: Position[]; // newest first
  education: School[]; // newest first
  socials: Social[];
  /** Where the data came from, e.g. ["experiences", "raw.linkedin"]. */
  inputs: string[];
};

export const LEVELS = [
  "intern",
  "entry",
  "mid",
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
  "vp",
  "exec",
] as const;
export type Level = (typeof LEVELS)[number];

export const FAMILIES = [
  "swe",
  "data",
  "pm",
  "design",
  "hardware",
  "research",
  "sales",
  "finance",
  "consulting",
  "ops",
  "other",
] as const;
export type Family = (typeof FAMILIES)[number];

/** How a job counts toward wealth. */
export type JobKind =
  | "fulltime"
  | "internship"
  | "parttime" // tutor, TA, barista while in school...
  | "student_org" // clubs, societies: unpaid
  | "founder"
  | "volunteer";

export type Tier =
  | "ai_lab"
  | "quant"
  | "bigtech"
  | "top_private"
  | "public_tech"
  | "startup"
  | "finance_ib"
  | "finance_buyside"
  | "consulting_mbb"
  | "consulting_big4"
  | "enterprise"
  | "nonprofit_gov_edu"
  | "healthcare"
  | "other";

/** A salary data point found on the web (or in our built-in table). */
export type CompEvidence = {
  source: "levels.fyi" | "glassdoor" | "web" | "table";
  company: string;
  title: string | null;
  url: string | null;
  snippet: string | null;
  medianTC: number | null; // USD / year
  low: number | null; // e.g. lowest level in a "ranges from" snippet
  high: number | null;
};

/** One row of `net_worth.sources`. */
export type Source = {
  type: "rules" | "table" | "levels.fyi" | "glassdoor" | "web" | "llm";
  label: string;
  url?: string;
  value?: number;
};

export type Estimate = {
  low: number;
  high: number;
  reasoning: string;
  sources: Source[];
  /** Debug info: not saved, printed by the CLI. */
  debug?: Record<string, unknown>;
};
