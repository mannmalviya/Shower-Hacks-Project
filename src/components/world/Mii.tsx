"use client";
// A blocky sim that walks to its spot and stands on its cash stack.
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const SKIN = ["#ffe0bd", "#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#5c3a1e"];
const HAIR = ["#2b1b0e", "#5a3825", "#d9a441", "#111111", "#a0522d", "#e8e0d0"];

const geo = {
  body: new THREE.BoxGeometry(0.9, 1.1, 0.6),
  head: new THREE.BoxGeometry(0.85, 0.8, 0.8),
  hair: new THREE.BoxGeometry(0.9, 0.25, 0.85),
  eye: new THREE.BoxGeometry(0.12, 0.14, 0.05),
  leg: new THREE.BoxGeometry(0.3, 0.5, 0.35),
  crown: new THREE.ConeGeometry(0.35, 0.45, 5),
  cash: new THREE.BoxGeometry(1.1, 1, 0.7),
};
const mats = new Map<string, THREE.MeshLambertMaterial>();
export const mat = (color: string, opacity = 1) => {
  const key = `${color}-${opacity}`;
  if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity }));
  return mats.get(key)!;
};
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function CashStack({ height, ghost = false }: { height: number; ghost?: boolean }) {
  // bills = slabs; ghost = the projected future you, translucent
  const slabs = Math.max(1, Math.round(height / 0.22));
  const h = height / slabs;
  return (
    <group>
      {Array.from({ length: slabs }, (_, i) => (
        <mesh key={i} geometry={geo.cash} position={[0, h * i + h / 2, 0]} scale={[1, h * 0.92, 1]}
          material={mat(i % 2 ? "#2f9e44" : "#40c057", ghost ? 0.25 : 1)} />
      ))}
    </group>
  );
}

type Props = {
  id: string;
  target: { x: number; y: number; z: number };
  color: string;
  stack: number; // cash stack height under the sim, 0 = none
  crown?: boolean;
  dim?: boolean;
  big?: boolean;
  onSelect?: (id: string) => void;
};

export function Mii({ id, target, color, stack, crown, dim, big, onSelect }: Props) {
  const ref = useRef<THREE.Group>(null);
  const h = hash(id);
  const phase = useMemo(() => (h % 628) / 100, [h]);
  const start = useMemo(() => new THREE.Vector3((h % 80) - 40, 0, ((h >> 4) % 80) - 40), [h]);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const scale = (big ? 1.6 : 1) * (dim ? 0.55 : 1);

  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g) return;
    goal.set(target.x, target.y + stack, target.z);
    const before = g.position.clone();
    g.position.lerp(goal, 0.06);
    const moving = before.distanceToSquared(g.position) > 1e-5;
    if (moving) g.rotation.y = Math.atan2(g.position.x - before.x, g.position.z - before.z);
    else g.rotation.y += (Math.atan2(-g.position.x, -g.position.z) - g.rotation.y) * 0.05; // face you
    const s = g.scale.x + (scale - g.scale.x) * 0.15;
    g.scale.setScalar(s);
    g.children[0].position.y = Math.abs(Math.sin(clock.elapsedTime * (moving ? 10 : 2.5) + phase)) * (moving ? 0.25 : 0.06);
  });

  return (
    <group ref={ref} position={start}
      onClick={(e) => { e.stopPropagation(); onSelect?.(id); }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "")}>
      <group>
        <mesh geometry={geo.leg} position={[-0.2, 0.25, 0]} material={mat("#343a40")} castShadow />
        <mesh geometry={geo.leg} position={[0.2, 0.25, 0]} material={mat("#343a40")} castShadow />
        <mesh geometry={geo.body} position={[0, 1.05, 0]} material={mat(color)} castShadow />
        <mesh geometry={geo.head} position={[0, 2, 0]} material={mat(SKIN[h % SKIN.length])} castShadow />
        <mesh geometry={geo.hair} position={[0, 2.45, -0.02]} material={mat(HAIR[(h >> 3) % HAIR.length])} castShadow />
        <mesh geometry={geo.eye} position={[-0.18, 2.05, 0.41]} material={mat("#212529")} />
        <mesh geometry={geo.eye} position={[0.18, 2.05, 0.41]} material={mat("#212529")} />
        {crown && <mesh geometry={geo.crown} position={[0, 2.85, 0]} material={mat("#ffc800")} />}
      </group>
    </group>
  );
}
