"use client";
/* eslint-disable react-hooks/immutability -- imperative three.js animation state, mutated every frame on purpose */
// Rolling hills where the rich stand; ground tinted by the group standing there. Morphs between categories.
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { TERRAIN_SEG, TERRAIN_SIZE, type WorldLayout } from "./worldLayout";

type Props = {
  layout: WorldLayout;
  heights: React.RefObject<Float32Array>; // live heights, shared with the crowd and the player
  onGround: (p: THREE.Vector3) => void;
};

// Lambert + a grid drawn in the fragment shader from world position: the lines follow the hills
// (a flat grid plane cut through them), antialiased with fwidth, fading out toward the horizon.
function gridMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
varying vec3 vWPos;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vWPos;
float gridLine(vec2 p, float size) {
  vec2 q = p / size;
  vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
  return 1.0 - min(min(g.x, g.y), 1.0);
}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        float fade = 1.0 - smoothstep(70.0, 125.0, length(vWPos.xz));
        float lines = max(gridLine(vWPos.xz, 4.0) * 0.35, gridLine(vWPos.xz, 20.0) * 0.7) * fade;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.58, 0.62, 0.92), lines);`);
  };
  return m;
}

export function Terrain({ layout, heights, onGround }: Props) {
  const S = TERRAIN_SEG + 1;
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
    g.rotateX(-Math.PI / 2); // row iz -> z = -size/2 + iz*step, matches worldLayout's grid
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(S * S * 3).fill(0.6), 3));
    return g;
  }, [S]);
  const material = useMemo(() => gridMaterial(), []);
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
      <mesh geometry={geo} receiveShadow onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onGround(e.point); }}>
        <primitive object={material} attach="material" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.05}>
        <circleGeometry args={[600, 48]} />
        <meshLambertMaterial color="#e9ebff" />
      </mesh>
    </group>
  );
}
