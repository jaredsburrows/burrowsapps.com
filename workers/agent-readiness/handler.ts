// Request logic for the agent-readiness Worker, kept apart from the entry
// module so tests can import it and so the entry module exports nothing but
// the default handler.

export type OriginFetch = (request: Request) => Promise<Response>;

export type PageLink = { href: string; rel: string; type?: string };
// asset: the path the asset router serves the page's HTML file at.
export type Page = { asset: string; markdown: string; links: readonly PageLink[] };

// Only IANA-registered relations, each pointing at a published file or a
// path this Worker serves. Targets are path-absolute.
export const PAGES: Readonly<Record<string, Page>> = {
  "/": {
    asset: "/",
    markdown: "/index.md",
    links: [
      { href: "/index.md", rel: "alternate", type: "text/markdown" },
      { href: "/.well-known/api-catalog", rel: "api-catalog", type: "application/linkset+json" },
      { href: "/api/v1/openapi.json", rel: "service-desc", type: "application/vnd.oai.openapi+json" },
      { href: "/developers.md", rel: "service-doc", type: "text/markdown" },
      { href: "/.well-known/agent-skills/index.json", rel: "describedby", type: "application/json" },
      { href: "/.well-known/ai-catalog.json", rel: "describedby", type: "application/json" },
      { href: "/privacy.html", rel: "privacy-policy" },
    ],
  },
  "/privacy.html": {
    asset: "/privacy",
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

// Fetches the page's markdown file from the static files. Returns null
// whenever the result is not usable markdown, so the caller can fall back to
// HTML.
async function markdownResponse(request: Request, page: Page, originFetch: OriginFetch): Promise<Response | null> {
  // Built from request.url so a request to www stays on www.
  const subrequest = new Request(new URL(page.markdown, request.url), {
    method: "GET",
    headers: { Accept: "text/markdown" },
    redirect: "manual",
  });
  const origin = await originFetch(subrequest);
  const contentType = origin.headers.get("Content-Type") ?? "";
  if (origin.status !== 200 || contentType.toLowerCase().startsWith("text/html")) return null;
  const markdown = await origin.text();
  if (markdown.trim() === "") return null;

  // Not storable anywhere: Cloudflare's cache does not vary on Accept, so a
  // cached markdown copy under the page URL could be handed to a browser.
  const headers = new Headers({
    "Content-Type": "text/markdown; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Vary": "Accept",
    "Link": formatLinks(page.links),
    "X-Markdown-Tokens": String(estimateTokens(markdown)),
  });
  const allowOrigin = origin.headers.get("Access-Control-Allow-Origin");
  if (allowOrigin !== null) headers.set("Access-Control-Allow-Origin", allowOrigin);
  return new Response(request.method === "HEAD" ? null : markdown, { status: 200, headers });
}

// True when the file's Vary already covers Accept, either by naming it or
// with "*", which must stand alone and already means "varies on everything".
function varyCoversAccept(vary: string | null): boolean {
  return (vary ?? "").split(",").some((token) => ["accept", "*"].includes(token.trim().toLowerCase()));
}

export async function handle(request: Request, originFetch: OriginFetch): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return originFetch(request);
  // The query string is ignored, so "/?sent=1" and "/?utm_source=x" are decorated as "/".
  const url = new URL(request.url);
  const page = PAGES[url.pathname];
  if (!page) return originFetch(request);

  if (prefersMarkdown(request.headers.get("Accept"))) {
    try {
      const markdown = await markdownResponse(request, page, originFetch);
      if (markdown) return markdown;
    } catch {
      // Fall through to the HTML page.
    }
  }

  // The asset router serves privacy.html at "/privacy" and answers a request
  // for "/privacy.html" with a redirect there. Ask for the path it serves,
  // with the visitor's own method and headers.
  const pageRequest = page.asset === url.pathname ? request : new Request(new URL(page.asset, url), request);
  // Errors here propagate; the router owns the last retry.
  const response = await originFetch(pageRequest);
  try {
    if (response.status !== 200 && response.status !== 304) return response;
    const out = new Response(response.body, response);
    out.headers.append("Link", formatLinks(page.links));
    if (!varyCoversAccept(out.headers.get("Vary"))) out.headers.append("Vary", "Accept");
    return out;
  } catch {
    return response;
  }
}
