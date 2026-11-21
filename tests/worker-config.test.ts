import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PAGES } from "../workers/agent-readiness/handler.ts";

const REPO = new URL("../", import.meta.url);
const AGENT_CONFIG = new URL("workers/agent-readiness/wrangler.jsonc", REPO);
const CONTACT_CONFIG = new URL("workers/contact/wrangler.jsonc", REPO);
const HOSTS = ["burrowsapps.com", "www.burrowsapps.com"];
const ALLOWED_RELS = ["alternate", "describedby", "privacy-policy"];

// A regex instead of a JSONC parser: "//" inside URL strings makes naive
// comment stripping wrong, and the patterns are all this test needs.
const patternsOf = async (config: URL): Promise<string[]> =>
  [...(await readFile(config, "utf8")).matchAll(/"pattern"\s*:\s*"([^"]+)"/g)].map(([, pattern]) => pattern);

const repoFile = (path: string): URL => new URL(`.${path}`, REPO);

test("agent-readiness has exactly the four exact routes", async () => {
  assert.deepEqual(await patternsOf(AGENT_CONFIG), [
    "burrowsapps.com/",
    "www.burrowsapps.com/",
    "burrowsapps.com/privacy.html",
    "www.burrowsapps.com/privacy.html",
  ]);
});

test("no agent-readiness route has a wildcard, a query, or an API path", async () => {
  for (const pattern of await patternsOf(AGENT_CONFIG)) {
    assert.ok(!/[*?]/.test(pattern), `${pattern} is not an exact pattern`);
    assert.ok(!pattern.includes("/api/"), `${pattern} would shadow the contact Worker`);
  }
});

test("routes and PAGES cover each other on apex and www", async () => {
  const patterns = await patternsOf(AGENT_CONFIG);
  const expected = Object.keys(PAGES).flatMap((path) => HOSTS.map((host) => `${host}${path}`));
  for (const pattern of expected) assert.ok(patterns.includes(pattern), `missing route ${pattern}`);
  for (const pattern of patterns) assert.ok(expected.includes(pattern), `route ${pattern} has no PAGES entry`);
});

test("the contact Worker keeps its two routes", async () => {
  assert.deepEqual(await patternsOf(CONTACT_CONFIG), [
    "burrowsapps.com/api/contact*",
    "www.burrowsapps.com/api/contact*",
  ]);
});

test("every markdown file and link target in PAGES exists in the repo", async () => {
  for (const page of Object.values(PAGES)) {
    assert.ok(existsSync(repoFile(page.markdown)), `${page.markdown} does not exist`);
    for (const link of page.links) assert.ok(existsSync(repoFile(link.href)), `${link.href} does not exist`);
  }
});

test("only registered link relations are used", async () => {
  for (const page of Object.values(PAGES)) {
    for (const link of page.links) assert.ok(ALLOWED_RELS.includes(link.rel), `rel ${link.rel} is not allowed`);
  }
});

test("the config's main file exists next to it", async () => {
  const main = (await readFile(AGENT_CONFIG, "utf8")).match(/"main"\s*:\s*"([^"]+)"/);
  assert.ok(main, "no main in wrangler.jsonc");
  assert.ok(existsSync(new URL(main[1], AGENT_CONFIG)), `${main[1]} does not exist`);
});
