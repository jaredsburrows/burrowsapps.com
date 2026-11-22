// Replays the pass criteria that the isitagentready.com scanner documents for
// each agent-readiness check, with the request shapes the scanner's own scans
// recorded, against the emulated deployed site: the committed files with
// .assetsignore, _headers, and run_worker_first applied, and the Worker
// behind them (tests/support/static-site.ts).
// It catches format mistakes against the documented criteria only; how
// strictly the live scanner checks beyond them is not known.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveSiteUrl } from "../../tests/support/site-map.ts";
import { site } from "../../tests/support/static-site.ts";

const SITE = "https://burrowsapps.com";
const REPO = new URL("../../", import.meta.url);

const scan = (url: string, headers: Record<string, string> = {}): Promise<Response> => site(new Request(url, { headers }));

const jsonOf = async (response: Response): Promise<Record<string, any>> => {
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") ?? "", /^application\/(?:[\w.+-]+\+)?json/);
  return response.json();
};

const nonEmptyArray = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

test("markdownNegotiation: the homepage answers text/markdown, with and without a query string", async () => {
  for (const url of [SITE, `${SITE}/?cb=1`]) {
    const response = await scan(url, { accept: "text/markdown", "cache-control": "no-cache" });
    assert.equal(response.status, 200, url);
    assert.ok((response.headers.get("Content-Type") ?? "").startsWith("text/markdown"), url);
    assert.ok(response.headers.has("x-markdown-tokens"), url);
  }
  const html = await scan(SITE);
  assert.ok((html.headers.get("Content-Type") ?? "").startsWith("text/html"));
});

test("linkHeaders: the homepage Link header has api-catalog, and its target answers", async () => {
  const link = (await scan(SITE)).headers.get("Link") ?? "";
  assert.match(link, /rel="api-catalog"/);
  assert.match(link, /rel="alternate"/);
  const target = link.match(/<([^>]+)>; rel="api-catalog"/)?.[1];
  assert.ok(target);
  assert.equal((await scan(new URL(target, SITE).href)).status, 200);
});

test("apiCatalog: a linkset whose entries have anchor, service-desc, and service-doc", async () => {
  const response = await scan(`${SITE}/.well-known/api-catalog`, { Accept: "application/linkset+json, application/json" });
  assert.equal(response.headers.get("Content-Type"), "application/linkset+json");
  const body = await jsonOf(response);
  assert.ok(nonEmptyArray(body.linkset));
  const apis = body.linkset.filter((entry: Record<string, unknown>) => !("item" in entry));
  assert.ok(apis.length >= 1);
  for (const entry of body.linkset) assert.ok("anchor" in entry);
  for (const entry of apis) {
    for (const key of ["anchor", "service-desc", "service-doc"]) assert.ok(key in entry, key);
  }
});

test("oauthDiscovery: openid-configuration is not owned, and RFC 8414 metadata has the read fields", async () => {
  assert.equal((await scan(`${SITE}/.well-known/openid-configuration`)).status, 404, "openid-configuration must not exist");
  assert.equal(resolveSiteUrl(`${SITE}/.well-known/openid-configuration`), null);
  const metadata = await jsonOf(await scan(`${SITE}/.well-known/oauth-authorization-server`));
  for (const field of ["issuer", "authorization_endpoint", "token_endpoint", "grant_types_supported", "response_types_supported"]) {
    assert.ok(field in metadata, field);
  }
  assert.equal(metadata.issuer, SITE);
});

test("oauthProtectedResource: the homepage sends no challenge and the metadata has the read fields", async () => {
  assert.equal((await scan(SITE)).headers.get("WWW-Authenticate"), null);
  const metadata = await jsonOf(await scan(`${SITE}/.well-known/oauth-protected-resource`));
  assert.equal(metadata.resource, SITE);
  assert.ok(nonEmptyArray(metadata.authorization_servers));
  assert.ok(nonEmptyArray(metadata.scopes_supported));
});

test("authMd: auth.md, the PRM, and the AS metadata agree on the anonymous method", async () => {
  const text = await readFile(new URL("auth.md", REPO), "utf8");
  assert.match(text.split("\n")[0], /^# .*auth\.md/);
  const served = await scan(`${SITE}/auth.md`, { Accept: "text/markdown, text/plain, */*" });
  assert.equal(served.status, 200, "auth.md is a published file");
  assert.equal(served.headers.get("Content-Type"), "text/markdown; charset=utf-8");

  const prm = await jsonOf(await scan(`${SITE}/.well-known/oauth-protected-resource`, { Accept: "application/json" }));
  for (const field of ["resource", "authorization_servers", "scopes_supported", "bearer_methods_supported"]) assert.ok(field in prm, field);
  assert.ok(prm.bearer_methods_supported.includes("header"));

  const as = await jsonOf(await scan(`${SITE}/.well-known/oauth-authorization-server`, { Accept: "application/json" }));
  assert.ok(prm.authorization_servers.includes(as.issuer));
  const agentAuth = as.agent_auth;
  for (const field of ["skill", "register_uri", "claim_uri"]) assert.equal(typeof agentAuth[field], "string", field);
  assert.ok(agentAuth.identity_types_supported.includes("anonymous"));
  assert.ok(nonEmptyArray(agentAuth.anonymous.credential_types_supported));
  assert.equal(new URL(agentAuth.skill).pathname, "/auth.md");
  assert.equal(resolveSiteUrl(agentAuth.skill), "file");
});

test("mcpServerCard: the well-known card has serverInfo, a transport endpoint, and capabilities", async () => {
  const card = await jsonOf(await scan(`${SITE}/.well-known/mcp/server-card.json`));
  assert.equal(typeof card.serverInfo.name, "string");
  assert.equal(typeof card.serverInfo.version, "string");
  assert.equal(typeof card.transport.endpoint, "string");
  assert.equal(typeof card.capabilities, "object");
  assert.equal(resolveSiteUrl(card.transport.endpoint), "worker");
});
