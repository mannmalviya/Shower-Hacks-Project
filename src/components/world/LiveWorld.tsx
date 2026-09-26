"use client";
// Picks the view: /world = the open world, /world?me=<id> = that person's world. Both update live.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { ScrapeStatus } from "@/app/onboarding/ScrapeStatus";
import { analyze } from "@/lib/analysis";
import { useWorldRows, type WorldRows } from "@/lib/worldData";
import { audienceOf } from "./npcs";
import OpenWorld from "./OpenWorld";
import World from "./World";

export default function LiveWorld({ me, seed }: { me: string | null; seed: boolean }) {
  const rows = useWorldRows(seed);
  const router = useRouter();
  if (!rows) return <Center>Loading the world…</Center>;
  const egoId = seed ? rows.egoId! : me;
  if (!egoId) return <OpenWorld rows={rows} onVisit={(id) => router.push(`/world?me=${id}`)} />;
  if (!rows.people.some((p) => p.id === egoId)) return <Center>Nobody with that id. <Link href="/world" className="underline">Open world</Link></Center>;
  return <EgoWorld rows={rows} egoId={egoId} live={!seed} />;
}

function EgoWorld({ rows, egoId, live }: { rows: WorldRows; egoId: string; live: boolean }) {
  const { analysis, links, details } = useMemo(() => {
    const analysis = analyze({ people: rows.people, follows: rows.follows, netWorth: rows.netWorth, egoId });
    const shown = new Set(analysis.nodes.map((n) => n.id));
    const seen = new Set<string>();
    const links: [string, string][] = [];
    for (const { follower_id: a, person_id: b } of rows.follows) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (shown.has(a) && shown.has(b) && !seen.has(key)) {
        seen.add(key);
        links.push([a, b]);
      }
    }
    return { analysis, links, details: new Map(rows.people.map((p) => [p.id, p])) };
  }, [rows, egoId]);
  const audience = useMemo(() => audienceOf(details.get(egoId)), [details, egoId]);

  const overlay = (
    <div className="absolute bottom-4 left-4 z-[100] flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {live && (
        <div className="rounded-3xl bg-white/90 p-3 shadow-xl">
          <ScrapeStatus personId={egoId} />
        </div>
      )}
      <Link href="/world" className="rounded-full bg-white/90 px-3 py-1.5 text-center text-xs font-bold text-sky-700 shadow hover:bg-white">
        ← Back to open world
      </Link>
    </div>
  );
  return <World analysis={analysis} links={links} details={details} audience={audience} overlay={overlay} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 flex items-center justify-center gap-2 bg-sky-50 text-sm font-bold text-slate-500">{children}</div>;
}
