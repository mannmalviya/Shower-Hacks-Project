"use client";
// Island dressing: low-poly pines along the coast, white flowers in the lawn, puffy clouds drifting over the sea.
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { coastAt, heightAt, type WorldLayout } from "./worldLayout";

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const rnd = (i: number, k: number) => (hash(`${i}:${k}`) % 1000) / 1000;

const TRUNK = new THREE.CylinderGeometry(0.22, 0.32, 1.2, 7);
const CONE_LO = new THREE.ConeGeometry(1.7, 2.6, 8);
const CONE_HI = new THREE.ConeGeometry(1.15, 2.2, 8);
const PETALS = new THREE.CylinderGeometry(0.3, 0.3, 0.07, 6);
const CORE = new THREE.SphereGeometry(0.11, 6, 6);
const PUFF = new THREE.SphereGeometry(1, 10, 8);
const lambert = (color: string) => new THREE.MeshLambertMaterial({ color });
const M = { trunk: lambert("#8b5a2b"), lo: lambert("#3fae4f"), hi: lambert("#57c765"), petal: lambert("#ffffff"), core: lambert("#ffd43b"),
  cloud: new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.35, fog: true }) };

type Spot = { x: number; y: number; z: number; s: number };

/** `clear`: radius around the center where people stand (nothing is planted inside it). */
export function Scenery({ layout, clear }: { layout: WorldLayout; clear: number }) {
  const spots = useMemo(() => {
    const trees: Spot[] = [], flowers: Spot[] = [];
    const people = [...layout.pos.values()];
    const free = (x: number, z: number, d: number) => people.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 > d * d);
    for (let i = 0; i < 160 && trees.length < 46; i++) {
      const a = i * GOLDEN + 0.3, coast = coastAt(layout.island, a);
      const r = coast - 5 - rnd(i, 1) * 11;
      if (r < clear + 4) continue;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = heightAt(layout.heights, x, z);
      if (y < -0.2 || !free(x, z, 3)) continue;
      trees.push({ x, y, z, s: 0.8 + rnd(i, 2) * 0.6 });
    }
    for (let i = 0; i < 400 && flowers.length < 140; i++) {
      const a = rnd(i, 3) * Math.PI * 2, coast = coastAt(layout.island, a);
      const r = Math.sqrt(rnd(i, 4)) * (coast - 6);
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = heightAt(layout.heights, x, z);
      if (y < -0.2 || !free(x, z, 2.2)) continue;
      flowers.push({ x, y, z, s: 0.7 + rnd(i, 5) * 0.6 });
    }
    return { trees, flowers };
  }, [layout, clear]);
  return <Plants {...spots} />;
}

/** Flat island (the open world): trees on the coast, flowers on the lawn, keeping clear of every crowd in `avoid`. */
export function FlatScenery({ cx, cz, radius, avoid }: { cx: number; cz: number; radius: number; avoid: { x: number; z: number; r: number }[] }) {
  const spots = useMemo(() => {
    const trees: Spot[] = [], flowers: Spot[] = [];
    const free = (x: number, z: number, pad: number) => avoid.every((a) => (a.x - x) ** 2 + (a.z - z) ** 2 > (a.r + pad) ** 2);
    for (let i = 0; i < 220 && trees.length < 60; i++) {
      const a = i * GOLDEN + 0.3, r = radius - 4 - rnd(i, 1) * 12;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!free(x, z, 2)) continue;
      trees.push({ x, y: 0, z, s: 0.8 + rnd(i, 2) * 0.6 });
    }
    for (let i = 0; i < 500 && flowers.length < 160; i++) {
      const a = rnd(i, 3) * Math.PI * 2, r = Math.sqrt(rnd(i, 4)) * (radius - 5);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!free(x, z, 1)) continue;
      flowers.push({ x, y: 0, z, s: 0.7 + rnd(i, 5) * 0.6 });
    }
    return { trees, flowers };
  }, [cx, cz, radius, avoid]);
  return <Plants {...spots} />;
}

function Plants({ trees, flowers }: { trees: Spot[]; flowers: Spot[] }) {
  const trunk = useRef<THREE.InstancedMesh>(null), lo = useRef<THREE.InstancedMesh>(null), hi = useRef<THREE.InstancedMesh>(null);
  const petal = useRef<THREE.InstancedMesh>(null), core = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    trees.forEach((t, i) => {
      const rot = q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd(i, 6) * Math.PI * 2);
      trunk.current!.setMatrixAt(i, m.compose(v.set(t.x, t.y + 0.55 * t.s, t.z), rot, s.set(t.s, t.s, t.s)));
      lo.current!.setMatrixAt(i, m.compose(v.set(t.x, t.y + 2.1 * t.s, t.z), rot, s.set(t.s, t.s, t.s)));
      hi.current!.setMatrixAt(i, m.compose(v.set(t.x, t.y + 3.6 * t.s, t.z), rot, s.set(t.s, t.s, t.s)));
    });
    flowers.forEach((f, i) => {
      q.identity();
      petal.current!.setMatrixAt(i, m.compose(v.set(f.x, f.y + 0.05, f.z), q, s.set(f.s, 1, f.s)));
      core.current!.setMatrixAt(i, m.compose(v.set(f.x, f.y + 0.1, f.z), q, s.set(f.s, f.s, f.s)));
    });
    for (const r of [trunk, lo, hi, petal, core]) if (r.current) r.current.instanceMatrix.needsUpdate = true;
  }, [trees, flowers]);

  return (
    <group>
      {trees.length > 0 && <group key={`t${trees.length}`}>
        <instancedMesh ref={trunk} args={[TRUNK, M.trunk, trees.length]} castShadow />
        <instancedMesh ref={lo} args={[CONE_LO, M.lo, trees.length]} castShadow />
        <instancedMesh ref={hi} args={[CONE_HI, M.hi, trees.length]} castShadow />
      </group>}
      {flowers.length > 0 && <group key={`f${flowers.length}`}>
        <instancedMesh ref={petal} args={[PETALS, M.petal, flowers.length]} />
        <instancedMesh ref={core} args={[CORE, M.core, flowers.length]} />
      </group>}
    </group>
  );
}

/** Puffy clouds circling slowly over the sea. `radius`: how far from the center they float. */
export function Clouds({ center = [0, 0], radius = 150, count = 9 }: { center?: [number, number]; radius?: number; count?: number }) {
  const puffs = useMemo(() => {
    const out: { cx: number; cz: number; y: number; dx: number; dz: number; s: number }[] = [];
    for (let c = 0; c < count; c++) {
      const a = (c / count) * Math.PI * 2 + rnd(c, 7), r = radius * (0.85 + rnd(c, 8) * 0.5), y = 42 + rnd(c, 9) * 26;
      const n = 4 + (hash(`c${c}`) % 3);
      for (let k = 0; k < n; k++) out.push({ cx: Math.cos(a) * r, cz: Math.sin(a) * r, y, dx: (k - n / 2) * 4.2, dz: (rnd(c * 10 + k, 10) - 0.5) * 3, s: 3.2 + rnd(c * 10 + k, 11) * 3 - Math.abs(k - n / 2) * 0.7 });
    }
    return out;
  }, [count, radius]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    puffs.forEach((p, i) => ref.current!.setMatrixAt(i, m.compose(v.set(p.cx + p.dx, p.y, p.cz + p.dz), q, s.set(p.s * 1.25, p.s * 0.7, p.s))));
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [puffs]);
  useFrame(({ clock }) => { if (group.current) group.current.rotation.y = clock.elapsedTime * 0.008; });
  return (
    <group ref={group} position={[center[0], 0, center[1]]}>
      <instancedMesh ref={ref} args={[PUFF, M.cloud, puffs.length]} frustumCulled={false} />
    </group>
  );
}
