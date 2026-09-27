"use client";
// Picks the view: /world = the open world, /world?me=<id> = that person's world. Both update live.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrapeStatus } from "@/app/onboarding/ScrapeStatus";
import { analyze } from "@/lib/analysis";
import { useWorldRows, type WorldRows } from "@/lib/worldData";
import { audienceOf } from "./npcs";
import OpenWorld from "./OpenWorld";
import World from "./World";
import { money } from "./format";

export default function LiveWorld({ me, seed }: { me: string | null; seed: boolean }) {
  const rows = useWorldRows(seed);
  const router = useRouter();
  if (!rows) return <Center>Loading the world…</Center>;
  const egoId = me; // seed mode: /world is the open world with the seed person as its one hub, /world?me=<seed id> their world
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
  const worth = useNetWorth(rows, egoId, live);

  const overlay = (
    <div className="absolute bottom-4 left-4 z-[100] flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {live && (
        <div className="rounded-3xl bg-white/90 p-3 shadow-xl">
          <ScrapeStatus personId={egoId} />
          {worth && <p className="mt-2 text-center text-xs font-bold text-emerald-700">{worth}</p>}
        </div>
      )}
      <Link href="/world" className="rounded-full bg-white/90 px-3 py-1.5 text-center text-xs font-bold text-sky-700 shadow hover:bg-white">
        ← Back to open world
      </Link>
    </div>
  );
  return <World analysis={analysis} links={links} details={details} audience={audience} overlay={overlay} />;
}


/** Once every scrape job is finished and there is no estimate yet, ask the server for one (POST /api/net-worth).
 *  The new net_worth row arrives through realtime and your cash stack grows. Returns a status line. */
function useNetWorth(rows: WorldRows, egoId: string, live: boolean): string | null {
  const asked = useRef<string | null>(null);
  const [state, setState] = useState<"idle" | "working" | "none" | "failed">("idle");
  const jobs = rows.jobs.filter((j) => j.person_id === egoId);
  const scraped = jobs.length > 0 && jobs.every((j) => j.status === "done" || j.status === "failed");
  const row = rows.netWorth.find((n) => n.person_id === egoId);
  useEffect(() => {
    if (!live || !scraped || row || asked.current === egoId) return;
    asked.current = egoId;
    setState("working");
    fetch("/api/net-worth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personId: egoId }) })
      .then((r) => r.json())
      .then((b: { results?: { skipped?: string; error?: string }[] }) => {
        const r = b.results?.[0];
        setState(r?.error ? "failed" : r?.skipped === "not enough information" ? "none" : "idle");
      })
      .catch(() => setState("failed"));
  }, [live, scraped, row, egoId]);
  if (row) return `💰 Net worth ${money(row.low)} – ${money(row.high)}`;
  if (state === "working") return "💰 Estimating your net worth…";
  if (state === "none") return "💰 Not enough data for a net worth estimate.";
  if (state === "failed") return "💰 Net worth estimate failed.";
  return null;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 flex items-center justify-center gap-2 bg-sky-50 text-sm font-bold text-slate-500">{children}</div>;
}
