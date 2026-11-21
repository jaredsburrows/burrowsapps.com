import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSiteUrl } from "../../tests/support/site-map.ts";
import { API_VERSION, CATALOG, openapi } from "./api.ts";
import { COMPANY, SERVICES, contactOptions } from "./facts.ts";
import { isOwned, route } from "./router.ts";
import { makeBaseEnv, makeDeps, T0 } from "./testing.ts";
import type { TestEnv } from "./testing.ts";

const SITE = "https://burrowsapps.com";

const call = async (path: string, init: RequestInit = {}, env: TestEnv = makeBaseEnv()) => {
  const deps = makeDeps();
  const response = await route(new Request(`${SITE}${path}`, init), env, deps);
  return { response, deps };
};

const ENDPOINTS: Record<string, string[]> = {
  "/api/v1": ["documentation", "endpoints", "name", "version"],
  "/api/v1/": ["documentation", "endpoints", "name", "version"],
  "/api/v1/company": ["contact", "description", "founder", "name", "privacyPolicy", "services", "tagline", "website"],
  "/api/v1/services": ["services"],
  "/api/v1/status": ["status", "time", "version"],
};

for (const [path, keys] of Object.entries(ENDPOINTS)) {
  test(`1. GET ${path} is 200 JSON with CORS and its documented keys`, async () => {
    const { response, deps } = await call(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/json");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.deepEqual(Object.keys(await response.json()).sort(), keys);
    assert.equal(deps.originCalls.length, 0);
  });

  test(`1. HEAD ${path} has no body and POST is 405`, async () => {
    const head = (await call(path, { method: "HEAD" })).response;
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const post = (await call(path, { method: "POST", body: "{}" })).response;
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("Allow"), "GET, HEAD, OPTIONS");
  });
}

test("1. the index lists absolute endpoint URLs", async () => {
  const body = await (await call("/api/v1")).response.json();
  assert.equal(body.version, API_VERSION);
  assert.deepEqual(body.endpoints, {
    company: `${SITE}/api/v1/company`,
    services: `${SITE}/api/v1/services`,
    status: `${SITE}/api/v1/status`,
    openapi: `${SITE}/api/v1/openapi.json`,
  });
});

test("1. company and services carry the facts", async () => {
  const company = await (await call("/api/v1/company")).response.json();
  assert.equal(company.name, COMPANY.name);
  assert.equal(company.tagline, COMPANY.tagline);
  assert.deepEqual(company.services, SERVICES);
  assert.deepEqual((await (await call("/api/v1/services")).response.json()).services, SERVICES);
});

test("2. status uses the clock and is not cached", async () => {
  const { response } = await call("/api/v1/status");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ok", version: API_VERSION, time: new Date(T0).toISOString() });
});

test("3. a refusing limiter gives 429 with Retry-After", async () => {
  const env = makeBaseEnv();
  for (let i = 0; i < 60; i += 1) await env.PUBLIC_LIMITER.limit({ key: "unknown" });
  const { response } = await call("/api/v1/company", {}, env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
});

test("3. the public limiter is keyed by client IP", async () => {
  const env = makeBaseEnv();
  await call("/api/v1/services", { headers: { "CF-Connecting-IP": "203.0.113.5" } }, env);
  assert.deepEqual(env.PUBLIC_LIMITER.keys, ["203.0.113.5"]);
});

test("6. company contact options are the contact facts", async () => {
  const company = await (await call("/api/v1/company")).response.json();
  assert.deepEqual(company.contact, contactOptions());
});

type LinkTarget = { href: string; type?: string; title?: string };
type CatalogEntry = { anchor: string } & Record<string, LinkTarget[] | string>;
const entries = (CATALOG.linkset as CatalogEntry[]);
const targets = (entry: CatalogEntry): string[] => [
  entry.anchor,
  ...Object.entries(entry).flatMap(([key, value]) => (key === "anchor" ? [] : (value as LinkTarget[]).map((link) => link.href))),
];

test("4. the catalog is a linkset served as plain application/linkset+json", async () => {
  const { response, deps } = await call("/.well-known/api-catalog", { headers: { Accept: "application/linkset+json, application/json" } });
  assert.equal(response.status, 200);
  const type = response.headers.get("Content-Type") ?? "";
  assert.equal(type, "application/linkset+json");
  assert.equal(response.headers.get("Link"), '</.well-known/api-catalog>; rel="api-catalog"');
  const body = await response.json();
  assert.ok(Array.isArray(body.linkset) && body.linkset.length === 3);
  for (const entry of body.linkset.slice(1)) {
    for (const key of ["anchor", "service-desc", "service-doc"]) assert.ok(key in entry, `entry lacks ${key}`);
  }
  assert.equal(deps.originCalls.length, 0);
  const head = (await call("/.well-known/api-catalog", { method: "HEAD" })).response;
  assert.equal(head.headers.get("Link"), '</.well-known/api-catalog>; rel="api-catalog"');
});

test("4. the catalog's own entry lists every API anchor as an item with a title", async () => {
  const [self, ...apis] = entries;
  assert.equal(self.anchor, "https://burrowsapps.com/.well-known/api-catalog");
  const items = self.item as unknown as LinkTarget[];
  assert.deepEqual(items.map((item) => item.href), apis.map((api) => api.anchor));
  for (const item of items) assert.ok(typeof item.title === "string" && item.title.length > 0);
  for (const href of targets(self)) assert.notEqual(resolveSiteUrl(href), null, `${href} does not resolve`);
});

// Pages serves .md files as text/markdown; everything else typed here is the Worker's.
const servedType = async (href: string): Promise<string> => {
  if (resolveSiteUrl(href) === "file") return href.endsWith(".md") ? "text/markdown" : "unknown";
  const { response } = await call(new URL(href).pathname);
  assert.equal(response.status, 200, href);
  return (response.headers.get("Content-Type") ?? "").split(";")[0].trim();
};

test("4. every typed link in the catalog names the content type its target is served with", async () => {
  for (const entry of entries.slice(1)) {
    for (const [rel, value] of Object.entries(entry)) {
      if (rel === "anchor") continue;
      for (const link of value as LinkTarget[]) {
        assert.ok(link.type, `${rel} ${link.href} has no type`);
        assert.equal(await servedType(link.href), link.type, `${rel} ${link.href}`);
      }
    }
  }
});

test("4. every link in the API entry of the catalog resolves on the site", async () => {
  for (const href of targets(entries[1])) assert.notEqual(resolveSiteUrl(href), null, `${href} does not resolve`);
});

test("4. every link in the MCP entry of the catalog resolves on the site", async () => {
  for (const href of targets(entries[2])) assert.notEqual(resolveSiteUrl(href), null, `${href} does not resolve`);
});

type OpenApi = {
  openapi: string;
  servers: { url: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
};

const refsIn = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) => (key === "$ref" && typeof inner === "string" ? [inner] : refsIn(inner)));
  }
  return [];
};

const resolvePointer = (document: unknown, pointer: string): unknown => {
  assert.ok(pointer.startsWith("#/"), pointer);
  return pointer.slice(2).split("/").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], document);
};

test("5. the OpenAPI document is consistent and read-only", async () => {
  const document = openapi() as OpenApi;
  assert.ok(document.openapi.startsWith("3.1"));
  for (const pointer of refsIn(document)) assert.ok(resolvePointer(document, pointer) !== undefined, `${pointer} does not resolve`);
  for (const [path, operations] of Object.entries(document.paths)) {
    const url = new URL(`${document.servers[0].url}${path}`);
    assert.ok(isOwned(url.pathname), `${url.pathname} is not owned by the router`);
    assert.deepEqual(Object.keys(operations), ["get"], `${path} has an operation other than GET`);
  }
  assert.equal(document.components.securitySchemes, undefined);
  assert.equal("security" in document, false);
});

test("5. every GET path in the OpenAPI document answers 200 through route()", async () => {
  const document = openapi() as OpenApi;
  for (const [path, operations] of Object.entries(document.paths)) {
    if (!("get" in operations)) continue;
    const { response } = await call(new URL(`${document.servers[0].url}${path}`).pathname);
    assert.equal(response.status, 200, path);
  }
});

test("5. the OpenAPI document is served with its media type", async () => {
  const { response } = await call("/api/v1/openapi.json");
  assert.equal(response.headers.get("Content-Type"), "application/vnd.oai.openapi+json");
  assert.deepEqual(await response.json(), openapi());
});
