"use client";
// The social mirror: a Mii world of your network. You in the middle, your circles around you.
import { Html, Instance, Instances, Line, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo, useState } from "react";
import * as THREE from "three";
import type { Analysis, Dimension, Node } from "@/lib/analysis";
import { computeLayout, placeSecondDegree, stackHeight, type GroupBy } from "./layout";
import { CashStack, Mii, mat } from "./Mii";
import { Portrait } from "./Portrait";

const FILTERS: { key: GroupBy; label: string }[] = [
  { key: "circle", label: "Circles" }, { key: "wealthTier", label: "Wealth" }, { key: "school", label: "School" },
  { key: "city", label: "City" }, { key: "industry", label: "Industry" }, { key: "company", label: "Company" },
  { key: "interest", label: "Interests" }, { key: "platform", label: "Platform" },
];
const capsule = new THREE.CapsuleGeometry(0.3, 0.6, 2, 6);
const money = (n: number | null | undefined) =>
  n == null ? "?" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${n}`;

export default function World({ analysis, links }: { analysis: Analysis; links: [string, string][] }) {
  const [by, setBy] = useState<GroupBy>("circle");
  const [selected, setSelected] = useState<string | null>(null);
  const [showSecond, setShowSecond] = useState(false);
  const [query, setQuery] = useState("");
  const [portrait, setPortrait] = useState(false);

  const nodes = analysis.nodes;
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const ego = byId.get(analysis.egoId)!;
  const layout = useMemo(() => computeLayout(nodes, by), [nodes, by]);
  const second = useMemo(() => placeSecondDegree(nodes, links, layout), [nodes, links, layout]);
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [a, b] of links) {
      (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
      (m.get(b) ?? m.set(b, new Set()).get(b)!).add(a);
    }
    return m;
  }, [links]);

  const wealthMode = by === "wealthTier";
  const q = query.trim().toLowerCase();
  const matches = (n: Node) => [n.name, n.company, n.school, n.city, n.circle, n.industry].some((v) => v?.toLowerCase().includes(q));
  const isDim = (n: Node) =>
    (selected && n.id !== selected && !neighbors.get(selected)?.has(n.id)) || (q && !matches(n)) || false;

  const posOf = (id: string) => (id === ego.id ? { x: 0, y: 0, z: 0 } : layout.placed.get(id) ?? (showSecond ? second.get(id) : undefined));
  const selectedLinks = selected
    ? [...(neighbors.get(selected) ?? [])].map((id) => posOf(id)).filter(Boolean) as { x: number; y: number; z: number }[]
    : [];
  const sel = selected ? byId.get(selected) : null;
  const bubble = analysis.bubbles[by as Dimension];

  return (
    <div className="fixed inset-0 bg-sky-200">
      <Canvas shadows camera={{ position: [0, 55, 75], fov: 45 }} onPointerMissed={() => setSelected(null)}>
        <color attach="background" args={["#bfe6ff"]} />
        <fog attach="fog" args={["#bfe6ff", 110, 260]} />
        <hemisphereLight args={["#ffffff", "#88bb77", 1.1]} />
        <directionalLight position={[40, 90, 30]} intensity={1.5} castShadow shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-90} shadow-camera-right={90} shadow-camera-top={90} shadow-camera-bottom={-90} />
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <circleGeometry args={[300, 64]} />
          <meshLambertMaterial color="#9be07a" />
        </mesh>

        {/* islands */}
        {layout.islands.map((isl) => (
          <group key={`${by}-${isl.key}`} position={[isl.x, 0, isl.z]}>
            <mesh position={[0, isl.height / 2, 0]} receiveShadow>
              <cylinderGeometry args={[isl.radius, isl.radius + 0.5, isl.height, 40]} />
              <meshLambertMaterial color={isl.color} transparent opacity={isl.era === "past" && by === "circle" ? 0.45 : 0.8} />
            </mesh>
            <Html position={[0, isl.height + 4, -isl.radius]} center distanceFactor={60} zIndexRange={[10, 0]}>
              <div className={`whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm font-extrabold shadow ${isl.era === "past" && by === "circle" ? "text-slate-400" : "text-slate-700"}`}>
                {isl.label} <span className="text-slate-400">{isl.count}</span>
              </div>
            </Html>
          </group>
        ))}

        {/* you: on your real stack, next to the ghost stack of who you could become */}
        <group>
          <CashStack height={stackHeight(analysis.class.ego?.mid)} />
          {analysis.class.projected && (
            <group position={[1.6, 0, 0]}>
              <CashStack height={stackHeight(analysis.class.projected.mid)} ghost />
              <Html position={[0, stackHeight(analysis.class.projected.mid) + 0.8, 0]} center distanceFactor={50}>
                <div className="whitespace-nowrap rounded-full bg-emerald-50/90 px-2 py-0.5 text-xs font-bold text-emerald-700">
                  future you? {money(analysis.class.projected.mid)}
                </div>
              </Html>
            </group>
          )}
          <Mii id={ego.id} target={{ x: 0, y: 0, z: 0 }} color="#ff3366" stack={stackHeight(analysis.class.ego?.mid)} big
            onSelect={setSelected} />
          <Html position={[0, stackHeight(analysis.class.ego?.mid) + 5.2, 0]} center distanceFactor={50}>
            <div className="whitespace-nowrap rounded-full bg-rose-500 px-3 py-1 text-sm font-extrabold text-white shadow">You</div>
          </Html>
        </group>

        {/* 1st degree */}
        {nodes.filter((n) => n.degree === 1).map((n) => {
          const p = layout.placed.get(n.id)!;
          const h = wealthMode && n.wealth ? stackHeight(n.wealth.mid) : 0;
          return (
            <group key={n.id}>
              {h > 0 && (
                <mesh position={[p.x, p.y + h / 2, p.z]} scale={[0.8, h, 0.55]} material={mat("#40c057")}>
                  <boxGeometry />
                </mesh>
              )}
              <Mii id={n.id} target={p} color={wealthMode && !n.wealth ? "#adb5bd" : p.color} stack={h}
                crown={(n.wealth?.mid ?? 0) > 1_000_000} dim={isDim(n)} onSelect={setSelected} />
            </group>
          );
        })}

        {/* 2nd degree: simplified sims, hidden by default */}
        {showSecond && (
          <Instances geometry={capsule} material={mat("#ced4da")} limit={2000}>
            {[...second.entries()].map(([id, p]) => (
              <Instance key={id} position={[p.x, 0.6, p.z]} onClick={(e) => { e.stopPropagation(); setSelected(id); }} />
            ))}
          </Instances>
        )}

        {/* links of the selected person */}
        {sel && selectedLinks.map((t, i) => {
          const s = posOf(sel.id)!;
          return <Line key={i} points={[[s.x, s.y + 1.5, s.z], [t.x, t.y + 1.5, t.z]]} color="#1d6fb8" lineWidth={1.5} transparent opacity={0.6} />;
        })}

        <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.2} minDistance={10} maxDistance={220} enableDamping />
      </Canvas>

      {/* HUD */}
      <div className="pointer-events-auto absolute left-4 top-4 w-80 max-w-[calc(100vw-2rem)] rounded-3xl border-4 border-white bg-white/90 p-4 shadow-xl">
        <h1 className="mb-1 text-xl font-black tracking-tight text-sky-600">Social Mirror 🚿</h1>
        <p className="mb-3 text-xs text-slate-500">Who you are, who your people are, and what they say about you.</p>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => { setBy(f.key); setSelected(null); }}
              className={`rounded-full border-2 px-3 py-1 text-xs font-bold ${by === f.key ? "border-sky-500 bg-sky-500 text-white" : "border-sky-100 bg-sky-50 text-slate-600"}`}>
              {f.label}
            </button>
          ))}
        </div>
        {bubble && (
          <div className="mb-3 rounded-2xl bg-amber-50 p-3">
            <p className="text-sm font-bold text-slate-800">{bubble.fact}</p>
            <div className="mt-2 flex items-center gap-2 text-[11px] font-bold uppercase text-slate-400">
              Diversity
              <div className="h-2 flex-1 overflow-hidden rounded bg-slate-200">
                <div className="h-full bg-gradient-to-r from-rose-400 via-amber-300 to-emerald-400" style={{ width: `${bubble.diversity}%` }} />
              </div>
              <span className="text-slate-600">{bubble.diversity}</span>
            </div>
          </div>
        )}
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showSecond} onChange={(e) => setShowSecond(e.target.checked)} />
          Friends of friends ({analysis.secondDegree.count})
        </label>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search (Stripe, soccer, Berkeley…)"
          className="mb-3 w-full rounded-xl border-2 border-sky-100 px-3 py-1.5 text-sm" />
        <button onClick={() => setPortrait(true)}
          className="w-full rounded-2xl bg-rose-500 py-2 text-sm font-black text-white shadow hover:bg-rose-600">
          🪞 My portrait
        </button>
      </div>

      {sel && <PersonCard n={sel} onClose={() => setSelected(null)} links={neighbors.get(sel.id)?.size ?? 0} />}
      {portrait && <Portrait analysis={analysis} onClose={() => setPortrait(false)} />}
    </div>
  );
}

function PersonCard({ n, links, onClose }: { n: Node; links: number; onClose: () => void }) {
  const tie = { self: "That's you", mutual: "Mutual", aspiration: "You follow them (no follow back)", audience: "They follow you", indirect: "Friend of a friend" }[n.tie];
  return (
    <div className="absolute bottom-4 right-4 w-72 max-w-[calc(100vw-2rem)] rounded-3xl border-4 border-sky-500 bg-white p-4 shadow-xl">
      <button onClick={onClose} className="absolute right-3 top-2 text-xl text-slate-400" aria-label="Close">×</button>
      <h2 className="text-lg font-black text-sky-600">{n.name}</h2>
      <p className="mb-2 text-sm text-slate-500">{n.circle}{n.isBridge ? " · 🌉 bridge between your two lives" : ""}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="font-bold text-slate-400">Tie</dt><dd>{tie}</dd>
        <dt className="font-bold text-slate-400">Work</dt><dd>{n.company ?? "—"}</dd>
        <dt className="font-bold text-slate-400">School</dt><dd>{n.school ?? "—"}</dd>
        <dt className="font-bold text-slate-400">City</dt><dd>{n.city ?? "—"}</dd>
        <dt className="font-bold text-slate-400">Wealth</dt>
        <dd>{n.wealth ? `${money(n.wealth.low)} – ${money(n.wealth.high)}` : "❓ invisible to the algorithm"}</dd>
        <dt className="font-bold text-slate-400">On</dt><dd>{n.platforms.join(", ") || "—"}</dd>
        <dt className="font-bold text-slate-400">Links</dt><dd>{links}</dd>
      </dl>
    </div>
  );
}
