import { test } from "node:test";
import assert from "node:assert/strict";
import { API_VERSION } from "./api.ts";
import { COMPANY, SERVICES } from "./facts.ts";
import { route } from "./router.ts";
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

test("6. company contact options have no inquiryApi while the authorization server is off", async () => {
  const company = await (await call("/api/v1/company")).response.json();
  assert.equal("inquiryApi" in company.contact, false);
});
