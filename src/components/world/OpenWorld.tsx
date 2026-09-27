"use client";
// The open world (/world): everyone we scraped stands on a grid in sign-up order, their audience around them
// (real scraped followers first, NPCs up to 300). Walk around, click anyone. Click a person to open their world.
import { OrbitControls, Sparkles } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { PersonRow, WorldRows } from "@/lib/worldData";
import { NPC_COLOR, PLATFORM_COLOR, PLATFORM_NAME, audienceOf, npcLayout, npcSplit, totalOf } from "./npcs";
import { LabelProjector, type Anchor } from "./Labels";
import { CashStack, Player, stackHeight } from "./Player";
import { Gear, NpcCard, PersonDetailCard } from "./SimCard";
import { SimpleCrowd } from "./SimpleCrowd";
import { hash } from "./Crowd";
import { PALETTE, TERRAIN_SEG } from "./worldLayout";

const NPC_CAP = 300; // most sims per person here (their own world shows up to 5,000)
const HUB = "#ff3366"; // same as your own Mii
const HUB_SCALE = 1.6; // a person with a world is drawn bigger, and so is their cash stack
const money = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${n}`);

type Sim = { kind: "hub" | "real"; id: string } | { kind: "npc"; hub: string; platform: string };
type Hub = { p: PersonRow; x: number; z: number; total: number; worth: { low: number; high: number } | null; stack: number };

/** backdrop: scenery only (behind the onboarding form): no panel, no clicks, no walking, the camera slowly circles. */
export default function OpenWorld({ rows, onVisit, backdrop = false }: { rows: WorldRows; onVisit?: (id: string) => void; backdrop?: boolean }) {
  const [grouped, setGrouped] = useState(false);
  const [follow, setFollow] = useState(false); // orbit camera by default, walking is opt-in (like the ego world)
  const [sel, setSel] = useState<number | null>(null);

  const world = useMemo(() => {
    const byId = new Map(rows.people.map((p) => [p.id, p]));
    // a "person with a world" = someone who was queued for a scrape (onboarded); rows come in sign-up order
    const jobbed = new Set(rows.jobs.map((j) => j.person_id));
    const hubPeople = rows.people.filter((p) => jobbed.has(p.id));
    const hubIds = new Set(hubPeople.map((p) => p.id));
    // each real follower is drawn once, near the first hub they follow
    const followersOf = new Map<string, string[]>(hubPeople.map((p) => [p.id, []]));
    const placed = new Set<string>();
    const followsCount = new Map<string, number>();
    for (const h of hubPeople) {
      for (const f of rows.follows) {
        if (f.person_id !== h.id || hubIds.has(f.follower_id) || !byId.has(f.follower_id)) continue;
        followsCount.set(f.follower_id, (followsCount.get(f.follower_id) ?? 0) + 1);
        if (!placed.has(f.follower_id)) { placed.add(f.follower_id); followersOf.get(h.id)!.push(f.follower_id); }
      }
    }
    const INNER = 4, AREA = 4.2;
    const outerOf = (n: number) => Math.sqrt(INNER * INNER + (n * AREA) / Math.PI);
    const cell = 2 * Math.max(12, ...hubPeople.map((p) => outerOf(Math.min(NPC_CAP, Math.max(totalOf(audienceOf(p)), followersOf.get(p.id)!.length))))) + 14;
    const cols = Math.max(1, Math.ceil(Math.sqrt(hubPeople.length)));
    const worthOf = new Map(rows.netWorth.map((n) => [n.person_id, n]));
    const hubs: Hub[] = hubPeople.map((p, i) => {
      const w = worthOf.get(p.id) ?? null;
      // a hub stands on their cash stack (same scale as "you" in the ego world); unknown = no stack
      return { p, x: (i % cols) * cell, z: Math.floor(i / cols) * cell, total: totalOf(audienceOf(p)), worth: w, stack: w ? HUB_SCALE * stackHeight((w.low + w.high) / 2) : 0 };
    });

    const xs: number[] = [], zs: number[] = [], ys: number[] = [], colors: string[] = [], scales: number[] = [], sims: Sim[] = [];
    const labels: { key: string; x: number; z: number; text: string; color: string }[] = [];
    const GOLDEN = Math.PI * (3 - Math.sqrt(5));
    for (const h of hubs) {
      xs.push(h.x); zs.push(h.z); ys.push(h.stack); colors.push(HUB); scales.push(HUB_SCALE); sims.push({ kind: "hub", id: h.p.id });
      const real = followersOf.get(h.p.id)!.slice(0, NPC_CAP);
      real.forEach((id, k) => {
        const r = Math.sqrt(INNER * INNER + (k * AREA) / Math.PI), a = k * GOLDEN;
        xs.push(h.x + Math.cos(a) * r); zs.push(h.z + Math.sin(a) * r); ys.push(0); colors.push(PALETTE[hash(id) % PALETTE.length]); scales.push(1); sims.push({ kind: "real", id });
      });
      const npc = npcLayout(h.x, h.z, outerOf(real.length), npcSplit(audienceOf(h.p), real.length, NPC_CAP), grouped, h.p.id);
      for (let k = 0; k < npc.x.length; k++) {
        xs.push(npc.x[k]); zs.push(npc.z[k]); ys.push(0); colors.push(grouped ? PLATFORM_COLOR[npc.platform[k]] ?? NPC_COLOR : NPC_COLOR);
        scales.push(1); sims.push({ kind: "npc", hub: h.p.id, platform: npc.platform[k] });
      }
      for (const g of npc.groups) labels.push({ key: `${h.p.id}-${g.platform}`, x: g.x, z: g.z, text: `${PLATFORM_NAME[g.platform] ?? g.platform} ${g.count}`, color: PLATFORM_COLOR[g.platform] ?? NPC_COLOR });
    }
    const extent = cols * cell;
    // middle of the occupied grid (the camera circles it in backdrop mode)
    const cx = ((cols - 1) * cell) / 2, cz = ((Math.ceil(hubs.length / cols) - 1) * cell) / 2;
    return { byId, hubs, followsCount, sims, colors, labels, extent, cx: Math.max(0, cx), cz: Math.max(0, cz),
      x: Float32Array.from(xs), z: Float32Array.from(zs), y: Float32Array.from(ys), scales: Float32Array.from(scales) };
  }, [rows, grouped]);

  // shared player state (same contract as the ego world)
  const heights = useRef(new Float32Array((TERRAIN_SEG + 1) ** 2)); // flat ground
  const start = world.hubs[0] ?? { x: 0, z: 0 };
  const playerPos = useRef(new THREE.Vector3(start.x, 0, start.z + 5));
  const walkTo = useRef<THREE.Vector3 | null>(null);
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement)?.tagName === "INPUT";
    if (backdrop) return;
    const down = (e: KeyboardEvent) => { if (!typing(e)) keys.current.add(e.key.toLowerCase()); if (e.key === "Escape") setSel(null); };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [backdrop]);

  // labels: plain DOM, moved every frame by <LabelProjector> (same as the ego world)
  const labelEls = useRef(new Map<string, HTMLElement>());
  const anchors = useRef(new Map<string, Anchor>());
  const priority = useRef(new Map<string, number>());
  const bindLabel = useCallback((key: string) => (el: HTMLElement | null) => {
    if (el) labelEls.current.set(key, el);
    else labelEls.current.delete(key);
  }, []);
  useEffect(() => {
    const m = new Map<string, Anchor>(), pr = new Map<string, number>();
    world.hubs.forEach((h) => { m.set(`h-${h.p.id}`, () => [h.x, h.stack + 5.5, h.z]); pr.set(`h-${h.p.id}`, 1e6 + h.total); });
    world.labels.forEach((l) => { m.set(l.key, () => [l.x, 3, l.z]); pr.set(l.key, 1); });
    anchors.current = m;
    priority.current = pr;
  }, [world]);

  const s = sel != null ? world.sims[sel] : null;
  const person = s && s.kind !== "npc" ? world.byId.get(s.id) : null;
  const mid = world.extent / 2;

  return (
    <div className="fixed inset-0 select-none bg-[linear-gradient(180deg,#8ec5ff_0%,#b3d8ff_30%,#d9ecff_55%,#e3f6ea_80%,#f1f8e9_100%)]">
      <Canvas shadows gl={{ alpha: true }} camera={{ position: backdrop ? [world.cx, 32, world.cz + 62] : [start.x, 34, start.z + 48], fov: 50 }} onPointerMissed={() => setSel(null)}>
        <fog attach="fog" args={["#dcecfb", 120, 380]} />
        <hemisphereLight args={["#eef6ff", "#9ed98a", 1.2]} />
        <directionalLight position={[world.cx + 50, 90, world.cz + 40]} intensity={0.95} color="#fff6ee" castShadow shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-110} shadow-camera-right={110} shadow-camera-top={110} shadow-camera-bottom={-110}>
          <object3D attach="target" position={[world.cx, 0, world.cz]} />
        </directionalLight>
        <Sparkles count={260} scale={[280, 50, 280]} position={[world.cx, 22, world.cz]} size={5} speed={0.35} opacity={0.8} color="#ffffff" />
        <mesh rotation-x={-Math.PI / 2} position={[mid, 0, mid]} receiveShadow
          onClick={(e) => { e.stopPropagation(); walkTo.current = e.point.clone(); }}>
          <planeGeometry args={[world.extent + 2000, world.extent + 2000]} />
          <meshLambertMaterial color="#8fd675" />
        </mesh>
        {world.hubs.map((h) => h.stack > 0 && (
          <group key={h.p.id} position={[h.x, 0, h.z]} scale={HUB_SCALE}><CashStack height={h.stack / HUB_SCALE} /></group>
        ))}
        <SimpleCrowd x={world.x} z={world.z} y={world.y} colors={world.colors} scales={world.scales} seed="open" onSelect={backdrop ? undefined : setSel} />
        <LabelProjector anchors={anchors} els={labelEls} priority={priority} />
        {!backdrop && <Player heights={heights} pos={playerPos} walkTo={walkTo} keys={keys} follow={follow} stack={0.15} ghostStack={null} />}
        {backdrop
          ? <OrbitControls target={[world.cx, 0, world.cz]} autoRotate autoRotateSpeed={0.35} enableRotate={false} enableZoom={false} enablePan={false} />
          : <OrbitControls enabled={!follow} target={[start.x, 0, start.z]} maxPolarAngle={Math.PI / 2.2} minDistance={10} maxDistance={400} enableDamping />}
      </Canvas>

      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {world.hubs.map((h) => (
          <button key={h.p.id} ref={bindLabel(`h-${h.p.id}`)} style={{ visibility: "hidden" }} onClick={() => onVisit?.(h.p.id)} title="See their world"
            className={`${backdrop ? "" : "pointer-events-auto "}absolute left-0 top-0 whitespace-nowrap rounded-full bg-rose-500 px-3 py-0.5 text-xs font-extrabold text-white shadow hover:bg-rose-600`}>
            {h.p.name}{h.total ? ` · 👥 ${h.total.toLocaleString("en-US")}` : ""}{h.worth ? ` · 💰 ${money(h.worth.low)}–${money(h.worth.high)}` : ""}
          </button>
        ))}
        {world.labels.map((l) => (
          <div key={l.key} ref={bindLabel(l.key)} style={{ visibility: "hidden", borderColor: l.color }}
            className="absolute left-0 top-0 whitespace-nowrap rounded-full border-2 bg-white/90 px-2 py-0.5 text-[10px] font-bold text-slate-600">{l.text}</div>
        ))}
      </div>

      {!backdrop && <>
      <div className="absolute left-3 top-3 z-[100] w-72 max-w-[calc(100vw-5rem)] rounded-3xl border-4 border-white bg-white/90 p-4 shadow-xl">
        <h1 className="text-xl font-black tracking-tight text-sky-600">Social Mirror 🚿</h1>
        <p className="mb-3 text-xs text-slate-500">
          {world.hubs.length ? `${world.hubs.length} ${world.hubs.length === 1 ? "person" : "people"} and their followers. Click a name to see their world.` : "Nobody here yet."}
        </p>
        <div className="flex gap-2">
          <button onClick={() => setFollow(!follow)} className="flex-1 rounded-xl bg-sky-100 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-200">
            {follow ? "🗺️ Overview" : "🚶 Walk"}
          </button>
          <Link href="/onboarding" className="flex-1 rounded-xl bg-rose-500 py-1.5 text-center text-xs font-bold text-white hover:bg-rose-600">➕ Add me</Link>
        </div>
        <p className="mt-2 text-center text-[10px] text-slate-400">
          {follow ? "WASD / arrows to walk · tap the ground to go · tap a sim" : "Drag to rotate · scroll to zoom · tap a sim"}
        </p>
      </div>
      <Gear grouped={grouped} setGrouped={setGrouped} />
      </>}

      {person && (
        <PersonDetailCard p={person} followsCount={world.followsCount.get(person.id) ?? 0}
          onVisit={s?.kind === "hub" && onVisit ? () => onVisit(person.id) : undefined} onClose={() => setSel(null)} />
      )}
      {s?.kind === "npc" && <NpcCard platform={s.platform} of={world.byId.get(s.hub)?.name ?? "them"} onClose={() => setSel(null)} />}
    </div>
  );
}
