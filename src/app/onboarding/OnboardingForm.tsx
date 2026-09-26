"use client";
// Soft UI. The logic lives in ./actions.ts.
// 3 steps: 1 about you, 2 socials, 3 net worth guess. Only step 3 saves.
import { useEffect, useRef, useState, useTransition } from "react";
import { findProfiles, submitOnboarding, type Candidate, type OnboardingInput, type OnboardingResult } from "./actions";
import type { Platform } from "@/lib/db";
import { normalizeSocialUrl } from "@/lib/socials";
import { ScrapeStatus } from "./ScrapeStatus";

const PLATFORMS: Platform[] = ["linkedin", "x", "instagram", "github"];

const EMPTY: OnboardingInput = { name: "", company: "", country: "", netWorthGuess: "", linkedin: "", x: "", instagram: "", github: "" };

type Field = { key: keyof OnboardingInput; label: string; placeholder?: string };

const STEPS: { title: string; fields: Field[] }[] = [
  {
    title: "About you",
    fields: [
      { key: "name", label: "Name *" },
      { key: "company", label: "Where do you work?" },
      { key: "country", label: "Country you live in" },
    ],
  },
  {
    title: "Your socials",
    fields: [
      { key: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/in/…" },
      { key: "x", label: "X", placeholder: "@handle or link" },
      { key: "instagram", label: "Instagram", placeholder: "@handle or link" },
      { key: "github", label: "GitHub", placeholder: "@handle or link" },
    ],
  },
  {
    title: "One last thing",
    fields: [{ key: "netWorthGuess", label: "What do you think your net worth is? (USD)", placeholder: "250000" }],
  },
];

const isPlatform = (key: string): key is Platform => (PLATFORMS as string[]).includes(key);

export function OnboardingForm() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(EMPTY);
  const [suggestions, setSuggestions] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [stepError, setStepError] = useState("");
  const [askPick, setAskPick] = useState(false); // step 2 with no links: "Are you one of these?"
  const [noneMatched, setNoneMatched] = useState(false);
  const [pending, startTransition] = useTransition();
  const lastQuery = useRef(0);

  // Typeahead: search every platform after the user stops typing their name or company for 500 ms.
  // Starts on step 1, so results are ready on step 2.
  useEffect(() => {
    if (form.name.trim().length < 3) return;
    const id = ++lastQuery.current;
    const t = setTimeout(async () => {
      setSearching(true);
      const found = await findProfiles(form.name, form.company);
      if (id === lastQuery.current) {
        setSuggestions(found);
        setSearching(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [form.name, form.company]);

  function set(key: keyof OnboardingInput, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setStepError("");
    setAskPick(false);
    setNoneMatched(false);
  }

  function pick(c: Candidate) {
    set(c.platform, c.url);
  }

  /** Checks the current step. Returns an error message, or "" if it is fine. */
  function checkStep(): string {
    if (step === 0 && !form.name.trim()) return "Name is required.";
    if (step === 1) {
      for (const p of PLATFORMS) {
        if (form[p].trim() && !normalizeSocialUrl(p, form[p])) return `That ${p} link does not look right.`;
      }
    }
    return "";
  }

  function next() {
    const err = checkStep();
    if (err) return setStepError(err);
    // No links: we cannot make a sim without data. Show what we found instead.
    if (step === 1 && PLATFORMS.every((p) => !form[p].trim())) return setAskPick(true);
    if (step < STEPS.length - 1) return setStep(step + 1);
    startTransition(async () => setResult(await submitOnboarding(form)));
  }

  if (result?.status === "saved") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">✓</div>
        <p className="text-lg font-medium text-slate-900">You are all set</p>
        <ScrapeStatus personId={result.personId} />
        <code className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500">{result.personId}</code>
      </div>
    );
  }

  const error = stepError || (result?.status === "error" ? result.message : "");
  const last = step === STEPS.length - 1;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        next();
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-lg font-medium text-slate-900">{STEPS[step].title}</p>
        <p className="text-sm text-slate-400">
          Step {step + 1} of {STEPS.length}
        </p>
      </div>

      {STEPS[step].fields.map(({ key, label, placeholder }) => (
        <div key={key} className="flex flex-col gap-1">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-600">{label}</span>
            <input
              className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-300 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100"
              value={form[key]}
              placeholder={placeholder}
              autoFocus={key === STEPS[step].fields[0].key}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
          {isPlatform(key) && !form[key] && (
            <CandidateList
              title="Is this you?"
              candidates={suggestions.filter((c) => c.platform === key).slice(0, 3)}
              loading={searching}
              onPick={pick}
            />
          )}
        </div>
      ))}

      {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}

      {askPick && !noneMatched && (
        <div className="rounded-2xl bg-indigo-50/70 p-4">
          <p className="mb-3 text-sm text-slate-600">You did not add any links. Are you one of these?</p>
          <CandidateList candidates={suggestions} loading={searching} showPlatform onPick={pick} />
          <button type="button" className="mt-3 text-sm text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline" onClick={() => setNoneMatched(true)}>
            None of these
          </button>
        </div>
      )}
      {noneMatched && <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">We could not find enough about you to make a sim. Add a social link and try again.</p>}

      <div className="mt-1 flex gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={() => {
              setStep(step - 1);
              setStepError("");
              setAskPick(false);
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Back
          </button>
        )}
        <button type="submit" disabled={pending} className="flex-1 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 px-4 py-3 font-medium text-white shadow-lg shadow-indigo-200 transition hover:-translate-y-0.5 hover:shadow-xl disabled:translate-y-0 disabled:opacity-50">
          {pending ? "Saving…" : last ? "Build my sim" : "Next"}
        </button>
      </div>
    </form>
  );
}

function CandidateList(props: {
  title?: string;
  candidates: Candidate[];
  loading?: boolean;
  showPlatform?: boolean;
  onPick: (c: Candidate) => void;
}) {
  if (props.loading) return <p className="text-sm text-slate-400">Searching…</p>;
  if (!props.candidates.length) return props.title ? null : <p className="text-sm text-slate-500">No profiles found.</p>;
  return (
    <div className="flex flex-col gap-2">
      {props.title && <p className="text-sm text-slate-400">{props.title}</p>}
      {props.candidates.map((c) => (
        <button
          key={c.url}
          type="button"
          onClick={() => props.onPick(c)}
          className="rounded-2xl border border-slate-100 bg-white px-4 py-3 text-left shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/60"
        >
          <span className="font-medium text-slate-800">{c.name}</span>{" "}
          <span className="text-sm text-slate-400">
            {props.showPlatform && `${c.platform} · `}
            {c.url.replace(/^https:\/\/(www\.)?/, "")}
          </span>
          {c.headline && <span className="block text-sm text-slate-500">{c.headline}</span>}
        </button>
      ))}
    </div>
  );
}
