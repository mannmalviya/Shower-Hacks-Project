import Link from "next/link";
import { OnboardingForm } from "./OnboardingForm";
import { WorldBackdrop } from "./WorldBackdrop";

export default function OnboardingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,#8ec5ff_0%,#b3d8ff_30%,#d9ecff_55%,#e3f6ea_80%,#f1f8e9_100%)] text-slate-800">
      <WorldBackdrop />
      <div className="pointer-events-none relative z-10 flex min-h-screen items-center justify-center px-4 py-12 lg:justify-start lg:pl-16">
        <div className="pointer-events-auto w-full max-w-lg">
          <div className="rounded-3xl border-4 border-white bg-white/85 p-6 shadow-2xl backdrop-blur-md sm:p-8">
            <div className="mb-6 text-center">
              <h1 className="text-3xl font-black tracking-tight text-sky-600">Join the world 🚿</h1>
              <p className="mt-1 text-sm text-slate-500">A few details, and your sim walks in with your followers.</p>
            </div>
            <OnboardingForm />
          </div>
          <p className="mt-4 text-center text-sm">
            <Link href="/world" className="rounded-full bg-white/85 px-4 py-1.5 font-bold text-sky-700 shadow backdrop-blur hover:bg-white">
              Skip, just explore →
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
