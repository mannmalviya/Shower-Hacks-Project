"use client";
// Shared scene environment for both worlds: sky, fog, lights, sparkles.
// Mounted inside the <Canvas> of World.tsx and OpenWorld.tsx. `center` is where the scene's action is (the sun aims there).
import { Sparkles } from "@react-three/drei";

export function Environment({ center = [0, 0] }: { center?: [number, number] }) {
  const [cx, cz] = center;
  return (
    <>
      <fog attach="fog" args={["#dcecfb", 120, 330]} />
      <hemisphereLight args={["#eef6ff", "#9ed98a", 1.2]} />
      <directionalLight position={[cx + 50, 90, cz + 40]} intensity={0.95} color="#fff6ee" castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-110} shadow-camera-right={110} shadow-camera-top={110} shadow-camera-bottom={-110}>
        <object3D attach="target" position={[cx, 0, cz]} />
      </directionalLight>
      <Sparkles count={260} scale={[280, 50, 280]} position={[cx, 22, cz]} size={5} speed={0.35} opacity={0.8} color="#ffffff" />
    </>
  );
}
