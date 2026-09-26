// Net worth estimator. See PLAN.md "Net worth".
//
//   normalize (tables or scraper raw) -> classify jobs -> salary evidence (levels.fyi, Firecrawl)
//   -> rules simulation (low / mid / high) -> Claude review (optional) -> { low, high, reasoning, sources }
//
// Works without any keys: no FIRECRAWL_API_KEY = levels.fyi only, no LLM key = rules only.
import { buildTimeline } from "./classify";
import { quoteComp } from "./comp";
import { findCompEvidence, type EvidenceResult } from "./evidence";
import type { LanguageModel } from "ai";
import { applyParsedCareer, extractCareer, llmModel, MODEL_ID, refineWithClaude } from "./llm";
import { normalize, type PersonBundle } from "./normalize";
import { resolvePlace } from "./place";
import { simulate, usd, type Baseline } from "./simulate";
import type { Estimate, Source } from "./types";

export type EstimateOptions = {
  asOf?: Date;
  /** Look up salary evidence on the web (levels.fyi, plus Firecrawl if keyed). Default true. */
  search?: boolean;
  /** Ask Claude to review the baseline (needs ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY). Default true. */
  llm?: boolean;
  /** Let Claude look up more salaries itself (slower, more tokens). Default false. */
  deep?: boolean;
  /** Override the model (tests). */
  model?: LanguageModel;
  log?: (msg: string) => void;
  signal?: AbortSignal;
};

const US_HUB = resolvePlace("San Francisco Bay Area", "United States");

/** Estimate one person. Null = not enough information (no row, grey sim). */
export async function estimateNetWorth(bundle: PersonBundle, opts: EstimateOptions = {}): Promise<Estimate | null> {
  const log = opts.log;
  let profile = normalize(bundle);
  const useLlm = opts.llm !== false && !!llmModel(opts.model);

  // No scraped work history (connection cards, bios only): let Claude read the headline into jobs.
  const hasHistory = profile.inputs.some((i) => i === "experiences" || i.endsWith(".experience"));
  if (useLlm && !hasHistory) {
    try {
      const parsed = await extractCareer(profile, { model: opts.model, log, signal: opts.signal });
      if (parsed) profile = applyParsedCareer(profile, parsed);
    } catch (e) {
      log?.(`headline parsing failed: ${(e as Error).message}`);
    }
  }
  const tl = buildTimeline(profile, opts.asOf);
  const place = resolvePlace(profile.location, profile.country);
  log?.(`${profile.name}: ${tl.positions.length} jobs, ${profile.education.length} schools, age ~${tl.age ?? "?"}${tl.student ? ", student" : ""}; inputs ${profile.inputs.join(", ") || "none"}`);

  // ---------- salary evidence for the current job ----------
  let ev: EvidenceResult = { evidence: [], pick: null };
  let currentTC: { tc: number; basis: string } | null = null;
  const cur = tl.current;
  if (opts.search !== false && cur && cur.kind !== "parttime") {
    const table = quoteComp({ companyKey: cur.companyKey, tier: cur.tier, family: cur.family, level: cur.level, title: cur.title, place: US_HUB, yearsAgo: 0 });
    try {
      ev = await findCompEvidence(cur, { yoe: tl.fulltimeMonths / 12, tableTC: table.tc, companyKey: cur.companyKey, log, signal: opts.signal });
    } catch (e) {
      log?.(`evidence failed: ${(e as Error).message}`);
    }
    if (ev.pick) {
      // levels.fyi numbers are US medians today: scale to the person's place. The simulation applies
      // the premium over our table to the whole job.
      const mult = ["swe", "data", "pm", "design", "hardware", "research"].includes(cur.family) ? place.techMult : place.generalMult / 1.35;
      currentTC = { tc: ev.pick.tc * mult, basis: ev.pick.basis };
    }
  }

  // ---------- rules baseline ----------
  const base = simulate(profile, tl, { currentTC });
  if (!base) {
    log?.("not enough information: no estimate");
    return null;
  }
  log?.(`baseline ${usd(base.low)} / ${usd(base.mid)} / ${usd(base.high)} (${base.confidence})`);

  const sources: Source[] = [
    { type: "rules", label: `Career model (pay tables, taxes, cost of living, savings, market returns): ${base.notes.slice(0, 3).join("; ")}` },
    ...ev.evidence.slice(0, 4).map((e) => evidenceSource(e)),
  ];
  const debug: Record<string, unknown> = {
    baseline: { low: base.low, mid: base.mid, high: base.high, confidence: base.confidence },
    streams: base.streams.map((s) => `${s.label} [${s.kind}] ${usd(s.monthly.mid * 12)}/yr (${s.basis})`),
    age: tl.age,
    place: base.place.label,
  };

  // ---------- Claude review ----------
  if (useLlm) {
    try {
      const r = await refineWithClaude(profile, tl, base, ev.evidence, { deep: opts.deep, model: opts.model, log, signal: opts.signal });
      if (r) {
        for (const e of r.looked_up.slice(0, 4)) sources.push(evidenceSource(e));
        sources.push({
          type: "llm",
          label: `Claude (${MODEL_ID}) review, ${r.confidence} confidence${r.adjustments.length ? `: ${r.adjustments.join("; ").slice(0, 300)}` : ": kept the baseline"}${r.clamped ? " (clamped to the model's range)" : ""}`,
        });
        debug.llm = { low: r.low, high: r.high, confidence: r.confidence, adjustments: r.adjustments, clamped: r.clamped };
        return { low: r.low, high: r.high, reasoning: r.reasoning.slice(0, 500), sources, debug };
      }
    } catch (e) {
      log?.(`claude failed, keeping the rules estimate: ${(e as Error).message}`);
      debug.llmError = (e as Error).message;
    }
  }

  return { low: base.low, high: base.high, reasoning: rulesReasoning(base), sources, debug };
}

function evidenceSource(e: EvidenceResult["evidence"][number]): Source {
  const label =
    e.source === "levels.fyi"
      ? `levels.fyi: ${e.company}${e.title ? ` ${e.title}` : ""}, ${e.snippet ?? ""} (Data source: Levels.fyi)`
      : `${e.source}: ${e.company}${e.title ? ` ${e.title}` : ""}, ${e.snippet ?? ""}`;
  return { type: e.source === "levels.fyi" ? "levels.fyi" : e.source === "glassdoor" ? "glassdoor" : "web", label: label.slice(0, 300), url: e.url ?? undefined, value: e.medianTC ?? undefined };
}

function rulesReasoning(b: Baseline): string {
  const s = b.notes.slice(0, 4).join("; ");
  return s ? `${s[0].toUpperCase()}${s.slice(1)}.` : "Estimated from career history.";
}

/** Run `fn` over `items` with at most `n` at a time. */
export async function mapLimit<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export type { Baseline, PersonBundle };
