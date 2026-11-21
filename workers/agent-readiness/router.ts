// Decides, for each request, whether the Worker answers it itself (an "owned"
// path), decorates the origin's page, or passes it through untouched.
//
// Owned paths never fall through to the origin: an internal failure is a 500
// from here, and passThroughOnException is not armed for them, so a bearer
// token or a code verifier is never forwarded to GitHub Pages. Everything else
// keeps the iteration 1 fail-open behavior.

import { handle as api, catalog } from "./api.ts";
import { handle } from "./handler.ts";
import { endpoint as mcp } from "./mcp.ts";
import { json } from "./http.ts";
import type { Deps, Env } from "./http.ts";

const SITE_HOST = "burrowsapps.com";

type Handler = (request: Request, env: Env, deps: Deps, url: URL) => Promise<Response>;

const notFound = async (): Promise<Response> => json(404, { error: "not_found" });

const publicApi: Handler = (request, env, deps, url) => api(request, env, deps, url, false);

const ROUTES: Readonly<Record<string, Handler>> = {
  "/.well-known/api-catalog": async (request) => catalog(request),
  "/api/v1": publicApi,
  "/api/v1/": publicApi,
  "/api/v1/company": publicApi,
  "/api/v1/services": publicApi,
  "/api/v1/status": publicApi,
  "/api/v1/openapi.json": publicApi,
  "/mcp": (request, env, deps) => mcp(request, env, deps, false),
};

export const OWNED_EXACT: readonly string[] = Object.keys(ROUTES);
export const OWNED_PREFIXES: readonly string[] = ["/api/v1/", "/mcp/", "/oauth/"];

export function isOwned(pathname: string): boolean {
  return OWNED_EXACT.includes(pathname) || OWNED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function served(response: Response): "markdown" | "html" | "other" {
  const type = (response.headers.get("Content-Type") ?? "").toLowerCase();
  if (type.startsWith("text/markdown")) return "markdown";
  if (type.startsWith("text/html")) return "html";
  return "other";
}

// One line for any request that asks for markdown or comes from Browser
// Rendering, so the scanner's probe can be seen in Workers Logs. It records
// request shape only: no IP, user agent, cookie, referrer, or query value.
export function logProbe(request: Request, url: URL, response: Response, deps: Deps): void {
  const accept = request.headers.get("Accept") ?? "";
  const brapi = request.headers.has("cf-brapi-devtools");
  if (!accept.toLowerCase().includes("markdown") && !brapi) return;
  const entry = {
    event: "probe",
    method: request.method,
    path: url.pathname.slice(0, 120),
    queryKeys: [...url.searchParams.keys()].slice(0, 5).map((key) => key.slice(0, 32)),
    accept: accept.slice(0, 120),
    brapi,
    cfWorker: (request.headers.get("cf-worker") ?? "").slice(0, 64),
    fetchMode: (request.headers.get("Sec-Fetch-Mode") ?? "").slice(0, 16),
    fetchDest: (request.headers.get("Sec-Fetch-Dest") ?? "").slice(0, 16),
    served: served(response),
    status: response.status,
  };
  deps.log(JSON.stringify(entry));
}

async function owned(request: Request, env: Env, deps: Deps, url: URL): Promise<Response> {
  const handler = ROUTES[url.pathname] ?? notFound;
  try {
    return await handler(request, env, deps, url);
  } catch (error) {
    console.error("agent-readiness owned path failed:", String(error));
    return json(500, { error: "internal_error" });
  }
}

export async function route(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname === SITE_HOST && isOwned(url.pathname)) return owned(request, env, deps, url);

  // Last line of defense for pages the Worker only decorates or passes through.
  deps.passThrough();
  let response: Response;
  try {
    response = await handle(request, deps.originFetch);
  } catch (error) {
    // Fail open: serve whatever GitHub Pages serves, undecorated.
    console.error("agent-readiness failed open:", String(error));
    response = await deps.originFetch(request);
  }
  try {
    logProbe(request, url, response, deps);
  } catch (error) {
    console.error("agent-readiness probe log failed:", String(error));
  }
  return response;
}
