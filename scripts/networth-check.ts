// Sanity check for the rules model: synthetic people vs. targets from the research that set the
// model's constants (assumptions.ts). Rules only: no web, no LLM. Run: pnpm networth:check
import { MockLanguageModelV4 } from "ai/test";
import { estimateNetWorth } from "../src/lib/networth";
import type { PersonBundle } from "../src/lib/networth/normalize";

const AS_OF = new Date("2026-09-26T00:00:00Z");
type Job = [title: string, company: string, start: string, end: string | null];
type School = [school: string, degree: string, start: string, end: string];

function person(name: string, location: string, jobs: Job[], schools: School[]): PersonBundle {
  const id = name.toLowerCase().replace(/\W+/g, "-");
  return {
    person: { id, name, headline: null, location, country: "United States", raw: {} },
    experiences: jobs.map(([title, company, start_date, end_date], i) => ({ person_id: id, title, company, start_date, end_date, is_primary: i === 0 })),
    education: schools.map(([school, degree, start_date, end_date]) => ({ person_id: id, school, degree, start_date, end_date })),
    social_profiles: [],
  };
}

const BAY = "San Francisco Bay Area";
const HS = (end: number): School => ["Lynbrook High School", "High School Diploma", `${end - 4}-08-01`, `${end}-06-01`];

// [label, bundle, target low / mid / high]
const CASES: [string, PersonBundle, [number, number, number]][] = [
  ["Berkeley sophomore, no internship", person("Soph", BAY, [], [["UC Berkeley", "BS", "2025-08-01", "2029-05-01"], HS(2025)]), [-10_000, 3_000, 20_000]],
  ["Sophomore after a Google internship", person("Soph Intern", BAY, [["Software Engineer Intern", "Google", "2026-06-01", "2026-08-01"]], [["UC Berkeley", "BS", "2024-08-01", "2028-05-01"], HS(2024)]), [0, 15_000, 40_000]],
  ["Google new grad, 5 months in, 2 internships", person("New Grad", BAY, [
    ["Software Engineer", "Google", "2026-05-01", null],
    ["Software Engineer Intern", "Meta", "2025-06-01", "2025-08-01"],
    ["Software Engineer Intern", "Google", "2024-06-01", "2024-08-01"],
  ], [["UC Berkeley", "BS", "2022-08-01", "2026-05-01"], HS(2022)]), [-2_000, 33_000, 72_000]],
  ["Meta SWE, 26, 4 years", person("Meta E4", BAY, [["Software Engineer", "Meta", "2022-07-01", null]], [["UC Berkeley", "BS", "2018-08-01", "2022-05-01"]]), [172_000, 340_000, 557_000]],
  ["Quant new grad, 2 years", person("Quant", "New York, NY", [["Software Engineer", "Jane Street", "2024-07-01", null]], [["MIT", "BS", "2020-08-01", "2024-05-01"]]), [121_000, 230_000, 351_000]],
  ["Non-tech, 28, ~$80k, Bay Area, 6 years", person("Coordinator", BAY, [["Operations Coordinator", "Acme Logistics", "2020-07-01", null]], [["San Jose State University", "BA", "2016-08-01", "2020-05-01"]]), [-24_000, 14_000, 106_000]],
  ["Mid SWE at a non-big-tech company, 30, 8 years", person("Mid SWE", BAY, [["Software Engineer", "Acme Software", "2018-07-01", null]], [["UC Davis", "BS", "2014-08-01", "2018-05-01"]]), [151_000, 328_000, 599_000]],
  ["Staff engineer, big tech, 35, 13 years", person("Staff", BAY, [
    ["Staff Software Engineer", "Google", "2021-07-01", null],
    ["Senior Software Engineer", "Google", "2017-07-01", "2021-06-01"],
    ["Software Engineer", "Google", "2013-07-01", "2017-06-01"],
  ], [["UC Berkeley", "BS", "2009-08-01", "2013-05-01"]]), [1_210_000, 2_200_000, 3_640_000]],
  ["Non-tech director, 50", person("Director", BAY, [
    ["Director of Operations", "Kaiser Permanente", "2014-01-01", null],
    ["Operations Manager", "Kaiser Permanente", "2005-01-01", "2013-12-01"],
    ["Operations Analyst", "Kaiser Permanente", "1998-07-01", "2004-12-01"],
  ], [["UC Davis", "BA", "1994-08-01", "1998-05-01"]]), [186_000, 982_000, 2_800_000]],
  ["Big tech director, 50", person("Big Director", BAY, [
    ["Director of Engineering", "Google", "2014-01-01", null],
    ["Engineering Manager", "Google", "2006-01-01", "2013-12-01"],
    ["Software Engineer", "Microsoft", "1998-07-01", "2005-12-01"],
  ], [["UC Berkeley", "BS", "1994-08-01", "1998-05-01"]]), [2_680_000, 5_690_000, 10_960_000]],
  ["PhD student, 5 years on a stipend", person("PhD", BAY, [["Graduate Student Researcher", "UC Berkeley", "2021-08-01", null]], [["UC Berkeley", "PhD, Computer Science", "2021-08-01", "2027-05-01"], ["UCLA", "BS", "2017-08-01", "2021-05-01"]]), [-24_000, -11_000, 3_000]],
];

const usd = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1e3)}k`);

async function main() {
  let off = 0;
  for (const [label, bundle, [tl, tm, th]] of CASES) {
    const est = await estimateNetWorth(bundle, { asOf: AS_OF, search: false, llm: false });
    if (!est) {
      console.log(`✗ ${label}: no estimate`);
      off++;
      continue;
    }
    const mid = (est.debug?.baseline as { mid: number }).mid;
    // Pass when our mid is within 2x of the target mid (or both are small) and the ranges overlap.
    const small = Math.abs(tm) < 20_000 && mid < 40_000;
    const ok = (small || (mid >= tm / 2 && mid <= tm * 2)) && est.high >= Math.max(0, tl) && est.low <= th;
    if (!ok) off++;
    console.log(`${ok ? "✓" : "✗"} ${label.padEnd(46)} ours ${usd(est.low)} / ${usd(mid)} / ${usd(est.high)}   target ${usd(tl)} / ${usd(tm)} / ${usd(th)}`);
  }
  console.log(`\n${CASES.length - off}/${CASES.length} within tolerance`);
  off += await checkLlmPlumbing();
  process.exit(off ? 1 : 0);
}

// ---------- LLM plumbing with a mock model (no key needed) ----------

function mockModel(reply: (prompt: string) => object | Error) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      const r = reply(JSON.stringify(options.prompt));
      if (r instanceof Error) throw r;
      return {
        content: [{ type: "text", text: JSON.stringify(r) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 20, text: 20, reasoning: undefined } },
        warnings: [],
      };
    },
  });
}

async function checkLlmPlumbing(): Promise<number> {
  let bad = 0;
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? "✓" : "✗"} ${what}`);
    if (!ok) bad++;
  };
  console.log("\nLLM plumbing (mock model):");

  // Headline-only person: Claude parses the headline into jobs, the rules price them, Claude's
  // absurd answer gets clamped to the rules range.
  const headlineOnly: PersonBundle = { person: { id: "h", name: "Headline Only", headline: "Ex-Google ✨ TypeScript Engineer 🧪", location: "San Francisco Bay Area", raw: {} } };
  const model = mockModel((prompt) =>
    prompt.includes("Profile text (JSON)")
      ? { student: false, jobs: [{ title: "TypeScript Engineer", company: "Unknown", current: true, start_year: 2021, end_year: null }, { title: "Software Engineer", company: "Google", current: false, start_year: 2018, end_year: 2021 }], schools: [] }
      : { low: 1, high: 50_000_000_000, reasoning: "Mock reasoning.", confidence: "high", adjustments: ["mock"] },
  );
  const est = await estimateNetWorth(headlineOnly, { asOf: AS_OF, search: false, model });
  const base = est?.debug?.baseline as { low: number; mid: number; high: number } | undefined;
  check(!!est && !!base, "headline-only person gets an estimate after Claude parses the headline");
  if (est && base) {
    check(est.high <= Math.max(base.high * 4, base.mid * 6, 50_000) && est.low >= base.low * 0.25 - 1, `absurd Claude answer clamped: ${usd(est.low)} – ${usd(est.high)} (rules ${usd(base.low)} – ${usd(base.high)})`);
    check(est.reasoning === "Mock reasoning." && est.sources.some((s) => s.type === "llm"), "Claude reasoning and source saved");
  }

  // Claude failing must fall back to the rules estimate, not crash.
  const failing = mockModel(() => new Error("mock API failure"));
  const bundle = CASES[3][1];
  const fallback = await estimateNetWorth(bundle, { asOf: AS_OF, search: false, model: failing });
  check(!!fallback && !fallback.sources.some((s) => s.type === "llm"), "Claude failure falls back to the rules estimate");

  // Featherless (OpenAI-compatible) with a fake fetch: request shape + repair of fenced / chatty JSON.
  const saved = { key: process.env.FEATHERLESS_API_KEY, fetch: globalThis.fetch };
  process.env.FEATHERLESS_API_KEY = "test";
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!String(url).startsWith("https://api.featherless.ai/")) return saved.fetch(url, init);
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const prompt = JSON.stringify(body.messages);
    const answer = prompt.includes("Profile text (JSON)")
      ? { student: false, jobs: [{ title: "Software Engineer", company: "Stripe", current: true, start_year: 2021, end_year: null }], schools: [] }
      : { low: 250000, high: 700000, reasoning: "Featherless reasoning.", confidence: "medium", adjustments: [] };
    const content = `Sure! Here is the JSON:\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``;
    return new Response(JSON.stringify({ id: "x", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const fe = await estimateNetWorth(headlineOnly, { asOf: AS_OF, search: false });
    const first = bodies[0] ?? {};
    check(bodies.length === 2, `Featherless called for parse + review (${bodies.length} requests)`);
    check((first.response_format as { type?: string } | undefined)?.type === "json_object" && !("reasoning_effort" in first) && JSON.stringify(first.messages).includes("JSON Schema"), "Featherless request: json_object mode, schema in prompt, no reasoning_effort");
    check(fe?.reasoning === "Featherless reasoning." && fe.sources.some((s) => s.type === "llm" && s.label.startsWith("Featherless (")), "fenced JSON repaired and saved with a Featherless source");
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.FEATHERLESS_API_KEY;
    else process.env.FEATHERLESS_API_KEY = saved.key;
  }
  return bad;
}
main();
