// Where someone lives -> pay multipliers, cost of living and tax regime.
import {
  CALIFORNIA_RE,
  COUNTRIES,
  HCOL_ABROAD_RE,
  HCOL_RE,
  NO_STATE_TAX_RE,
  REGION_OCCUPATION,
  TAX_CA,
  TAX_COUNTRY,
  TAX_NO_STATE,
  TAX_US_OTHER,
  TECH_OUTSIDE_HUBS,
  interpolate,
} from "./assumptions";

export type Place = {
  label: string; // for reasoning text
  country: string; // "us" or a COUNTRIES key
  /** Tech pay vs a US tech hub. */
  techMult: number;
  /** General wages vs the US national median (BLS). */
  generalMult: number;
  /** Cost-of-living class for the savings floor. */
  hcol: boolean;
  priceLevel: number;
  taxRate: (gross: number) => number;
  known: boolean;
};

const STATES =
  "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia";
const STATE_CODES =
  "al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc";
// US when it says so, or has a state after a comma ("Indianapolis, IN", "Berlin, CT", "Bloomington, Indiana").
const US_RE = new RegExp(
  String.raw`united states|\busa\b|\bu\.s\.|,\s*(${STATE_CODES}|${STATES})\b|\b(california|new york|washington|texas|massachusetts|illinois|colorado|oregon|georgia|district of columbia)\b`,
  "i",
);

export function resolvePlace(location: string | null, country: string | null): Place {
  const text = `${location ?? ""} ${country ?? ""}`.trim();

  if (!text) {
    // Unknown: most of our people are Bay Area students and tech workers.
    return { label: "location unknown (assumed Bay Area)", country: "us", techMult: 1, generalMult: 1.35, hcol: true, priceLevel: 1, taxRate: (g) => interpolate(TAX_CA, g), known: false };
  }

  // An explicit country beats city names in the location ("Washington, Tyne and Wear" + "United Kingdom").
  const byCountry = country && !US_RE.test(country) ? COUNTRIES.find((c) => c.re.test(country)) : undefined;
  const foreign = byCountry ?? (!US_RE.test(text) ? COUNTRIES.find((c) => c.re.test(text)) : undefined);
  if (foreign) {
    const rate = TAX_COUNTRY[foreign.key] ?? 0.25;
    return {
      label: foreign.key.replace("_", " "),
      country: foreign.key,
      techMult: foreign.tech,
      generalMult: foreign.general,
      hcol: HCOL_ABROAD_RE.test(text),
      priceLevel: foreign.price,
      // A bit progressive around the country average.
      taxRate: (g) => Math.max(0.05, Math.min(0.55, rate + (g > 150_000 ? 0.05 : g < 30_000 ? -0.07 : 0))),
      known: true,
    };
  }

  const hcol = HCOL_RE.test(text);
  const region = REGION_OCCUPATION.find(([re]) => re.test(text))?.[1] ?? 1;
  const tax = CALIFORNIA_RE.test(text) ? TAX_CA : NO_STATE_TAX_RE.test(text) ? TAX_NO_STATE : TAX_US_OTHER;
  return {
    label: location ?? country ?? "US",
    country: "us",
    techMult: hcol ? 1 : TECH_OUTSIDE_HUBS,
    generalMult: region,
    hcol,
    priceLevel: 1,
    taxRate: (g) => interpolate(tax, g),
    known: true,
  };
}
