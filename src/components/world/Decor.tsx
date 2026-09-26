"use client";
// Mii-village scenery: trees, bushes, flowers and drifting clouds (instanced). Trees shrink away when a crowd
// moves onto their spot and grow back when it leaves, so the decor never hides people.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { heightAt, type WorldLayout } from "./worldLayout";

const rnd = (i: number, k: number) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
type Kind = "round" | "pine" | "bush" | "flower";
const SPOTS = Array.from({ length: 420 }, (_, i) => {
  const r = 14 + Math.sqrt(rnd(i, 1)) * 112, a = rnd(i, 2) * Math.PI * 2, roll = rnd(i, 3);
  const kind: Kind = roll < 0.28 ? "round" : roll < 0.45 ? "pine" : roll < 0.65 ? "bush" : "flower";
  return { x: Math.cos(a) * r, z: Math.sin(a) * r, kind, size: 0.8 + rnd(i, 4) * 0.6, color: i % 3 };
});
const GEO = {
  trunk: new THREE.CylinderGeometry(0.22, 0.32, 1.6, 7),
  round: new THREE.SphereGeometry(1.5, 10, 8),
  pine: new THREE.ConeGeometry(1.3, 3.2, 8),
  bush: new THREE.SphereGeometry(0.8, 8, 6),
  flower: new THREE.SphereGeometry(0.2, 6, 4),
  cloud: new THREE.SphereGeometry(4, 10, 8),
};
const MAT = {
  trunk: new THREE.MeshLambertMaterial({ color: "#8d5b3a" }),
  leaves: new THREE.MeshLambertMaterial({ color: "#ffffff" }),
  flower: new THREE.MeshLambertMaterial({ color: "#ffffff" }),
  cloud: new THREE.MeshLambertMaterial({ color: "#ffffff", transparent: true, opacity: 0.92 }),
};
const LEAF = ["#5cb85c", "#40a060", "#7ccf5a"].map((c) => new THREE.Color(c));
const PETAL = ["#ff8fab", "#ffd43b", "#ffffff"].map((c) => new THREE.Color(c));
const CLOUDS = Array.from({ length: 14 }, (_, i) => ({ x: (rnd(i, 7) - 0.5) * 300, z: (rnd(i, 8) - 0.5) * 260, y: 42 + rnd(i, 9) * 14, s: 0.7 + rnd(i, 10) * 0.8 }));

export function Decor({ layout, heights }: { layout: WorldLayout; heights: React.RefObject<Float32Array> }) {
  const trees = useMemo(() => SPOTS.filter((s) => s.kind === "round" || s.kind === "pine"), []);
  const bushes = useMemo(() => SPOTS.filter((s) => s.kind === "bush"), []);
  const flowers = useMemo(() => SPOTS.filter((s) => s.kind === "flower"), []);
  const trunk = useRef<THREE.InstancedMesh>(null), round = useRef<THREE.InstancedMesh>(null), pine = useRef<THREE.InstancedMesh>(null);
  const bush = useRef<THREE.InstancedMesh>(null), flower = useRef<THREE.InstancedMesh>(null), cloud = useRef<THREE.InstancedMesh>(null);
  const roundIdx = useMemo(() => trees.map((t) => t.kind === "round"), [trees]);

  // which spots are free in this layout (nobody within a few meters)
  const target = useRef({ trees: new Float32Array(trees.length), bushes: new Float32Array(bushes.length), flowers: new Float32Array(flowers.length) });
  const scale = useRef({ trees: new Float32Array(trees.length), bushes: new Float32Array(bushes.length), flowers: new Float32Array(flowers.length) });
  useEffect(() => {
    const people = [...layout.pos.values()];
    const free = (s: { x: number; z: number }, r: number) => !people.some((p) => (p.x - s.x) ** 2 + (p.z - s.z) ** 2 < r * r)
      && Math.hypot(s.x - layout.ego.x, s.z - layout.ego.z) > 7;
    trees.forEach((s, i) => (target.current.trees[i] = free(s, 4.5) ? s.size : 0));
    bushes.forEach((s, i) => (target.current.bushes[i] = free(s, 3) ? s.size : 0));
    flowers.forEach((s, i) => (target.current.flowers[i] = free(s, 1.8) ? 1 : 0));
  }, [layout, trees, bushes, flowers]);

  useEffect(() => {
    trees.forEach((s, i) => (roundIdx[i] ? round : pine).current?.setColorAt(i, LEAF[s.color]));
    bushes.forEach((s, i) => bush.current?.setColorAt(i, LEAF[(s.color + 1) % 3]));
    flowers.forEach((s, i) => flower.current?.setColorAt(i, PETAL[s.color]));
    for (const r of [round, pine, bush, flower]) if (r.current?.instanceColor) r.current.instanceColor.needsUpdate = true;
  }, [trees, bushes, flowers, roundIdx]);

  const m = useMemo(() => new THREE.Matrix4(), []), q = useMemo(() => new THREE.Quaternion(), []);
  const v = useMemo(() => new THREE.Vector3(), []), s3 = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }, delta) => {
    const H = heights.current, k = Math.min(1, delta * 3), t = clock.elapsedTime;
    const place = (mesh: THREE.InstancedMesh | null, i: number, x: number, y: number, z: number, sx: number, sy = sx) =>
      mesh?.setMatrixAt(i, m.compose(v.set(x, y, z), q, s3.set(sx, sy, sx)));
    trees.forEach((s, i) => {
      const sc = (scale.current.trees[i] += (target.current.trees[i] - scale.current.trees[i]) * k);
      const y = heightAt(H, s.x, s.z);
      place(trunk.current, i, s.x, y + 0.8 * sc, s.z, sc);
      if (roundIdx[i]) { place(round.current, i, s.x, y + 2.6 * sc, s.z, sc); place(pine.current, i, 0, -99, 0, 0); }
      else { place(pine.current, i, s.x, y + 2.9 * sc, s.z, sc); place(round.current, i, 0, -99, 0, 0); }
    });
    bushes.forEach((s, i) => {
      const sc = (scale.current.bushes[i] += (target.current.bushes[i] - scale.current.bushes[i]) * k);
      place(bush.current, i, s.x, heightAt(H, s.x, s.z) + 0.4 * sc, s.z, sc, sc * 0.75);
    });
    flowers.forEach((s, i) => {
      const sc = (scale.current.flowers[i] += (target.current.flowers[i] - scale.current.flowers[i]) * k);
      place(flower.current, i, s.x, heightAt(H, s.x, s.z) + 0.2, s.z, sc);
    });
    CLOUDS.forEach((c, i) => {
      const x = ((c.x + t * 1.2 + 150) % 300) - 150;
      place(cloud.current, i, x, c.y, c.z, c.s * 1.6, c.s * 0.7);
    });
    for (const r of [trunk, round, pine, bush, flower, cloud]) if (r.current) r.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={trunk} args={[GEO.trunk, MAT.trunk, trees.length]} castShadow frustumCulled={false} />
      <instancedMesh ref={round} args={[GEO.round, MAT.leaves, trees.length]} castShadow frustumCulled={false} />
      <instancedMesh ref={pine} args={[GEO.pine, MAT.leaves, trees.length]} castShadow frustumCulled={false} />
      <instancedMesh ref={bush} args={[GEO.bush, MAT.leaves, bushes.length]} frustumCulled={false} />
      <instancedMesh ref={flower} args={[GEO.flower, MAT.flower, flowers.length]} frustumCulled={false} />
      <instancedMesh ref={cloud} args={[GEO.cloud, MAT.cloud, CLOUDS.length]} frustumCulled={false} />
    </group>
  );
}
