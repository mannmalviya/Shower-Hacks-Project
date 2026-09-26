"use client";
/* eslint-disable react-hooks/immutability -- imperative three.js animation state, mutated every frame on purpose */
// Every 1st-degree Mii in a handful of instanced meshes, one animation loop.
// Tribe accessories (skateboard, briefcase, ball...), friends strolling in pairs, a hop when you walk past a mutual friend.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Node } from "@/lib/analysis";
import { heightAt, keysOf, type WorldLayout } from "./worldLayout";

const SKIN = ["#ffe0bd", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#5c3a1e"].map((c) => new THREE.Color(c));
const HAIR = ["#2b1b0e", "#5a3825", "#d9a441", "#111111", "#a0522d", "#e8e0d0"].map((c) => new THREE.Color(c));
export const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// V1 Mii: round head, flared cylinder body, hair cap tilted back
export const miiGeo = {
  body: new THREE.CylinderGeometry(0.55, 0.85, 1.6, 16),
  head: new THREE.SphereGeometry(0.75, 20, 16),
  hair: new THREE.SphereGeometry(0.8, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.2),
  eye: new THREE.SphereGeometry(0.1, 8, 8),
  crown: new THREE.ConeGeometry(0.45, 0.6, 5),
};
const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const L = {
  body: T(0, 0.8, 0),
  head: T(0, 2.2, 0),
  hair: T(0, 2.3, 0).multiply(new THREE.Matrix4().makeRotationX(-0.25)),
  eyeL: T(-0.25, 2.25, 0.68),
  eyeR: T(0.25, 2.25, 0.68),
  crown: T(0, 3.25, 0),
};
const lambert = (color: string) => new THREE.MeshLambertMaterial({ color });
const white = lambert("#ffffff");
const dark = new THREE.MeshBasicMaterial({ color: "#212529" });
const gold = lambert("#ffc800");
const AURA = new THREE.Color("#f3f0ff");

// one accessory per tribe family, picked from the tribe's emoji
type Acc = { match: RegExp; geo: THREE.BufferGeometry; mat: THREE.Material; local: THREE.Matrix4 };
const ACCESSORIES: Acc[] = [
  { match: /^🛹/, geo: new THREE.BoxGeometry(0.75, 0.12, 2.5), mat: lambert("#e8590c"), local: T(0, 0.06, 0) }, // skateboard (sticks out front and back)
  { match: /^💼/, geo: new THREE.BoxGeometry(0.55, 0.42, 0.16), mat: lambert("#7c4a1e"), local: T(0.95, 0.45, 0) }, // briefcase
  { match: /^⚽/, geo: new THREE.SphereGeometry(0.32, 12, 10), mat: lambert("#f8f9fa"), local: T(0.95, 0.32, 0.95) }, // ball
  { match: /^🎹/, geo: new THREE.TorusGeometry(0.82, 0.09, 8, 20, Math.PI), mat: lambert("#e03131"), local: T(0, 2.2, 0) }, // headphones
  { match: /^🎨/, geo: new THREE.CylinderGeometry(0.5, 0.58, 0.16, 16), mat: lambert("#c2255c"),
    local: T(0.12, 2.95, 0).multiply(new THREE.Matrix4().makeRotationZ(-0.3)) }, // beret
  { match: /^🤖/, geo: new THREE.ConeGeometry(0.1, 0.8, 6), mat: lambert("#868e96"), local: T(0, 3.25, 0) }, // antenna
  { match: /^💻/, geo: new THREE.BoxGeometry(0.85, 0.55, 0.05), mat: lambert("#adb5bd"),
    local: T(0, 1.25, 0.9).multiply(new THREE.Matrix4().makeRotationX(-0.35)) }, // laptop
  { match: /^(🎓|🐻)/, geo: new THREE.BoxGeometry(1.15, 0.08, 1.15), mat: lambert("#1c2a4a"), local: T(0, 2.98, 0) }, // grad cap
  { match: /^⭐/, geo: new THREE.BoxGeometry(1.0, 0.2, 0.08), mat: dark, local: T(0, 2.3, 0.72) }, // sunglasses
];

// What each tribe does all day, Sims-style. 0 = just strolling.
const JOG = 1, DANCE = 2, TALK = 3, GLIDE = 4, TYPE = 5, PICNIC = 6, ROBOT = 7, POSE = 8;
const ACTIVITY: [RegExp, number][] = [[/^⚽/, JOG], [/^🎹/, DANCE], [/^💼/, TALK], [/^🛹/, GLIDE], [/^💻/, TYPE], [/^🏠/, PICNIC], [/^🤖/, ROBOT], [/^⭐/, POSE]];
const BALL = ACCESSORIES.findIndex((a) => a.match.test("⚽"));

export type CrowdState = { ids: string[]; x: Float32Array; y: Float32Array; z: Float32Array };

type Props = {
  nodes: Node[]; // 1st degree only (friends of friends are <Ghosts>)
  links: [string, string][];
  layout: WorldLayout;
  heights: React.RefObject<Float32Array>;
  dim: Set<string> | null;
  player: React.RefObject<THREE.Vector3>;
  walking: boolean;
  state: React.RefObject<CrowdState | null>;
  onSelect: (id: string) => void;
  onNearest: (id: string | null) => void;
  veil?: number; // outer rings are seen through an aura: 0 = crisp (your circle), 1 = almost invisible
};

export function Crowd({ nodes, links, layout, heights, dim, player, walking, state, onSelect, onNearest, veil = 0 }: Props) {
  const mats = useMemo(() => {
    if (!veil) return { white, dark, gold };
    const fade = <M extends THREE.Material>(m: M) => Object.assign(m.clone(), { transparent: true, opacity: 1 - veil * 0.6 });
    return { white: fade(white), dark: fade(dark), gold: fade(gold) };
  }, [veil]);
  const N = nodes.length;
  const body = useRef<THREE.InstancedMesh>(null), head = useRef<THREE.InstancedMesh>(null), hair = useRef<THREE.InstancedMesh>(null);
  const eyes = useRef<THREE.InstancedMesh>(null), crown = useRef<THREE.InstancedMesh>(null);
  const accRefs = useRef<(THREE.InstancedMesh | null)[]>([]);

  const sim = useMemo(() => {
    const s = {
      x: new Float32Array(N), z: new Float32Array(N), y: new Float32Array(N), tx: new Float32Array(N), tz: new Float32Array(N),
      heading: new Float32Array(N), scale: new Float32Array(N).fill(1), target: new Float32Array(N).fill(1),
      phase: new Float32Array(N), size: new Float32Array(N), crowned: new Uint8Array(N), hop: new Float32Array(N),
      buddy: new Int32Array(N).fill(-1), mutual: new Uint8Array(N),
      act: new Uint8Array(N), cx: new Float32Array(N), cz: new Float32Array(N), // activity + center of your group
      acc: ACCESSORIES.map(() => [] as number[]), // indices of people wearing each accessory
    };
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    nodes.forEach((n, i) => {
      const h = hash(n.id);
      s.phase[i] = (h % 628) / 100;
      s.size[i] = 0.8 + (n.wealth ? Math.min(1, n.wealth.mid / 2e6) : 0.2) * 0.5; // V1: richer = a bit taller
      s.crowned[i] = (n.wealth?.mid ?? 0) > 1_000_000 ? 1 : 0;
      s.mutual[i] = n.tie === "mutual" ? 1 : 0;
      s.act[i] = ACTIVITY.find(([re]) => re.test(n.tribe))?.[1] ?? 0;
      const a = ACCESSORIES.findIndex((acc) => acc.match.test(n.tribe));
      if (a >= 0) s.acc[a].push(i);
      const p = layout.pos.get(n.id) ?? { x: 0, z: 0 };
      s.x[i] = p.x + ((h % 40) - 20); s.z[i] = p.z + (((h >>> 5) % 40) - 20); // walk in from around
    });
    // friends in the same tribe stroll in pairs (each person has at most one buddy)
    for (const [a, b] of links) {
      const i = idx.get(a), j = idx.get(b);
      if (i == null || j == null || s.buddy[i] >= 0 || s.buddy[j] >= 0 || nodes[i].tribe !== nodes[j].tribe || s.act[i] !== 0) continue;
      s.buddy[i] = j; s.buddy[j] = i;
      s.phase[j] = s.phase[i];
    }
    return s;
    // positions persist across layouts; only rebuild when the set of people changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links]);

  useEffect(() => {
    state.current = { ids: nodes.map((n) => n.id), x: sim.x, y: sim.y, z: sim.z };
  }, [nodes, sim, state]);

  // targets + colors when the category changes; buddies share the leader's spot
  useEffect(() => {
    nodes.forEach((n, i) => {
      const p = layout.pos.get(n.id);
      if (p) { sim.tx[i] = p.x; sim.tz[i] = p.z; }
    });
    nodes.forEach((_, i) => {
      const j = sim.buddy[i];
      if (j > i) { sim.tx[j] = sim.tx[i] + 1.4; sim.tz[j] = sim.tz[i] + 0.3; }
    });
    // group centers (to face each other / sit around), and the family picnic circle
    const center = new Map(layout.groups.map((g) => [g.key, g]));
    const byTribe = layout.category === "tribe" || layout.category === "lifemap";
    const picnic = new Map<string, number[]>();
    nodes.forEach((n, i) => {
      const g = center.get(keysOf(n, layout.category)[0]);
      sim.cx[i] = g?.x ?? sim.tx[i]; sim.cz[i] = g?.z ?? sim.tz[i];
      if (byTribe && sim.act[i] === PICNIC) (picnic.get(n.tribe) ?? picnic.set(n.tribe, []).get(n.tribe)!).push(i);
    });
    for (const members of picnic.values()) members.forEach((i, k) => {
      const a = (k / members.length) * Math.PI * 2;
      sim.tx[i] = sim.cx[i] + Math.cos(a) * 2.8; sim.tz[i] = sim.cz[i] + Math.sin(a) * 2.8;
    });
    const c = new THREE.Color();
    nodes.forEach((n, i) => {
      const h = hash(n.id);
      body.current?.setColorAt(i, c.set(layout.colorOf.get(n.id) ?? "#ced4da").lerp(AURA, veil * 0.5));
      head.current?.setColorAt(i, SKIN[h % SKIN.length]);
      hair.current?.setColorAt(i, HAIR[(h >>> 3) % HAIR.length]);
    });
    for (const r of [body, head, hair]) if (r.current?.instanceColor) r.current.instanceColor.needsUpdate = true;
  }, [layout, nodes, sim, veil]);

  useEffect(() => {
    nodes.forEach((n, i) => (sim.target[i] = dim && dim.has(n.id) ? 0.5 : 1));
  }, [dim, nodes, sim]);

  const nearest = useRef<string | null>(null);
  const tmp = useMemo(() => ({
    m: new THREE.Matrix4(), p: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(),
    up: new THREE.Vector3(0, 1, 0), zero: new THREE.Matrix4().makeScale(0, 0, 0), parents: Array.from({ length: N }, () => new THREE.Matrix4()),
    ball: new THREE.Matrix4(),
  }), [N]);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05), t = clock.elapsedTime, H = heights.current, pl = player.current;
    const { m, p, q, v, s, up, zero, parents, ball } = tmp;
    let best: string | null = null, bestD = 3.5 * 3.5;
    for (let i = 0; i < N; i++) {
      // stroll around your spot; pairs stroll a bigger loop together (same phase, side by side)
      const act = sim.act[i], ph = sim.phase[i];
      const loop = act === JOG ? 3.2 : act === GLIDE ? 4.5 : act === ROBOT ? 1.2 : act === DANCE ? 0.25 : act === TALK ? 0.35
        : act === TYPE || act === POSE ? 0.15 : act === PICNIC ? 0 : sim.buddy[i] >= 0 ? 2.2 : 0.9;
      const tempo = act === JOG ? 1.8 : act === GLIDE ? 1.5 : 1;
      const gx = sim.tx[i] + Math.sin(t * 0.25 * tempo + ph) * loop;
      const gz = sim.tz[i] + Math.cos(t * 0.19 * tempo + ph * 1.7) * loop;
      const dx = gx - sim.x[i], dz = gz - sim.z[i], d = Math.hypot(dx, dz);
      const step = Math.min(d, Math.max(1.2, d * 1.4) * tempo * dt);
      const turn = (want: number, k: number) => {
        const diff = Math.atan2(Math.sin(want - sim.heading[i]), Math.cos(want - sim.heading[i]));
        sim.heading[i] += diff * Math.min(1, dt * k);
      };
      if (d > 0.05) {
        sim.x[i] += (dx / d) * step; sim.z[i] += (dz / d) * step;
        if (d > 1.2 || (act !== TALK && act !== PICNIC && act !== DANCE && act !== ROBOT && act !== POSE)) turn(Math.atan2(dx, dz), 8);
      }
      if (d <= 1.2) {
        if (act === TALK || act === PICNIC) turn(Math.atan2(sim.cx[i] - sim.x[i], sim.cz[i] - sim.z[i]), 4); // face the group
        else if (act === DANCE) sim.heading[i] = t * 2.2; // everyone spins in sync
        else if (act === ROBOT) sim.heading[i] = Math.round(t * 0.6 + ph) * (Math.PI / 2); // jerky quarter turns
        else if (act === POSE) sim.heading[i] = t * 0.6 + ph;
      }
      sim.y[i] = H ? heightAt(H, sim.x[i], sim.z[i]) : 0;
      sim.scale[i] += (sim.target[i] - sim.scale[i]) * Math.min(1, dt * 6);
      // mutual friends hop when you walk past them
      const pd = pl ? (pl.x - sim.x[i]) ** 2 + (pl.z - sim.z[i]) ** 2 : Infinity;
      if (walking && sim.mutual[i] && pd < 16 && sim.hop[i] <= 0) sim.hop[i] = 1;
      if (sim.hop[i] > 0) sim.hop[i] = pd < 16 ? Math.max(0.001, sim.hop[i] - dt * 0.6) : sim.hop[i] - dt * 2;
      const hopY = sim.hop[i] > 0 ? Math.abs(Math.sin(t * 9 + sim.phase[i])) * 0.6 : 0;
      const fast = d > 1.5;
      const actBob = act === DANCE ? Math.abs(Math.sin(t * 6)) * 0.45 // in rhythm, all together
        : act === JOG ? Math.abs(Math.sin(t * 12 + ph)) * 0.25
        : act === TYPE ? Math.abs(Math.sin(t * 22 + ph)) * 0.03
        : act === TALK ? Math.abs(Math.sin(t * 2.5 + ph)) * 0.08
        : act === GLIDE || act === PICNIC || act === ROBOT || act === POSE ? 0
        : Math.abs(Math.sin(t * 3 + ph)) * 0.05;
      const bob = (fast && act !== GLIDE ? Math.abs(Math.sin(t * 11 + ph)) * 0.22 : actBob) + hopY + (act === PICNIC && !fast ? -0.45 : 0); // sitting
      const sc = sim.scale[i] * sim.size[i];
      p.compose(v.set(sim.x[i], sim.y[i] + bob, sim.z[i]), q.setFromAxisAngle(up, sim.heading[i]), s.set(sc, sc, sc));
      parents[i].copy(p);
      body.current!.setMatrixAt(i, m.multiplyMatrices(p, L.body));
      head.current!.setMatrixAt(i, m.multiplyMatrices(p, L.head));
      hair.current!.setMatrixAt(i, m.multiplyMatrices(p, L.hair));
      eyes.current!.setMatrixAt(i * 2, m.multiplyMatrices(p, L.eyeL));
      eyes.current!.setMatrixAt(i * 2 + 1, m.multiplyMatrices(p, L.eyeR));
      crown.current!.setMatrixAt(i, sim.crowned[i] ? m.multiplyMatrices(p, L.crown) : zero);
      if (pd < bestD) { bestD = pd; best = nodes[i].id; }
    }
    ACCESSORIES.forEach((acc, a) => {
      const mesh = accRefs.current[a];
      if (!mesh) return;
      sim.acc[a].forEach((i, k) => {
        // soccer: the ball bounces in front of you
        const local = a === BALL ? ball.makeTranslation(0.95, 0.32 + Math.abs(Math.sin(clock.elapsedTime * 6 + sim.phase[i])) * 0.8, 0.95) : acc.local;
        mesh.setMatrixAt(k, m.multiplyMatrices(parents[i], local));
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
    for (const r of [body, head, hair, eyes, crown]) if (r.current) r.current.instanceMatrix.needsUpdate = true;
    if (best !== nearest.current) { nearest.current = best; onNearest(best); }
  });

  const click = (e: { stopPropagation: () => void; instanceId?: number }) => {
    e.stopPropagation();
    if (e.instanceId != null) onSelect(nodes[e.instanceId].id);
  };
  return (
    <group>
      <instancedMesh ref={body} args={[miiGeo.body, mats.white, N]} castShadow frustumCulled={false} onClick={click} />
      <instancedMesh ref={head} args={[miiGeo.head, mats.white, N]} castShadow frustumCulled={false} onClick={click} />
      <instancedMesh ref={hair} args={[miiGeo.hair, mats.white, N]} frustumCulled={false} />
      <instancedMesh ref={eyes} args={[miiGeo.eye, mats.dark, N * 2]} frustumCulled={false} />
      <instancedMesh ref={crown} args={[miiGeo.crown, mats.gold, N]} frustumCulled={false} />
      {ACCESSORIES.map((acc, a) => sim.acc[a].length > 0 && (
        <instancedMesh key={a} ref={(el) => { accRefs.current[a] = el; }} args={[acc.geo, acc.mat, sim.acc[a].length]} castShadow frustumCulled={false} />
      ))}
    </group>
  );
}
