"use client";
// "My portrait": 3 blocks. Offline templates for now; the Claude route will replace the text
// (it gets analysis.portraitInput: aggregates only, no names).
import type { Analysis } from "@/lib/analysis";

const pct = (x: number | null | undefined) => (x == null ? "?" : `${Math.round(x * 100)}%`);
const money = (n: number | null | undefined) =>
  n == null ? "?" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${n}`;

export function templatePortrait(a: Analysis) {
  const { bubbles: b, class: c, tribes } = a;
  const hobbies = tribes.filter((x) => /^(⚽|🎹|🎨|🤖|🛹)/.test(x.name));
  const techShare = b.industry.groups.find((g) => g.value === "Tech")?.share ?? 0;
  const archetype = hobbies.length >= 2 && techShare > 0.3
    ? "The jack-of-all-trades tech bro"
    : techShare > 0.5 ? "The tech monk" : b.circle.diversity > 80 ? "The social butterfly" : "The loyal tribe member";
  const topCircle = b.circle.groups[0];
  return [
    {
      title: "Who you are",
      big: archetype,
      text: hobbies.length
        ? `Your tribes include ${hobbies.map((h) => h.name).join(", ")}. Yet ${pct(b.interest.groups[0]?.share)} of your people share one thing: ${b.interest.groups[0]?.value}.`
        : `Your crowd's #1 thing is ${b.interest.groups[0]?.value ?? "a mystery"}.`,
    },
    {
      title: "Your group",
      big: `${topCircle?.value ?? "?"} (${pct(topCircle?.share)})`,
      text: `${b.school.fact} ${b.city.fact} ${b.industry.fact} ${pct(a.ties.mutualShare)} of your links are mutual, and you follow ${a.ties.aspiration} people who don't follow you back.`,
    },
    {
      title: "What it represents",
      big: c.vsUsMedian != null ? `${c.vsUsMedian.toFixed(1)}× the US median` : "Unknown class",
      text: `The working people around you are worth ${money(c.workingMedian)} (median). You: ${money(c.ego?.mid)}. ` +
        (c.projected ? `The ghost stack next to you is who you're heading toward: ${money(c.projected.mid)}. ` : "") +
        `${pct(c.unknownShare)} of your network is invisible to the algorithm.`,
    },
  ];
}

export function Portrait({ analysis, onClose }: { analysis: Analysis; onClose: () => void }) {
  const blocks = templatePortrait(analysis);
  return (
    <div className="absolute inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-3xl border-4 border-rose-400 bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-2xl font-black text-rose-500">🪞 Your portrait</h2>
          <button onClick={onClose} className="text-2xl text-slate-400" aria-label="Close">×</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {blocks.map((b, i) => (
            <div key={b.title} className="rounded-2xl bg-slate-50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{i + 1}. {b.title}</div>
              <div className="my-1 text-lg font-black leading-tight text-slate-800">{b.big}</div>
              <p className="text-sm text-slate-600">{b.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
