"use client";
// The training room entrance (Hyperbolic Time Chamber vibe): a small white temple far behind the world,
// the only landmark in the endless white.
const PILLARS = [-9, -3, 3, 9];

export function Chamber() {
  return (
    <group position={[0, 0, -125]}>
      <mesh position={[0, 0.6, 0]} receiveShadow><cylinderGeometry args={[18, 19, 1.2, 48]} /><meshLambertMaterial color="#ffffff" /></mesh>
      <mesh position={[0, 7, -4]} castShadow><boxGeometry args={[24, 12, 8]} /><meshLambertMaterial color="#f8f9fa" /></mesh>
      <mesh position={[0, 13.5, -4]} castShadow><cylinderGeometry args={[7, 8, 1, 32]} /><meshLambertMaterial color="#ffffff" /></mesh>
      <mesh position={[0, 16, -4]} castShadow><sphereGeometry args={[6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshLambertMaterial color="#ffffff" /></mesh>
      <mesh position={[0, 5, 0.05]}><boxGeometry args={[5, 8, 0.2]} /><meshLambertMaterial color="#343a40" /></mesh>
      {PILLARS.map((x) => (
        <mesh key={x} position={[x, 7, 2]} castShadow><cylinderGeometry args={[0.9, 1, 12, 16]} /><meshLambertMaterial color="#ffffff" /></mesh>
      ))}
    </group>
  );
}
