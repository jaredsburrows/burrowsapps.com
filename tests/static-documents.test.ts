import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CATALOG_TYPE } from "../workers/agent-readiness/api.ts";
import { DOCUMENTS } from "../workers/agent-readiness/documents.ts";
import { CARD_PATH, CARD_WELL_KNOWN_PATH } from "../workers/agent-readiness/mcp.ts";
import { OWNED_EXACT, isOwned } from "../workers/agent-readiness/router.ts";
import { runsWorkerFirst, site } from "./support/static-site.ts";

const REPO = new URL("../", import.meta.url);
const SITE = "https://burrowsapps.com";
const committed = (path: string): Promise<string> => readFile(new URL(`.${path}`, REPO), "utf8");

test("there are five generated documents", async () => {
  assert.deepEqual(Object.keys(DOCUMENTS).sort(), [
    "/.well-known/api-catalog",
    "/.well-known/mcp/server-card.json",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/mcp/server-card",
  ]);
});

for (const [path, content] of Object.entries(DOCUMENTS)) {
  test(`${path} is committed exactly as generated (run workers/agent-readiness/tools/write-documents.ts)`, async () => {
    assert.equal(await committed(path), content);
  });
}

test("no generated document is owned by the Worker or runs it first", async () => {
  for (const path of Object.keys(DOCUMENTS)) {
    assert.ok(!isOwned(path) && !OWNED_EXACT.includes(path), `${path} is owned by the Worker`);
    assert.ok(!runsWorkerFirst(path), `${path} matches run_worker_first`);
  }
});

test("the two server card paths have identical bytes", async () => {
  assert.equal(await committed(CARD_PATH), await committed(CARD_WELL_KNOWN_PATH));
});

// The type and cache lifetime each document had when the Worker built it.
const SERVED: Readonly<Record<string, { type: string; maxAge: number }>> = {
  "/.well-known/api-catalog": { type: CATALOG_TYPE, maxAge: 300 },
  "/.well-known/oauth-authorization-server": { type: "application/json", maxAge: 3600 },
  "/.well-known/oauth-protected-resource": { type: "application/json", maxAge: 3600 },
  [CARD_WELL_KNOWN_PATH]: { type: "application/json", maxAge: 3600 },
  [CARD_PATH]: { type: "application/mcp-server-card+json", maxAge: 3600 },
};

test("every generated document has an expected type and cache lifetime", async () => {
  assert.deepEqual(Object.keys(SERVED).sort(), Object.keys(DOCUMENTS).sort());
});

for (const [path, { type, maxAge }] of Object.entries(SERVED)) {
  test(`${path} is served as ${type} with CORS, nosniff, and max-age=${maxAge}`, async () => {
    const response = await site(new Request(`${SITE}${path}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), type);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Cache-Control"), `public, max-age=${maxAge}`);
    assert.equal(await response.text(), DOCUMENTS[path]);
    const head = await site(new Request(`${SITE}${path}`, { method: "HEAD" }));
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("Content-Type"), type);
    assert.equal(await head.text(), "");
  });
}

test("the generated documents answer other methods with the asset router's 405", async () => {
  for (const path of Object.keys(DOCUMENTS)) {
    for (const method of ["POST", "OPTIONS"]) {
      const response = await site(new Request(`${SITE}${path}`, { method }));
      assert.equal(response.status, 405, `${method} ${path}`);
      assert.equal(await response.text(), "", `${method} ${path}`);
    }
  }
});

test("the catalog carries its own api-catalog Link header", async () => {
  const response = await site(new Request(`${SITE}/.well-known/api-catalog`));
  assert.equal(response.headers.get("Link"), '</.well-known/api-catalog>; rel="api-catalog"');
});
