import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isOwned } from "../workers/agent-readiness/router.ts";
import { resolveSiteUrl } from "./support/site-map.ts";

const REPO = new URL("../", import.meta.url);
const read = (path: string): Promise<string> => readFile(new URL(path, REPO), "utf8");

// Whole-line comments only, so dropping them leaves plain JSON.
const agentConfig = async (): Promise<{ ratelimits: { name: string; simple: { limit: number; period: number } }[] }> =>
  JSON.parse((await read("workers/agent-readiness/wrangler.jsonc")).split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n"));

const limiter = async (name: string): Promise<{ limit: number; period: number }> => {
  const found = (await agentConfig()).ratelimits.find((entry) => entry.name === name);
  assert.ok(found, `${name} is not in wrangler.jsonc`);
  return found.simple;
};

const siteUrls = (text: string): string[] =>
  [...new Set((text.match(/https:\/\/burrowsapps\.com[^\s)`]*/g) ?? []).map((raw) => raw.replace(/[.,;:]+$/, "")))];

// Endpoint paths named inside code spans, such as `GET /api/v1/company`.
const endpointPaths = (text: string): string[] => {
  const spans = [...text.matchAll(/`([^`]+)`/g)].map(([, span]) => span);
  const paths = spans.flatMap((span) => span.match(/(?:^|\s)(\/(?:api\/v1|mcp)[^\s?]*)/g) ?? []).map((path) => path.trim());
  return [...new Set(paths)];
};

const developers = await read("developers.md");

for (const url of siteUrls(developers)) {
  test(`developers.md: ${url} resolves`, async () => {
    assert.notEqual(resolveSiteUrl(url), null, `${url} does not resolve`);
  });
}

test("developers.md names only endpoint paths the Worker owns", async () => {
  const paths = endpointPaths(developers);
  assert.ok(paths.includes("/api/v1/company"), paths.join(" "));
  for (const path of paths) assert.ok(isOwned(path), `${path} is not owned by the Worker`);
});

test("developers.md states the public limit that PUBLIC_LIMITER enforces", async () => {
  const { limit, period } = await limiter("PUBLIC_LIMITER");
  assert.equal(period, 60);
  assert.ok(developers.includes(`${limit} requests a minute for each IP address`));
});
