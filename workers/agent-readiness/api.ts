// The public, read-only JSON API under /api/v1.

import { COMPANY, SERVICES, contactOptions } from "./facts.ts";
import { allow, clientIp, json, staticDoc, tooMany } from "./http.ts";
import type { Deps, Env } from "./http.ts";

export const API_VERSION = "1.0.0";
export const OPENAPI_TYPE = "application/vnd.oai.openapi+json";
export const CATALOG_TYPE = "application/linkset+json";
const BASE = "https://burrowsapps.com/api/v1";
const JSON_TYPE = "application/json";
const DOCS = "https://burrowsapps.com/developers.md";

const INDEX = {
  name: "Burrows Applications public API",
  version: API_VERSION,
  documentation: DOCS,
  endpoints: {
    company: `${BASE}/company`,
    services: `${BASE}/services`,
    status: `${BASE}/status`,
    openapi: `${BASE}/openapi.json`,
  },
} as const;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonContent = (name: string) => ({ "application/json": { schema: ref(name) } });
const response = (description: string, schema: string) => ({ description, content: jsonContent(schema) });
const RATE_LIMITED = response("Too many requests. Wait the number of seconds in Retry-After.", "Error");

const getOperation = (operationId: string, summary: string, schema: string) => ({
  get: {
    operationId,
    summary,
    responses: { "200": response(summary, schema), "429": RATE_LIMITED },
  },
});

const STRING = { type: "string" } as const;

// The OpenAPI 3.1 description of this API. Every operation is a read-only GET
// that needs no credential.
export function openapi(): Record<string, unknown> {
  const paths: Record<string, unknown> = {
    "/company": getOperation("getCompany", "Company profile, services, and contact options", "Company"),
    "/services": getOperation("listServices", "The services Burrows Applications offers", "ServiceList"),
    "/status": getOperation("getStatus", "Health check with the API version and the time", "Status"),
  };
  const schemas: Record<string, unknown> = {
    Company: {
      type: "object",
      required: ["name", "tagline", "description", "founder", "website", "privacyPolicy", "services", "contact"],
      properties: {
        name: STRING,
        tagline: STRING,
        description: STRING,
        founder: STRING,
        website: { type: "string", format: "uri" },
        privacyPolicy: { type: "string", format: "uri" },
        services: { type: "array", items: ref("Service") },
        contact: { type: "object", description: "Ways to get in touch, including the contact form's field limits." },
      },
    },
    Service: {
      type: "object",
      required: ["id", "name", "description"],
      properties: { id: STRING, name: STRING, description: STRING },
    },
    ServiceList: {
      type: "object",
      required: ["services"],
      properties: { services: { type: "array", items: ref("Service") } },
    },
    Status: {
      type: "object",
      required: ["status", "version", "time"],
      properties: { status: STRING, version: STRING, time: { type: "string", format: "date-time" } },
    },
    Error: {
      type: "object",
      required: ["error"],
      properties: { error: STRING, error_description: STRING, fields: { type: "array", items: STRING } },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Burrows Applications public API",
      version: API_VERSION,
      description: "Read-only facts about Burrows Applications: the company profile, its services, and a status endpoint.",
      contact: { email: "contact@burrowsapps.com", url: "https://burrowsapps.com/" },
    },
    servers: [{ url: BASE }],
    externalDocs: { url: DOCS },
    paths,
    components: { schemas },
  };
}

// RFC 9727 API catalog in the RFC 9264 linkset format.
// The first entry is the catalog itself, listing each API as an item.
export const CATALOG: Record<string, unknown> = {
  linkset: [
    {
      anchor: "https://burrowsapps.com/.well-known/api-catalog",
      item: [
        { href: BASE, title: "Burrows Applications public API" },
        { href: "https://burrowsapps.com/mcp", title: "Burrows Applications MCP server" },
      ],
    },
    {
      anchor: BASE,
      "service-desc": [{ href: `${BASE}/openapi.json`, type: OPENAPI_TYPE }],
      "service-doc": [{ href: DOCS, type: "text/markdown" }],
      status: [{ href: `${BASE}/status`, type: JSON_TYPE }],
    },
    {
      anchor: "https://burrowsapps.com/mcp",
      "service-desc": [{ href: "https://burrowsapps.com/mcp/server-card", type: "application/mcp-server-card+json" }],
      "service-doc": [{ href: DOCS, type: "text/markdown" }],
    },
  ],
};

export function catalog(request: Request): Response {
  return staticDoc(request, JSON.stringify(CATALOG), CATALOG_TYPE, { Link: '</.well-known/api-catalog>; rel="api-catalog"' });
}

type Body = { body: unknown; contentType?: string; headers?: Record<string, string> };

function bodyFor(pathname: string, deps: Deps): Body | null {
  switch (pathname) {
    case "/api/v1":
    case "/api/v1/":
      return { body: INDEX };
    case "/api/v1/company":
      return { body: { ...COMPANY, services: SERVICES, contact: contactOptions() } };
    case "/api/v1/services":
      return { body: { services: SERVICES } };
    case "/api/v1/status":
      return {
        body: { status: "ok", version: API_VERSION, time: new Date(deps.now()).toISOString() },
        headers: { "Cache-Control": "no-store" },
      };
    case "/api/v1/openapi.json":
      return { body: openapi(), contentType: OPENAPI_TYPE };
    default:
      return null;
  }
}

export async function handle(request: Request, env: Env, deps: Deps, url: URL): Promise<Response> {
  if (!(await allow(env.PUBLIC_LIMITER, clientIp(request), "open"))) return tooMany();
  const doc = bodyFor(url.pathname, deps);
  if (!doc) return json(404, { error: "not_found" });
  return staticDoc(request, JSON.stringify(doc.body), doc.contentType ?? JSON_TYPE, doc.headers);
}
