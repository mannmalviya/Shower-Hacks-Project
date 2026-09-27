"use client";
/* eslint-disable react-hooks/immutability -- imperative three.js animation state, mutated every frame on purpose */
// You: a Mii you walk around (WASD / ZQSD / arrows, or click the ground), riding your cash stack,
// with the ghost stack of "future you" floating next to you. The camera follows over your shoulder.
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { miiGeo } from "./Crowd";
import { heightAt } from "./worldLayout";

const BUNDLE = new THREE.BoxGeometry(0.62, 1, 0.42); // one bundle of cash; height is scaled per pyramid
const cashMat = new THREE.MeshLambertMaterial({ color: "#ffffff" });
const ghost = new THREE.MeshLambertMaterial({ color: "#40c057", transparent: true, opacity: 0.22 });
const GREENS = [new THREE.Color("#40c057"), new THREE.Color("#2f9e44")];

/** Cash stack height (world units): log scale, so billionaires don't reach the moon. */
export const stackHeight = (mid: number | null | undefined) => (!mid || mid <= 0 ? 0.15 : Math.max(0.15, (Math.log10(mid) - 3) * 1.1));

/** A stepped pyramid of cash bundles, `height` tall with one bundle on top to stand on.
 *  Richer = taller and wider (the base grows with the height, up to 9 x 9 bundles). One instanced mesh. */
export function CashStack({ height, isGhost = false }: { height: number; isGhost?: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const layout = useMemo(() => {
    const layers = Math.max(1, Math.round(height / 0.3)), h = height / layers;
    const base = Math.max(1, Math.min(9, Math.ceil(layers / 2)));
    const spots: [number, number, number, number][] = []; // x, y, z, layer
    for (let i = 0; i < layers; i++) {
      const n = Math.max(1, Math.round(base * (1 - i / layers)));
      for (let a = 0; a < n; a++) for (let b = 0; b < n; b++)
        spots.push([(a - (n - 1) / 2) * 0.64, h * i + h / 2, (b - (n - 1) / 2) * 0.64, i]);
    }
    return { spots, h };
  }, [height]);
  useLayoutEffect(() => {
    const im = mesh.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    layout.spots.forEach(([x, y, z, layer], k) => {
      im.setMatrixAt(k, m.makeScale(1, layout.h * 0.92, 1).setPosition(x, y, z));
      if (!isGhost) im.setColorAt(k, GREENS[layer % 2]);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, [layout, isGhost]);
  return <instancedMesh key={layout.spots.length} ref={mesh} args={[BUNDLE, isGhost ? ghost : cashMat, layout.spots.length]} castShadow />;
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
  controls?: React.RefObject<{ target: THREE.Vector3; update: () => void } | null>; // the orbit camera: it tags along when you move
};

export function Player({ heights, pos, walkTo, keys, follow, stack, ghostStack, children, controls }: Props) {
  const ref = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const heading = useRef(0);
  const camGoal = useRef(new THREE.Vector3());
  const pullBack = useRef(0); // frames left of the zoom-out when switching to overview
  const wasFollowing = useRef(follow);
  const last = useRef<THREE.Vector3 | null>(null); // where you were last frame (the orbit camera moves by the same step)

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
    // overview: move the orbit camera and its target by your step, so you stay in view while you walk
    const c = controls?.current;
    if (!follow && c && last.current && pullBack.current <= 0) {
      const dx = p.x - last.current.x, dz = p.z - last.current.z;
      if (dx || dz) { camera.position.x += dx; camera.position.z += dz; c.target.x += dx; c.target.z += dz; c.update(); }
    }
    (last.current ??= new THREE.Vector3()).copy(p);
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
      </group>
      {children}
    </group>
  );
}
