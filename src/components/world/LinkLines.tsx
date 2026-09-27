"use client";
/* eslint-disable react-hooks/immutability -- line buffers rewritten every frame on purpose */
// Glowing lines on the lawn between people who are linked, following them as they stroll. Colored by their groups.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { CrowdState } from "./Crowd";
import { heightAt, type WorldLayout } from "./worldLayout";

const WHITE = new THREE.Color("#ffffff");
const SEGS = 4; // points per link, so the line hugs the hills
const MAX = 320; // the shortest links only, so the lawn reads as neighborhoods, not a hairball
const REACH = 34;

export function LinkLines({ links, crowd, layout, heights, egoId }: {
  links: [string, string][];
  crowd: React.RefObject<CrowdState | null>;
  layout: WorldLayout;
  heights: React.RefObject<Float32Array>;
  egoId: string;
}) {
  // spokes to you are implied (everyone here is your contact); draw only the links between them
  const pairs = useMemo(() => {
    const d = ([a, b]: [string, string]) => { const p = layout.pos.get(a), q = layout.pos.get(b); return p && q ? Math.hypot(p.x - q.x, p.z - q.z) : Infinity; };
    return links.filter(([a, b]) => a !== egoId && b !== egoId && d([a, b]) < REACH).sort((x, y) => d(x) - d(y)).slice(0, MAX);
  }, [links, egoId, layout]);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX * SEGS * 2 * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX * SEGS * 2 * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }), []);
  const ca = useMemo(() => new THREE.Color(), []), cb = useMemo(() => new THREE.Color(), []), cm = useMemo(() => new THREE.Color(), []);
  const index = useRef(new Map<string, number>());
  const lastIds = useRef<string[] | null>(null);

  useFrame(() => {
    const st = crowd.current, H = heights.current;
    if (!st) return;
    if (st.ids !== lastIds.current) { lastIds.current = st.ids; index.current = new Map(st.ids.map((id, i) => [id, i])); }
    const idx = index.current;
    const pos = geo.attributes.position.array as Float32Array, col = geo.attributes.color.array as Float32Array;
    let k = 0;
    for (const [a, b] of pairs) {
      const i = idx.get(a), j = idx.get(b);
      if (i == null || j == null) continue;
      ca.set(layout.colorOf.get(a) ?? "#ffffff").lerp(WHITE, 0.35);
      cb.set(layout.colorOf.get(b) ?? "#ffffff").lerp(WHITE, 0.35);
      let px = st.x[i], pz = st.z[i], py = heightAt(H, px, pz) + 0.22;
      for (let s = 1; s <= SEGS; s++) {
        const t = s / SEGS, x = st.x[i] + (st.x[j] - st.x[i]) * t, z = st.z[i] + (st.z[j] - st.z[i]) * t, y = heightAt(H, x, z) + 0.22;
        cm.copy(ca).lerp(cb, (s - 0.5) / SEGS);
        pos[k * 6] = px; pos[k * 6 + 1] = py; pos[k * 6 + 2] = pz; pos[k * 6 + 3] = x; pos[k * 6 + 4] = y; pos[k * 6 + 5] = z;
        col[k * 6] = cm.r; col[k * 6 + 1] = cm.g; col[k * 6 + 2] = cm.b; col[k * 6 + 3] = cm.r; col[k * 6 + 4] = cm.g; col[k * 6 + 5] = cm.b;
        px = x; py = y; pz = z; k++;
      }
    }
    geo.setDrawRange(0, k * 2);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  });
  return <lineSegments geometry={geo} material={mat} frustumCulled={false} renderOrder={1} />;
}
