"use client";
// "Social Wrapped": 5 full-screen cards (Spotify Wrapped style), then the full portrait.
import { useEffect, useState } from "react";
import type { Analysis } from "@/lib/analysis";
import { templatePortrait } from "./Portrait";

const pct = (x: number) => `${Math.round(x * 100)}%`;

function cards(a: Analysis) {
  const first = a.nodes.filter((n) => n.degree === 1);
  const tribe = a.tribes.find((t) => t.name === a.egoTribe) ?? a.tribes[0];
  // the most homogeneous dimension; the big number matches its fact line (school facts talk about the top 2 schools)
  const shareOf = (d: "school" | "city") => (d === "school" ? a.bubbles.school.top2Share : a.bubbles.city.topShare);
  const dim = shareOf("school") >= shareOf("city") ? "school" : "city";
  const bubble = { ...a.bubbles[dim], top2Share: shareOf(dim) };
  // #1 bridge: someone whose tribes span your past AND your present
  const eraOf = new Map(a.tribes.map((t) => [t.name, t.era]));
  const spans = (n: (typeof first)[number]) => new Set([n.tribe, ...n.tribes].map((t) => eraOf.get(t))).size > 1;
  const bridge = [...first].filter((n) => n.isBridge).sort((x, y) => Number(spans(y)) - Number(spans(x)) || y.tribes.length - x.tribes.length)[0];
  const lostTribe = a.tribes.filter((t) => t.era === "past").sort((x, y) => y.size - x.size)[0];
  const lost = first.find((n) => n.era === "past" && n.tribe === lostTribe?.name && n.tie === "mutual");
  const portrait = templatePortrait(a);
  return [
    { bg: "from-sky-500 to-indigo-600", kicker: "Your tribe", big: tribe?.name ?? "?", sub: `${tribe?.size ?? 0} of your ${first.length} people. The group you actually belong to (confidence ${pct(tribe?.confidence ?? 0)}).` },
    { bg: "from-amber-400 to-rose-500", kicker: "Your bubble number", big: pct(bubble.top2Share), sub: bubble.fact },
    { bg: "from-emerald-400 to-teal-600", kicker: "Your #1 bridge", big: bridge?.name ?? "Nobody 🏝️",
      sub: bridge ? `${bridge.tribe}${bridge.tribes.length ? ` ↔ ${bridge.tribes.join(" ↔ ")}` : ""}. One of only ${a.pastVsPresent.bridges} people linking your two lives.` : "Your worlds never touch." },
    { bg: "from-slate-500 to-slate-800", kicker: "The friend you left behind", big: lost?.name ?? "Your past", sub: `${lostTribe?.name ?? "Your old crew"}. ${a.pastVsPresent.past.size} people from before are still in your network, fading 👻` },
    { bg: "from-fuchsia-500 to-rose-500", kicker: "Your archetype", big: portrait[0].big, sub: portrait[0].text },
  ];
}

export function Wrapped({ analysis, onDone, onPortrait }: { analysis: Analysis; onDone: () => void; onPortrait: () => void }) {
  const list = cards(analysis);
  const [i, setI] = useState(0);
  const next = () => (i < list.length - 1 ? setI(i + 1) : onPortrait());
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") setI((x) => Math.min(list.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
      if (e.key === "Escape") onDone();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [list.length, onDone]);
  const c = list[i];
  return (
    <div className={`absolute inset-0 z-[300] flex flex-col bg-gradient-to-br ${c.bg} p-6 text-white transition-colors duration-500`} onClick={next}>
      <div className="flex gap-1.5">
        {list.map((_, k) => <div key={k} className={`h-1 flex-1 rounded-full ${k <= i ? "bg-white" : "bg-white/30"}`} />)}
      </div>
      <button onClick={(e) => { e.stopPropagation(); onDone(); }} className="absolute right-6 top-8 text-3xl text-white/80" aria-label="Close">×</button>
      <div key={i} className="m-auto max-w-2xl animate-[fadeIn_.5s_ease] text-center">
        <div className="mb-3 text-sm font-bold uppercase tracking-[0.3em] text-white/80">{c.kicker}</div>
        <div className="mb-5 text-5xl font-black leading-tight drop-shadow sm:text-7xl">{c.big}</div>
        <p className="text-lg font-semibold text-white/90 sm:text-xl">{c.sub}</p>
      </div>
      <p className="text-center text-xs font-bold text-white/70">{i < list.length - 1 ? "Tap to continue" : "Tap to see your full portrait"}</p>
      <style>{"@keyframes fadeIn{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}"}</style>
    </div>
  );
}
