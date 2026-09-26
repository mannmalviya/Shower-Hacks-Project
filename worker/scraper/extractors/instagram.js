// Runs inside an Instagram profile page. Instagram's DOM is obfuscated, so read
// the Open Graph meta tags, which it fills server-side for every public profile:
//   og:title       "Jane Doe (@jane) • Instagram photos and videos"
//   og:description "1,234 Followers, 56 Following, 78 Posts - See Instagram photos and videos from Jane Doe (@jane)"
(() => {
  const meta = (p) => document.querySelector(`meta[property="${p}"]`)?.content || null;
  const href = window.location.href;
  if (/\/accounts\/login/.test(href)) return JSON.stringify({ blocked: "login wall: " + href });
  const title = meta("og:title");
  if (!title) return JSON.stringify({ blocked: "no og:title (not loaded or not a profile)", url: href });
  const desc = meta("og:description") || "";
  const bio = document.querySelector("header section h1, header section span[dir='auto']");
  return JSON.stringify({
    url: href,
    og_title: title,
    og_description: desc,
    photo_url: meta("og:image"),
    bio: bio ? bio.innerText.trim() : null,
  });
})()
