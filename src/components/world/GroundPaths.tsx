"use client";
// Dirt paths between groups: wider = more friendships between the two groups. Works in every category.
// Click a group: its paths light up (with "🤝 12" signs), the others fade.
import { useMemo } from "react";
import * as THREE from "three";
import type { Node } from "@/lib/analysis";
import { heightAt, keysOf, type Category, type WorldLayout } from "./worldLayout";

export type GroupPath = { a: string; b: string; count: number; mid: { x: number; z: number } };

/** Friendships between members of two different groups (by primary key), biggest first. */
export function groupPaths(nodes: Node[], links: [string, string][], layout: WorldLayout, category: Category): GroupPath[] {
  const key = new Map(nodes.filter((n) => n.degree === 1).map((n) => [n.id, keysOf(n, category)[0]]));
  const at = new Map(layout.groups.map((g) => [g.key, g]));
  const counts = new Map<string, number>();
  for (const [x, y] of links) {
    const a = key.get(x), b = key.get(y);
    if (!a || !b || a === b) continue;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, count]) => {
    const [a, b] = k.split("|");
    const ga = at.get(a)!, gb = at.get(b)!;
    return { a, b, count, mid: { x: (ga.x + gb.x) / 2, z: (ga.z + gb.z) / 2 } };
  }).filter((p) => p.count >= 2 && at.has(p.a) && at.has(p.b)).sort((p, q) => q.count - p.count).slice(0, 30);
}

function ribbons(paths: GroupPath[], layout: WorldLayout, max: number, widen: number) {
  const at = new Map(layout.groups.map((g) => [g.key, g]));
  const pos: number[] = [], idx: number[] = [];
  for (const p of paths) {
    const a = at.get(p.a)!, b = at.get(p.b)!;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len, w = (0.5 + (p.count / max) * 2.2) * widen;
    const S = Math.max(8, Math.round(len / 2));
    const base = pos.length / 3;
    for (let i = 0; i <= S; i++) {
      const t = i / S, x = a.x + dx * t, z = a.z + dz * t;
      for (const side of [-1, 1]) {
        const px = x + nx * w * side, pz = z + nz * w * side;
        pos.push(px, heightAt(layout.heights, px, pz) + 0.12, pz);
      }
      if (i < S) {
        const v = base + i * 2;
        idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function GroundPaths({ paths, layout, focus }: { paths: GroupPath[]; layout: WorldLayout; focus: string | null }) {
  const max = paths[0]?.count ?? 1;
  const { lit, dim } = useMemo(() => {
    const on = focus ? paths.filter((p) => p.a === focus || p.b === focus) : paths;
    const off = focus ? paths.filter((p) => p.a !== focus && p.b !== focus) : [];
    return { lit: ribbons(on, layout, max, focus ? 1.3 : 1), dim: ribbons(off, layout, max, 1) };
  }, [paths, layout, focus, max]);
  return (
    <group>
      <mesh geometry={lit} renderOrder={1}>
        <meshLambertMaterial color={focus ? "#fff3bf" : "#e6d3a3"} transparent opacity={focus ? 0.95 : 0.8} depthWrite={false}
          polygonOffset polygonOffsetFactor={-2} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={dim} renderOrder={1}>
        <meshLambertMaterial color="#e6d3a3" transparent opacity={0.2} depthWrite={false} polygonOffset polygonOffsetFactor={-2} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
