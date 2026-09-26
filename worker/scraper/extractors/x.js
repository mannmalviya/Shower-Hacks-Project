// Runs inside a logged-in X profile page (x.com/<handle>). Returns a JSON string.
// X uses stable data-testid attributes, which survive redesigns better than classes.
(() => {
  const t = (el) => (el ? el.innerText.replace(/\s+/g, " ").trim() : null);
  const href = window.location.href;
  if (/\/(login|i\/flow\/login)/.test(href)) return JSON.stringify({ blocked: "login wall: " + href });
  const q = (s) => document.querySelector(s);
  const nameBlock = q('[data-testid="UserName"]');
  if (!nameBlock) return JSON.stringify({ blocked: "no UserName block (not loaded, suspended, or logged out)", url: href });
  const handle = window.location.pathname.split("/").filter(Boolean)[0];
  const countFor = (suffix) => t(q(`a[href="/${handle}/${suffix}"]`));
  const photo = q(`a[href="/${handle}/photo"] img`) || q('img[src*="profile_images"]');
  return JSON.stringify({
    url: href,
    name: t(nameBlock.querySelector("span")),
    bio: t(q('[data-testid="UserDescription"]')),
    location: t(q('[data-testid="UserLocation"]')),
    website: t(q('[data-testid="UserUrl"]')),
    photo_url: photo ? photo.src.replace("_normal", "_400x400") : null,
    followers: countFor("verified_followers") || countFor("followers"),
    following: countFor("following"),
  });
})()
