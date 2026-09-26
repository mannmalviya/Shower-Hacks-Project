// Date parsing for scraped profiles. Handles LinkedIn text ("Jun 2025 - Present · 1 yr 4 mos",
// "Sep 2022 – 2026"), seed/joeyism fields ("Jun 2026", "Present") and DB dates ("2025-06-01").
import type { YM } from "./types";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const PRESENT = /^(present|current|now|today|ongoing)$/i;

/** One date. "present" when the text says the role is ongoing. Year-only dates get month 1 (starts) — callers pick. */
export function parseYM(input: unknown, yearOnlyMonth = 1): YM | "present" | null {
  if (input == null) return null;
  const s = String(input).trim().replace(/\s+/g, " ");
  if (!s) return null;
  if (PRESENT.test(s)) return "present";

  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?/); // 2025-06-01, 2025-06
  if (m) return ym(+m[1], +m[2]);
  m = s.match(/^(\d{1,2})\/(\d{4})$/); // 06/2025
  if (m) return ym(+m[2], +m[1]);
  m = s.match(/^([A-Za-z]{3,9})\.?,? (\d{4})$/); // Jun 2025, September 2025
  if (m) {
    const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mon ? ym(+m[2], mon) : ym(+m[2], yearOnlyMonth);
  }
  m = s.match(/^(\d{4})$/); // 2026
  if (m) return ym(+m[1], yearOnlyMonth);
  m = s.match(/\b(19[5-9]\d|20[0-4]\d)\b/); // anything else with a year in it
  if (m) return ym(+m[1], yearOnlyMonth);
  return null;
}

function ym(y: number, m: number): YM | null {
  if (y < 1940 || y > 2100 || m < 1 || m > 12) return null;
  return { y, m };
}

/**
 * A LinkedIn date range: "Jun 2025 - Sep 2025 · 4 mos", "Sep 2025 - Present · 1 yr 1 mo",
 * "Sep 2022 – 2026", "2019 - 2023". Year-only ends count as the end of that school/work year (June).
 */
export function parseRange(input: unknown): { start: YM | null; end: YM | null; current: boolean } {
  const none = { start: null, end: null, current: false };
  if (input == null) return none;
  const s = String(input).split("·")[0].trim(); // drop "· 1 yr 4 mos"
  if (!s) return none;
  const parts = s.split(/\s+(?:-|–|—|to)\s+|\s*[–—]\s*/).filter(Boolean);
  const start = parseYM(parts[0], 9); // year-only start: school/job years usually start in the fall
  const endRaw = parts.length > 1 ? parseYM(parts[1], 6) : null;
  return {
    start: start === "present" ? null : start,
    end: endRaw === "present" ? null : endRaw,
    current: endRaw === "present",
  };
}

export function toMonths(d: YM): number {
  return d.y * 12 + (d.m - 1);
}

export function fromMonths(n: number): YM {
  return { y: Math.floor(n / 12), m: (n % 12) + 1 };
}

export function nowYM(asOf?: Date): YM {
  const d = asOf ?? new Date();
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

/** Months between two dates (b - a), never negative. */
export function monthsBetween(a: YM, b: YM): number {
  return Math.max(0, toMonths(b) - toMonths(a));
}

export function fmtYM(d: YM | null): string {
  if (!d) return "?";
  return `${d.y}-${String(d.m).padStart(2, "0")}`;
}
