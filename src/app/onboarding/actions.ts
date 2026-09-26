"use server";
// Onboarding logic. No sign-in in v1, so every write uses the admin client.
import { createAdminClient } from "@/lib/supabase/admin";
import { search } from "@/lib/firecrawl";
import { isProfileUrl, normalizeSocialUrl } from "@/lib/socials";
import { queueScrapeJobs, type Platform, type ScrapePlatform } from "@/lib/db";

export type Candidate = {
  platform: Platform;
  url: string;
  name: string;
  headline: string;
  source: "db" | "web";
};

export type OnboardingInput = {
  name: string;
  company: string;
  country: string;
  netWorthGuess: string;
  linkedin: string;
  x: string;
  instagram: string;
  github: string;
};

export type OnboardingResult =
  | { status: "error"; message: string }
  | { status: "pick"; candidates: Candidate[] } // no links given: ask the user to pick a profile
  | { status: "saved"; personId: string; jobsQueued: number };

const PLATFORMS: Platform[] = ["linkedin", "x", "instagram", "github"];
const SCRAPE_PLATFORMS: ScrapePlatform[] = ["linkedin", "x", "instagram"];
const SEARCH_SITES: Record<Platform, string> = {
  linkedin: "linkedin.com/in",
  x: "x.com",
  instagram: "instagram.com",
  github: "github.com",
};

/** Social profiles matching a name (+ company), on every platform. People we already have come first. */
export async function findProfiles(name: string, company: string): Promise<Candidate[]> {
  name = name.trim();
  if (name.length < 3) return [];
  const db = createAdminClient();

  const [known, ...web] = await Promise.all([
    db.from("people").select("name, headline, social_profiles!inner(platform, url)").ilike("name", `%${name}%`).limit(3),
    ...PLATFORMS.map((p) => search(`${name} ${company.trim()} site:${SEARCH_SITES[p]}`, 5).catch(() => [])),
  ]);

  const out: Candidate[] = [];
  const add = (c: Candidate) => {
    if (!out.some((o) => o.url === c.url)) out.push(c);
  };
  for (const p of known.data ?? []) {
    for (const s of p.social_profiles) {
      add({ platform: s.platform as Platform, url: s.url, name: p.name, headline: p.headline ?? "", source: "db" });
    }
  }
  PLATFORMS.forEach((platform, i) => {
    for (const r of web[i]) {
      const url = isProfileUrl(platform, r.url) && normalizeSocialUrl(platform, r.url);
      if (url) add({ platform, url, ...parseTitle(r.title, r.description), source: "web" });
    }
  });
  return out;
}

// Titles look like "Jane Doe - Engineer at Acme | LinkedIn", "Jane Doe (@jane) / X", "Jane Doe (jane) - GitHub".
function parseTitle(title: string, description: string) {
  const t = title.replace(/\s*(\|\s*LinkedIn|-\s*LinkedIn|\/\s*X|•\s*Instagram.*|[-·]\s*GitHub)\s*$/i, "");
  const [first, ...rest] = t.split(" - ");
  const headline = rest.join(" - ").trim() || description.replace(/\(https?:[^)]*\)|[#*[\]]/g, "").replace(/\s+/g, " ").trim();
  return { name: first.replace(/\s*\(.*\)\s*$/, "").trim(), headline: headline.slice(0, 120) };
}

export async function submitOnboarding(input: OnboardingInput): Promise<OnboardingResult> {
  const name = input.name.trim();
  if (!name) return { status: "error", message: "Name is required." };

  const socials: { platform: Platform; url: string }[] = [];
  for (const platform of PLATFORMS) {
    const raw = input[platform];
    if (!raw.trim()) continue;
    const url = normalizeSocialUrl(platform, raw);
    if (!url) return { status: "error", message: `That ${platform} link does not look right.` };
    socials.push({ platform, url });
  }

  // No links: we cannot make a sim without data. Show what we found instead.
  if (socials.length === 0) {
    return { status: "pick", candidates: await findProfiles(name, input.company) };
  }

  const db = createAdminClient();
  const guess = Number(input.netWorthGuess.replace(/[^\d]/g, ""));
  // Blank fields are left out, so a second submit never wipes saved data.
  const fields = {
    name,
    ...(input.country.trim() && { country: input.country.trim() }),
    ...(input.netWorthGuess.trim() && Number.isSafeInteger(guess) && { net_worth_guess: guess }),
  };

  // Same link = same person. Reuse them instead of making a duplicate.
  const existing = await db
    .from("social_profiles")
    .select("person_id")
    .in("url", socials.map((s) => s.url))
    .limit(1)
    .maybeSingle();
  if (existing.error) return { status: "error", message: existing.error.message };

  let personId = existing.data?.person_id;
  if (personId) {
    const { error } = await db.from("people").update(fields).eq("id", personId);
    if (error) return { status: "error", message: error.message };
  } else {
    const { data, error } = await db.from("people").insert(fields).select("id").single();
    if (error) return { status: "error", message: error.message };
    personId = data.id;
  }

  const { error: socialError } = await db
    .from("social_profiles")
    .upsert(socials.map((s) => ({ ...s, person_id: personId })), { onConflict: "person_id,platform" });
  if (socialError) return { status: "error", message: socialError.message };

  // Keep the typed company until the scraper fills the real work history.
  const company = input.company.trim();
  if (company) {
    const { count } = await db.from("experiences").select("id", { count: "exact", head: true }).eq("person_id", personId);
    if (!count) await db.from("experiences").insert({ person_id: personId, company, is_primary: true });
  }

  // Queue a scrape per platform, unless one is already waiting or running.
  const { data: active } = await db
    .from("scrape_jobs")
    .select("platform")
    .eq("person_id", personId)
    .in("status", ["queued", "running"]);
  const toQueue = SCRAPE_PLATFORMS.filter(
    (p) => socials.some((s) => s.platform === p) && !active?.some((j) => j.platform === p),
  );
  if (toQueue.length) await queueScrapeJobs(db, personId, toQueue);

  return { status: "saved", personId, jobsQueued: toQueue.length };
}
