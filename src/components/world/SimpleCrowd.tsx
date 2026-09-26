"use client";
// Thousands of simple Miis (one merged low-poly body + head) in ONE instanced mesh: one draw call.
// Static spots, a slow shared sway. Used for NPCs and for the open world.
import type { ThreeEvent } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const GEO = mergeGeometries([
  new THREE.CylinderGeometry(0.55, 0.85, 1.6, 7).translate(0, 0.8, 0),
  new THREE.SphereGeometry(0.75, 8, 6).translate(0, 2.2, 0),
]);
const MAT = new THREE.MeshLambertMaterial({ color: "#ffffff" });

type Props = {
  x: Float32Array;
  z: Float32Array;
  colors: string[]; // one per sim
  scales?: Float32Array; // default 1
  dim?: (i: number) => boolean; // shrink (faded out by a filter)
  onSelect?: (i: number) => void;
};

export function SimpleCrowd({ x, z, colors, scales, dim, onSelect }: Props) {
  const N = x.length;
  const mesh = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), c: new THREE.Color() }), []);

  useEffect(() => {
    const im = mesh.current;
    if (!im) return;
    for (let i = 0; i < N; i++) im.setColorAt(i, tmp.c.set(colors[i] ?? "#ced4da"));
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, [N, colors, tmp]);

  // sway: every sim turns a little around its own heading (cheap: 1 matrix per sim, only every 4th frame)
  const frame = useRef(0);
  useFrame(({ clock }) => {
    const im = mesh.current;
    if (!im || (frame.current++ % 4 && frame.current > 4)) return;
    const t = clock.elapsedTime;
    for (let i = 0; i < N; i++) {
      const sc = (scales?.[i] ?? 1) * (dim?.(i) ? 0.5 : 1);
      tmp.q.setFromAxisAngle(tmp.up, i * 2.4 + Math.sin(t * 0.8 + i) * 0.5);
      im.setMatrixAt(i, tmp.m.compose(tmp.v.set(x[i], 0, z[i]), tmp.q, tmp.s.set(sc, sc, sc)));
    }
    im.instanceMatrix.needsUpdate = true;
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId != null) onSelect?.(e.instanceId);
  };
  // key: an instanced mesh cannot grow, so a new size means a new mesh
  return <instancedMesh key={N} ref={mesh} args={[GEO, MAT, N]} frustumCulled={false} castShadow onClick={click} />;
}
