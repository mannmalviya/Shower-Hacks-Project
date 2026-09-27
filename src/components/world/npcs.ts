// NPCs: fake followers that fill a person's audience up to their real follower count.
// Built in the browser from social_profiles.follower_count, never stored. Every real scraped
// follower takes the place of one NPC.
import type { PersonRow } from "@/lib/worldData";

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const AREA = 4.2; // ground per NPC, world units²

export const NPC_COLOR = "#ced4da";
export const PLATFORM_COLOR: Record<string, string> = { instagram: "#e64980", x: "#343a40", linkedin: "#1c7ed6", github: "#7950f2" };
export const PLATFORM_NAME: Record<string, string> = { instagram: "Instagram", x: "X", linkedin: "LinkedIn", github: "GitHub" };

export type Split = { platform: string; count: number }[];
export type NpcGroup = { platform: string; count: number; x: number; z: number };
export type NpcLayout = { x: Float32Array; z: Float32Array; platform: string[]; groups: NpcGroup[]; outer: number };

/** Follower counts per platform, biggest first. */
export function audienceOf(p: PersonRow | undefined): Split {
  return (p?.social_profiles ?? []).filter((s) => (s.follower_count ?? 0) > 0)
    .map((s) => ({ platform: s.platform, count: s.follower_count! })).sort((a, b) => b.count - a.count);
}
export const totalOf = (s: Split) => s.reduce((a, b) => a + b.count, 0);

/** How many NPCs to draw per platform: min(cap, total) minus the real followers we have, split by share. */
export function npcSplit(audience: Split, real: number, cap: number): Split {
  const total = totalOf(audience);
  const n = Math.max(0, Math.min(cap, total) - real);
  if (!n) return [];
  const exact = audience.map((a) => (a.count / total) * n);
  const out = audience.map((a, i) => ({ platform: a.platform, count: Math.floor(exact[i]) }));
  // largest remainder, so the parts add up to n
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < n - totalOf(out); k++) out[order[k % order.length][1]].count++;
  return out.filter((o) => o.count > 0);
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** NPC spots around (cx, cz) from radius `inner` outwards. Mixed: one well-mixed crowd. Grouped: one wedge per platform. */
export function npcLayout(cx: number, cz: number, inner: number, split: Split, grouped: boolean, seed: string): NpcLayout {
  const N = totalOf(split);
  const x = new Float32Array(N), z = new Float32Array(N), platform: string[] = new Array(N);
  const spin = (hash(seed) % 628) / 100;
  let outer = inner;
  if (!grouped) {
    // deficit round robin: at every step, the platform furthest behind its share goes next
    const done = split.map(() => 0);
    for (let k = 0; k < N; k++) {
      let best = 0, bestD = -Infinity;
      split.forEach((s, i) => { const d = (s.count * (k + 1)) / N - done[i]; if (d > bestD) { bestD = d; best = i; } });
      done[best]++;
      const r = Math.sqrt(inner * inner + (k * AREA) / Math.PI), a = spin + k * GOLDEN;
      x[k] = cx + Math.cos(a) * r; z[k] = cz + Math.sin(a) * r; platform[k] = split[best].platform;
      outer = r;
    }
    return { x, z, platform, groups: [], outer };
  }
  const groups: NpcGroup[] = [];
  let start = spin, k = 0;
  for (const s of split) {
    const span = (s.count / N) * Math.PI * 2;
    let r = inner;
    for (let j = 0; j < s.count; j++, k++) {
      r = Math.sqrt(inner * inner + (2 * j * AREA) / span); // wedge area between inner and r = j * AREA
      const a = start + span * (((j * GOLDEN) / (Math.PI * 2)) % 1) * 0.94 + span * 0.03; // small gap between wedges
      x[k] = cx + Math.cos(a) * r; z[k] = cz + Math.sin(a) * r; platform[k] = s.platform;
    }
    const mid = start + span / 2;
    groups.push({ platform: s.platform, count: s.count, x: cx + Math.cos(mid) * (r + 3), z: cz + Math.sin(mid) * (r + 3) });
    outer = Math.max(outer, r);
    start += span;
  }
  return { x, z, platform, groups, outer };
}

// ---------- fake profiles: every NPC gets a stable made-up identity (same NPC, same card) ----------

const FIRST = ["Alex", "Maya", "Jordan", "Priya", "Sam", "Lucas", "Aisha", "Kenji", "Sofia", "Omar", "Chloe", "Diego", "Nina", "Ethan",
  "Zara", "Leo", "Hana", "Mateo", "Ava", "Ravi", "Emma", "Kai", "Lina", "Noah", "Mei", "Tomás", "Ivy", "Yusuf", "Grace", "Arjun"];
const LAST = ["Nguyen", "Patel", "Garcia", "Kim", "Smith", "Okafor", "Rossi", "Tanaka", "Silva", "Haddad", "Novak", "Chen", "Lopez",
  "Müller", "Singh", "Johnson", "Park", "Costa", "Ali", "Brown", "Ivanova", "Martin", "Sato", "Mensah", "Dubois", "Khan"];
const JOBS: [string, string][] = [["Software Engineer", "Stripe"], ["Barista", "Blue Bottle"], ["Student", "UC Berkeley"], ["Designer", "Figma"],
  ["Nurse", "Kaiser Permanente"], ["Founder", "a stealth startup"], ["Data Scientist", "Airbnb"], ["Teacher", "Oakland Unified"],
  ["Product Manager", "Google"], ["Photographer", "Freelance"], ["Analyst", "Goldman Sachs"], ["Chef", "Nopa"], ["Student", "Stanford"],
  ["Marketing Lead", "Nike"], ["Mechanic", "Tesla"], ["Content Creator", "YouTube"], ["Research Scientist", "OpenAI"], ["Sales", "Salesforce"]];
const CITIES = ["San Francisco", "New York", "Austin", "Los Angeles", "Seattle", "Toronto", "London", "Berlin", "Singapore", "Taipei",
  "São Paulo", "Mumbai", "Lagos", "Sydney", "Oakland", "Chicago"];

export type FakeProfile = { name: string; title: string; company: string; city: string; followers: number };

export function fakeProfile(seed: string, i: number): FakeProfile {
  const h = hash(`${seed}:${i}`), g = (k: number) => (h >>> k) ^ (h * (k + 7));
  const [title, company] = JOBS[Math.abs(g(3)) % JOBS.length];
  return {
    name: `${FIRST[h % FIRST.length]} ${LAST[Math.abs(g(5)) % LAST.length]}`,
    title, company,
    city: CITIES[Math.abs(g(9)) % CITIES.length],
    followers: Math.round(40 + (Math.abs(g(13)) % 1000) ** 1.5 / 10), // mostly small accounts, a few bigger ones
  };
}

/** A body color for NPC i (bright, from the world palette), or the platform color when grouped. */
export const npcColor = (seed: string, i: number, platform: string, grouped: boolean, palette: string[]) =>
  grouped ? PLATFORM_COLOR[platform] ?? NPC_COLOR : palette[hash(`${seed}:${i}`) % palette.length];
