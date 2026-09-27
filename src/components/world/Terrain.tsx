"use client";
/* eslint-disable react-hooks/immutability -- imperative three.js animation state, mutated every frame on purpose */
// The island: rolling checkered lawn where the rich stand on hills, sand at the coast, grey cliffs dropping into a blue sea.
// Ground tinted by the group standing there. Morphs between categories.
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SEA_LEVEL, TERRAIN_SEG, TERRAIN_SIZE, type WorldLayout } from "./worldLayout";

type Props = {
  layout: WorldLayout;
  heights: React.RefObject<Float32Array>; // live heights, shared with the crowd and the player
  onGround: (p: THREE.Vector3) => void;
};

/** Lambert + a soft checkerboard drawn in the fragment shader from world position (only on the lawn, not on cliffs). */
export function checkerMaterial(opts: { vertexColors?: boolean; color?: string } = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: opts.vertexColors ?? true, color: opts.color ?? "#ffffff" });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
varying vec3 vWPos;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vWPos;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        float ch = mod(floor(vWPos.x / 4.0) + floor(vWPos.z / 4.0), 2.0);
        float lawn = smoothstep(-0.6, 0.2, vWPos.y);
        diffuseColor.rgb *= mix(1.0, 1.0 + 0.085 * ch, lawn);`);
  };
  return m;
}

const WATER = new THREE.MeshLambertMaterial({ color: "#2f8fff" });
const SHALLOW = new THREE.MeshLambertMaterial({ color: "#8fd8ff", transparent: true, opacity: 0.55, depthWrite: false });

/** The sea: a huge disc at sea level plus a soft light ring of shallows hugging the coast. */
export function Sea({ x = 0, z = 0, coast }: { x?: number; z?: number; coast: number }) {
  return (
    <group position={[x, SEA_LEVEL, z]}>
      <mesh rotation-x={-Math.PI / 2} material={WATER} receiveShadow><circleGeometry args={[1500, 64]} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.05} material={SHALLOW}><ringGeometry args={[Math.max(1, coast - 8), coast + 12, 96]} /></mesh>
    </group>
  );
}

export function Terrain({ layout, heights, onGround }: Props) {
  const S = TERRAIN_SEG + 1;
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
    g.rotateX(-Math.PI / 2); // row iz -> z = -size/2 + iz*step, matches worldLayout's grid
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(S * S * 3).fill(0.6), 3));
    return g;
  }, [S]);
  const material = useMemo(() => checkerMaterial(), []);
  const settling = useRef(0);
  const colors = useRef(new Float32Array(S * S * 3).fill(0.6));

  const first = useRef(true);
  useEffect(() => {
    settling.current = first.current ? 1 : 50; // first load: snap; later: morph between categories
    first.current = false;
  }, [layout]);

  useFrame(() => {
    if (settling.current <= 0) return;
    settling.current--;
    const H = heights.current, pos = geo.attributes.position as THREE.BufferAttribute, col = geo.attributes.color as THREE.BufferAttribute;
    const k = settling.current === 0 ? 1 : 0.07;
    for (let v = 0; v < S * S; v++) {
      H[v] += (layout.heights[v] - H[v]) * k;
      pos.setY(v, H[v]);
      for (let c = 0; c < 3; c++) colors.current[v * 3 + c] += (layout.tints[v * 3 + c] - colors.current[v * 3 + c]) * k;
    }
    (col.array as Float32Array).set(colors.current);
    pos.needsUpdate = true;
    col.needsUpdate = true;
    if (settling.current % 6 === 0) geo.computeVertexNormals();
  });

  return (
    <group>
      <mesh geometry={geo} receiveShadow castShadow onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onGround(e.point); }}>
        <primitive object={material} attach="material" />
      </mesh>
      <Sea coast={layout.island} />
    </group>
  );
}
