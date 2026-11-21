import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNED_EXACT, route } from "./router.ts";
import { BROWSER_ACCEPT, makeBaseEnv, makeDeps } from "./testing.ts";

const SITE = "https://burrowsapps.com";

const get = (path: string, headers: Record<string, string> = {}, host = SITE): Request =>
  new Request(`${host}${path}`, { headers: { Accept: BROWSER_ACCEPT, ...headers } });

test("1. GET / from a browser is passed through once and decorated", async () => {
  const deps = makeDeps();
  const response = await route(get("/"), makeBaseEnv(), deps);
  assert.equal(deps.passThroughCalls, 1);
  assert.match(response.headers.get("Link") ?? "", /rel="describedby"/);
  assert.equal(deps.originCalls.length, 1);
});

test("2. an origin failure fails open with the same Request, undecorated", async (t) => {
  t.mock.method(console, "error", () => {});
  const deps = makeDeps();
  const fallback = new Response("<!DOCTYPE html>", { status: 200, headers: { "Content-Type": "text/html" } });
  let calls = 0;
  deps.setOrigin(() => {
    calls += 1;
    if (calls === 1) throw new Error("origin down");
    return fallback;
  });
  const request = get("/");
  const response = await route(request, makeBaseEnv(), deps);
  assert.equal(deps.originCalls.length, 2);
  assert.equal(deps.originCalls[1], request);
  assert.equal(response, fallback);
  assert.equal(response.headers.get("Link"), null);
});

for (const path of ["/api/v1/nope", "/mcp/nope"]) {
  test(`5. ${path} is a JSON 404 from the Worker`, async () => {
    const deps = makeDeps();
    const response = await route(get(path), makeBaseEnv(), deps);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
    assert.equal(deps.originCalls.length, 0);
    assert.equal(deps.passThroughCalls, 0);
  });
}

test("6. POST /api/contact is passed to the origin as the same Request", async () => {
  const deps = makeDeps();
  const origin = new Response(null, { status: 204 });
  deps.setOrigin(() => origin);
  const request = new Request(`${SITE}/api/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SITE },
    body: "{}",
  });
  const response = await route(request, makeBaseEnv(), deps);
  assert.equal(deps.originCalls.length, 1);
  assert.equal(deps.originCalls[0], request);
  assert.equal(response, origin);
  assert.equal(response.headers.get("Link"), null);
});

test("6. a stylesheet is passed to the origin as the same Request", async () => {
  const deps = makeDeps();
  const origin = new Response("body{}", { status: 200, headers: { "Content-Type": "text/css" } });
  deps.setOrigin(() => origin);
  const request = get("/static/css/home.css");
  const response = await route(request, makeBaseEnv(), deps);
  assert.equal(deps.originCalls[0], request);
  assert.equal(response, origin);
  assert.equal(response.headers.get("Link"), null);
});

for (const path of ["/?utm_source=x", "/?sent=1"]) {
  test(`7. ${path} is decorated as /`, async () => {
    const deps = makeDeps();
    const response = await route(get(path), makeBaseEnv(), deps);
    assert.match(response.headers.get("Link") ?? "", /<\/index\.md>; rel="alternate"/);
    const markdown = await route(get(path, { Accept: "text/markdown" }), makeBaseEnv(), deps);
    assert.match(markdown.headers.get("Content-Type") ?? "", /^text\/markdown/);
  });
}

test("8. an owned path on www is passed through, not owned", async () => {
  const deps = makeDeps();
  const origin = new Response("not found", { status: 404, headers: { "Content-Type": "text/html" } });
  deps.setOrigin(() => origin);
  const request = get("/api/v1/company", {}, "https://www.burrowsapps.com");
  const response = await route(request, makeBaseEnv(), deps);
  assert.equal(deps.passThroughCalls, 1);
  assert.equal(deps.originCalls[0], request);
  assert.equal(response, origin);
});

test("10. a markdown request writes one probe line", async () => {
  const deps = makeDeps();
  await route(get("/", { Accept: "text/markdown" }), makeBaseEnv(), deps);
  assert.equal(deps.logs.length, 1);
  const entry = JSON.parse(deps.logs[0]);
  assert.equal(entry.event, "probe");
  assert.equal(entry.served, "markdown");
  assert.equal(entry.path, "/");
  assert.equal(entry.status, 200);
});

test("10. a Browser Rendering request writes a probe line with brapi true", async () => {
  const deps = makeDeps();
  await route(get("/", { "cf-brapi-devtools": "1" }), makeBaseEnv(), deps);
  assert.equal(deps.logs.length, 1);
  const entry = JSON.parse(deps.logs[0]);
  assert.equal(entry.brapi, true);
  assert.equal(entry.served, "html");
});

test("10. a plain browser request writes no probe line", async () => {
  const deps = makeDeps();
  await route(get("/"), makeBaseEnv(), deps);
  assert.deepEqual(deps.logs, []);
});

test("10. the probe line holds no identifying header or query value", async () => {
  const deps = makeDeps();
  const markers = {
    "CF-Connecting-IP": "marker-ip-198.51.100.7",
    "User-Agent": "marker-user-agent",
    Cookie: "session=marker-cookie",
    Referer: "https://marker-referrer.example/",
  };
  await route(get("/?token=marker-query-secret", { Accept: "text/markdown", ...markers }), makeBaseEnv(), deps);
  assert.equal(deps.logs.length, 1);
  const line = deps.logs[0];
  for (const marker of ["marker-ip", "marker-user-agent", "marker-cookie", "marker-referrer", "marker-query-secret"]) {
    assert.ok(!line.includes(marker), `probe line leaks ${marker}`);
  }
  assert.deepEqual(JSON.parse(line).queryKeys, ["token"]);
  assert.deepEqual(Object.keys(JSON.parse(line)), [
    "event", "method", "path", "queryKeys", "accept", "brapi", "cfWorker", "fetchMode", "fetchDest", "served", "status",
  ]);
});

test("11. a throwing log does not change the response", async (t) => {
  t.mock.method(console, "error", () => {});
  const deps = makeDeps({ log: () => { throw new Error("log down"); } });
  const response = await route(get("/", { Accept: "text/markdown" }), makeBaseEnv(), deps);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") ?? "", /^text\/markdown/);
});

const OWNED_GETS = ["/api/v1/company"];

for (const path of OWNED_GETS) {
  test(`3. ${path} is answered without the origin and without passThrough`, async () => {
    const deps = makeDeps();
    const response = await route(get(path), makeBaseEnv(), deps);
    assert.equal(response.status, 200);
    assert.equal(deps.passThroughCalls, 0);
    assert.equal(deps.originCalls.length, 0);
  });
}

test("4. a throwing handler is a 500 from the Worker, never the origin", async (t) => {
  t.mock.method(console, "error", () => {});
  const deps = makeDeps({ now: () => { throw new Error("clock down"); } });
  const response = await route(get("/api/v1/status"), makeBaseEnv(), deps);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "internal_error" });
  assert.equal(deps.originCalls.length, 0);
  assert.equal(deps.passThroughCalls, 0);
});

test("12. the owned exact paths are exactly the documented ones", async () => {
  assert.deepEqual([...OWNED_EXACT].sort(), [
    "/.well-known/api-catalog",
    "/.well-known/mcp/server-card.json",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/api/v1",
    "/api/v1/",
    "/api/v1/company",
    "/api/v1/openapi.json",
    "/api/v1/services",
    "/api/v1/status",
    "/mcp",
    "/mcp/server-card",
  ]);
});

test("3. the catalog, the MCP endpoint, and the OAuth documents never reach the origin", async () => {
  for (const [path, init] of [
    ["/.well-known/api-catalog", {}],
    ["/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }],
    ["/.well-known/oauth-protected-resource", {}],
  ] as const) {
    const deps = makeDeps();
    await route(new Request(`${SITE}${path}`, init), makeBaseEnv(), deps);
    assert.equal(deps.passThroughCalls, 0, path);
    assert.equal(deps.originCalls.length, 0, path);
  }
});

test("auth.md and openid-configuration are left to the origin", async () => {
  for (const path of ["/auth.md", "/.well-known/openid-configuration"]) {
    const deps = makeDeps();
    await route(get(path), makeBaseEnv(), deps);
    assert.equal(deps.passThroughCalls, 1, path);
    assert.equal(deps.originCalls.length, 1, path);
  }
});
