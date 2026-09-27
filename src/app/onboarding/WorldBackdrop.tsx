"use client";
// The live open world, slowly circling behind the onboarding form. Scenery only.
import OpenWorld from "@/components/world/OpenWorld";
import { useWorldRows } from "@/lib/worldData";

export function WorldBackdrop() {
  const rows = useWorldRows(process.env.NEXT_PUBLIC_WORLD_SEED === "1");
  return rows ? <OpenWorld rows={rows} backdrop /> : null;
}
