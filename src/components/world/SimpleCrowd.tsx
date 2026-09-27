"use client";
// Thousands of Miis (same parts and palettes as <Crowd>: body, skin-tone head, hair, eyes) in 4 instanced
// meshes. Each one strolls a small loop around its spot. Used for NPCs and for the open world.
import type { ThreeEvent } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { HAIR, SKIN, hash, miiGeo } from "./Crowd";

const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const L = { // same local offsets as <Crowd>
  body: T(0, 0.8, 0), head: T(0, 2.2, 0), hair: T(0, 2.3, 0).multiply(new THREE.Matrix4().makeRotationX(-0.25)),
  eyeL: T(-0.25, 2.25, 0.68), eyeR: T(0.25, 2.25, 0.68),
};
const WHITE = new THREE.MeshLambertMaterial({ color: "#ffffff" });
const DARK = new THREE.MeshBasicMaterial({ color: "#212529" });

type Props = {
  x: Float32Array;
  z: Float32Array;
  colors: string[]; // body color, one per sim
  scales?: Float32Array; // default 1
  seed?: string; // varies skin / hair between crowds
  onSelect?: (i: number) => void;
};

export function SimpleCrowd({ x, z, colors, scales, seed = "", onSelect }: Props) {
  const N = x.length;
  const body = useRef<THREE.InstancedMesh>(null), head = useRef<THREE.InstancedMesh>(null);
  const hair = useRef<THREE.InstancedMesh>(null), eyes = useRef<THREE.InstancedMesh>(null);
  const phase = useMemo(() => Float32Array.from({ length: N }, (_, i) => (hash(`${seed}${i}`) % 628) / 100), [N, seed]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(),
    s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), c: new THREE.Color() }), []);

  useEffect(() => {
    for (let i = 0; i < N; i++) {
      const h = hash(`${seed}${i}`);
      body.current?.setColorAt(i, tmp.c.set(colors[i] ?? "#ced4da"));
      head.current?.setColorAt(i, SKIN[h % SKIN.length]);
      hair.current?.setColorAt(i, HAIR[(h >>> 3) % HAIR.length]);
    }
    for (const r of [body, head, hair]) if (r.current?.instanceColor) r.current.instanceColor.needsUpdate = true;
  }, [N, colors, seed, tmp]);

  const frame = useRef(0);
  useFrame(({ clock }) => {
    // big crowds animate every other frame (still smooth, half the cost)
    if (N > 1500 && frame.current++ % 2) return;
    const t = clock.elapsedTime, { m, p, q, v, s, up } = tmp;
    for (let i = 0; i < N; i++) {
      const ph = phase[i], sc = scales?.[i] ?? 1;
      const dx = Math.sin(t * 0.25 + ph) * 0.6, dz = Math.cos(t * 0.19 + ph * 1.7) * 0.6; // stroll a small loop
      const heading = Math.atan2(Math.cos(t * 0.25 + ph) * 0.25, -Math.sin(t * 0.19 + ph * 1.7) * 0.19);
      p.compose(v.set(x[i] + dx, Math.abs(Math.sin(t * 3 + ph)) * 0.05, z[i] + dz), q.setFromAxisAngle(up, heading), s.set(sc, sc, sc));
      body.current!.setMatrixAt(i, m.multiplyMatrices(p, L.body));
      head.current!.setMatrixAt(i, m.multiplyMatrices(p, L.head));
      hair.current!.setMatrixAt(i, m.multiplyMatrices(p, L.hair));
      eyes.current!.setMatrixAt(i * 2, m.multiplyMatrices(p, L.eyeL));
      eyes.current!.setMatrixAt(i * 2 + 1, m.multiplyMatrices(p, L.eyeR));
    }
    for (const r of [body, head, hair, eyes]) if (r.current) r.current.instanceMatrix.needsUpdate = true;
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId != null) onSelect?.(e.instanceId);
  };
  // key: an instanced mesh cannot grow, so a new size means new meshes
  return (
    <group key={N}>
      <instancedMesh ref={body} args={[miiGeo.body, WHITE, N]} castShadow frustumCulled={false} onClick={click} />
      <instancedMesh ref={head} args={[miiGeo.head, WHITE, N]} castShadow frustumCulled={false} onClick={click} />
      <instancedMesh ref={hair} args={[miiGeo.hair, WHITE, N]} frustumCulled={false} />
      <instancedMesh ref={eyes} args={[miiGeo.eye, DARK, N * 2]} frustumCulled={false} />
    </group>
  );
}
