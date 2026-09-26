// Where every sim stands. Pure: nodes + group-by -> islands and positions.
// You are at the center. Present groups in front of you (close), past groups behind (far).
import type { Dimension, Era, Node } from "@/lib/analysis";

export type GroupBy = Dimension;

export type Island = {
  key: string;
  label: string;
  count: number;
  x: number;
  z: number;
  radius: number;
  height: number; // top of the island (podiums in wealth mode)
  color: string;
  era: Era;
};

export type Placed = { x: number; y: number; z: number; color: string; island: string };

export type Layout = { islands: Island[]; placed: Map<string, Placed>; ego: { x: number; z: number } };

const PALETTE = ["#1d9bf0", "#ff6b6b", "#7ed957", "#ffd23f", "#b07cff", "#ff8c42", "#2ec4b6", "#ff5fa2",
  "#5c7cfa", "#94d82d", "#f06595", "#20c997", "#fab005", "#845ef7"];
export const WEALTH_ORDER = ["💸 Broke", "🙂 Getting by", "💼 Comfortable", "💰 Well-off", "🏝️ Rich", "👑 Ultra-rich", "❓ Unknown"];
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function groupOf(n: Node, by: GroupBy): string {
  switch (by) {
    case "platform": return n.platforms[0] ?? "unknown";
    case "interest": return n.interests[0] ?? "❔ No clue";
    case "wealthTier": return n.wealthTier;
    case "industry": return n.industry;
    default: return (n[by] as string | null) ?? "❔ Unknown";
  }
}

export function computeLayout(nodes: Node[], by: GroupBy): Layout {
  const first = nodes.filter((n) => n.degree === 1);
  const groups = new Map<string, Node[]>();
  for (const n of first) {
    const g = groupOf(n, by);
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(n);
  }

  // era of a group = majority era of its members
  const eraOf = (members: Node[]): Era => {
    const past = members.filter((m) => m.era === "past").length, present = members.filter((m) => m.era === "present").length;
    return past > present ? "past" : present > past ? "present" : "unknown";
  };
  let entries = [...groups.entries()].map(([key, members]) => ({ key, members, era: eraOf(members) }));
  entries = by === "wealthTier"
    ? entries.sort((a, b) => WEALTH_ORDER.indexOf(a.key) - WEALTH_ORDER.indexOf(b.key))
    : entries.sort((a, b) => b.members.length - a.members.length);

  // angles: present spread over the front half (z > 0, toward the camera), past over the back half
  const byEra = { present: entries.filter((e) => e.era === "present"), past: entries.filter((e) => e.era === "past"), unknown: entries.filter((e) => e.era === "unknown") };
  const angle = new Map<string, number>();
  const spread = (list: typeof entries, from: number, to: number) =>
    list.forEach((e, i) => angle.set(e.key, from + ((i + 0.5) / list.length) * (to - from)));
  if (by === "circle") {
    spread(byEra.present, Math.PI * 0.1, Math.PI * 0.9);
    spread(byEra.past, Math.PI * 1.1, Math.PI * 1.9);
    spread(byEra.unknown, -Math.PI * 0.08, Math.PI * 0.08);
  } else {
    spread(entries, 0, Math.PI * 2);
  }

  const islands: Island[] = [];
  const placed = new Map<string, Placed>();
  entries.forEach((e, gi) => {
    const radius = 2.5 + Math.sqrt(e.members.length) * 1.6;
    const mutual = e.members.filter((m) => m.tie === "mutual").length / e.members.length;
    // strong ties close, weak ties far; the past is further away
    let dist = 16 + radius + (1 - mutual) * 10 + (by === "circle" && e.era === "past" ? 10 : 0);
    if (by === "wealthTier") dist = 18 + gi * 7;
    const a = angle.get(e.key)!;
    const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
    const podium = by === "wealthTier" && e.key !== "❓ Unknown" ? 0.4 + gi * 1.2 : 0.4;
    const color = e.key.includes("Unknown") ? "#adb5bd" : PALETTE[gi % PALETTE.length];
    islands.push({ key: e.key, label: e.key, count: e.members.length, x, z, radius, height: podium, color, era: e.era });
    e.members.forEach((m, i) => {
      const rr = (radius - 1) * Math.sqrt((i + 0.5) / e.members.length);
      placed.set(m.id, { x: x + Math.cos(i * GOLDEN) * rr, y: podium, z: z + Math.sin(i * GOLDEN) * rr, color, island: e.key });
    });
  });

  // 2nd degree: an outer cloud, next to the island of the 1st-degree contact they hang off
  return { islands, placed, ego: { x: 0, z: 0 } };
}

export function placeSecondDegree(nodes: Node[], links: [string, string][], layout: Layout): Map<string, Placed> {
  const out = new Map<string, Placed>();
  const anchor = new Map<string, string>();
  for (const [a, b] of links) {
    if (layout.placed.has(a) && !layout.placed.has(b)) anchor.set(b, anchor.get(b) ?? a);
    if (layout.placed.has(b) && !layout.placed.has(a)) anchor.set(a, anchor.get(a) ?? b);
  }
  let i = 0;
  for (const n of nodes) {
    if (n.degree !== 2) continue;
    const p = layout.placed.get(anchor.get(n.id) ?? "");
    const base = p ? Math.atan2(p.z, p.x) : i * GOLDEN;
    const r = (p ? Math.hypot(p.x, p.z) : 40) + 12 + ((i * 7) % 9);
    const a = base + (((i * 13) % 11) - 5) * 0.035;
    out.set(n.id, { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r, color: "#ced4da", island: "2nd" });
    i++;
  }
  return out;
}

/** Cash stack height (world units) for a net worth: log scale, so billionaires don't reach the moon. */
export function stackHeight(mid: number | null | undefined): number {
  if (!mid || mid <= 0) return 0.15;
  return Math.max(0.15, (Math.log10(mid) - 3) * 1.1);
}
