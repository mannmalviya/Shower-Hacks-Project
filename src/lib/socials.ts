// Turn what the user typed into one clean URL per platform, so the same profile always has the same URL.
import type { Platform } from "./db";

const PATTERNS: Record<Platform, { re: RegExp; base: string }> = {
  linkedin: { re: /linkedin\.com\/in\/([^/?#\s]+)/i, base: "https://www.linkedin.com/in/" },
  x: { re: /(?:x|twitter)\.com\/([^/?#\s]+)/i, base: "https://x.com/" },
  instagram: { re: /instagram\.com\/([^/?#\s]+)/i, base: "https://www.instagram.com/" },
  github: { re: /github\.com\/([^/?#\s]+)/i, base: "https://github.com/" },
};

/** Accepts a full URL, or a bare handle like "@mann" (not for LinkedIn). Returns null if it does not look valid. */
export function normalizeSocialUrl(platform: Platform, input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const { re, base } = PATTERNS[platform];
  const m = s.match(re);
  if (m) return base + decodeURIComponent(m[1]).toLowerCase();
  if (platform !== "linkedin" && /^@?[\w.-]+$/.test(s)) return base + s.replace(/^@/, "").toLowerCase();
  return null;
}

// First path parts that are site pages, not usernames.
const RESERVED = new Set([
  "i", "home", "search", "explore", "hashtag", "intent", "p", "reel", "reels", "popular", "stories",
  "accounts", "orgs", "topics", "features", "about", "sponsors", "settings", "login", "marketplace", "collections", "trending",
]);

/** True if the URL is a profile page (e.g. x.com/jane), not a post, reel or repo. */
export function isProfileUrl(platform: Platform, url: string): boolean {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (platform === "linkedin") return parts.length === 2 && parts[0] === "in";
    return parts.length === 1 && !RESERVED.has(parts[0].toLowerCase());
  } catch {
    return false;
  }
}
