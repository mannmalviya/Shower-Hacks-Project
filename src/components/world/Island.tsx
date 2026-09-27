"use client";
// The world is an island: sea all around, and low-poly trees on the open ground (instanced: 2 draw calls).
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export const SEA_LEVEL = -0.8;

/** Sea all around (a big disc just below the island's shore). */
export function Sea({ cx = 0, cz = 0 }: { cx?: number; cz?: number }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[cx, SEA_LEVEL, cz]}>
      <circleGeometry args={[2500, 64]} />
      <meshLambertMaterial color="#4dabf7" />
    </mesh>
  );
}

/** A flat island (open world): grass disc with a sand beach ring. */
export function FlatIsland({ cx, cz, radius, onGround }: { cx: number; cz: number; radius: number; onGround?: (p: THREE.Vector3) => void }) {
  return (
    <group position={[cx, 0, cz]}>
      <mesh rotation-x={-Math.PI / 2} receiveShadow onClick={(e) => { e.stopPropagation(); onGround?.(e.point.clone()); }}>
        <circleGeometry args={[radius, 96]} />
        <meshLambertMaterial color="#8fd675" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.02}>
        <ringGeometry args={[radius - 1, radius + 9, 96]} />
        <meshLambertMaterial color="#f1dfa4" />
      </mesh>
    </group>
  );
}

export type TreeSpot = { x: number; z: number; y: number; s: number };
type Circle = { x: number; z: number; r: number };

/** Random tree spots in the ring inner..outer around (cx, cz), never inside an `avoid` circle. Stable for a seed. */
export function treeSpots(cx: number, cz: number, inner: number, outer: number, count: number, seed: number, avoid: Circle[] = [],
  heightAt?: (x: number, z: number) => number): TreeSpot[] {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const out: TreeSpot[] = [];
  for (let tries = 0; out.length < count && tries < count * 20; tries++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(inner * inner + rnd() * (outer * outer - inner * inner));
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (avoid.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r)) continue;
    if (out.some((t) => (x - t.x) ** 2 + (z - t.z) ** 2 < 9)) continue; // not on top of each other
    out.push({ x, z, y: heightAt?.(x, z) ?? 0, s: 0.8 + rnd() * 0.9 });
  }
  return out;
}

const TRUNK = new THREE.CylinderGeometry(0.25, 0.35, 2, 6).translate(0, 1, 0);
const LEAVES = new THREE.ConeGeometry(1.5, 3.4, 7).translate(0, 3.6, 0);
const TRUNK_MAT = new THREE.MeshLambertMaterial({ color: "#8d5b3c" });
const LEAF_MAT = new THREE.MeshLambertMaterial({ color: "#ffffff" });
const LEAF_GREENS = ["#2f9e44", "#37b24d", "#40c057", "#2b8a3e"].map((c) => new THREE.Color(c));

/** Low-poly pines, one instanced mesh for trunks and one for leaves. */
export function Trees({ spots }: { spots: TreeSpot[] }) {
  const trunk = useRef<THREE.InstancedMesh>(null), leaves = useRef<THREE.InstancedMesh>(null);
  const m = useMemo(() => new THREE.Matrix4(), []);
  useLayoutEffect(() => {
    spots.forEach((t, i) => {
      m.makeScale(t.s, t.s, t.s).setPosition(t.x, t.y, t.z);
      trunk.current?.setMatrixAt(i, m);
      leaves.current?.setMatrixAt(i, m);
      leaves.current?.setColorAt(i, LEAF_GREENS[i % LEAF_GREENS.length]);
    });
    for (const r of [trunk, leaves]) if (r.current) r.current.instanceMatrix.needsUpdate = true;
    if (leaves.current?.instanceColor) leaves.current.instanceColor.needsUpdate = true;
  }, [spots, m]);
  if (!spots.length) return null;
  return (
    <group key={spots.length}>
      <instancedMesh ref={trunk} args={[TRUNK, TRUNK_MAT, spots.length]} castShadow />
      <instancedMesh ref={leaves} args={[LEAVES, LEAF_MAT, spots.length]} castShadow />
    </group>
  );
}
