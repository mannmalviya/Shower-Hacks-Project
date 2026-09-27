"use client";
// Shared scene environment for both worlds: sky, fog, lights, sparkles.
// Mounted inside the <Canvas> of World.tsx and OpenWorld.tsx. `center` is where the scene's action is (the sun aims there).
import { Sparkles } from "@react-three/drei";

export function Environment({ center = [0, 0] }: { center?: [number, number] }) {
  const [cx, cz] = center;
  return (
    <>
      <fog attach="fog" args={["#a9d4ff", 150, 420]} />
      <hemisphereLight args={["#eaf4ff", "#7fc96a", 1.25]} />
      <directionalLight position={[cx + 60, 110, cz + 50]} intensity={1.1} color="#fff7ea" castShadow shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004} shadow-camera-left={-130} shadow-camera-right={130} shadow-camera-top={130} shadow-camera-bottom={-130}>
        <object3D attach="target" position={[cx, 0, cz]} />
      </directionalLight>
      <Sparkles count={260} scale={[280, 50, 280]} position={[cx, 22, cz]} size={5} speed={0.35} opacity={0.8} color="#ffffff" />
    </>
  );
}
