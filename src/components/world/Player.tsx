"use client";
/* eslint-disable react-hooks/immutability -- imperative three.js animation state, mutated every frame on purpose */
// You: a Mii you walk around (WASD / ZQSD / arrows, or click the ground), riding your cash stack,
// with the ghost stack of "future you" floating next to you. The camera follows over your shoulder.
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { miiGeo } from "./Crowd";
import { heightAt } from "./worldLayout";

const cash = new THREE.BoxGeometry(1.9, 1, 1.3), strap = new THREE.BoxGeometry(0.6, 1.02, 1.34);
const green = [new THREE.MeshLambertMaterial({ color: "#3fcf5c" }), new THREE.MeshLambertMaterial({ color: "#34b64f" })];
const paper = new THREE.MeshLambertMaterial({ color: "#f4fff6" });
const ghost = new THREE.MeshLambertMaterial({ color: "#40c057", transparent: true, opacity: 0.22 });
const gold = new THREE.MeshLambertMaterial({ color: "#ffc800", emissive: "#ffb300", emissiveIntensity: 0.35 });
const ray = new THREE.BoxGeometry(0.12, 0.5, 0.12);
/** Soft radial glow sprite behind the crown. */
function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!, r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  r.addColorStop(0, "rgba(255,225,120,0.95)"); r.addColorStop(0.45, "rgba(255,210,80,0.35)"); r.addColorStop(1, "rgba(255,200,60,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Cash stack height (world units): log scale, so billionaires don't reach the moon. */
export const stackHeight = (mid: number | null | undefined) => (!mid || mid <= 0 ? 0.15 : Math.max(0.15, (Math.log10(mid) - 3) * 1.1));

export function CashStack({ height, isGhost = false }: { height: number; isGhost?: boolean }) {
  const slabs = Math.max(1, Math.round(height / 0.55)), h = height / slabs;
  return (
    <group>
      {Array.from({ length: slabs }, (_, i) => (
        <mesh key={i} geometry={cash} position={[0, h * i + h / 2, 0]} scale={[1, h * 0.94, 1]} material={isGhost ? ghost : green[i % 2]} castShadow receiveShadow />
      ))}
      {!isGhost && <mesh geometry={strap} position={[0, height / 2, 0]} scale={[1, height, 1]} material={paper} />}
    </group>
  );
}

/** Your crown: gold, glowing, with little rays that pulse. */
function Crown() {
  const tex = useMemo(() => glowTexture(), []);
  const rays = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!rays.current) return;
    const k = 1 + Math.sin(clock.elapsedTime * 3) * 0.12;
    rays.current.scale.setScalar(k);
    rays.current.rotation.y = clock.elapsedTime * 0.4;
  });
  return (
    <group position={[0, 3.35, 0]}>
      <sprite scale={[3.2, 3.2, 1]} position={[0, 0.3, -0.2]}><spriteMaterial map={tex} transparent depthWrite={false} /></sprite>
      <mesh geometry={miiGeo.crown} material={gold} castShadow />
      <mesh geometry={miiGeo.crown} material={gold} position={[0, 0.02, 0]} rotation-y={Math.PI / 5} scale={[0.85, 1.1, 0.85]} />
      <group ref={rays}>
        {Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return <mesh key={i} geometry={ray} material={gold} position={[Math.cos(a) * 1.1, 0.55 + Math.sin(i) * 0.1, Math.sin(a) * 1.1]} rotation-z={Math.cos(a) * 0.6} rotation-x={-Math.sin(a) * 0.6} />;
        })}
      </group>
    </group>
  );
}

const KEYS = {
  up: ["w", "z", "arrowup"], down: ["s", "arrowdown"], left: ["a", "q", "arrowleft"], right: ["d", "arrowright"],
};

type Props = {
  heights: React.RefObject<Float32Array>;
  pos: React.RefObject<THREE.Vector3>; // shared: the crowd uses it to find who is near you
  walkTo: React.RefObject<THREE.Vector3 | null>;
  keys: React.RefObject<Set<string>>;
  follow: boolean;
  stack: number;
  ghostStack: number | null;
  children?: React.ReactNode; // labels that ride with you
};

export function Player({ heights, pos, walkTo, keys, follow, stack, ghostStack, children }: Props) {
  const ref = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const heading = useRef(0);
  const camGoal = useRef(new THREE.Vector3());
  const pullBack = useRef(0); // frames left of the zoom-out when switching to overview
  const wasFollowing = useRef(follow);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.05), k = keys.current, p = pos.current;
    let dx = 0, dz = 0;
    if (KEYS.up.some((x) => k.has(x))) dz -= 1;
    if (KEYS.down.some((x) => k.has(x))) dz += 1;
    if (KEYS.left.some((x) => k.has(x))) dx -= 1;
    if (KEYS.right.some((x) => k.has(x))) dx += 1;
    let speed = 9;
    if (dx || dz) {
      walkTo.current = null;
    } else if (walkTo.current) {
      dx = walkTo.current.x - p.x; dz = walkTo.current.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.2) walkTo.current = null;
      speed = Math.min(14, Math.max(4, d * 1.5));
    }
    const len = Math.hypot(dx, dz);
    const moving = len > 0.01;
    if (moving) {
      const step = Math.min(speed * dt, walkTo.current ? Math.hypot(walkTo.current.x - p.x, walkTo.current.z - p.z) : Infinity);
      p.x += (dx / len) * step; p.z += (dz / len) * step;
      let diff = Math.atan2(dx, dz) - heading.current;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      heading.current += diff * Math.min(1, dt * 10);
    }
    p.y = heights.current ? heightAt(heights.current, p.x, p.z) : 0;
    ref.current!.position.set(p.x, p.y, p.z);
    body.current!.rotation.y = heading.current;
    body.current!.position.y = stack + (moving ? Math.abs(Math.sin(clock.elapsedTime * 11)) * 0.25 : 0);
    if (wasFollowing.current && !follow) pullBack.current = 70;
    wasFollowing.current = follow;
    if (!follow && pullBack.current > 0) {
      pullBack.current--;
      camera.position.lerp(camGoal.current.set(p.x, p.y + 75, p.z + 85), 0.06);
      camera.lookAt(p.x, p.y, p.z);
    }
    if (follow) {
      camGoal.current.set(p.x, p.y + 15, p.z + 13);
      camera.position.lerp(camGoal.current, 1 - Math.exp(-dt * 4));
      camera.lookAt(p.x, p.y + 1.5, p.z);
    }
  });

  return (
    <group ref={ref}>
      <CashStack height={stack} />
      {ghostStack != null && (
        <group position={[1.7, 0, 0]}><CashStack height={ghostStack} isGhost /></group>
      )}
      <group ref={body} scale={1.25}>
        <mesh geometry={miiGeo.body} position={[0, 0.8, 0]} castShadow><meshLambertMaterial color="#ff3366" /></mesh>
        <mesh geometry={miiGeo.head} position={[0, 2.2, 0]} castShadow><meshLambertMaterial color="#f1c27d" /></mesh>
        <mesh geometry={miiGeo.hair} position={[0, 2.3, 0]} rotation-x={-0.25}><meshLambertMaterial color="#111111" /></mesh>
        <mesh geometry={miiGeo.eye} position={[-0.25, 2.25, 0.68]}><meshBasicMaterial color="#212529" /></mesh>
        <mesh geometry={miiGeo.eye} position={[0.25, 2.25, 0.68]}><meshBasicMaterial color="#212529" /></mesh>
        <mesh geometry={miiGeo.mouth} position={[0, 2.02, 0.7]} rotation-z={Math.PI}><meshBasicMaterial color="#212529" /></mesh>
        <Crown />
      </group>
      {children}
    </group>
  );
}
