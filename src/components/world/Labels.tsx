"use client";
/* eslint-disable react-hooks/immutability -- writes DOM styles every frame on purpose */
// Labels without drei <Html>: plain DOM elements in one overlay, moved every frame by projecting
// their 3D anchor to the screen. No extra React roots and cheaper.
// Decluttering: labels with a priority never overlap; the lower-priority one fades out (hover brings it back).
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export type Anchor = () => readonly [number, number, number] | null;

export function LabelProjector({ anchors, els, priority }: {
  anchors: React.RefObject<Map<string, Anchor>>;
  els: React.RefObject<Map<string, HTMLElement>>;
  priority: React.RefObject<Map<string, number>>; // keys listed here are decluttered, higher wins
}) {
  const v = useMemo(() => new THREE.Vector3(), []);
  const sizes = useRef(new Map<string, [number, number]>());
  const frame = useRef(0);
  useFrame(({ camera, size }) => {
    frame.current++;
    const placed: { x: number; y: number; w: number; h: number; key: string; el: HTMLElement; z: number }[] = [];
    for (const [key, el] of els.current) {
      const p = anchors.current.get(key)?.();
      if (p) v.set(p[0], p[1], p[2]).project(camera);
      if (!p || v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) {
        el.style.visibility = "hidden";
        continue;
      }
      // measure rarely (reading layout every frame is slow)
      if (!sizes.current.has(key) || frame.current % 45 === 0) sizes.current.set(key, [el.offsetWidth, el.offsetHeight]);
      const [w, h] = sizes.current.get(key)!;
      placed.push({ x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height, w, h, key, el, z: v.z });
    }
    const prio = priority.current;
    const kept: typeof placed = [];
    placed.sort((a, b) => (prio.get(b.key) ?? Infinity) - (prio.get(a.key) ?? Infinity));
    for (const l of placed) {
      let hidden = false;
      if (prio.has(l.key)) {
        hidden = kept.some((k) => prio.has(k.key) && Math.abs(k.x - l.x) < (k.w + l.w) / 2 + 4 && Math.abs(k.y - l.y) < (k.h + l.h) / 2 + 2);
        if (!hidden) kept.push(l);
      }
      l.el.style.visibility = "visible";
      l.el.style.opacity = hidden ? "0.08" : "1";
      l.el.style.transform = `translate(${l.x}px, ${l.y}px) translate(-50%, -50%)`;
      l.el.style.zIndex = String(hidden ? 1 : Math.round((1 - l.z) * 1000) + 10);
    }
  });
  return null;
}
