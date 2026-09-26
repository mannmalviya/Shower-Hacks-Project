"use client";
// Arcs between tribes: thicker = more people linked across the two groups. Shows the social structure at a glance.
import { QuadraticBezierLine } from "@react-three/drei";
import { useMemo } from "react";
import type { Node } from "@/lib/analysis";
import { heightAt, type WorldLayout } from "./worldLayout";

export type TribeLink = { a: string; b: string; count: number };

/** Links between members of two different primary tribes, biggest first. */
export function tribeLinks(nodes: Node[], links: [string, string][]): TribeLink[] {
  const tribe = new Map(nodes.filter((n) => n.degree === 1).map((n) => [n.id, n.tribe]));
  const counts = new Map<string, number>();
  for (const [x, y] of links) {
    const a = tribe.get(x), b = tribe.get(y);
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([k, count]) => ({ a: k.split("|")[0], b: k.split("|")[1], count })).sort((p, q) => q.count - p.count);
}

export function TribeArcs({ layout, arcs, focus }: { layout: WorldLayout; arcs: TribeLink[]; focus: string | null }) {
  const at = useMemo(() => new Map(layout.groups.map((g) => [g.key, g])), [layout]);
  const max = arcs[0]?.count ?? 1;
  return (
    <group>
      {arcs.slice(0, 24).map(({ a, b, count }) => {
        const ga = at.get(a), gb = at.get(b);
        if (!ga || !gb || count < 2) return null;
        const lit = !focus || focus === a || focus === b;
        const ya = heightAt(layout.heights, ga.x, ga.z) + 3, yb = heightAt(layout.heights, gb.x, gb.z) + 3;
        const d = Math.hypot(ga.x - gb.x, ga.z - gb.z);
        return (
          <QuadraticBezierLine key={`${a}|${b}`} start={[ga.x, ya, ga.z]} end={[gb.x, yb, gb.z]}
            mid={[(ga.x + gb.x) / 2, Math.max(ya, yb) + d * 0.35, (ga.z + gb.z) / 2]}
            color={lit ? "#4dabf7" : "#ced4da"} lineWidth={1 + (count / max) * 6} transparent opacity={lit ? 0.85 : 0.15} />
        );
      })}
    </group>
  );
}
