"use client";
// The social mirror: an open Mii world of your network. Walk among your tribes; every category reorganizes the world.
import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Analysis, Dimension, Node } from "@/lib/analysis";
import { Crowd, type CrowdState } from "./Crowd";
import { Ghosts } from "./Ghosts";
import { LabelProjector, type Anchor } from "./Labels";
import { Landmarks } from "./Landmarks";
import { Player, stackHeight } from "./Player";
import { Portrait } from "./Portrait";
import { Terrain } from "./Terrain";
import { TribeArcs, tribeLinks } from "./TribeArcs";
import { CATEGORIES, TERRAIN_SEG, computeWorld, coverage, heightAt, keysOf, type Category } from "./worldLayout";

const money = (n: number | null | undefined) =>
  n == null ? "?" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${n}`;
const FACT_DIM: Partial<Record<Category, Dimension>> = {
  tribe: "tribe", places: "circle", wealthTier: "wealthTier", school: "school", city: "city", industry: "industry", platform: "platform",
};

export default function World({ analysis, links }: { analysis: Analysis; links: [string, string][] }) {
  const [category, setCategory] = useState<Category>("tribe");
  const [follow, setFollow] = useState(false); // V1: orbit camera by default, walking is opt-in
  const [showSecond, setShowSecond] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [nearest, setNearest] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null); // a group (tribe, school...) the camera flew to
  const [query, setQuery] = useState("");
  const [portrait, setPortrait] = useState(false);

  const byId = useMemo(() => new Map(analysis.nodes.map((n) => [n.id, n])), [analysis]);
  const cover = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c.key, coverage(analysis, c.key)])) as Record<Category, number>, [analysis]);
  const layout = useMemo(() => computeWorld(analysis, links, category), [analysis, links, category]);
  const crowdNodes = useMemo(() => analysis.nodes.filter((n) => n.degree === 1), [analysis]);
  const ghostNodes = useMemo(() => analysis.nodes.filter((n) => n.degree === 2), [analysis]);
  const arcs = useMemo(() => tribeLinks(analysis.nodes, links), [analysis, links]);
  const byTribe = category === "tribe" || category === "lifemap";
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [a, b] of links) {
      (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
      (m.get(b) ?? m.set(b, new Set()).get(b)!).add(a);
    }
    return m;
  }, [links]);

  // shared mutable world state (no re-renders per frame)
  const heights = useRef(new Float32Array((TERRAIN_SEG + 1) ** 2));
  const playerPos = useRef(new THREE.Vector3(layout.ego.x, 0, layout.ego.z));
  const walkTo = useRef<THREE.Vector3 | null>(null);
  const keys = useRef(new Set<string>());
  const crowd = useRef<CrowdState | null>(null);
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const flyTo = useRef<{ x: number; y: number; z: number } | null>(null);
  const labelEls = useRef(new Map<string, HTMLElement>());
  const anchors = useRef(new Map<string, Anchor>());
  const bindLabel = useCallback((key: string) => (el: HTMLElement | null) => {
    if (el) labelEls.current.set(key, el);
    else labelEls.current.delete(key);
  }, []);
  const egoStack = stackHeight(analysis.class.ego?.mid);
  const ghostStack = analysis.class.projected ? stackHeight(analysis.class.projected.mid) : null;

  // where each label sits in 3D (read every frame by <LabelProjector>)
  useEffect(() => {
    const m = new Map<string, Anchor>();
    layout.groups.forEach((g, i) => {
      const y = heightAt(layout.heights, g.x, g.z) + 5.5;
      m.set(`g${i}`, () => [g.x, y, g.z]);
    });
    const p = playerPos.current;
    m.set("you", () => [p.x, p.y + egoStack + 4.6, p.z]);
    if (ghostStack != null) m.set("future", () => [p.x + 1.7, p.y + ghostStack + 0.7, p.z]);
    const axis = category === "lifemap" || category === "places";
    m.set("past", () => (axis ? [-60, 2, 40] : null));
    m.set("now", () => (axis ? [60, 2, 40] : null));
    m.set("near", () => {
      const c = crowd.current;
      const i = c && nearest ? c.ids.indexOf(nearest) : -1;
      return c && i >= 0 ? [c.x[i], c.y[i] + 4, c.z[i]] : null;
    });
    anchors.current = m;
  }, [layout, category, nearest, egoStack, ghostStack]);

  // on a new category, walk back to your spot in it
  useEffect(() => {
    walkTo.current = new THREE.Vector3(layout.ego.x, 0, layout.ego.z);
  }, [layout]);

  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement)?.tagName === "INPUT";
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const k = e.key.toLowerCase();
      keys.current.add(k);
      if (k === "e" && nearest) setSelected(nearest);
      if (k === "escape") setSelected(null);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [nearest]);

  const q = query.trim().toLowerCase();
  const dim = useMemo(() => {
    if (!selected && !q && !focus) return null;
    const s = new Set<string>();
    for (const n of analysis.nodes) {
      const keep = selected ? n.id === selected || neighbors.get(selected)?.has(n.id)
        : focus ? (byTribe ? n.tribe === focus || n.tribes.includes(focus) : n.degree === 1 && keysOf(n, category).includes(focus))
        : [n.name, n.company, n.school, n.city, n.tribe, n.industry].some((v) => v?.toLowerCase().includes(q));
      if (!keep) s.add(n.id);
    }
    return s;
  }, [analysis, selected, q, focus, neighbors, byTribe, category]);

  const onGround = useCallback((p: THREE.Vector3) => { walkTo.current = p.clone(); }, []);
  const focusGroup = (key: string | null) => {
    setFocus(key);
    setSelected(null);
    const g = key ? layout.groups.find((x) => x.key === key) : null;
    if (!g) return;
    setFollow(false);
    flyTo.current = { x: g.x, y: heightAt(layout.heights, g.x, g.z), z: g.z };
  };
  const toggleFollow = () => {
    if (follow && controls.current) controls.current.target.copy(playerPos.current);
    setFollow(!follow);
  };

  const sel = selected ? byId.get(selected) : null;
  const near = nearest ? byId.get(nearest) : null;
  const dimKey = FACT_DIM[category];
  const bubble = dimKey ? analysis.bubbles[dimKey] : null;
  const pp = analysis.pastVsPresent;
  const fact = category === "lifemap"
    ? `Past: ${pp.past.size} people (diversity ${pp.past.diversity}). Now: ${pp.present.size} (diversity ${pp.present.diversity}). Only ${pp.bridges} people bridge your two lives.`
    : bubble?.fact ?? "";
  const selLines = sel && layout.pos.has(sel.id)
    ? [...(neighbors.get(sel.id) ?? [])].filter((id) => layout.pos.has(id) && (showSecond || byId.get(id)?.degree !== 2)).map((id) => layout.pos.get(id)!)
    : [];

  return (
    <div className="fixed inset-0 select-none bg-sky-200">
      <Canvas shadows camera={{ position: [0, 70, 95], fov: 50 }} onPointerMissed={() => setSelected(null)}>
        <color attach="background" args={["#bfe6ff"]} />
        <fog attach="fog" args={["#bfe6ff", 120, 320]} />
        <hemisphereLight args={["#ffffff", "#88bb77", 1.1]} />
        <directionalLight position={[50, 90, 40]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-110} shadow-camera-right={110} shadow-camera-top={110} shadow-camera-bottom={-110} />

        <Terrain layout={layout} heights={heights} onGround={onGround} />
        {category === "places" && <Landmarks layout={layout} />}
        <Crowd nodes={crowdNodes} links={links} layout={layout} heights={heights} dim={dim} player={playerPos} walking={follow}
          state={crowd} onSelect={setSelected} onNearest={setNearest} />
        {showSecond && <Ghosts nodes={ghostNodes} layout={layout} heights={heights} onSelect={setSelected} />}
        {byTribe && !follow && <TribeArcs layout={layout} arcs={arcs} focus={focus} />}
        <CameraFly flyTo={flyTo} controls={controls} />
        <Player heights={heights} pos={playerPos} walkTo={walkTo} keys={keys} follow={follow} stack={egoStack} ghostStack={ghostStack} />
        <LabelProjector anchors={anchors} els={labelEls} />

        {sel && selLines.map((t, i) => {
          const s = layout.pos.get(sel.id)!;
          return <Line key={i} points={[[s.x, heightAt(layout.heights, s.x, s.z) + 1.6, s.z], [t.x, heightAt(layout.heights, t.x, t.z) + 1.6, t.z]]}
            color="#1d6fb8" lineWidth={1.5} transparent opacity={0.55} />;
        })}

        <OrbitControls ref={controls} enabled={!follow} maxPolarAngle={Math.PI / 2.2} minDistance={10} maxDistance={260} enableDamping />
      </Canvas>

      {/* labels overlay: moved every frame by <LabelProjector> */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {layout.groups.map((g, i) => (
          <div key={`${category}-${i}`} ref={bindLabel(`g${i}`)} style={{ borderColor: g.color, visibility: "hidden", background: focus === g.key ? g.color : undefined }}
            onClick={() => focusGroup(focus === g.key ? null : g.key)}
            className={`pointer-events-auto absolute left-0 top-0 cursor-pointer whitespace-nowrap rounded-full border-2 bg-white/95 px-3 py-0.5 text-xs font-extrabold shadow hover:scale-110 ${focus === g.key ? "text-white" : g.era === "past" && category === "lifemap" ? "text-slate-400" : "text-slate-700"}`}>
            {g.key} <span className="text-slate-400">{g.count}</span>
          </div>
        ))}
        <div ref={bindLabel("you")} style={{ visibility: "hidden" }}
          className="absolute left-0 top-0 whitespace-nowrap rounded-full bg-rose-500 px-3 py-0.5 text-xs font-extrabold text-white shadow">You</div>
        {analysis.class.projected && (
          <div ref={bindLabel("future")} style={{ visibility: "hidden" }}
            className="absolute left-0 top-0 whitespace-nowrap rounded-full bg-emerald-50/90 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
            future you? {money(analysis.class.projected.mid)}
          </div>
        )}
        {(["past", "now"] as const).map((side) => (
          <div key={side} ref={bindLabel(side)} style={{ visibility: "hidden" }}
            className="absolute left-0 top-0 whitespace-nowrap text-2xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]">
            {side === "past" ? "⬅ YOUR PAST" : "NOW ➡"}
          </div>
        ))}
        <div ref={bindLabel("near")} style={{ visibility: "hidden" }}
          className="absolute left-0 top-0 whitespace-nowrap rounded-full bg-slate-900/80 px-2 py-0.5 text-xs font-bold text-white">{near?.name}</div>
      </div>

      {/* HUD */}
      <div className="absolute left-4 top-4 z-[100] w-80 max-w-[calc(100vw-2rem)] rounded-3xl border-4 border-white bg-white/90 p-4 shadow-xl">
        <h1 className="text-xl font-black tracking-tight text-sky-600">Social Mirror 🚿</h1>
        <p className="mb-3 text-xs text-slate-500">Who you are, who your people are, and what they say about you.</p>
        <div className="mb-3 grid grid-cols-4 gap-1.5">
          {CATEGORIES.map((c) => {
            const off = cover[c.key] < 0.3;
            return (
              <button key={c.key} disabled={off} title={off ? "Not enough data for this view" : c.hint}
                onClick={() => { setCategory(c.key); setSelected(null); setFocus(null); }}
                className={`rounded-xl border-2 px-1 py-1 text-[11px] font-bold ${off ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                  : category === c.key ? "border-sky-500 bg-sky-500 text-white" : "border-sky-100 bg-sky-50 text-slate-600"}`}>
                {c.label}
              </button>
            );
          })}
        </div>
        <div className="mb-3 rounded-2xl bg-amber-50 p-3">
          <p className="text-sm font-bold text-slate-800">{fact}</p>
          {bubble && (
            <div className="mt-2 flex items-center gap-2 text-[10px] font-bold uppercase text-slate-400">
              Diversity
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-200">
                <div className="h-full bg-gradient-to-r from-rose-400 via-amber-300 to-emerald-400" style={{ width: `${bubble.diversity}%` }} />
              </div>
              <span className="text-slate-600">{bubble.diversity}</span>
            </div>
          )}
        </div>
        {category === "tribe" && (
          <div className="mb-3 max-h-48 space-y-1 overflow-y-auto pr-1">
            {analysis.tribes.map((t) => (
              <button key={t.name} onClick={() => focusGroup(focus === t.name ? null : t.name)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs ${focus === t.name ? "bg-sky-100" : "hover:bg-slate-50"}`}>
                <span className="flex-1 truncate font-bold text-slate-700">{t.name}{t.name === analysis.egoTribe ? " (you)" : ""}</span>
                <span className="text-slate-400">{t.era === "past" ? "🕰️" : "✨"} {t.size}</span>
                <span className="h-1.5 w-10 overflow-hidden rounded bg-slate-200" title={`confidence ${Math.round(t.confidence * 100)}%`}>
                  <span className="block h-full bg-emerald-400" style={{ width: `${t.confidence * 100}%` }} />
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="mb-2 flex gap-2">
          <button onClick={toggleFollow} className="flex-1 rounded-xl bg-sky-100 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-200">
            {follow ? "🗺️ Overview" : "🚶 Walk"}
          </button>
          <label className="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-xl bg-slate-100 text-xs font-bold text-slate-600">
            <input type="checkbox" checked={showSecond} onChange={(e) => setShowSecond(e.target.checked)} /> 👻 {analysis.secondDegree.count} friends of friends
          </label>
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search (Stripe, skate, Berkeley…)"
          className="mb-2 w-full rounded-xl border-2 border-sky-100 px-3 py-1.5 text-sm" />
        <button onClick={() => setPortrait(true)} className="w-full rounded-2xl bg-rose-500 py-2 text-sm font-black text-white shadow hover:bg-rose-600">
          🪞 My portrait
        </button>
        <p className="mt-2 text-center text-[10px] text-slate-400">{follow ? "WASD / ZQSD / arrows to walk · click the ground to go · E to meet someone" : "Drag to rotate · scroll to zoom · click a Mii"}</p>
      </div>

      {near && !sel && (
        <div className="absolute bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-full bg-slate-900/80 px-4 py-2 text-sm font-bold text-white">
          {near.name} · {near.tribe} — press <kbd className="rounded bg-white/20 px-1">E</kbd>
        </div>
      )}
      {!sel && focus && byTribe && (
        <TribeCard name={focus} analysis={analysis} arcs={arcs} onPick={focusGroup} onClose={() => focusGroup(null)} />
      )}
      {sel && <PersonCard n={sel} links={neighbors.get(sel.id)?.size ?? 0} tribes={analysis.tribes} onClose={() => setSelected(null)} />}
      {portrait && <Portrait analysis={analysis} onClose={() => setPortrait(false)} />}
    </div>
  );
}

function PersonCard({ n, links, tribes, onClose }: { n: Node; links: number; tribes: Analysis["tribes"]; onClose: () => void }) {
  const tie = { self: "That's you", mutual: "Mutual", aspiration: "You follow them (no follow back)", audience: "They follow you", indirect: "Friend of a friend" }[n.tie];
  const conf = tribes.find((t) => t.name === n.tribe)?.confidence;
  return (
    <div className="absolute bottom-4 right-4 z-[100] w-72 max-w-[calc(100vw-2rem)] rounded-3xl border-4 border-sky-500 bg-white p-4 shadow-xl">
      <button onClick={onClose} className="absolute right-3 top-2 text-xl text-slate-400" aria-label="Close">×</button>
      <h2 className="text-lg font-black text-sky-600">{n.name}</h2>
      <div className="mb-2 flex flex-wrap gap-1">
        <span className="rounded-full bg-sky-500 px-2 py-0.5 text-[11px] font-bold text-white">{n.tribe}{conf != null ? ` · ${Math.round(conf * 100)}%` : ""}</span>
        {n.tribes.map((t) => <span key={t} className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">{t}</span>)}
        {n.isBridge && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">🌉 bridge</span>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="font-bold text-slate-400">Tie</dt><dd>{tie}</dd>
        <dt className="font-bold text-slate-400">Work</dt><dd>{n.company ?? "—"}</dd>
        <dt className="font-bold text-slate-400">School</dt><dd>{n.school ?? "—"}</dd>
        <dt className="font-bold text-slate-400">City</dt><dd>{n.city ?? "—"}</dd>
        <dt className="font-bold text-slate-400">Wealth</dt><dd>{n.wealth ? `${money(n.wealth.low)} – ${money(n.wealth.high)}` : "❓ invisible to the algorithm"}</dd>
        <dt className="font-bold text-slate-400">On</dt><dd>{n.platforms.join(", ") || "—"}</dd>
        <dt className="font-bold text-slate-400">Links</dt><dd>{links}</dd>
      </dl>
    </div>
  );
}

/** Smoothly flies the orbit camera to a group when you click it. */
function CameraFly({ flyTo, controls }: {
  flyTo: React.RefObject<{ x: number; y: number; z: number } | null>;
  controls: React.RefObject<React.ComponentRef<typeof OrbitControls> | null>;
}) {
  const goal = useMemo(() => new THREE.Vector3(), []);
  const frames = useRef(0);
  const last = useRef<{ x: number; y: number; z: number } | null>(null);
  useFrame(({ camera }) => {
    const f = flyTo.current, c = controls.current;
    if (!f || !c) return;
    if (f !== last.current) { last.current = f; frames.current = 80; }
    if (frames.current <= 0) return;
    frames.current--;
    c.target.lerp(goal.set(f.x, f.y, f.z), 0.08);
    camera.position.lerp(goal.set(f.x, f.y + 30, f.z + 36), 0.06);
    c.update();
  });
  return null;
}

function TribeCard({ name, analysis, arcs, onPick, onClose }: {
  name: string; analysis: Analysis; arcs: ReturnType<typeof tribeLinks>; onPick: (k: string) => void; onClose: () => void;
}) {
  const t = analysis.tribes.find((x) => x.name === name);
  if (!t) return null;
  const members = analysis.nodes.filter((n) => n.degree === 1 && n.tribe === name);
  const also = analysis.nodes.filter((n) => n.degree === 1 && n.tribes.includes(name)).length;
  const bridges = arcs.filter((a) => a.a === name || a.b === name).slice(0, 3).map((a) => ({ other: a.a === name ? a.b : a.a, count: a.count }));
  const you = analysis.class.ego?.mid ?? null;
  return (
    <div className="absolute bottom-4 right-4 z-[100] w-80 max-w-[calc(100vw-2rem)] rounded-3xl border-4 border-emerald-400 bg-white p-4 shadow-xl">
      <button onClick={onClose} className="absolute right-3 top-2 text-xl text-slate-400" aria-label="Close">×</button>
      <h2 className="text-lg font-black text-emerald-600">{t.name}{t.name === analysis.egoTribe ? " (your tribe)" : ""}</h2>
      <p className="mb-2 text-xs text-slate-500">
        {t.size} people{also ? ` + ${also} half-in` : ""} · {t.era === "past" ? "🕰️ from your past" : "✨ your present"} · confidence {Math.round(t.confidence * 100)}%
      </p>
      <div className="mb-2 flex flex-wrap gap-1">
        {t.topTraits.map((tr) => <span key={tr} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">{tr}</span>)}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="font-bold text-slate-400">Worth</dt>
        <dd>{t.medianWealth != null ? `${money(t.medianWealth)} median` : "❓ invisible to the algorithm"}
          {t.medianWealth != null && you != null && you > 0 ? <span className="text-slate-400"> · {(t.medianWealth / you).toFixed(0)}× you</span> : null}</dd>
        <dt className="font-bold text-slate-400">Bridges</dt>
        <dd className="flex flex-wrap gap-1">
          {bridges.length ? bridges.map((b) => (
            <button key={b.other} onClick={() => onPick(b.other)} className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-sky-700 hover:bg-sky-100">
              {b.other} · {b.count}
            </button>
          )) : "an island 🏝️"}
        </dd>
        <dt className="font-bold text-slate-400">Faces</dt>
        <dd className="text-xs text-slate-600">{members.slice(0, 6).map((m) => m.name).join(", ")}{members.length > 6 ? "…" : ""}</dd>
      </dl>
    </div>
  );
}
