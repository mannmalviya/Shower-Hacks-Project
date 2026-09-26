"""Fake world for the viz: `python seed/generate.py` -> seed/alex.json

Output = rows for the Supabase tables in supabase/migrations (people, follows, net_worth).
No schema change: everything a scraper returns goes in `people.raw`, keyed by platform,
in the shape the real tools return (see seed/README.md). Swap this file for real scraper
output and the viz / analysis code does not change.

Persona "alex": Alex Chen, 20, CS junior at UC Berkeley, grew up in San Jose.
Lots of hobbies as a kid (soccer, piano, drawing, scouts, robotics) -> now all-in on CS.
"""
import json
import random
import sys
import uuid
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
random.seed(26)
NS = uuid.UUID("5a0e5e5e-0000-4000-8000-000000000026")
OUT = Path(__file__).resolve().parent / "alex.json"

FIRST = ["Ethan", "Sophia", "Daniel", "Mia", "Kevin", "Emily", "Ryan", "Chloe", "Jason", "Olivia", "Brandon",
         "Isabella", "Justin", "Grace", "Andrew", "Ava", "Nathan", "Hannah", "Eric", "Lily", "Marcus", "Priya",
         "Diego", "Aaliyah", "Omar", "Fatima", "Mateo", "Leilani", "Jamal", "Sofia", "Vikram", "Ana", "Tyler",
         "Maya", "Kai", "Zoe", "Luis", "Nina", "Sam", "Jordan", "Riley", "Camila", "Arjun", "Mei", "Julian"]
LAST = ["Nguyen", "Garcia", "Patel", "Kim", "Lopez", "Chen", "Singh", "Martinez", "Tran", "Rodriguez", "Wong",
        "Hernandez", "Park", "Shah", "Lee", "Ramirez", "Huang", "Johnson", "Reyes", "Liu", "Okafor", "Silva",
        "Brown", "Cohen", "Ahmed", "Flores", "Yamamoto", "Davis", "Morales", "Gupta", "Castillo", "Wu"]

LOC = {
    "sj": "San Jose, California, United States", "berkeley": "Berkeley, California, United States",
    "sf": "San Francisco, California, United States", "la": "Los Angeles, California, United States",
    "sd": "San Diego, California, United States", "seattle": "Seattle, Washington, United States",
    "ny": "New York, New York, United States", "oakland": "Oakland, California, United States",
    "sc": "Santa Clara, California, United States",
}

# Median total comp (USD) the net worth route would get from Firecrawl (levels.fyi / Glassdoor)
COMP = {"Stripe": 310_000, "Google": 290_000, "Meta": 330_000, "Apple": 260_000, "NVIDIA": 300_000,
        "OpenAI": 520_000, "Tesla": 200_000, "Kaiser Permanente": 135_000, "PwC": 115_000,
        "County of Santa Clara": 98_000, "Safeway": 42_000, "Target": 38_000, "Starbucks": 33_000,
        "Chen's Kitchen": 58_000, "San Jose Unified School District": 82_000, "Loopwise": 240_000,
        "Figma": 280_000, "Databricks": 320_000}

# Circles = ground truth for generation only. The analysis must re-infer them from raw data.
#   n, platform odds, where they are now (school / job options), follow-back odds
CIRCLES = {
    "family": dict(n=12, era="past", p=dict(facebook=.9, instagram=.3, linkedin=.35), back=1.0,
                   jobs=[("Registered Nurse", "Kaiser Permanente"), ("Owner", "Chen's Kitchen"),
                         ("Senior Accountant", "PwC"), ("Teacher", "San Jose Unified School District"),
                         ("Store Manager", "Safeway"), ("Retired", None)], loc=["sj"] * 5 + ["sc", "sf"]),
    "soccer": dict(n=14, era="past", p=dict(instagram=.8, facebook=.6, linkedin=.2), back=.8,
                   schools=["San Jose State University", "De Anza College", "Evergreen Valley College"],
                   jobs=[("Barista", "Starbucks"), ("Sales Associate", "Target")], loc=["sj"] * 4 + ["sc"],
                   bio=["⚽ {school}", "SJ ⚽ | {school}", "futbol > everything"]),
    "piano": dict(n=8, era="past", p=dict(instagram=.7, facebook=.5), back=.9,
                  schools=["San Francisco Conservatory of Music", "San Jose State University", "UCLA"],
                  loc=["sj", "sf", "la"], bio=["🎹 {school}", "pianist • {school}", "music is my love language"]),
    "art": dict(n=8, era="past", p=dict(instagram=.95, x=.2), back=.7,
                schools=["California College of the Arts", "ArtCenter College of Design", "De Anza College"],
                loc=["sj", "oakland", "la"], bio=["illustrator ✏️ commissions open", "art @ {school}",
                                                  "i draw things sometimes"]),
    "scouts": dict(n=8, era="past", p=dict(facebook=.8, instagram=.4), back=1.0,
                   schools=["San Jose State University", "UC Davis", "Evergreen Valley College"],
                   jobs=[("Sales Associate", "Target"), ("Clerk", "Safeway")], loc=["sj"] * 3 + ["sc"]),
    "highschool": dict(n=25, era="past", p=dict(instagram=.85, facebook=.5, linkedin=.35, x=.1), back=.85,
                       schools=["UC Davis", "San Jose State University", "UCLA", "UC Santa Cruz", "De Anza College",
                                "UC San Diego", "Cal Poly SLO"], loc=["sj", "sj", "la", "sd", "sc"],
                       bio=["Lynbrook '23 → {school}", "{school} '27", "just vibing"]),
    "robotics": dict(n=8, era="bridge", p=dict(github=.75, linkedin=.6, instagram=.6), back=.9,
                     schools=["UCLA", "UC San Diego", "Georgia Tech", "UC Berkeley"], loc=["la", "sd", "berkeley"],
                     roles=["Computer Engineering Student", "EECS Student", "Robotics Researcher"],
                     bio=["FRC alum 🤖 {school}", "building robots @ {school}"]),
    "berkeley": dict(n=45, era="present", p=dict(linkedin=.9, github=.6, instagram=.55, x=.3), back=.9,
                     schools=["UC Berkeley"], loc=["berkeley"] * 5 + ["sf"],
                     roles=["Computer Science Student", "EECS Student", "CS + Data Science Student",
                            "Undergraduate Researcher, BAIR"],
                     interns=["Google", "Meta", "Apple", "NVIDIA", "Databricks", "Figma"],
                     bio=["cs @ berkeley", "cal '27 | {intern} swe intern", "eecs 🐻"]),
    "hackathon": dict(n=15, era="present", p=dict(x=.75, github=.85, linkedin=.7), back=.75,
                      schools=["UC Berkeley", "Stanford University", "San Jose State University"], loc=["sf", "berkeley", "sf"],
                      roles=["Founder (stealth)", "Hacker in residence", "Computer Science Student"],
                      bio=["building something new 🚀", "cal hacks organizer", "shipping at 3am"]),
    "internship": dict(n=12, era="present", p=dict(linkedin=1.0, github=.35, x=.25), back=1.0,
                       jobs=[("Software Engineer", "Stripe"), ("Senior Software Engineer", "Stripe"),
                             ("Staff Engineer", "Stripe"), ("Engineering Manager", "Stripe"),
                             ("Product Manager", "Stripe"), ("Software Engineer Intern", "Stripe")],
                       loc=["sf"] * 4 + ["seattle", "ny"]),
    "idols": dict(n=10, era="present", p=dict(x=.8, instagram=.6), back=0.0, loc=["sf", "ny", "la"],
                  bio=["dev youtuber 📹 1M subs", "founder @ Loopwise (YC W24)", "ex-OpenAI. writing about AGI",
                       "indie hacker, $40k MRR", "10x engineer memes"]),
}

people, follows, net_worth = [], [], []
used_names = set()


def pid(key: str) -> str:
    return str(uuid.uuid5(NS, key))


def new_name() -> str:
    while True:
        n = f"{random.choice(FIRST)} {random.choice(LAST)}"
        if n not in used_names:
            used_names.add(n)
            return n


def handle(name: str, style: int) -> str:
    f, l = name.lower().split()
    return [f"{f}.{l}", f"{f}{l[0]}_{random.randint(1, 99)}", f"{f}{l}", f"_{f}.{l[:3]}"][style % 4]


def seniority(role: str) -> int:
    r = (role or "").lower()
    for words, lvl in [(("owner", "founder", "ceo"), 5), (("manager", "staff", "principal"), 3),
                       (("senior",), 2), (("intern", "student", "researcher"), 0)]:
        if any(w in r for w in words):
            return lvl
    return 1


def add_net_worth(p_id: str, role: str | None, company: str | None, years: int, source: str, older=False):
    """What the net worth API route would write. No company -> no row (grey Mii)."""
    s = seniority(role)
    if s == 0 and role:  # students: no salary lookup needed
        low, high, why = 0, 15_000, f"Student / intern ({role} at {company}). Savings from internships at most."
        net_worth.append({"person_id": p_id, "low": low, "high": high, "reasoning": why, "sources": []})
        return
    if not company or company not in COMP:
        return
    else:
        comp = COMP[company] * (0.6 + 0.25 * s)
        low, high = int(comp * years * 0.08), int(comp * years * 0.25)
        why = f"{role} at {company}: ~${int(comp):,}/yr total comp, ~{years} yrs experience, 8–25% savings rate."
        if older:
            low, high = low + 150_000, high + 600_000
            why += " Likely home equity (Bay Area homeowner)."
        if source == "github":  # company only, seniority unknown -> wider range
            low, high = int(low * 0.5), int(high * 1.6)
            why += " Company from GitHub only, seniority unknown: wide range."
    net_worth.append({"person_id": p_id, "low": low, "high": high, "reasoning": why,
                      "sources": [{"type": "firecrawl", "query": f"{company} salaries levels.fyi",
                                   "median_total_comp_usd": COMP[company]}]})


def raw_linkedin(url, name, headline, loc, exps, edus):
    # joeyism/linkedin_scraper v3 / linkedin-mcp-server get_person_profile shape
    return {"linkedin_url": url, "name": name, "headline": headline, "location": loc, "about": None,
            "open_to_work": False,
            "experiences": [{"position_title": t, "institution_name": c, "from_date": f, "to_date": to,
                             "location": loc, "description": None} for t, c, f, to in exps],
            "educations": [{"institution_name": s, "degree": d, "from_date": f, "to_date": to}
                           for s, d, f, to in edus]}


def raw_instagram(user, full_name, bio, followers, following, verified=False, category=None):
    # Instaloader Profile._node / web_profile_info "user" shape (subset)
    return {"username": user, "full_name": full_name, "biography": bio, "external_url": None,
            "edge_followed_by": {"count": followers}, "edge_follow": {"count": following},
            "is_private": random.random() < 0.4 and not verified, "is_verified": verified,
            "is_business_account": category is not None, "category_name": category, "profile_pic_url": None}


def raw_facebook(fb_id, name, work, edu, city, hometown):
    # kevinzg/facebook-scraper get_profile shape (subset)
    return {"id": fb_id, "Name": name, "profile_url": f"https://www.facebook.com/{fb_id}",
            "Friend_count": random.randint(80, 900),
            "Work": [{"text": w} for w in work], "Education": [{"text": e} for e in edu],
            "Places Lived": [p for p in [{"type": "Current City", "text": city},
                                         {"type": "Hometown", "text": hometown}] if p["text"]]}


def raw_x(user, display, bio, loc, followers, following, verified=False):
    # twscrape User shape (subset)
    return {"id": random.randint(10**17, 10**18), "username": user, "displayname": display,
            "rawDescription": bio, "location": loc, "followersCount": followers, "friendsCount": following,
            "statusesCount": random.randint(20, 30_000), "verified": verified,
            "url": f"https://x.com/{user}", "created": f"20{random.randint(12, 23)}-0{random.randint(1, 9)}-15T10:00:00Z"}


def raw_github(login, name, company, loc, bio, langs, followers):
    # GitHub REST GET /users/{login} (subset) + top_languages from GET /users/{login}/repos
    return {"login": login, "name": name, "company": f"@{company.lower()}" if company else None,
            "blog": "", "location": loc, "bio": bio, "twitter_username": None,
            "public_repos": random.randint(3, 80), "followers": followers, "following": random.randint(5, 200),
            "html_url": f"https://github.com/{login}", "top_languages": langs}


def person_row(p_id, name, raw, headline=None, company=None, role=None, location=None):
    """Top-level columns filled the way the worker would: LinkedIn > GitHub > X > Facebook > Instagram."""
    li, ig, x = raw.get("linkedin"), raw.get("instagram"), raw.get("x")
    return {"id": p_id, "user_id": None, "name": name, "headline": headline, "company": company, "role": role,
            "location": location, "photo_url": None,
            "linkedin_url": li["linkedin_url"] if li else None,
            "x_url": x["url"] if x else None,
            "instagram_url": f"https://www.instagram.com/{ig['username']}" if ig else None,
            "raw": raw}


def link(a: str, b: str, mutual=True):
    """follows row: follower_id follows person_id."""
    follows.append({"follower_id": a, "person_id": b})
    if mutual:
        follows.append({"follower_id": b, "person_id": a})


# ---------- the user: Alex ----------
ALEX = pid("alex")
alex_raw = {
    "linkedin": raw_linkedin("https://www.linkedin.com/in/alex-chen-cs", "Alex Chen",
                             "CS @ UC Berkeley | SWE Intern @ Stripe", LOC["berkeley"],
                             [("Software Engineer Intern", "Stripe", "Jun 2026", "Aug 2026"),
                              ("Teaching Assistant, CS 61A", "UC Berkeley", "Jan 2026", "Present"),
                              ("Robotics Team Lead", "Lynbrook Robotics (FRC 846)", "Sep 2021", "Jun 2023")],
                             [("UC Berkeley", "BS, Computer Science", "2023", "2027"),
                              ("Lynbrook High School", "High School Diploma", "2019", "2023")]),
    "instagram": raw_instagram("alexchen.jpg", "Alex Chen", "cal '27 🐻 | used to draw, now i code", 612, 740),
    "facebook": raw_facebook("alex.chen.5021", "Alex Chen", ["Stripe"], ["UC Berkeley", "Lynbrook High School"],
                             "Berkeley, California", "San Jose, California"),
    "x": raw_x("alexchen_dev", "alex chen", "cs @ berkeley. building things. prev: robots, piano, soccer",
               "Berkeley, CA", 318, 590),
    "github": raw_github("alexchen-dev", "Alex Chen", None, "Berkeley, CA", "CS @ Berkeley",
                         ["Python", "TypeScript", "C++"], 64),
}
people.append(person_row(ALEX, "Alex Chen", alex_raw, "CS @ UC Berkeley | SWE Intern @ Stripe", "Stripe",
                         "Software Engineer Intern", LOC["berkeley"]))
add_net_worth(ALEX, "Software Engineer Intern", "Stripe", 0, "linkedin")
scrapable = []  # 1st-degree people whose own follows the worker would scrape (-> 2nd degree)

# ---------- 1st degree ----------
for circle, c in CIRCLES.items():
    for i in range(c["n"]):
        name = new_name() if circle != "family" else f"{random.choice(FIRST)} Chen"
        if circle == "family" and name in used_names:
            name = f"{random.choice(FIRST)} {random.choice(['Chen', 'Lin', 'Wu'])}"
        used_names.add(name)
        p_id = pid(f"{circle}-{i}")
        loc = LOC[random.choice(c["loc"])]
        school = random.choice(c["schools"]) if "schools" in c else None
        role, company, years, older = None, None, 0, False
        if circle in ("family", "internship") or ("jobs" in c and random.random() < 0.35):
            role, company = random.choice(c["jobs"])
            years = random.randint(12, 30) if circle == "family" else random.randint(1, 12)
            older = circle == "family"
            if circle != "family" and circle != "internship":
                years = random.randint(1, 3)
        elif "roles" in c:
            role = random.choice(c["roles"])
            company = random.choice(c["interns"]) if "interns" in c and random.random() < 0.4 else school
            if company != school:
                role = "Software Engineer Intern"
        if circle == "idols":
            role, company = (("Founder & CEO", "Loopwise") if i == 1 else
                             ("Member of Technical Staff", "OpenAI") if i == 2 else (None, None))
            years = 8
        intern = company if company in COMP and circle == "berkeley" else "Meta"
        bio = random.choice(c.get("bio", [""])).format(school=school or "", intern=intern) or None
        user = handle(name, i)
        raw = {}
        on = {plat for plat, odds in c["p"].items() if random.random() < odds} or {max(c["p"], key=c["p"].get)}
        if "linkedin" in on:
            if not role and school:
                role, company = "Student", school
            exps = [(role, company, "Jan 2022", "Present")] if role and company and company != school else []
            if circle == "berkeley" and company in COMP:
                exps = [("Software Engineer Intern", company, "Jun 2026", "Aug 2026")]
            edus = [(school, "BS", "2023", "2027")] if school else []
            if circle in ("highschool", "robotics"):
                edus.append(("Lynbrook High School", "High School Diploma", "2019", "2023"))
            headline = (f"{school} | {role} @ {company}" if school and company and company != school
                        else f"{role} at {company}" if role and company and company != school
                        else f"{role or 'Student'} @ {school}" if school else role)
            raw["linkedin"] = raw_linkedin(f"https://www.linkedin.com/in/{user.replace('.', '-').strip('_')}-{i}",
                                           name, headline, loc, exps, edus)
        if "instagram" in on:
            big = circle == "idols"
            raw["instagram"] = raw_instagram(user.replace("-", "_"), name if random.random() < .8 else "",
                                             bio, random.randint(200_000, 2_000_000) if big else
                                             random.randint(150, 1500), random.randint(100, 1200), verified=big,
                                             category="Digital creator" if big else None)
        if "facebook" in on:
            hometown = "San Jose, California" if c["era"] == "past" or circle == "robotics" else None
            work = [company] if company and company != school else []
            edu = [e for e in [school, "Lynbrook High School" if circle in ("highschool", "robotics", "soccer")
                               else None] if e]
            raw["facebook"] = raw_facebook(f"{user.replace('_', '')}.{random.randint(100, 9999)}", name, work,
                                           edu, loc.rsplit(",", 1)[0], hometown)
        if "x" in on:
            big = circle == "idols"
            raw["x"] = raw_x(user.replace(".", "_"), name.split()[0].lower() if not big else name, bio,
                             loc.split(",")[0], random.randint(100_000, 900_000) if big else random.randint(20, 3000),
                             random.randint(50, 900), verified=big)
        if "github" in on:
            langs = random.sample(["Python", "TypeScript", "Rust", "Go", "C++", "Java", "Swift", "Jupyter Notebook"], 3)
            if circle == "robotics":
                langs[0] = "C++"
            gh_company = company if company in COMP else None
            raw["github"] = raw_github(user.replace(".", "-").strip("_-"), name, gh_company, loc.split(",")[0],
                                       bio, langs, random.randint(3, 400))
        li = raw.get("linkedin")
        gh = raw.get("github")
        location = loc if (li or gh or "x" in raw or "facebook" in raw) else None
        display = name if (li or gh or "facebook" in raw or (raw.get("instagram") or {}).get("full_name")
                           or "x" in raw) else raw["instagram"]["username"]
        people.append(person_row(p_id, display, raw,
                                 headline=li["headline"] if li else bio,
                                 company=company if (li and company) or (gh and gh["company"]) else None,
                                 role=role if li else None, location=location))
        if li:
            add_net_worth(p_id, role, company, years, "linkedin", older)
        elif gh and gh["company"]:
            add_net_worth(p_id, None, company, 3, "github")
        # edges with Alex
        if circle == "idols":
            link(ALEX, p_id, mutual=False)                 # Alex follows them, no follow back
        elif random.random() < c["back"]:
            link(ALEX, p_id)
        else:
            link(p_id, ALEX, mutual=False)                 # they follow Alex, Alex doesn't follow back
        if circle in ("berkeley", "hackathon", "robotics", "internship") and ("github" in raw or "x" in raw):
            scrapable.append((p_id, circle))

# edges inside circles (friends know each other); only visible via scraped contacts in reality
ids_by_circle = {c: [pid(f"{c}-{i}") for i in range(v["n"])] for c, v in CIRCLES.items()}
for circle, ids in ids_by_circle.items():
    if circle == "idols":
        continue
    for a in ids:
        for b in random.sample(ids, min(3, len(ids))):
            if a < b and random.random() < 0.5:
                link(a, b)
# the bridge: robotics friends know some high school + berkeley people
for a in ids_by_circle["robotics"]:
    link(a, random.choice(ids_by_circle["highschool"]))
    link(a, random.choice(ids_by_circle["berkeley"]))

# ---------- 2nd degree: who the scraped contacts follow ----------
second = 0
for p_id, circle in random.sample(scrapable, min(15, len(scrapable))):
    for j in range(random.randint(12, 20)):
        key = f"2nd-{random.randint(0, 260)}"            # shared pool -> friends of friends overlap
        q_id = pid(key)
        if not any(p["id"] == q_id for p in people):
            name = new_name()
            login = handle(name, j).replace(".", "-").strip("_-")
            company = random.choice([None, None, "Google", "Meta", "Stripe", "OpenAI", "Tesla", "Figma"])
            # a following list only gives login/name; ~40% get enriched by the worker
            enriched = random.random() < 0.4
            raw = {"github": raw_github(login, name if enriched else None, company if enriched else None,
                                        random.choice(["San Francisco", "Berkeley", "Seattle", "New York", None]),
                                        None, [], random.randint(1, 500))}
            people.append(person_row(q_id, name if enriched else login, raw,
                                     company=company if enriched else None))
            if enriched and company:
                add_net_worth(q_id, None, company, random.randint(1, 10), "github")
            second += 1
        link(p_id, q_id, mutual=random.random() < 0.3)
    # some of what they follow is also in Alex's 1st degree
    for q_id in random.sample(ids_by_circle[circle], min(4, len(ids_by_circle[circle]))):
        if q_id != p_id:
            link(p_id, q_id)

# de-dup edges (primary key follower_id, person_id)
follows = [dict(t) for t in {(("follower_id", f["follower_id"]), ("person_id", f["person_id"])) for f in follows}]
follows.sort(key=lambda f: (f["follower_id"], f["person_id"]))

OUT.write_text(json.dumps({
    "_meta": {"persona": "alex", "ego_id": ALEX, "generator": "seed/generate.py",
              "note": "Fake data. Rows match supabase/migrations. people.raw = untouched scraper output per platform."},
    "people": people, "follows": follows, "net_worth": net_worth,
}, indent=1, ensure_ascii=False), encoding="utf-8")

first = sum(1 for f in follows if f["follower_id"] == ALEX or f["person_id"] == ALEX)
plat = {k: sum(1 for p in people if k in p["raw"]) for k in ["linkedin", "instagram", "facebook", "x", "github"]}
print(f"→ {OUT.name}: {len(people)} people ({len(people) - 1 - second} 1st degree, {second} 2nd degree), "
      f"{len(follows)} follows, {len(net_worth)} net_worth rows")
print(f"  on each platform: {plat}")
print(f"  unknown wealth among 1st degree: "
      f"{100 - round(100 * sum(1 for n in net_worth if n['person_id'] in {pid(f'{c}-{i}') for c, v in CIRCLES.items() for i in range(v['n'])}) / (len(people) - 1 - second))}%")
