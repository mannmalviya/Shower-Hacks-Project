// What a Mii says when you walk by. Built from the analysis fields, no LLM.
import type { Node } from "@/lib/analysis";

const pick = (id: string, lines: string[]) => lines[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 3) % lines.length];

export function lineFor(n: Node): string {
  if (n.degree === 2) return pick(n.id, ["We've never met. But I've heard of you 👻", "Friend of a friend. Awkward wave?", "I only know you through someone else."]);
  if (n.tie === "aspiration") return pick(n.id, ["You follow me. I don't follow you back.", "Big fan, huh? 😎", "Sorry, who are you again?"]);
  if (n.tie === "audience") return pick(n.id, ["I follow you. You never followed back 🥲", "Still waiting for that follow back…"]);
  if ((n.wealth?.mid ?? 0) > 1_000_000) return pick(n.id, ["Nice pile. Mine's bigger.", "Have you tried buying a house? 🏡", "Money can't buy friends. But look at this hill."]);
  if (n.tribe.startsWith("🛹")) return "Wanna skate later? 🛹";
  if (n.tribe.startsWith("💼")) return pick(n.id, ["Let's circle back on that.", "Have you seen my LinkedIn post?"]);
  if (n.tribe.startsWith("💻") || n.tribe.startsWith("🐻")) return pick(n.id, ["Did you finish the CS 61B project?", "Shipping at 3am again 💻", "Go Bears! 🐻"]);
  if (n.tribe.startsWith("⚽")) return "Pickup game on Sunday? ⚽";
  if (n.tribe.startsWith("🎹")) return "I still practice every day 🎹";
  if (!n.wealth) return "The algorithm can't see me 🫥";
  return pick(n.id, ["Hey! 👋", "Long time no see!", "We should hang out more."]);
}
