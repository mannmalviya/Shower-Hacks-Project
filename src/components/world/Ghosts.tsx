"use client";
// Friends of friends as little ghosts: translucent, floating, drifting around the friend they hang off.
// You don't really know them; they haunt the edges of your world.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Node } from "@/lib/analysis";
import { hash } from "./Crowd";
import { heightAt, type WorldLayout } from "./worldLayout";

// a Mii-ish ghost: round head melting into a flared sheet
const sheet = new THREE.LatheGeometry(
  [[0, 1.9], [0.55, 1.75], [0.72, 1.3], [0.78, 0.7], [0.9, 0.15], [0.7, 0.05], [0.55, 0.2], [0.4, 0.05], [0.25, 0.2], [0, 0.1]]
    .map(([x, y]) => new THREE.Vector2(x, y)), 18);
const eye = new THREE.SphereGeometry(0.11, 8, 6);
const ghostMat = new THREE.MeshLambertMaterial({ color: "#eef6ff", emissive: "#9ec5fe", emissiveIntensity: 0.25, transparent: true, opacity: 0.55, depthWrite: false });
const eyeMat = new THREE.MeshBasicMaterial({ color: "#343a40", transparent: true, opacity: 0.8 });
const eyeL = new THREE.Matrix4().makeTranslation(-0.22, 1.45, 0.7), eyeR = new THREE.Matrix4().makeTranslation(0.22, 1.45, 0.7);

export function Ghosts({ nodes, layout, heights, onSelect }: {
  nodes: Node[]; // 2nd degree
  layout: WorldLayout;
  heights: React.RefObject<Float32Array>;
  onSelect: (id: string) => void;
}) {
  const N = nodes.length;
  const bodies = useRef<THREE.InstancedMesh>(null), eyes = useRef<THREE.InstancedMesh>(null);
  const phase = useMemo(() => Float32Array.from(nodes, (n) => (hash(n.id) % 628) / 100), [nodes]);
  const tmp = useMemo(() => ({ p: new THREE.Matrix4(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) }), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime, H = heights.current, { p, m, q, v, s, up } = tmp;
    nodes.forEach((n, i) => {
      const base = layout.pos.get(n.id) ?? { x: 0, z: 0 };
      const x = base.x + Math.sin(t * 0.15 + phase[i]) * 1.8, z = base.z + Math.cos(t * 0.12 + phase[i] * 1.3) * 1.8;
      const y = (H ? heightAt(H, x, z) : 0) + 0.9 + Math.sin(t * 1.3 + phase[i]) * 0.3;
      const sway = Math.sin(t * 0.9 + phase[i]) * 0.12;
      p.compose(v.set(x, y, z), q.setFromAxisAngle(up, Math.atan2(-x, -z) + sway), s.setScalar(0.75));
      bodies.current!.setMatrixAt(i, p);
      eyes.current!.setMatrixAt(i * 2, m.multiplyMatrices(p, eyeL));
      eyes.current!.setMatrixAt(i * 2 + 1, m.multiplyMatrices(p, eyeR));
    });
    bodies.current!.instanceMatrix.needsUpdate = true;
    eyes.current!.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={bodies} args={[sheet, ghostMat, N]} frustumCulled={false}
        onClick={(e) => { e.stopPropagation(); if (e.instanceId != null) onSelect(nodes[e.instanceId].id); }} />
      <instancedMesh ref={eyes} args={[eye, eyeMat, N * 2]} frustumCulled={false} />
    </group>
  );
}
