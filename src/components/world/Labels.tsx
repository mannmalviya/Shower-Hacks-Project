"use client";
/* eslint-disable react-hooks/immutability -- writes DOM styles every frame on purpose */
// Labels without drei <Html>: plain DOM elements in one overlay, moved every frame by projecting
// their 3D anchor to the screen. No extra React roots (fixes the "synchronously unmount a root" error) and cheaper.
import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";

export type Anchor = () => readonly [number, number, number] | null;

export function LabelProjector({ anchors, els }: {
  anchors: React.RefObject<Map<string, Anchor>>;
  els: React.RefObject<Map<string, HTMLElement>>;
}) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const [key, el] of els.current) {
      const p = anchors.current.get(key)?.();
      if (p) v.set(p[0], p[1], p[2]).project(camera);
      if (!p || v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "visible";
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -50%)`;
      el.style.zIndex = String(Math.round((1 - v.z) * 1000)); // nearer labels on top
    }
  });
  return null;
}
