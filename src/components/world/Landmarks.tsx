"use client";
// "Places" view: one building per circle (school, office tower, family house, soccer field...), generated from the data.
import { heightAt, type WorldLayout } from "./worldLayout";

type Kind = "school" | "tower" | "house" | "field" | "hall" | "stage" | "plaza" | "garage";
const kindOf = (key: string): Kind =>
  key.startsWith("🎓") ? "school" : key.startsWith("💼") ? "tower" : key.startsWith("🏠") ? "house"
  : key.startsWith("⚽") || key.startsWith("🛹") ? "field" : key.startsWith("🎹") || key.startsWith("🎨") ? "hall"
  : key.startsWith("⭐") ? "stage" : key.startsWith("💻") || key.startsWith("🤖") ? "garage" : "plaza";

function Building({ kind, color }: { kind: Kind; color: string }) {
  switch (kind) {
    case "school": return (
      <group>
        <mesh position={[0, 2, 0]} castShadow><boxGeometry args={[7, 4, 4]} /><meshLambertMaterial color="#f1e3c8" /></mesh>
        <mesh position={[0, 4.9, 0]} rotation-y={Math.PI / 4} castShadow><coneGeometry args={[4.4, 1.8, 4]} /><meshLambertMaterial color={color} /></mesh>
        <mesh position={[0, 6.3, 0]}><cylinderGeometry args={[0.08, 0.08, 1.8]} /><meshLambertMaterial color="#495057" /></mesh>
      </group>
    );
    case "tower": return (
      <group>
        <mesh position={[0, 6, 0]} castShadow><boxGeometry args={[4, 12, 4]} /><meshLambertMaterial color="#a5d8ff" /></mesh>
        <mesh position={[0, 12.3, 0]}><boxGeometry args={[4.3, 0.6, 4.3]} /><meshLambertMaterial color={color} /></mesh>
      </group>
    );
    case "house": return (
      <group>
        <mesh position={[0, 1.5, 0]} castShadow><boxGeometry args={[4, 3, 4]} /><meshLambertMaterial color="#fff4e6" /></mesh>
        <mesh position={[0, 3.8, 0]} rotation-y={Math.PI / 4} castShadow><coneGeometry args={[3.3, 1.8, 4]} /><meshLambertMaterial color="#e03131" /></mesh>
      </group>
    );
    case "field": return (
      <group>
        <mesh position={[0, 0.06, 0]} rotation-x={-Math.PI / 2}><planeGeometry args={[8, 5]} /><meshLambertMaterial color="#2f9e44" /></mesh>
        <mesh position={[-4, 1, 0]}><boxGeometry args={[0.15, 2, 2.4]} /><meshLambertMaterial color="#ffffff" /></mesh>
        <mesh position={[4, 1, 0]}><boxGeometry args={[0.15, 2, 2.4]} /><meshLambertMaterial color="#ffffff" /></mesh>
      </group>
    );
    case "hall": return (
      <group>
        <mesh position={[0, 1.5, 0]} castShadow><cylinderGeometry args={[3, 3, 3, 16]} /><meshLambertMaterial color="#f8f0fc" /></mesh>
        <mesh position={[0, 3, 0]} castShadow><sphereGeometry args={[3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshLambertMaterial color={color} /></mesh>
      </group>
    );
    case "stage": return (
      <group>
        <mesh position={[0, 0.5, 0]} castShadow><boxGeometry args={[8, 1, 4]} /><meshLambertMaterial color="#343a40" /></mesh>
        <mesh position={[0, 5, -1.8]} castShadow><boxGeometry args={[9, 5, 0.3]} /><meshLambertMaterial color={color} /></mesh>
      </group>
    );
    case "garage": return (
      <group>
        <mesh position={[0, 1.6, 0]} castShadow><boxGeometry args={[5, 3.2, 4]} /><meshLambertMaterial color="#dee2e6" /></mesh>
        <mesh position={[0, 1.2, 2.01]}><planeGeometry args={[3.4, 2.4]} /><meshLambertMaterial color={color} /></mesh>
      </group>
    );
    default: return (
      <group>
        <mesh position={[0, 0.08, 0]}><cylinderGeometry args={[3, 3, 0.16, 20]} /><meshLambertMaterial color="#e9ecef" /></mesh>
        <mesh position={[0, 2, 0]}><cylinderGeometry args={[0.12, 0.12, 4]} /><meshLambertMaterial color="#495057" /></mesh>
        <mesh position={[0, 3.6, 0]}><boxGeometry args={[1.6, 0.9, 0.08]} /><meshLambertMaterial color={color} /></mesh>
      </group>
    );
  }
}

export function Landmarks({ layout }: { layout: WorldLayout }) {
  return (
    <group>
      {layout.groups.map((g) => {
        // behind the group, pushed away from the center, facing you
        const d = Math.hypot(g.x, g.z) || 1;
        const x = g.x + (g.x / d) * 7, z = g.z + (g.z / d) * 7;
        return (
          <group key={g.key} position={[x, heightAt(layout.heights, x, z), z]} rotation-y={Math.atan2(-x, -z)}>
            <Building kind={kindOf(g.key)} color={g.color} />
          </group>
        );
      })}
    </group>
  );
}
