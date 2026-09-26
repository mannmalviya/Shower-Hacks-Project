import Link from "next/link";
import { OnboardingForm } from "./OnboardingForm";

export default function OnboardingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 px-4 py-12 text-slate-800">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Tell us about you</h1>
          <p className="mt-2 text-sm text-slate-500">A few details, and we will build your sim.</p>
        </div>
        <div className="rounded-3xl border border-white/80 bg-white/70 p-6 shadow-xl shadow-indigo-100/60 backdrop-blur sm:p-8">
          <OnboardingForm />
        </div>
        <p className="mt-4 text-center text-sm">
          <Link href="/world" className="text-slate-500 underline hover:text-slate-700">Skip, just explore →</Link>
        </p>
      </div>
    </main>
  );
}
