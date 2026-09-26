// The Mii world. Seed data for now; swap to Supabase (listPeople / follows / net_worth) once the worker writes real rows.
import World from "@/components/world/World";
import { analyze } from "@/lib/analysis";
import seed from "../../../seed/alex.json";

export default function WorldPage() {
  const analysis = analyze({ people: seed.people, follows: seed.follows, netWorth: seed.net_worth, egoId: seed._meta.ego_id });
  const shown = new Set(analysis.nodes.map((n) => n.id));
  const seen = new Set<string>();
  const links: [string, string][] = [];
  for (const { follower_id: a, person_id: b } of seed.follows) {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (shown.has(a) && shown.has(b) && !seen.has(key)) {
      seen.add(key);
      links.push([a, b]);
    }
  }
  return <World analysis={analysis} links={links} />;
}
