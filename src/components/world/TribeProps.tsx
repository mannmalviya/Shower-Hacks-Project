"use client";
// Little "lots" for tribe activities (Sims-style): the family picnic blanket, the soccer goals, the music dance floor.
import { heightAt, type WorldLayout } from "./worldLayout";

const TILES = ["#ff6b9d", "#ffd43b", "#74c0fc", "#b197fc", "#69db7c", "#ffa94d"];

export function TribeProps({ layout }: { layout: WorldLayout }) {
  return (
    <group>
      {layout.groups.map((g) => {
        const y = heightAt(layout.heights, g.x, g.z);
        if (g.key.startsWith("🏠")) return (
          <group key={g.key} position={[g.x, y + 0.05, g.z]}>
            <mesh rotation-x={-Math.PI / 2} receiveShadow><circleGeometry args={[2, 24]} /><meshLambertMaterial color="#e03131" /></mesh>
            <mesh rotation-x={-Math.PI / 2} position-y={0.01}><ringGeometry args={[1.1, 1.4, 24]} /><meshLambertMaterial color="#ffffff" /></mesh>
            <mesh position={[0.4, 0.25, 0]} castShadow><cylinderGeometry args={[0.35, 0.3, 0.5, 12]} /><meshLambertMaterial color="#c68642" /></mesh>
          </group>
        );
        if (g.key.startsWith("⚽")) return (
          <group key={g.key} position={[g.x, y, g.z]}>
            {[-6, 6].map((x) => (
              <group key={x} position={[x, 0, 0]} rotation-y={x < 0 ? Math.PI / 2 : -Math.PI / 2}>
                <mesh position={[-1.4, 0.8, 0]}><cylinderGeometry args={[0.07, 0.07, 1.6]} /><meshLambertMaterial color="#ffffff" /></mesh>
                <mesh position={[1.4, 0.8, 0]}><cylinderGeometry args={[0.07, 0.07, 1.6]} /><meshLambertMaterial color="#ffffff" /></mesh>
                <mesh position={[0, 1.6, 0]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.07, 0.07, 2.8]} /><meshLambertMaterial color="#ffffff" /></mesh>
              </group>
            ))}
          </group>
        );
        if (g.key.startsWith("🎹")) return (
          <group key={g.key} position={[g.x, y + 0.06, g.z]}>
            {Array.from({ length: 36 }, (_, k) => (
              <mesh key={k} rotation-x={-Math.PI / 2} position={[((k % 6) - 2.5) * 1.1, 0, (Math.floor(k / 6) - 2.5) * 1.1]}>
                <planeGeometry args={[1.05, 1.05]} />
                <meshLambertMaterial color={TILES[(k + Math.floor(k / 6)) % TILES.length]} emissive={TILES[(k + Math.floor(k / 6)) % TILES.length]} emissiveIntensity={0.25} />
              </mesh>
            ))}
          </group>
        );
        return null;
      })}
    </group>
  );
}
