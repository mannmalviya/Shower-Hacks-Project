// Run the analysis on the seed: node scripts/analyze-seed.mjs [seed/alex.json]
import { readFileSync } from "node:fs";
import { analyze } from "../src/lib/analysis.ts";

const seed = JSON.parse(readFileSync(process.argv[2] ?? "seed/alex.json", "utf8"));
const a = analyze({ people: seed.people, follows: seed.follows, netWorth: seed.net_worth, egoId: seed._meta.ego_id });

console.log("\n== Facts per filter");
for (const b of Object.values(a.bubbles)) console.log(`  [${b.dimension}] diversity ${b.diversity} | ${b.fact}`);
console.log(`\n== Tribes (you: ${a.egoTribe})`);
for (const t of a.tribes) console.log(`  ${t.name.padEnd(30)} ${t.era.padEnd(8)} ${String(t.size).padStart(3)}  conf ${t.confidence}  | ${t.topTraits.join(", ")}`);
const multi = a.nodes.filter((n) => n.tribes.length);
console.log(`  ${multi.length} people in 2+ tribes, e.g. ${multi.slice(0, 3).map((n) => `${n.tribe} + ${n.tribes.join(" + ")}`).join(" | ")}`);
console.log("\n== Circles");
for (const c of a.circles) console.log(`  ${c.name.padEnd(28)} ${c.era.padEnd(8)} ${String(c.size).padStart(3)}  mutual ${Math.round(c.mutualShare * 100)}%  wealth ${c.medianWealth ?? "?"}  | ${c.topTraits.join(", ")}`);
console.log("\n== Ties", a.ties);
console.log("== Class", a.class);
console.log("== Past vs present", JSON.stringify(a.pastVsPresent));
console.log("== 2nd degree", a.secondDegree);
console.log(`\nportraitInput: ${JSON.stringify(a.portraitInput).length} chars, names included: ${seed.people.slice(1, 50).some((p) => JSON.stringify(a.portraitInput).includes(p.name))}`);
