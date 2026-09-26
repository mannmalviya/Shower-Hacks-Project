"use client";
/* eslint-disable react-hooks/immutability, react-hooks/refs -- imperative three.js animation state, mutated every frame on purpose */
// Every Mii in a handful of instanced meshes (~6 draw calls for 300+ people), one animation loop.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Node } from "@/lib/analysis";
import { heightAt, type WorldLayout } from "./worldLayout";

const SKIN = ["#ffe0bd", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#5c3a1e"].map((c) => new THREE.Color(c));
const HAIR = ["#2b1b0e", "#5a3825", "#d9a441", "#111111", "#a0522d", "#e8e0d0"].map((c) => new THREE.Color(c));
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// V1 Mii: round head, flared cylinder body, hair cap tilted back
export const miiGeo = {
  body: new THREE.CylinderGeometry(0.55, 0.85, 1.6, 16),
  head: new THREE.SphereGeometry(0.75, 20, 16),
  hair: new THREE.SphereGeometry(0.8, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.2),
  eye: new THREE.SphereGeometry(0.1, 8, 8),
  crown: new THREE.ConeGeometry(0.45, 0.6, 5),
};
const white = new THREE.MeshLambertMaterial({ color: "#ffffff" });
const dark = new THREE.MeshBasicMaterial({ color: "#212529" });
const gold = new THREE.MeshLambertMaterial({ color: "#ffc800" });

// local offsets of each part relative to the Mii's feet
export const MII_PARTS = {
  body: new THREE.Matrix4().makeTranslation(0, 0.8, 0),
  head: new THREE.Matrix4().makeTranslation(0, 2.2, 0),
  hair: new THREE.Matrix4().makeTranslation(0, 2.3, 0).multiply(new THREE.Matrix4().makeRotationX(-0.25)),
  eyeL: new THREE.Matrix4().makeTranslation(-0.25, 2.25, 0.68),
  eyeR: new THREE.Matrix4().makeTranslation(0.25, 2.25, 0.68),
  crown: new THREE.Matrix4().makeTranslation(0, 3.25, 0),
};
const L = MII_PARTS;

export type CrowdState = { ids: string[]; x: Float32Array; y: Float32Array; z: Float32Array };

type Props = {
  nodes: Node[]; // 1st degree (+ 2nd degree when shown)
  layout: WorldLayout;
  heights: React.RefObject<Float32Array>; // live terrain heights (animated by <Terrain>)
  dim: Set<string> | null;
  player: React.RefObject<THREE.Vector3>;
  state: React.RefObject<CrowdState | null>;
  onSelect: (id: string) => void;
  onNearest: (id: string | null) => void;
};

export function Crowd({ nodes, layout, heights, dim, player, state, onSelect, onNearest }: Props) {
  const N = nodes.length;
  const refs = {
    body: useRef<THREE.InstancedMesh>(null), head: useRef<THREE.InstancedMesh>(null), hair: useRef<THREE.InstancedMesh>(null),
    eyes: useRef<THREE.InstancedMesh>(null), crown: useRef<THREE.InstancedMesh>(null),
  };
  const sim = useMemo(() => {
    const s = {
      x: new Float32Array(N), z: new Float32Array(N), y: new Float32Array(N), tx: new Float32Array(N), tz: new Float32Array(N),
      heading: new Float32Array(N), scale: new Float32Array(N).fill(1), target: new Float32Array(N).fill(1),
      phase: new Float32Array(N), size: new Float32Array(N), crowned: new Uint8Array(N),
    };
    nodes.forEach((n, i) => {
      const h = hash(n.id);
      s.phase[i] = (h % 628) / 100;
      s.size[i] = n.degree === 2 ? 0.5 : 0.8 + (n.wealth ? Math.min(1, n.wealth.mid / 2e6) : 0.2) * 0.5; // V1: richer = a bit taller
      s.crowned[i] = (n.wealth?.mid ?? 0) > 1_000_000 ? 1 : 0;
      const p = layout.pos.get(n.id) ?? { x: 0, z: 0 };
      s.x[i] = p.x + ((h % 40) - 20); s.z[i] = p.z + (((h >> 5) % 40) - 20); // walk in from around
    });
    return s;
    // positions persist across layouts; only rebuild when the set of people changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  useEffect(() => {
    state.current = { ids: nodes.map((n) => n.id), x: sim.x, y: sim.y, z: sim.z };
  }, [nodes, sim, state]);

  // targets + colors when the category changes
  useEffect(() => {
    nodes.forEach((n, i) => {
      const p = layout.pos.get(n.id);
      if (p) { sim.tx[i] = p.x; sim.tz[i] = p.z; }
    });
    const c = new THREE.Color();
    nodes.forEach((n, i) => {
      const h = hash(n.id);
      refs.body.current?.setColorAt(i, c.set(layout.colorOf.get(n.id) ?? "#ced4da"));
      refs.head.current?.setColorAt(i, SKIN[h % SKIN.length]);
      refs.hair.current?.setColorAt(i, HAIR[(h >>> 3) % HAIR.length]);
    });
    for (const r of [refs.body, refs.head, refs.hair]) if (r.current?.instanceColor) r.current.instanceColor.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, nodes, sim]);

  useEffect(() => {
    nodes.forEach((n, i) => (sim.target[i] = dim && dim.has(n.id) ? 0.5 : 1));
  }, [dim, nodes, sim]);

  const nearest = useRef<string | null>(null);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), zero: new THREE.Matrix4().makeScale(0, 0, 0) }), []);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05), t = clock.elapsedTime;
    const H = heights.current;
    const { m, p, q, v, s, up, zero } = tmp;
    let best: string | null = null, bestD = 3.5 * 3.5;
    const pl = player.current;
    for (let i = 0; i < N; i++) {
      // idle wander around your spot (smooth, no randomness per frame)
      const gx = sim.tx[i] + Math.sin(t * 0.31 + sim.phase[i]) * 0.9;
      const gz = sim.tz[i] + Math.cos(t * 0.23 + sim.phase[i] * 1.7) * 0.9;
      const dx = gx - sim.x[i], dz = gz - sim.z[i], d = Math.hypot(dx, dz);
      const speed = Math.max(1.2, d * 1.4);
      const step = Math.min(d, speed * dt);
      const moving = d > 0.05;
      if (moving) {
        sim.x[i] += (dx / d) * step; sim.z[i] += (dz / d) * step;
        const want = Math.atan2(dx, dz);
        let diff = want - sim.heading[i];
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        sim.heading[i] += diff * Math.min(1, dt * 8);
      }
      sim.y[i] = H ? heightAt(H, sim.x[i], sim.z[i]) : 0;
      sim.scale[i] += (sim.target[i] - sim.scale[i]) * Math.min(1, dt * 6);
      const fast = d > 1.5;
      const bob = Math.abs(Math.sin(t * (fast ? 11 : 3) + sim.phase[i])) * (fast ? 0.22 : 0.05);
      const sc = sim.scale[i] * sim.size[i];
      p.compose(v.set(sim.x[i], sim.y[i] + bob, sim.z[i]), q.setFromAxisAngle(up, sim.heading[i]), s.set(sc, sc, sc));
      refs.body.current!.setMatrixAt(i, m.multiplyMatrices(p, L.body));
      refs.head.current!.setMatrixAt(i, m.multiplyMatrices(p, L.head));
      refs.hair.current!.setMatrixAt(i, m.multiplyMatrices(p, L.hair));
      refs.eyes.current!.setMatrixAt(i * 2, m.multiplyMatrices(p, L.eyeL));
      refs.eyes.current!.setMatrixAt(i * 2 + 1, m.multiplyMatrices(p, L.eyeR));
      refs.crown.current!.setMatrixAt(i, sim.crowned[i] ? m.multiplyMatrices(p, L.crown) : zero);
      if (pl && sim.size[i] > 0.5) {
        const pd = (pl.x - sim.x[i]) ** 2 + (pl.z - sim.z[i]) ** 2;
        if (pd < bestD) { bestD = pd; best = nodes[i].id; }
      }
    }
    for (const r of Object.values(refs)) if (r.current) r.current.instanceMatrix.needsUpdate = true;
    if (best !== nearest.current) { nearest.current = best; onNearest(best); }
  });

  const click = (e: { stopPropagation: () => void; instanceId?: number }) => {
    e.stopPropagation();
    if (e.instanceId != null) onSelect(nodes[e.instanceId].id);
  };
  return (
    <group>
      <instancedMesh ref={refs.body} args={[miiGeo.body, white, N]} castShadow frustumCulled={false} onClick={click} />
      <instancedMesh ref={refs.head} args={[miiGeo.head, white, N]} castShadow frustumCulled={false} onClick={click} />
      <instancedMesh ref={refs.hair} args={[miiGeo.hair, white, N]} frustumCulled={false} />
      <instancedMesh ref={refs.eyes} args={[miiGeo.eye, dark, N * 2]} frustumCulled={false} />
      <instancedMesh ref={refs.crown} args={[miiGeo.crown, gold, N]} frustumCulled={false} />
    </group>
  );
}
