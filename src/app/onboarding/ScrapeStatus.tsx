"use client";
// Live status of a person's scrape jobs. The worker updates scrape_jobs; we poll it (reads are public).
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/database.types";

type Job = Pick<Tables<"scrape_jobs">, "id" | "platform" | "status" | "error">;

const NAMES: Record<string, string> = { linkedin: "LinkedIn", x: "X", instagram: "Instagram" };

function message(job: Job) {
  const name = NAMES[job.platform] ?? job.platform;
  if (job.status === "queued") return `Waiting for the scraper to pick up ${name}…`;
  if (job.status === "running") return `Reading your ${name} profile…`;
  if (job.status === "done") return `${name} done.`;
  return `${name} failed${job.error ? `: ${job.error}` : "."}`;
}

const ICONS: Record<string, string> = { queued: "○", running: "◌", done: "✓", failed: "✕" };

export function ScrapeStatus({ personId }: { personId: string }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);

  useEffect(() => {
    const db = createClient();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    async function load() {
      const { data } = await db
        .from("scrape_jobs")
        .select("id, platform, status, error")
        .eq("person_id", personId)
        .order("created_at", { ascending: false });
      if (stopped) return;
      // Newest job per platform only.
      const latest = (data ?? []).filter((j, i, all) => all.findIndex((k) => k.platform === j.platform) === i);
      setJobs(latest);
      if (!latest.length || latest.some((j) => j.status === "queued" || j.status === "running")) {
        timer = setTimeout(load, 2000);
      }
    }
    load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [personId]);

  if (!jobs) return <p className="text-sm text-slate-500">Checking the scraper…</p>;
  if (!jobs.length) return <p className="text-sm text-slate-500">Nothing to scrape.</p>;

  const busy = jobs.some((j) => j.status === "queued" || j.status === "running");
  return (
    <div className="flex w-full max-w-sm flex-col gap-2 text-left">
      {jobs.map((j) => (
        <div key={j.id} className="flex items-start gap-2 rounded-2xl bg-slate-50 px-4 py-2 text-sm text-slate-600">
          <span className={j.status === "running" ? "animate-spin" : ""}>{ICONS[j.status] ?? "○"}</span>
          <span title={j.error ?? undefined} className={`min-w-0 break-words ${j.status === "failed" ? "line-clamp-3 text-rose-600" : ""}`}>{message(j)}</span>
        </div>
      ))}
      <p className="text-center text-xs text-slate-400">
        {busy ? "This can take a minute. You can keep this page open." : "All done. Your sim is ready."}
      </p>
    </div>
  );
}
