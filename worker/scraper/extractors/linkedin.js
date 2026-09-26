// Runs inside a logged-in LinkedIn profile page (linkedin.com/in/<handle>/).
// Returns a JSON string. Selectors lean on stable-ish structure (h1, section anchors
// #experience / #education, aria-hidden spans) instead of hashed class names.
(() => {
  const t = (el) => (el ? el.innerText.replace(/\s+/g, " ").trim() : null);
  const href = window.location.href;
  if (/\/(authwall|login|checkpoint|uas\/login)/.test(href) || document.querySelector("form#join-form, .authwall-join-form")) {
    return JSON.stringify({ blocked: "login wall: " + href });
  }
  const main = document.querySelector("main") || document.body;
  const h1 = main.querySelector("h1");
  if (!h1) return JSON.stringify({ blocked: "no profile h1 found (page not loaded or layout changed)", url: href });
  const top = h1.closest("section") || main;

  const headline = t(top.querySelector(".text-body-medium"));
  const loc = t(top.querySelector(".text-body-small.inline.t-black--light, span.text-body-small.inline"));
  const img =
    top.querySelector("img.pv-top-card-profile-picture__image--show, img.pv-top-card-profile-picture__image, img.profile-photo-edit__preview") ||
    [...top.querySelectorAll("img")].find((i) => (i.alt || "").trim() === t(h1));
  const followersEl = [...top.querySelectorAll("li, span")].find((e) => /followers$/i.test(t(e) || ""));

  // Each list item -> the visible text lines (LinkedIn duplicates text in visually-hidden spans; aria-hidden ones are the visible copy).
  const sectionFor = (id) => {
    const anchor = document.getElementById(id);
    return anchor ? anchor.closest("section") : null;
  };
  const items = (sec) => {
    if (!sec) return [];
    const lis = [...sec.querySelectorAll("li.artdeco-list__item, li.pvs-list__paged-list-item")];
    return lis
      .map((li) => {
        const lines = [...li.querySelectorAll('span[aria-hidden="true"]')].map((s) => t(s)).filter(Boolean);
        return [...new Set(lines)];
      })
      .filter((l) => l.length);
  };
  const about = t(sectionFor("about")?.querySelector('.inline-show-more-text span[aria-hidden="true"], .display-flex span[aria-hidden="true"]'));

  return JSON.stringify({
    url: href,
    name: t(h1),
    headline,
    location: loc,
    photo_url: img ? img.src : null,
    followers: t(followersEl),
    about,
    experience_lines: items(sectionFor("experience")),
    education_lines: items(sectionFor("education")),
    page_text: (main.innerText || "").slice(0, 15000),
  });
})()
