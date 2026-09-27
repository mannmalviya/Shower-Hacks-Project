"use client";
// What we scraped about a sim (shown on click), the NPC card, and the gear menu.
import { useState } from "react";
import type { PersonRow } from "@/lib/worldData";
import { PLATFORM_COLOR, PLATFORM_NAME, type FakeProfile } from "./npcs";
import { count as num } from "./format";

const year = (d: string | null) => d?.slice(0, 4) ?? "";
const span = (a: string | null, b: string | null) => (a || b ? `${year(a) || "?"}–${b ? year(b) : "now"}` : "");

/** Photo, headline, follower counts, profile links, jobs, schools. */
export function ScrapedSection({ p }: { p: PersonRow }) {
  return (
    <div className="mt-3 border-t-2 border-sky-100 pt-2 text-sm">
      <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Scraped</p>
      <div className="mb-2 flex items-center gap-2">
        {p.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element -- remote CDN photos, any host
          <img src={p.photo_url} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-full object-cover" />
        )}
        <p className="text-xs text-slate-600">{p.headline || "—"}</p>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {p.social_profiles.map((s) => (
          <a key={s.platform} href={s.url} target="_blank" rel="noreferrer" style={{ background: PLATFORM_COLOR[s.platform] ?? "#868e96" }}
            className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white hover:opacity-80">
            {PLATFORM_NAME[s.platform] ?? s.platform}{s.follower_count != null ? ` · ${num(s.follower_count)}` : ""} ↗
          </a>
        ))}
      </div>
      {p.experiences.length > 0 && (
        <ul className="mb-1 space-y-0.5 text-xs text-slate-600">
          {p.experiences.map((e, i) => (
            <li key={i}>💼 {e.title ? `${e.title} · ` : ""}<b>{e.company}</b> <span className="text-slate-400">{span(e.start_date, e.end_date)}</span></li>
          ))}
        </ul>
      )}
      {p.education.length > 0 && (
        <ul className="space-y-0.5 text-xs text-slate-600">
          {p.education.map((e, i) => (
            <li key={i}>🎓 <b>{e.school}</b>{e.degree ? ` · ${e.degree}` : ""}{e.field ? ` ${e.field}` : ""} <span className="text-slate-400">{span(e.start_date, e.end_date)}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CARD = "absolute bottom-4 right-4 z-[100] w-72 max-w-[calc(100vw-2rem)] rounded-3xl border-4 bg-white p-4 shadow-xl";

/** A fake follower: a generated profile stands in until we scrape the real one. */
export function NpcCard({ platform, of, profile, onClose }: { platform: string; of: string; profile: FakeProfile; onClose: () => void }) {
  return (
    <div className={`${CARD} border-sky-300`}>
      <button onClick={onClose} className="absolute right-3 top-2 text-xl text-slate-400" aria-label="Close">×</button>
      <h2 className="text-lg font-black text-sky-600">{profile.name}</h2>
      <p className="mb-2 text-xs text-slate-500">
        Follows {of} on {PLATFORM_NAME[platform] ?? platform}
        <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-400" title="Made-up profile: we know this follower exists, not who they are">NPC · generated</span>
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="font-bold text-slate-400">Work</dt><dd>{profile.title} · {profile.company}</dd>
        <dt className="font-bold text-slate-400">City</dt><dd>{profile.city}</dd>
        <dt className="font-bold text-slate-400">Followers</dt><dd>{num(profile.followers)}</dd>
      </dl>
    </div>
  );
}

/** A real person in the open world. `onVisit` opens their own world (only for people with a crowd). */
export function PersonDetailCard({ p, followsCount, onVisit, onClose }: { p: PersonRow; followsCount: number; onVisit?: () => void; onClose: () => void }) {
  return (
    <div className={`${CARD} max-h-[70dvh] overflow-y-auto border-sky-500`}>
      <button onClick={onClose} className="absolute right-3 top-2 text-xl text-slate-400" aria-label="Close">×</button>
      <h2 className="text-lg font-black text-sky-600">{p.name}</h2>
      <p className="text-xs text-slate-500">{p.location ?? ""}{followsCount ? `${p.location ? " · " : ""}follows ${followsCount} ${followsCount === 1 ? "person" : "people"} here` : ""}</p>
      {onVisit && (
        <button onClick={onVisit} className="mt-2 w-full rounded-xl bg-rose-500 py-1.5 text-xs font-black text-white hover:bg-rose-600">🌍 See their world</button>
      )}
      <ScrapedSection p={p} />
    </div>
  );
}

/** Tiny gear in the corner: how the crowd is arranged. */
export function Gear({ grouped, setGrouped }: { grouped: boolean; setGrouped: (g: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute right-3 top-3 z-[110] flex flex-col items-end gap-1">
      <button onClick={() => setOpen(!open)} aria-label="Options" title="Options"
        className="h-8 w-8 rounded-full bg-white/90 text-base shadow hover:bg-white">⚙️</button>
      {open && (
        <div className="rounded-2xl bg-white/95 p-2 text-xs font-bold text-slate-600 shadow-xl">
          <p className="mb-1 px-1 text-[10px] uppercase text-slate-400">Audience</p>
          {([[false, "Mixed"], [true, "Group by platform"]] as const).map(([g, label]) => (
            <label key={label} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-50">
              <input type="radio" name="grouped" checked={grouped === g} onChange={() => setGrouped(g)} /> {label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
