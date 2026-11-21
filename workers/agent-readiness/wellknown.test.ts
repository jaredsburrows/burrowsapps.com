import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolveSiteUrl } from "../../tests/support/site-map.ts";
import { route } from "./router.ts";
import { makeBaseEnv, makeDeps } from "./testing.ts";
import { AUTHORIZATION_SERVER, OAUTH_PATHS, PROTECTED_RESOURCE } from "./wellknown.ts";

const SITE = "https://burrowsapps.com";
const REPO = new URL("../../", import.meta.url);

type Labeled = { status?: unknown; available?: unknown; message?: unknown };
const AS = AUTHORIZATION_SERVER as Labeled & Record<string, any>;
const PR = PROTECTED_RESOURCE as Labeled & Record<string, any>;

const isNonEmptyArray = (value: unknown): value is unknown[] => Array.isArray(value) && value.length > 0;

const strings = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
};

const fetchDoc = (path: string, init: RequestInit = {}) => {
  const deps = makeDeps();
  return route(new Request(`${SITE}${path}`, init), makeBaseEnv(), deps).then((response) => ({ response, deps }));
};

test("both documents say, at every level, that nothing here is offered", async () => {
  const levels: [string, Labeled | undefined][] = [
    ["oauth-authorization-server", AS],
    ["oauth-authorization-server agent_auth", AS.agent_auth],
    ["oauth-authorization-server agent_auth.anonymous", AS.agent_auth?.anonymous],
    ["oauth-protected-resource", PR],
  ];
  for (const [where, part] of levels) {
    assert.equal(part?.available, false, where);
    assert.equal(part?.status, "not_offered", where);
    assert.equal(typeof part?.message, "string", where);
  }
});

test("both documents open their message with the no-login claim auth.md makes", async () => {
  for (const doc of [AS, PR]) assert.ok(String(doc.message).startsWith("Burrows Applications has no login."));
});

test("nothing in them implies a login is on the way", async () => {
  const text = JSON.stringify([AS, PR]);
  for (const phrase of [/coming soon/i, /\bplanned\b/i, /under[ _-]construction/i]) assert.ok(!phrase.test(text), String(phrase));
});

test("the authorization-server metadata has the fields the oauthDiscovery check reads", async () => {
  assert.equal(AS.issuer, SITE);
  for (const field of ["authorization_endpoint", "token_endpoint"]) {
    assert.equal(typeof AS[field], "string", field);
    assert.equal(new URL(AS[field]).origin, SITE, field);
  }
  assert.ok(isNonEmptyArray(AS.grant_types_supported));
  assert.ok(isNonEmptyArray(AS.response_types_supported));
  assert.ok(!Object.hasOwn(AS, "jwks_uri"), "there are no keys, so there is no jwks_uri");
});

test("the protected-resource metadata has the fields the oauthProtectedResource check reads", async () => {
  assert.equal(PR.resource, SITE);
  assert.deepEqual(PR.authorization_servers, [AS.issuer]);
  assert.ok(Array.isArray(PR.bearer_methods_supported) && PR.bearer_methods_supported.includes("header"));
  assert.ok(isNonEmptyArray(PR.scopes_supported));
});

test("agent_auth has what the authMd metadata path reads", async () => {
  const agentAuth = AS.agent_auth;
  assert.ok(agentAuth);
  for (const field of ["skill", "register_uri", "claim_uri"]) assert.equal(typeof agentAuth[field], "string", field);
  assert.equal(agentAuth.skill, `${SITE}/auth.md`);
  assert.ok(agentAuth.identity_types_supported.includes("anonymous"));
  assert.ok(isNonEmptyArray(agentAuth.anonymous?.credential_types_supported));
});

test("there is no A2A agent here, so no a2a field is published", async () => {
  for (const doc of [AS, PR]) for (const key of Object.keys(doc)) assert.ok(!key.startsWith("a2a"), key);
});

test("every on-site URL in either document resolves, and none carries a fragment", async () => {
  for (const [name, doc] of [["oauth-authorization-server", AS], ["oauth-protected-resource", PR]] as const) {
    const onSite = strings(doc).filter((value) => value.startsWith(`${SITE}/`) || value === SITE);
    assert.ok(onSite.length >= 5, `only ${onSite.length} on-site URLs in ${name}`);
    for (const value of onSite) {
      assert.ok(!value.includes("#"), `${name} names ${value}, which carries a fragment`);
      assert.notEqual(resolveSiteUrl(value), null, `${name} names ${value}, which does not resolve`);
    }
  }
});

test("every endpoint field points at the page that explains there is no login", async () => {
  for (const value of [AS.authorization_endpoint, AS.token_endpoint, AS.agent_auth.register_uri, AS.agent_auth.claim_uri]) {
    const url = new URL(value);
    assert.equal(`${url.origin}${url.pathname}`, `${SITE}/auth.md`);
    assert.equal(resolveSiteUrl(value), "file");
  }
});

test("the MCP and catalog URLs are the real ones the Worker serves", async () => {
  for (const doc of [AS, PR]) {
    assert.equal(doc.mcp_url, `${SITE}/mcp`);
    for (const field of ["mcp_server_card_url", "api_catalog_url"]) {
      const { response } = await fetchDoc(new URL(doc[field]).pathname);
      assert.equal(response.status, 200, field);
    }
  }
});

for (const path of OAUTH_PATHS) {
  test(`${path} is served by the Worker as application/json`, async () => {
    const { response, deps } = await fetchDoc(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/json");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
    assert.deepEqual(await response.json(), path.endsWith("authorization-server") ? AS : PR);
    assert.equal(deps.originCalls.length, 0);
    assert.equal(deps.passThroughCalls, 0);
  });

  test(`${path} answers HEAD with no body and refuses POST`, async () => {
    const head = (await fetchDoc(path, { method: "HEAD" })).response;
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("Content-Type"), "application/json");
    assert.equal(await head.text(), "");
    assert.equal((await fetchDoc(path, { method: "POST" })).response.status, 405);
  });
}

test("openid-configuration stays absent: this origin is not an OpenID Provider", async () => {
  assert.equal(resolveSiteUrl(`${SITE}/.well-known/openid-configuration`), null);
  assert.ok(!existsSync(new URL(".well-known/openid-configuration", REPO)));
});
