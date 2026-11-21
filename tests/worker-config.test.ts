import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PAGES } from "../workers/agent-readiness/handler.ts";
import { resolveSiteUrl } from "./support/site-map.ts";

const REPO = new URL("../", import.meta.url);
const AGENT_CONFIG = new URL("workers/agent-readiness/wrangler.jsonc", REPO);
const CONTACT_CONFIG = new URL("workers/contact/wrangler.jsonc", REPO);
const HTTP_SOURCE = new URL("workers/agent-readiness/http.ts", REPO);
const ALLOWED_RELS = ["alternate", "api-catalog", "service-desc", "service-doc", "describedby", "privacy-policy"];

type Config = {
  main: string;
  routes: { pattern: string }[];
  send_email?: { name: string; allowed_destination_addresses: string[] }[];
  ratelimits?: { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
};

// Both configs use whole-line comments only, so dropping those lines leaves
// plain JSON. "//" inside URL strings is never at the start of a line.
const withoutComments = async (config: URL): Promise<string> =>
  (await readFile(config, "utf8")).split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");

const readConfig = async (config: URL): Promise<Config> => JSON.parse(await withoutComments(config));

const patternsOf = async (config: URL): Promise<string[]> => (await readConfig(config)).routes.map((r) => r.pattern);

// A Workers route pattern matches a URL (without scheme) exactly, or as a
// prefix when it ends in "*".
const matches = (pattern: string, target: string): boolean =>
  pattern.endsWith("*") ? target.startsWith(pattern.slice(0, -1)) : target === pattern;

const repoFile = (path: string): URL => new URL(`.${path}`, REPO);

// The binding names declared in the Env type, by declared type.
const envBindings = async (): Promise<string[]> => {
  const source = await readFile(HTTP_SOURCE, "utf8");
  const block = source.match(/export type Env = \{([^}]*)\}/);
  assert.ok(block, "Env type not found in http.ts");
  return [...block[1].matchAll(/(\w+)\?:\s*(RateLimiter|EmailSender);/g)].map(([, name]) => name);
};

test("agent-readiness has exactly the wildcard route and the /api/v1 route", async () => {
  assert.deepEqual(await patternsOf(AGENT_CONFIG), ["burrowsapps.com/*", "burrowsapps.com/api/v1*"]);
});

test("no agent-readiness route is on www", async () => {
  for (const pattern of await patternsOf(AGENT_CONFIG)) assert.ok(!pattern.startsWith("www."), pattern);
});

test("the contact Worker's routes are more specific than every agent route that matches them", async () => {
  const agent = await patternsOf(AGENT_CONFIG);
  const contact = await patternsOf(CONTACT_CONFIG);
  const competing = agent.filter((pattern) => matches(pattern, "burrowsapps.com/api/contact"));
  assert.ok(competing.length > 0);
  for (const mine of contact.filter((pattern) => !pattern.startsWith("www."))) {
    for (const theirs of competing) assert.ok(mine.length > theirs.length, `${mine} must be longer than ${theirs}`);
  }
});

test("the /api/v1 route is more specific than a leftover /api/* route", async () => {
  const agent = await patternsOf(AGENT_CONFIG);
  assert.ok(agent.includes("burrowsapps.com/api/v1*"));
  assert.ok("burrowsapps.com/api/v1*".length > "burrowsapps.com/api/*".length);
  assert.ok(!agent.includes("burrowsapps.com/api/*"));
});

test("the contact Worker keeps its two routes", async () => {
  assert.deepEqual(await patternsOf(CONTACT_CONFIG), [
    "burrowsapps.com/api/contact*",
    "www.burrowsapps.com/api/contact*",
  ]);
});

test("every markdown file in PAGES exists in the repo", async () => {
  for (const page of Object.values(PAGES)) {
    assert.ok(existsSync(repoFile(page.markdown)), `${page.markdown} does not exist`);
  }
});

test("every link target in PAGES is a file in the repo or a Worker path", async () => {
  for (const page of Object.values(PAGES)) {
    for (const link of page.links) assert.notEqual(resolveSiteUrl(link.href), null, `${link.href} does not resolve`);
  }
});

test("only registered link relations are used", async () => {
  for (const page of Object.values(PAGES)) {
    for (const link of page.links) assert.ok(ALLOWED_RELS.includes(link.rel), `rel ${link.rel} is not allowed`);
  }
});

test("the config's bindings are exactly the binding names in Env", async () => {
  const config = await readConfig(AGENT_CONFIG);
  const names = [...(config.ratelimits ?? []), ...(config.send_email ?? [])].map((binding) => binding.name).sort();
  assert.deepEqual(names, (await envBindings()).sort());
  assert.equal(names.length, 5);
});

test("the email binding is locked to the contact Worker's destination", async () => {
  const agent = (await readConfig(AGENT_CONFIG)).send_email ?? [];
  const contact = (await readConfig(CONTACT_CONFIG)).send_email ?? [];
  assert.equal(agent.length, 1);
  assert.deepEqual(agent[0].allowed_destination_addresses, contact[0].allowed_destination_addresses);
});

test("the rate limiter namespaces do not collide with the contact Worker's", async () => {
  const agent = ((await readConfig(AGENT_CONFIG)).ratelimits ?? []).map((limiter) => limiter.namespace_id);
  const contact = ((await readConfig(CONTACT_CONFIG)).ratelimits ?? []).map((limiter) => limiter.namespace_id);
  assert.equal(new Set(agent).size, agent.length);
  for (const id of agent) assert.ok(!contact.includes(id), `namespace ${id} is also the contact Worker's`);
});

test("the config declares no storage and no secret", async () => {
  const config = await withoutComments(AGENT_CONFIG);
  for (const key of ["kv_namespaces", "durable_objects", "d1_databases", "OAUTH_SIGNING_KEY", "TURNSTILE_SECRET"]) {
    assert.ok(!new RegExp(`"${key}"\\s*:`).test(config), `config declares ${key}`);
  }
});

test("the config's main file exists next to it", async () => {
  const { main } = await readConfig(AGENT_CONFIG);
  assert.ok(existsSync(new URL(main, AGENT_CONFIG)), `${main} does not exist`);
});
