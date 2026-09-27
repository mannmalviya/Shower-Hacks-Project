// Model constants for the rules baseline. Sources: 2026 federal + 2025 CA tax brackets, BEA/BLS saving
// distributions, Damodaran S&P 500 / T-bill history, Fed SCF 2022, College Scorecard / Berkeley CDS,
// Census HVS, Carta. Researched 2026-09-26. All USD, 2026 dollars.

export type Scenario = "low" | "mid" | "high";

/** Piecewise-linear lookup over sorted [x, y] points (clamped at both ends). */
export function interpolate(points: readonly (readonly [number, number])[], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

// ---------- taxes: total effective rate (federal + FICA + state), single filer, W-2 ----------

export const TAX_CA: [number, number][] = [
  [0, 0.08], [20_000, 0.11], [50_000, 0.187], [80_000, 0.239], [120_000, 0.294], [180_000, 0.336],
  [250_000, 0.356], [400_000, 0.401], [700_000, 0.444], [1_000_000, 0.469], [5_000_000, 0.49],
];
/** WA, TX, FL, NV, TN... */
export const TAX_NO_STATE: [number, number][] = [
  [0, 0.08], [20_000, 0.096], [50_000, 0.153], [80_000, 0.186], [120_000, 0.223], [180_000, 0.254],
  [250_000, 0.267], [400_000, 0.305], [700_000, 0.336], [1_000_000, 0.353], [5_000_000, 0.37],
];
/** Other US states: roughly between the two. */
export const TAX_US_OTHER: [number, number][] = TAX_CA.map(([x, y], i) => [x, (y + TAX_NO_STATE[i][1]) / 2]);

/** Rough personal effective rate by country (midpoint of researched ranges). */
export const TAX_COUNTRY: Record<string, number> = {
  uk: 0.3, canada: 0.3, germany: 0.39, singapore: 0.1, hong_kong: 0.09, china: 0.25, india: 0.22,
  south_korea: 0.2, taiwan: 0.15, japan: 0.25, france: 0.35, australia: 0.3, israel: 0.3, switzerland: 0.25,
};

// ---------- savings: save = clamp((1 - mpc) * (afterTax - floor * family), -5%, 75%) of after-tax ----------

export const SAVINGS = {
  /** Cost-of-living floor for a single renter (2026 $). */
  floor: {
    hcol: { low: 72_000, mid: 58_000, high: 45_000 }, // Bay Area, NYC, Seattle, Boston...
    us: { low: 50_000, mid: 40_000, high: 32_000 },
  },
  /** Share of income above the floor that is spent. */
  mpc: { low: 0.6, mid: 0.45, high: 0.3 },
  /** Floor multiplier by age (kids, bigger home): [maxAge, multiplier]. */
  family: {
    low: [[30, 1.0], [35, 1.2], [45, 1.5], [200, 1.7]],
    mid: [[30, 1.0], [35, 1.15], [45, 1.35], [200, 1.5]],
    high: [[30, 1.0], [35, 1.1], [45, 1.25], [200, 1.35]],
  } as Record<Scenario, [number, number][]>,
  minRate: -0.05,
  maxRate: 0.75,
  /** Students: rent is mostly covered (parents, aid, dorms), so they save a share of what they earn. */
  studentRate: { low: 0.05, mid: 0.2, high: 0.4 },
  /** Internship pay while in school: ~$5k / $12k / $22k saved per big tech summer. */
  internRate: { low: 0.2, mid: 0.45, high: 0.7 },
  /** Cost of living fell ~3%/yr going back in time. */
  floorDeflator: 0.03,
};

// ---------- returns ----------

/** S&P 500 total return by year (Damodaran). */
export const SP500: Record<number, number> = {
  1990: -0.0306, 1991: 0.3023, 1992: 0.0749, 1993: 0.0997, 1994: 0.0133, 1995: 0.372, 1996: 0.2268, 1997: 0.331,
  1998: 0.2834, 1999: 0.2089, 2000: -0.0903, 2001: -0.1185, 2002: -0.2197, 2003: 0.2836, 2004: 0.1074, 2005: 0.0483,
  2006: 0.1561, 2007: 0.0548, 2008: -0.3655, 2009: 0.2594, 2010: 0.1482, 2011: 0.021, 2012: 0.1589, 2013: 0.3215,
  2014: 0.1352, 2015: 0.0138, 2016: 0.1177, 2017: 0.2161, 2018: -0.0423, 2019: 0.3121, 2020: 0.1802, 2021: 0.2847,
  2022: -0.1804, 2023: 0.2606, 2024: 0.2488, 2025: 0.1778,
};
export const TBILL: Record<number, number> = {
  1990: 0.0775, 1991: 0.0554, 1992: 0.0351, 1993: 0.0307, 1994: 0.0437, 1995: 0.0566, 1996: 0.0515, 1997: 0.052,
  1998: 0.0491, 1999: 0.0478, 2000: 0.06, 2001: 0.0348, 2002: 0.0164, 2003: 0.0103, 2004: 0.014, 2005: 0.0322,
  2006: 0.0485, 2007: 0.0448, 2008: 0.014, 2009: 0.0015, 2010: 0.0014, 2011: 0.0005, 2012: 0.0009, 2013: 0.0006,
  2014: 0.0003, 2015: 0.0005, 2016: 0.0032, 2017: 0.0095, 2018: 0.0197, 2019: 0.0211, 2020: 0.0036, 2021: 0.0004,
  2022: 0.0209, 2023: 0.0528, 2024: 0.0518, 2025: 0.0421,
};
export const FUTURE_RETURN = { equity: 0.06, cash: 0.035 };
/** Share of savings invested in stocks (the rest sits in cash). */
export const INVESTED = { low: 0.3, mid: 0.6, high: 0.9 };
export const DEBT_INTEREST = 0.06;

export function yearReturn(year: number, s: Scenario): number {
  const eq = SP500[year] ?? (year < 1990 ? 0.1 : FUTURE_RETURN.equity);
  const cash = TBILL[year] ?? (year < 1990 ? 0.05 : FUTURE_RETURN.cash);
  return INVESTED[s] * eq + (1 - INVESTED[s]) * cash;
}

// ---------- comp over time ----------

/** Pay grows ~3.5%/yr in tech, ~3% elsewhere. Used to deflate 2026 medians for older jobs. */
export const WAGE_GROWTH = { tech: 0.035, general: 0.03 };

// ---------- student debt (negative starting balance at graduation) ----------

export const STUDENT_DEBT: Record<string, Record<Scenario, number>> = {
  ba: { low: -20_000, mid: -8_000, high: 0 },
  mba: { low: -130_000, mid: -77_000, high: 0 },
  jd: { low: -160_000, mid: -107_000, high: 0 },
  md: { low: -230_000, mid: -205_000, high: -50_000 },
};

// ---------- students ----------

export const STUDENT = {
  /** Undergrad with no paid work: checking account +/- loans. */
  base: { low: 0, mid: 3_000, high: 15_000 },
  highSchool: { low: 0, mid: 500, high: 5_000 },
  /** Part-time campus job (TA, tutor, barista): gross per month. */
  parttimeMonthly: 1_800,
};

// ---------- housing (high scenario only: gain on the borrowed part of a home) ----------

export const HOUSING = {
  minAge: 32,
  price: { hcol: 1_400_000, us: 420_000 },
  downPayment: 0.2,
  appreciation: 0.03,
};

// ---------- founders (stage unknown: assume a seed-stage company) ----------

export const FOUNDER = {
  /** Founders pay themselves a fraction of market salary. */
  salaryShare: { low: 0.3, mid: 0.5, high: 0.8 },
  /** Paper value of a seed-stage stake: ~28% (half of 56% founder-team ownership) of a ~$20M post-money. */
  paperValue: 5_600_000,
  /** Student / stealth / pre-seed projects: a small stake in something unfunded. */
  earlyPaperValue: 400_000,
  paperMultiplier: { low: 0, mid: 0.05, high: 0.25 },
  /** Known later-stage / public companies founded by the person: the LLM step should handle these. */
};

// ---------- private company equity (AI labs, pre-IPO unicorns) ----------

/** TC counts private stock at paper value. Low case discounts it for illiquidity; high case adds growth. */
export const PRIVATE_EQUITY = { low: 0.85, mid: 1.0, high: 1.15 };

// ---------- Fed SCF 2022 household net worth by age (2022 $), scaled x1.2 to 2026 ----------

export const SCF_BY_AGE: { maxAge: number; p25: number; median: number; p75: number; p90: number }[] = [
  { maxAge: 24, p25: 88, median: 10_222, p75: 33_898, p90: 184_516 },
  { maxAge: 29, p25: 3_784, median: 31_470, p75: 130_606, p90: 296_830 },
  { maxAge: 34, p25: 11_016, median: 88_631, p75: 186_140, p90: 538_750 },
  { maxAge: 44, p25: 19_100, median: 135_600, p75: 415_000, p90: 1_049_700 },
  { maxAge: 54, p25: 51_300, median: 247_200, p75: 800_000, p90: 1_973_600 },
  { maxAge: 64, p25: 81_800, median: 364_500, p75: 1_122_200, p90: 2_960_900 },
  { maxAge: 74, p25: 87_000, median: 409_900, p75: 1_176_100, p90: 2_997_400 },
  { maxAge: 200, p25: 93_600, median: 335_600, p75: 975_200, p90: 2_699_000 },
];
export const SCF_TO_2026 = 1.2;

export function scfForAge(age: number) {
  const row = SCF_BY_AGE.find((r) => age <= r.maxAge) ?? SCF_BY_AGE[SCF_BY_AGE.length - 1];
  return {
    p25: row.p25 * SCF_TO_2026,
    median: row.median * SCF_TO_2026,
    p75: row.p75 * SCF_TO_2026,
    p90: row.p90 * SCF_TO_2026,
  };
}

// ---------- places ----------

/** Cost-of-living class and state tax regime from a US location string. */
export const HCOL_RE =
  /san francisco|bay area|\bsf\b|san jose|oakland|berkeley|palo alto|mountain view|sunnyvale|menlo park|cupertino|santa clara|redwood city|san mateo|fremont|new york|nyc|manhattan(?!,? (ks|kansas)\b)|brooklyn|seattle|bellevue|redmond|boston|cambridge, ma|los angeles|(?<!,\s*)\bla\b|santa monica|washington,?\s*d\.?c|district of columbia|san diego/i;
/** High-cost cities abroad. */
export const HCOL_ABROAD_RE = /\b(london|zurich|zürich|singapore|hong kong)\b/i;
export const NO_STATE_TAX_RE = /\b(washington(?!,?\s*(d\.?c|district of columbia))|seattle|bellevue|redmond|texas|austin|dallas|houston|florida|miami|nevada|las vegas|tennessee|nashville|wyoming|south dakota|alaska|new hampshire)\b|,\s*(wa|tx|fl|nv|tn|wy|sd|ak|nh)\b/i;
export const CALIFORNIA_RE = /california|,\s*ca\b|bay area|san francisco|los angeles|san diego|san jose|oakland|berkeley|palo alto|mountain view|sunnyvale|cupertino|santa clara/i;

/** Country detection -> [techPayVsUS, generalWageVsUS, priceLevel]. */
export const COUNTRIES: { key: string; re: RegExp; tech: number; general: number; price: number }[] = [
  { key: "canada", re: /\b(canada|toronto|vancouver|montreal|ontario|british columbia|waterloo)\b/i, tech: 0.55, general: 0.75, price: 0.82 },
  { key: "uk", re: /\b(united kingdom|uk|england|london|scotland|manchester|cambridge, uk|oxford)\b/i, tech: 0.55, general: 0.72, price: 0.87 },
  { key: "germany", re: /\b(germany|deutschland|berlin|munich|münchen|hamburg)\b/i, tech: 0.45, general: 0.72, price: 0.8 },
  { key: "france", re: /\b(france|paris)\b/i, tech: 0.4, general: 0.65, price: 0.8 },
  { key: "switzerland", re: /\b(switzerland|zurich|zürich|geneva)\b/i, tech: 0.8, general: 1.2, price: 1.1 },
  { key: "israel", re: /\b(israel|tel aviv)\b/i, tech: 0.6, general: 0.7, price: 0.9 },
  { key: "india", re: /\b(india|bengaluru|bangalore|mumbai|hyderabad|delhi|pune|chennai|gurgaon|noida)\b/i, tech: 0.22, general: 0.06, price: 0.235 },
  { key: "china", re: /\b(china|beijing|shanghai|shenzhen|guangzhou|guangdong|hangzhou|chengdu|wuhan|nanjing)\b/i, tech: 0.35, general: 0.2, price: 0.49 },
  { key: "hong_kong", re: /\bhong kong\b/i, tech: 0.6, general: 0.45, price: 0.72 },
  { key: "taiwan", re: /\b(taiwan|taipei|hsinchu)\b/i, tech: 0.25, general: 0.3, price: 0.44 },
  { key: "south_korea", re: /\b(korea|seoul)\b/i, tech: 0.3, general: 0.47, price: 0.57 },
  { key: "japan", re: /\b(japan|tokyo|osaka)\b/i, tech: 0.35, general: 0.45, price: 0.6 },
  { key: "singapore", re: /\bsingapore\b/i, tech: 0.6, general: 0.7, price: 0.63 },
  { key: "australia", re: /\b(australia|sydney|melbourne)\b/i, tech: 0.55, general: 0.82, price: 0.85 },
  { key: "brazil", re: /\b(brazil|brasil|são paulo|sao paulo)\b/i, tech: 0.2, general: 0.1, price: 0.45 },
  { key: "mexico", re: /\b((?<!new )mexico(?! city, nm)|ciudad de méxico|guadalajara)\b/i, tech: 0.22, general: 0.12, price: 0.5 },
  { key: "vietnam", re: /\b(vietnam|hanoi|ho chi minh)\b/i, tech: 0.12, general: 0.05, price: 0.35 },
  { key: "philippines", re: /\b(philippines|manila)\b/i, tech: 0.1, general: 0.05, price: 0.35 },
  { key: "nigeria", re: /\b(nigeria|lagos)\b/i, tech: 0.1, general: 0.02, price: 0.3 },
];

/** Occupations (BLS national medians) by US region. Company / tier comp already assumes a tech hub. */
export const REGION_OCCUPATION: [RegExp, number][] = [
  [/san francisco|bay area|san jose|oakland|berkeley|palo alto|mountain view|sunnyvale|santa clara|cupertino|fremont|redwood city|san mateo/i, 1.35],
  [/new york|nyc|manhattan(?!,? (ks|kansas)\b)|brooklyn/i, 1.25],
  [/seattle|bellevue|redmond|boston|washington,?\s*d\.?c|district of columbia/i, 1.25],
  [/los angeles|santa monica/i, 1.15],
  [/san diego/i, 1.1],
  [/austin/i, 1.05],
];
/** Tech pay outside the hubs (US). */
export const TECH_OUTSIDE_HUBS = 0.88;
