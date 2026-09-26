// Firecrawl web search. Server only.
import "server-only";

export type WebResult = { url: string; title: string; description: string };

export async function search(query: string, limit = 5): Promise<WebResult[]> {
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.FIRECRAWL_API_KEY && { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}` }),
    },
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) throw new Error(`Firecrawl search failed: ${res.status}`);
  const json = await res.json();
  return (json.data?.web ?? []).map((r: WebResult) => ({
    url: r.url,
    title: r.title ?? "",
    description: r.description ?? "",
  }));
}
