// Demo data for the live world: well-known founders + a few made-up people, each with made-up followers.
//
//   node scripts/seed-demo.mjs            add (removes the old demo rows first, so it is safe to re-run)
//   node scripts/seed-demo.mjs --remove   remove every demo row
//
// Every demo person has people.raw.demo = true; deleting them cascades to all their rows.
// Public figures: public roles and schools only. Follower counts and net worth are rough public
// estimates, labeled as demo data. Scrape jobs are inserted as "done", so the worker never scrapes them.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const B = 1e9, M = 1e6, K = 1e3;
const job = (company, title, start, end = null, is_primary = !end) => ({ company, title, start_date: start, end_date: end, is_primary });
const school = (name, degree, field, end) => ({ school: name, degree, field, end_date: end });

// [name, headline, location, jobs, schools, socials [platform, url, followers], worth [low, high], followers to create]
const PEOPLE = [
  ["Elon Musk", "CEO of Tesla and SpaceX", "Austin, Texas, United States",
    [job("Tesla", "CEO", "2008-10-01"), job("SpaceX", "CEO & CTO", "2002-05-01", null, false), job("xAI", "Founder", "2023-03-01", null, false), job("PayPal", "Co-founder", "1999-03-01", "2002-10-01")],
    [school("University of Pennsylvania", "BS", "Economics, Physics", "1997-05-01")],
    [["x", "https://x.com/elonmusk", 220 * M]], [300 * B, 500 * B], 60],
  ["Sam Altman", "CEO of OpenAI", "San Francisco, California, United States",
    [job("OpenAI", "CEO", "2019-03-01"), job("Y Combinator", "President", "2014-02-01", "2019-03-01"), job("Loopt", "Co-founder & CEO", "2005-01-01", "2012-03-01")],
    [school("Stanford University", null, "Computer Science", null)],
    [["x", "https://x.com/sama", 4 * M]], [1.5 * B, 3 * B], 40],
  ["Jensen Huang", "Founder and CEO of NVIDIA", "Santa Clara, California, United States",
    [job("NVIDIA", "Founder & CEO", "1993-04-01"), job("LSI Logic", "Director", "1985-01-01", "1993-01-01"), job("AMD", "Microprocessor Designer", "1983-01-01", "1985-01-01")],
    [school("Stanford University", "MS", "Electrical Engineering", "1992-06-01"), school("Oregon State University", "BS", "Electrical Engineering", "1984-06-01")],
    [["linkedin", "https://www.linkedin.com/in/jenhsunhuang", 1 * M]], [120 * B, 160 * B], 40],
  ["Bill Gates", "Chair, Gates Foundation", "Medina, Washington, United States",
    [job("Gates Foundation", "Chair", "2000-01-01"), job("Breakthrough Energy", "Founder", "2015-01-01", null, false), job("Microsoft", "Co-founder", "1975-04-01", "2020-03-01")],
    [school("Harvard University", null, null, null)],
    [["x", "https://x.com/BillGates", 65 * M]], [100 * B, 130 * B], 50],
  ["Garry Tan", "President & CEO of Y Combinator", "San Francisco, California, United States",
    [job("Y Combinator", "President & CEO", "2023-01-01"), job("Initialized Capital", "Co-founder", "2011-01-01", "2022-12-01"), job("Posterous", "Co-founder", "2008-01-01", "2012-03-01"), job("Palantir", "Designer", "2005-01-01", "2008-01-01")],
    [school("Stanford University", "BS", "Computer Systems Engineering", "2003-06-01")],
    [["x", "https://x.com/garrytan", 500 * K]], [200 * M, 800 * M], 35],
  ["Peter Thiel", "Partner, Founders Fund", "Los Angeles, California, United States",
    [job("Founders Fund", "Partner", "2005-01-01"), job("Palantir", "Co-founder & Chairman", "2003-01-01", null, false), job("PayPal", "Co-founder & CEO", "1998-12-01", "2002-10-01")],
    [school("Stanford Law School", "JD", "Law", "1992-06-01"), school("Stanford University", "BA", "Philosophy", "1989-06-01")],
    [["x", "https://x.com/peterthiel", 400 * K]], [15 * B, 25 * B], 30],
  // made-up people (fictional names and handles)
  ["Maya Patel", "Software Engineer at Stripe", "San Francisco, California, United States",
    [job("Stripe", "Software Engineer", "2023-07-01"), job("Meta", "SWE Intern", "2022-06-01", "2022-09-01")],
    [school("UC Berkeley", "BS", "Computer Science", "2023-05-01")],
    [["instagram", "https://www.instagram.com/socialmirror_demo_maya", 2400], ["linkedin", "https://www.linkedin.com/in/socialmirror-demo-maya", 900]], [60 * K, 140 * K], 25],
  ["Diego Ramirez", "Barista and film student", "Oakland, California, United States",
    [job("Blue Bottle Coffee", "Barista", "2024-01-01")],
    [school("San Francisco State University", "BA", "Cinema", null)],
    [["instagram", "https://www.instagram.com/socialmirror_demo_diego", 870]], [0, 12 * K], 15],
  ["Chloe Kim", "Product Designer at Figma", "New York, New York, United States",
    [job("Figma", "Product Designer", "2021-03-01"), job("IDEO", "Designer", "2018-06-01", "2021-02-01")],
    [school("Rhode Island School of Design", "BFA", "Industrial Design", "2018-05-01")],
    [["instagram", "https://www.instagram.com/socialmirror_demo_chloe", 15600], ["x", "https://x.com/socialmirror_demo_chloe", 3200]], [180 * K, 420 * K], 30],
  ["Omar Haddad", "Founder, stealth AI startup (YC W26)", "San Francisco, California, United States",
    [job("Stealth Startup", "Founder & CEO", "2025-09-01"), job("Google", "Software Engineer", "2019-08-01", "2025-08-01")],
    [school("University of Waterloo", "BASc", "Software Engineering", "2019-05-01")],
    [["x", "https://x.com/socialmirror_demo_omar", 11800], ["linkedin", "https://www.linkedin.com/in/socialmirror-demo-omar", 7400]], [700 * K, 2.5 * M], 30],
  ["Lena Novak", "ICU Nurse", "Chicago, Illinois, United States",
    [job("Northwestern Medicine", "Registered Nurse, ICU", "2017-06-01")],
    [school("Loyola University Chicago", "BSN", "Nursing", "2017-05-01")],
    [["instagram", "https://www.instagram.com/socialmirror_demo_lena", 540]], [90 * K, 220 * K], 12],
];

// made-up followers: names, jobs and cities (fictional)
const FIRST = ["Alex", "Maya", "Jordan", "Priya", "Sam", "Lucas", "Aisha", "Kenji", "Sofia", "Omar", "Chloe", "Diego", "Nina", "Ethan", "Zara", "Leo", "Hana", "Mateo", "Ava", "Ravi", "Emma", "Kai", "Lina", "Noah", "Mei", "Ivy", "Yusuf", "Grace", "Arjun", "Tariq"];
const LAST = ["Nguyen", "Patel", "Garcia", "Kim", "Smith", "Okafor", "Rossi", "Tanaka", "Silva", "Haddad", "Novak", "Chen", "Lopez", "Singh", "Johnson", "Park", "Costa", "Ali", "Brown", "Martin", "Sato", "Mensah", "Dubois", "Khan"];
const JOBS = [["Stripe", "Software Engineer"], ["Google", "Product Manager"], ["Airbnb", "Data Scientist"], ["Figma", "Designer"], ["OpenAI", "Research Engineer"], ["NVIDIA", "GPU Architect"], ["Tesla", "Mechanical Engineer"], ["SpaceX", "Avionics Engineer"], ["Sequoia", "Investor"], ["Kaiser Permanente", "Nurse"], ["Blue Bottle Coffee", "Barista"], ["Goldman Sachs", "Analyst"], ["Y Combinator", "Founder"], ["Microsoft", "Software Engineer"], ["Palantir", "Forward Deployed Engineer"]];
const SCHOOLS = ["Stanford University", "UC Berkeley", "MIT", "Carnegie Mellon University", "University of Waterloo", "UCLA", "Georgia Tech", "University of Michigan"];
const CITIES = ["San Francisco, California, United States", "New York, New York, United States", "Austin, Texas, United States", "Seattle, Washington, United States", "Los Angeles, California, United States", "Toronto, Ontario, Canada", "London, England, United Kingdom"];
let seed = 42;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };

async function removeDemo() {
  const { data, error } = await db.from("people").select("id").eq("raw->>demo", "true");
  if (error) throw error;
  for (let i = 0; i < data.length; i += 100) {
    const { error: e } = await db.from("people").delete().in("id", data.slice(i, i + 100).map((p) => p.id));
    if (e) throw e;
  }
  return data.length;
}

const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

async function add() {
  const followerPool = []; // made-up followers, some follow more than one person
  for (const [name, headline, location, jobs, schools, socials, [low, high], nFollowers] of PEOPLE) {
    const [person] = must(await db.from("people").insert({ name, headline, location, raw: { demo: true } }).select("id"));
    const id = person.id;
    must(await db.from("experiences").insert(jobs.map((j) => ({ ...j, person_id: id }))));
    must(await db.from("education").insert(schools.map((s) => ({ ...s, person_id: id }))));
    must(await db.from("social_profiles").insert(socials.map(([platform, url, follower_count]) => ({
      person_id: id, platform, url, handle: url.split("/").filter(Boolean).pop(), follower_count, raw: { demo: true } }))));
    must(await db.from("net_worth").upsert({ person_id: id, low: Math.round(low), high: Math.round(high),
      reasoning: "Demo data: a rough range based on public estimates, not a scrape.", sources: [{ type: "demo", label: "Demo data" }] }));
    // "done" jobs: this person counts as someone with a world, and the worker leaves them alone
    must(await db.from("scrape_jobs").insert(socials.filter(([p]) => p !== "github").map(([platform]) => ({ person_id: id, platform, status: "done" }))));

    // followers: reuse some from earlier people (shared audience), make the rest new
    const reuse = followerPool.filter(() => rnd(6) === 0).slice(0, Math.floor(nFollowers / 5));
    const fresh = [];
    for (let k = reuse.length; k < nFollowers; k++) {
      const [company, title] = JOBS[rnd(JOBS.length)];
      fresh.push({ name: `${FIRST[rnd(FIRST.length)]} ${LAST[rnd(LAST.length)]}`, headline: `${title} at ${company}`, location: CITIES[rnd(CITIES.length)], raw: { demo: true }, _job: [company, title], _school: SCHOOLS[rnd(SCHOOLS.length)] });
    }
    const made = fresh.length ? must(await db.from("people").insert(fresh.map(({ _job, _school, ...p }) => p)).select("id")) : [];
    const exps = made.map((p, k) => ({ person_id: p.id, company: fresh[k]._job[0], title: fresh[k]._job[1], is_primary: true }));
    const edus = made.map((p, k) => ({ person_id: p.id, school: fresh[k]._school }));
    if (exps.length) must(await db.from("experiences").insert(exps));
    if (edus.length) must(await db.from("education").insert(edus));
    const followerIds = [...reuse, ...made.map((p) => p.id)];
    must(await db.from("follows").insert(followerIds.map((f) => ({ follower_id: f, person_id: id }))));
    // a few mutuals (they follow back), so the world has real ties
    const back = followerIds.filter(() => rnd(5) === 0);
    if (back.length) must(await db.from("follows").insert(back.map((f) => ({ follower_id: id, person_id: f }))));
    // rough net worth for about half the followers (the rest stay unknown)
    const worths = made.filter(() => rnd(2) === 0).map((p) => { const mid = [20, 60, 150, 400, 1200][rnd(5)] * K; return { person_id: p.id, low: Math.round(mid * 0.6), high: Math.round(mid * 1.6), reasoning: "Demo data.", sources: [{ type: "demo", label: "Demo data" }] }; });
    if (worths.length) must(await db.from("net_worth").insert(worths));
    followerPool.push(...made.map((p) => p.id));
    console.log(`${name}: ${followerIds.length} followers (${reuse.length} shared)`);
  }
}

const removed = await removeDemo();
console.log(`removed ${removed} old demo people`);
if (!process.argv.includes("--remove")) await add();
