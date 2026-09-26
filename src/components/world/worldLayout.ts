// Open world layout. Pure, computed once per category (then cached):
//   anchors per group -> force simulation (pull to your groups + friends, push neighbors apart)
//   terrain: altitude = wealth of the people standing there ("the rich live on the hill")
import type { Analysis, Node } from "@/lib/analysis";

export type Category = "tribe" | "places" | "lifemap" | "wealthTier" | "school" | "city" | "industry" | "platform";

export const CATEGORIES: { key: Category; label: string; hint: string }[] = [
  { key: "tribe", label: "Tribes", hint: "Who you really hang out with" },
  { key: "lifemap", label: "Life map", hint: "Past on the left, now on the right" },
  { key: "places", label: "Places", hint: "Where you know people from" },
  { key: "wealthTier", label: "Wealth", hint: "Stairs from broke to rich" },
  { key: "school", label: "School", hint: "Where they studied" },
  { key: "city", label: "City", hint: "Where they live" },
  { key: "industry", label: "Industry", hint: "What they do" },
  { key: "platform", label: "Platform", hint: "Where you follow them" },
];

const PALETTE = ["#1d9bf0", "#ff6b6b", "#51cf66", "#fcc419", "#9775fa", "#ff922b", "#22b8cf", "#f06595",
  "#5c7cfa", "#94d82d", "#e64980", "#20c997", "#fab005", "#7950f2", "#15aabf", "#fd7e14"];
export const WEALTH_ORDER = ["💸 Broke", "🙂 Getting by", "💼 Comfortable", "💰 Well-off", "🏝️ Rich", "👑 Ultra-rich", "❓ Unknown"];
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export type Group = { key: string; count: number; x: number; z: number; color: string; era: string };
export type WorldLayout = {
  category: Category;
  groups: Group[];
  pos: Map<string, { x: number; z: number }>; // 1st + 2nd degree
  colorOf: Map<string, string>; // body color per person
  ego: { x: number; z: number };
  heights: Float32Array; // terrain grid heights (TERRAIN_SEG+1)^2
  tints: Float32Array; // terrain vertex colors rgb
};

export const TERRAIN_SIZE = 260;
export const TERRAIN_SEG = 110;

/** Keys a person belongs to in a category; the first one is primary. */
export function keysOf(n: Node, c: Category): string[] {
  switch (c) {
    case "tribe": case "lifemap": return [n.tribe, ...n.tribes];
    case "places": return [n.circle];
    case "wealthTier": return [n.wealthTier];
    case "school": return [n.school ?? "❔ Unknown"];
    case "city": return [n.city ?? "❔ Unknown"];
    case "industry": return [n.industry === "Unknown" ? "❔ Unknown" : n.industry];
    case "platform": return n.platforms.length ? n.platforms : ["❔ Unknown"];
  }
}

/** Share of 1st-degree people with real data for this category. Under 30% -> the category is greyed out. */
export function coverage(a: Analysis, c: Category): number {
  const first = a.nodes.filter((n) => n.degree === 1);
  if (!first.length) return 0;
  const ok = (n: Node) => {
    switch (c) {
      case "tribe": case "platform": return true;
      case "lifemap": return n.era !== "unknown";
      case "places": return !n.circle.startsWith("❔");
      case "wealthTier": return !!n.wealth;
      case "school": return !!n.school;
      case "city": return !!n.city;
      case "industry": return n.industry !== "Unknown";
    }
  };
  return first.filter(ok).length / first.length;
}

const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const rand = (s: string, k: number) => ((hash(s + k) % 1000) / 1000) * 2 - 1;

// one layout per (analysis, category), computed once: switching back and forth is instant
const CACHE = new WeakMap<Analysis, Map<Category, WorldLayout>>();
export function getWorld(a: Analysis, links: [string, string][], c: Category): WorldLayout {
  let byCat = CACHE.get(a);
  if (!byCat) CACHE.set(a, (byCat = new Map()));
  if (!byCat.has(c)) byCat.set(c, computeWorld(a, links, c));
  return byCat.get(c)!;
}

export function computeWorld(a: Analysis, links: [string, string][], c: Category): WorldLayout {
  const first = a.nodes.filter((n) => n.degree === 1);
  const counts = new Map<string, { n: number; past: number; present: number }>();
  for (const n of first) {
    const k = keysOf(n, c)[0];
    const e = counts.get(k) ?? { n: 0, past: 0, present: 0 };
    e.n++;
    if (n.era === "past") e.past++;
    if (n.era === "present") e.present++;
    counts.set(k, e);
  }
  let keys = [...counts.keys()].sort((x, y) => counts.get(y)!.n - counts.get(x)!.n);
  if (c === "wealthTier") keys = keys.sort((x, y) => WEALTH_ORDER.indexOf(x) - WEALTH_ORDER.indexOf(y));
  // your own tribe goes in the middle, where you stand
  if ((c === "tribe") && a.egoTribe && keys.includes(a.egoTribe)) keys = [a.egoTribe, ...keys.filter((k) => k !== a.egoTribe)];

  const eraOf = (k: string) => {
    const e = counts.get(k)!;
    return e.past > e.present ? "past" : e.present > e.past ? "present" : "unknown";
  };
  const anchors = new Map<string, { x: number; z: number }>();
  if (c === "lifemap" || c === "places") {
    // past to the west, present to the east, the rest up north
    const side = { past: keys.filter((k) => eraOf(k) === "past"), present: keys.filter((k) => eraOf(k) === "present"), unknown: keys.filter((k) => eraOf(k) === "unknown") };
    side.past.forEach((k, i) => anchors.set(k, { x: -26 - (i % 2) * 16, z: (i - (side.past.length - 1) / 2) * 13 }));
    side.present.forEach((k, i) => anchors.set(k, { x: 26 + (i % 2) * 16, z: (i - (side.present.length - 1) / 2) * 13 }));
    side.unknown.forEach((k, i) => anchors.set(k, { x: (i - (side.unknown.length - 1) / 2) * 14, z: -40 }));
  } else if (c === "wealthTier") {
    // a staircase arc, broke on the left, rich on the right; unknown off in the fog
    keys.forEach((k) => {
      if (k === "❓ Unknown") return anchors.set(k, { x: 0, z: -48 });
      const t = WEALTH_ORDER.indexOf(k) / 5;
      anchors.set(k, { x: Math.cos(Math.PI * (1 - t)) * 36, z: Math.sin(Math.PI * (1 - t)) * -8 + 14 });
    });
  } else {
    keys.forEach((k, i) => {
      const d = i === 0 ? 0 : 14 + 13 * Math.sqrt(i);
      anchors.set(k, { x: Math.cos(i * GOLDEN) * d, z: Math.sin(i * GOLDEN) * d });
    });
  }
  const colorFor = new Map(keys.map((k, i) => [k, k.includes("Unknown") ? "#adb5bd" : PALETTE[i % PALETTE.length]]));

  // ---------- force simulation ----------
  const P = first.map((n) => {
    const an = anchors.get(keysOf(n, c)[0])!;
    return { x: an.x + rand(n.id, 1) * 4, z: an.z + rand(n.id, 2) * 4 };
  });
  const idx = new Map(first.map((n, i) => [n.id, i]));
  const L = links.map(([x, y]) => [idx.get(x), idx.get(y)] as const).filter((l): l is readonly [number, number] => l[0] != null && l[1] != null);
  const pulls = first.map((n) => keysOf(n, c).map((k, j) => ({ a: anchors.get(k), w: j === 0 ? 1 : 0.35 })).filter((p) => p.a));
  const egoAnchor = c === "lifemap" || c === "places" || c === "wealthTier" ? { x: 0, z: 0 } : anchors.get(keys[0]) ?? { x: 0, z: 0 };
  for (let it = 0; it < 140; it++) {
    const cool = 1 - it / 160;
    first.forEach((_, i) => {
      for (const { a: an, w } of pulls[i]) {
        P[i].x += (an!.x - P[i].x) * 0.045 * w * cool;
        P[i].z += (an!.z - P[i].z) * 0.045 * w * cool;
      }
    });
    for (const [i, j] of L) {
      const dx = P[j].x - P[i].x, dz = P[j].z - P[i].z, d = Math.hypot(dx, dz) || 1;
      if (d > 4) {
        const f = (d - 4) * 0.004 * cool;
        P[i].x += (dx / d) * f; P[i].z += (dz / d) * f;
        P[j].x -= (dx / d) * f; P[j].z -= (dz / d) * f;
      }
    }
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        const dx = P[j].x - P[i].x, dz = P[j].z - P[i].z, d2 = dx * dx + dz * dz;
        if (d2 < 6.3 && d2 > 1e-6) {
          const d = Math.sqrt(d2), f = (2.5 - d) * 0.5;
          P[i].x -= (dx / d) * f; P[i].z -= (dz / d) * f;
          P[j].x += (dx / d) * f; P[j].z += (dz / d) * f;
        }
      }
      // keep a little plaza free around you
      const dx = P[i].x - egoAnchor.x, dz = P[i].z - egoAnchor.z, d = Math.hypot(dx, dz) || 1;
      if (d < 5) { P[i].x += (dx / d) * (5 - d); P[i].z += (dz / d) * (5 - d); }
    }
  }

  const pos = new Map<string, { x: number; z: number }>();
  const colorOf = new Map<string, string>();
  first.forEach((n, i) => { pos.set(n.id, P[i]); colorOf.set(n.id, colorFor.get(keysOf(n, c)[0])!); });

  // 2nd degree: just outside the contact they hang off, away from that contact's group center
  const anchorOf = new Map<string, string>();
  for (const [x, y] of links) {
    if (pos.has(x) && !pos.has(y)) anchorOf.set(y, anchorOf.get(y) ?? x);
    if (pos.has(y) && !pos.has(x)) anchorOf.set(x, anchorOf.get(x) ?? y);
  }
  for (const n of a.nodes) {
    if (n.degree !== 2) continue;
    const contact = first.find((f) => f.id === anchorOf.get(n.id));
    const cp = contact ? pos.get(contact.id)! : { x: rand(n.id, 3) * 90, z: rand(n.id, 4) * 90 };
    const an = contact ? anchors.get(keysOf(contact, c)[0])! : { x: 0, z: 0 };
    const dx = cp.x - an.x, dz = cp.z - an.z, d = Math.hypot(dx, dz) || 1;
    const out = 5 + (hash(n.id) % 50) / 10;
    pos.set(n.id, { x: cp.x + (dx / d) * out + rand(n.id, 5) * 2.5, z: cp.z + (dz / d) * out + rand(n.id, 6) * 2.5 });
    colorOf.set(n.id, "#ced4da");
  }

  // group label spots = centroid of primary members
  const groups: Group[] = keys.map((k) => {
    const members = first.filter((n) => keysOf(n, c)[0] === k).map((n) => pos.get(n.id)!);
    const x = members.reduce((s, p) => s + p.x, 0) / members.length, z = members.reduce((s, p) => s + p.z, 0) / members.length;
    return { key: k, count: members.length, x, z, color: colorFor.get(k)!, era: eraOf(k) };
  });

  const { heights, tints } = terrain(first, pos, colorOf);
  return { category: c, groups, pos, colorOf, ego: egoAnchor, heights, tints };
}

// ---------- terrain ----------

const hexRgb = (h: string) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function terrain(first: Node[], pos: Map<string, { x: number; z: number }>, colorOf: Map<string, string>) {
  const S = TERRAIN_SEG + 1, half = TERRAIN_SIZE / 2, step = TERRAIN_SIZE / TERRAIN_SEG;
  const rich = first.filter((n) => n.wealth).map((n) => ({ ...pos.get(n.id)!, w: Math.max(0, Math.min(1.3, (Math.log10(n.wealth!.mid + 1) - 3.5) / 2.5)) }));
  const people = first.map((n) => ({ ...pos.get(n.id)!, rgb: hexRgb(colorOf.get(n.id)!) }));
  const heights = new Float32Array(S * S), tints = new Float32Array(S * S * 3);
  const s2h = 2 * 8.5 * 8.5, s2c = 2 * 3.2 * 3.2; // wide, soft hills
  for (let iz = 0; iz < S; iz++) {
    for (let ix = 0; ix < S; ix++) {
      const x = -half + ix * step, z = -half + iz * step, v = iz * S + ix;
      // altitude = local average wealth (kernel regression), fading where nobody is known
      let kw = 0, k = 0;
      for (const r of rich) {
        const d2 = (x - r.x) ** 2 + (z - r.z) ** 2;
        if (d2 > 900) continue;
        const g = Math.exp(-d2 / s2h);
        kw += g * r.w; k += g;
      }
      const h = k > 0 ? (kw / (k + 0.35)) * 7 : 0;
      heights[v] = h;
      // ground tint = color of the group standing there, over grass that turns golden uphill
      let cr = 0, cg = 0, cb = 0, ck = 0;
      for (const p of people) {
        const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
        if (d2 > 60) continue;
        const g = Math.exp(-d2 / s2c);
        cr += g * p.rgb[0]; cg += g * p.rgb[1]; cb += g * p.rgb[2]; ck += g;
      }
      const t = Math.min(1, h / 7);
      const base = [0.92 + 0.07 * t, 0.93 - 0.01 * t, 1.0 - 0.2 * t]; // Soul's soft lavender floor, peach-gold uphill
      const m = Math.min(0.22, ck * 0.15); // just a hint of the group color
      // vertex colors are linear in three.js: convert from sRGB or everything looks washed out
      tints[v * 3] = toLinear(ck ? base[0] * (1 - m) + (cr / ck) * m : base[0]);
      tints[v * 3 + 1] = toLinear(ck ? base[1] * (1 - m) + (cg / ck) * m : base[1]);
      tints[v * 3 + 2] = toLinear(ck ? base[2] * (1 - m) + (cb / ck) * m : base[2]);
    }
  }
  return { heights, tints };
}

/** Terrain height at a world position (bilinear on the grid). */
export function heightAt(heights: Float32Array, x: number, z: number): number {
  const S = TERRAIN_SEG + 1, half = TERRAIN_SIZE / 2, step = TERRAIN_SIZE / TERRAIN_SEG;
  const fx = Math.max(0, Math.min(TERRAIN_SEG - 1e-3, (x + half) / step)), fz = Math.max(0, Math.min(TERRAIN_SEG - 1e-3, (z + half) / step));
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const h = (i: number, j: number) => heights[j * S + i];
  return (h(ix, iz) * (1 - tx) + h(ix + 1, iz) * tx) * (1 - tz) + (h(ix, iz + 1) * (1 - tx) + h(ix + 1, iz + 1) * tx) * tz;
}
