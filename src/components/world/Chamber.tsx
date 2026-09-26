"use client";
// Soul-style "Great Beyond": a glowing stairway rising from the far end of the world into a disc of white light.
// The only landmark in the pastel void.
const STEPS = 34;
const glow = { color: "#ffffff", emissive: "#e9e4ff", emissiveIntensity: 0.6 };

export function Chamber() {
  return (
    <group position={[0, 0, -130]}>
      {Array.from({ length: STEPS }, (_, i) => (
        <mesh key={i} position={[0, 0.3 + i * 1.6, -i * 2.6]}>
          <boxGeometry args={[7, 0.35, 2.4]} />
          <meshStandardMaterial {...glow} transparent opacity={1 - (i / STEPS) * 0.55} />
        </mesh>
      ))}
      {/* the light at the top */}
      <mesh position={[0, STEPS * 1.6 + 8, -STEPS * 2.6 - 6]}>
        <circleGeometry args={[16, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.95} fog={false} />
      </mesh>
      <mesh position={[0, STEPS * 1.6 + 8, -STEPS * 2.6 - 6.5]}>
        <circleGeometry args={[26, 64]} />
        <meshBasicMaterial color="#f1edff" transparent opacity={0.45} fog={false} />
      </mesh>
    </group>
  );
}
