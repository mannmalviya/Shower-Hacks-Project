"use client";
// "The value of your network": always-visible banner with the 3 facets. Click one to light up who contributes most.
import type { NetworkValue } from "@/lib/analysis";

export type Facet = "money" | "reach" | "doors";

export const fmtMoney = (n: number | null | undefined) =>
  n == null ? "?" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`;
export const fmtCount = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const ordinal = (p: number) => {
  const n = Math.max(1, Math.round(p * 100));
  return `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
};

export function ValueBar({ value, active, onPick }: { value: NetworkValue; active: Facet | null; onPick: (f: Facet | null) => void }) {
  const { money, reach, doors } = value;
  const facets: { key: Facet; icon: string; label: string; big: string; small: string; title: string }[] = [
    {
      key: "money", icon: "💰", label: "Worth", big: fmtMoney(money.total),
      small: money.yourPercentile != null ? `you: ${ordinal(money.yourPercentile)} percentile` : `median ${fmtMoney(money.median)}`,
      title: `Estimated total net worth of your circle (median ${fmtMoney(money.median)}), estimated on ${Math.round(money.knownShare * 100)}% of your people. Click to see who weighs the most.`,
    },
    {
      key: "reach", icon: "📣", label: "Reach", big: `${reach.known} known`, small: `up to ${fmtCount(reach.audience)} reachable`,
      title: "People you know (your circle + friends of friends we know about), and up to how many people a post relayed by your circle could reach (their followers). Click to see your biggest relays.",
    },
    {
      key: "doors", icon: "🚪", label: "Doors", big: `${doors.oneHop.length} companies`,
      small: [...doors.oneHop.slice(0, 2).map((d) => d.company), ...(doors.twoHop[0] ? [`+${doors.twoHop.length} via friends`] : [])].join(" · "),
      title: `1 contact away: ${doors.oneHop.map((d) => d.company).join(", ") || "none"}. 2 contacts away: ${doors.twoHop.map((d) => d.company).join(", ") || "none"}. Click to see who opens the most doors.`,
    },
  ];
  return (
    <div className="absolute left-1/2 top-3 z-[90] flex -translate-x-1/2 items-stretch gap-1.5 rounded-3xl border-4 border-white bg-white/90 p-1.5 shadow-xl max-sm:top-auto max-sm:bottom-3">
      <div className="hidden flex-col justify-center px-2 text-[10px] font-black uppercase leading-tight tracking-wide text-slate-400 lg:flex">
        Your network<br />is worth
      </div>
      {facets.map((f) => (
        <button key={f.key} title={f.title} onClick={() => onPick(active === f.key ? null : f.key)}
          className={`rounded-2xl px-3 py-1.5 text-left transition ${active === f.key ? "bg-sky-500 text-white" : "hover:bg-sky-50"}`}>
          <div className={`text-[10px] font-bold uppercase tracking-wide ${active === f.key ? "text-sky-100" : "text-slate-400"}`}>{f.icon} {f.label}</div>
          <div className="text-sm font-black leading-tight">{f.big}</div>
          <div className={`max-w-[11rem] truncate text-[10px] font-semibold ${active === f.key ? "text-sky-100" : "text-slate-500"}`}>{f.small}</div>
        </button>
      ))}
    </div>
  );
}
