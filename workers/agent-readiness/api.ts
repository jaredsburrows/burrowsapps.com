// The public, read-only JSON API under /api/v1.

import { COMPANY, SERVICES, contactOptions } from "./facts.ts";
import { allow, clientIp, json, staticDoc, tooMany } from "./http.ts";
import type { Deps, Env } from "./http.ts";

export const API_VERSION = "1.0.0";
const BASE = "https://burrowsapps.com/api/v1";
const JSON_TYPE = "application/json";

const INDEX = {
  name: "Burrows Applications public API",
  version: API_VERSION,
  documentation: "https://burrowsapps.com/developers.md",
  endpoints: {
    company: `${BASE}/company`,
    services: `${BASE}/services`,
    status: `${BASE}/status`,
    openapi: `${BASE}/openapi.json`,
  },
} as const;

type Body = { body: unknown; contentType?: string; headers?: Record<string, string> };

function bodyFor(pathname: string, deps: Deps, authOn: boolean): Body | null {
  switch (pathname) {
    case "/api/v1":
    case "/api/v1/":
      return { body: INDEX };
    case "/api/v1/company":
      return { body: { ...COMPANY, services: SERVICES, contact: contactOptions(authOn) } };
    case "/api/v1/services":
      return { body: { services: SERVICES } };
    case "/api/v1/status":
      return {
        body: { status: "ok", version: API_VERSION, time: new Date(deps.now()).toISOString() },
        headers: { "Cache-Control": "no-store" },
      };
    default:
      return null;
  }
}

export async function handle(request: Request, env: Env, deps: Deps, url: URL, authOn: boolean): Promise<Response> {
  if (!(await allow(env.PUBLIC_LIMITER, clientIp(request), "open"))) return tooMany();
  const doc = bodyFor(url.pathname, deps, authOn);
  if (!doc) return json(404, { error: "not_found" });
  return staticDoc(request, JSON.stringify(doc.body), doc.contentType ?? JSON_TYPE, doc.headers);
}
