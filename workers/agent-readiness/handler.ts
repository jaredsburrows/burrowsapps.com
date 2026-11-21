// Request logic for the agent-readiness Worker, kept apart from the entry
// module so tests can import it and so the entry module exports nothing but
// the default handler.

export type OriginFetch = (request: Request) => Promise<Response>;

export type PageLink = { href: string; rel: string; type?: string };
export type Page = { markdown: string; links: readonly PageLink[] };

// Only IANA-registered relations, each pointing at a file in this repo.
// Targets are path-absolute so the same value is right on apex and www.
export const PAGES: Readonly<Record<string, Page>> = {
  "/": {
    markdown: "/index.md",
    links: [
      { href: "/index.md", rel: "alternate", type: "text/markdown" },
      { href: "/.well-known/agent-skills/index.json", rel: "describedby", type: "application/json" },
      { href: "/.well-known/ai-catalog.json", rel: "describedby", type: "application/json" },
      { href: "/privacy.html", rel: "privacy-policy" },
    ],
  },
  "/privacy.html": {
    markdown: "/privacy.md",
    links: [{ href: "/privacy.md", rel: "alternate", type: "text/markdown" }],
  },
};

export function formatLinks(links: readonly PageLink[]): string {
  return links
    .map((link) => `<${link.href}>; rel="${link.rel}"${link.type ? `; type="${link.type}"` : ""}`)
    .join(", ");
}

// Markdown wins only when text/markdown is listed explicitly with q > 0 and
// its q is at least that of HTML. Wildcards count for neither side, so a
// browser's "*/*" never turns into markdown.
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  let md = 0;
  let html = 0;
  for (const part of accept.split(",")) {
    const [rawType, ...params] = part.split(";");
    const type = rawType.trim().toLowerCase();
    let q = 1;
    for (const param of params) {
      const [key, value] = param.split("=");
      if (key.trim().toLowerCase() === "q" && value !== undefined) {
        const parsed = Number(value.trim());
        q = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1;
      }
    }
    if (type === "text/markdown") md = Math.max(md, q);
    if (type === "text/html" || type === "application/xhtml+xml") html = Math.max(html, q);
  }
  return md > 0 && md >= html;
}

// Same estimate Cloudflare's Markdown for Agents documents: bytes / 4, floored.
export function estimateTokens(markdown: string): number {
  return Math.floor(new TextEncoder().encode(markdown).length / 4);
}
