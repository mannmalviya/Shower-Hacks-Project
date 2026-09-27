// The Mii world. Live Supabase rows (src/lib/worldData.ts); NEXT_PUBLIC_WORLD_SEED=1 shows the fake Alex world instead.
//   /world           the open world: everyone we scraped
//   /world?me=<id>   one person's world (their audience, tribes, portrait)
import LiveWorld from "@/components/world/LiveWorld";

export default async function WorldPage({ searchParams }: PageProps<"/world">) {
  const { me } = await searchParams;
  return <LiveWorld me={typeof me === "string" ? me : null} seed={process.env.NEXT_PUBLIC_WORLD_SEED === "1"} />;
}
