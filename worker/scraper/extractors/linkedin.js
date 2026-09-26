// Runs inside a logged-in LinkedIn page and returns a JSON string. Three page types:
//   /in/<handle>/                      -> top card (name, headline, location, photo, counts)
//   /in/<handle>/details/experience/   -> {items: [[line, line, ...], ...]}
//   /in/<handle>/details/education/    -> same
// Handles the 2026 server-driven layout (id$="Topcard", componentkey="entity-collection-item...")
// and falls back to the older h1 / li.pvs-list layout. Text lines, not hashed classes.
(() => {
  const t = (el) => (el ? el.innerText.replace(/\s+/g, " ").trim() : null);
  const lines = (el) => (el?.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const href = window.location.href;
  if (/\/(authwall|login|checkpoint|uas\/login)/.test(href) || document.querySelector("form#join-form, .authwall-join-form")) {
    return JSON.stringify({ blocked: "login wall: " + href });
  }
  const main = document.querySelector("main") || document.body;

  if (/\/details\/(experience|education)/.test(href)) {
    const key = '[componentkey^="entity-collection-item"]';
    let items = [...main.querySelectorAll(key)].filter((e) => !e.parentElement.closest(key)).map(lines);
    if (!items.length) {
      items = [...main.querySelectorAll("li.pvs-list__paged-list-item, li.artdeco-list__item")].map((li) => [
        ...new Set([...li.querySelectorAll('span[aria-hidden="true"]')].map(t).filter(Boolean)),
      ]);
    }
    return JSON.stringify({ url: href, items: items.filter((l) => l.length) });
  }

  const top = document.querySelector('[id$="Topcard"]') || main.querySelector("h1")?.closest("section");
  if (!top) return JSON.stringify({ blocked: "no top card yet (not loaded or layout changed)", url: href });
  const name = t(top.querySelector("h1, h2"));
  // Lines after the name, minus noise: connection degree ("· 2nd"), pronouns, lone separators.
  const noise = /^(·|·\s*)?(1st|2nd|3rd\+?)?$|^(he|she|they)\/\w+$|^·$/i;
  const all = lines(top);
  const after = all.slice(all.indexOf(name) + 1).filter((l) => !noise.test(l));
  const stop = (l) => /connections?$|followers$|^contact info$|^open to|^message$|^connect$|^follow$|^more$/i.test(l);
  const headline = t(top.querySelector(".text-body-medium")) || (after[0] && !stop(after[0]) ? after[0] : null);
  const rest = after.slice(after.indexOf(headline) + 1);
  const loc =
    t(top.querySelector(".text-body-small.inline.t-black--light")) || (rest[0] && !stop(rest[0]) ? rest[0] : null);
  const img =
    [...top.querySelectorAll("img")].find((i) => /profile-displayphoto/.test(i.src)) ||
    top.querySelector("img.pv-top-card-profile-picture__image--show, img.pv-top-card-profile-picture__image");
  const count = (re) => [...main.querySelectorAll("p, span, li, a")].map(t).find((s) => s && re.test(s)) || null;

  return JSON.stringify({
    url: href,
    name,
    headline,
    location: loc,
    photo_url: img ? img.src : null,
    followers: count(/^[\d,.]+[KM]?\+? followers$/i),
    // Own profile: "500+ connections" on one line. Others' profiles: "500+" then "connections".
    connections: (() => {
      const i = all.findIndex((l) => /connections?$/i.test(l));
      if (i < 0) return null;
      return /\d/.test(all[i]) ? all[i] : `${all[i - 1] || ""} ${all[i]}`.trim();
    })(),
    page_text: (main.innerText || "").slice(0, 15000),
  });
})()
