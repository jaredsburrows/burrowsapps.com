import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
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

const authMd = await read("auth.md");
const contactWorker = await read("workers/contact/index.js");

// [text](target) links, resolved against the site root as a browser would.
const linkTargets = (text: string): string[] => [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map(([, target]) => target);

test("auth.md opens with its only H1, which contains auth.md", async () => {
  const h1s = authMd.match(/^# .+$/gm) ?? [];
  assert.equal(h1s.length, 1);
  assert.equal(authMd.split("\n")[0], h1s[0]);
  assert.match(h1s[0], /auth\.md/);
});

test("auth.md has the five labelled bullets and answers the three that matter with none", async () => {
  const lines = authMd.split("\n");
  for (const label of ["Audience", "Registration endpoint", "Supported methods", "Credential use", "Protected resources"]) {
    assert.ok(authMd.includes(`**${label}:**`), `no "${label}" bullet`);
  }
  const bullet = (label: string): string => lines.find((line) => line.includes(`**${label}:**`)) ?? "";
  for (const label of ["Registration endpoint", "Supported methods", "Protected resources"]) {
    assert.match(bullet(label), /\bnone\b/i, `${label} no longer says none`);
  }
  assert.match(authMd, /No authentication is required, offered, or possible/);
  assert.match(authMd, /Burrows Applications has no login\./);
});

test("auth.md does not claim the site has no API or is static-only", async () => {
  for (const phrase of ["static content only", "serves static", "is a static site", "there is no api", "no api exists", "has no api", "nothing to call", "coming soon", "planned"]) {
    assert.ok(!authMd.toLowerCase().includes(phrase), `auth.md says "${phrase}"`);
  }
});

test("every link in auth.md resolves to a file or a Worker path", async () => {
  const targets = linkTargets(authMd);
  assert.ok(targets.length >= 10, `only ${targets.length} links found`);
  for (const target of targets) assert.notEqual(resolveSiteUrl(target), null, `${target} does not resolve`);
  for (const url of siteUrls(authMd)) assert.notEqual(resolveSiteUrl(url), null, `${url} does not resolve`);
});

test("auth.md names only endpoint paths the Worker owns, plus the contact form's", async () => {
  for (const path of endpointPaths(authMd)) assert.ok(isOwned(path), `${path} is not owned by the Worker`);
  for (const path of ["/api/v1", "/mcp", "/api/contact"]) assert.ok(authMd.includes(`\`${path}\``), `auth.md does not name ${path}`);
});

test("auth.md's statements about the contact endpoint are in the contact Worker", async () => {
  // Meant only for the form: the Worker keeps an allow-list of the site's origins.
  assert.match(contactWorker, /const ALLOWED_ORIGINS = \[\s*"https:\/\/burrowsapps\.com"/, "the Origin allow-list is gone");
  // Bot checks and rate limits.
  assert.match(contactWorker, /data\.company\?\.trim\(\)/, "the honeypot is gone");
  assert.match(contactWorker, /env\.TURNSTILE_SECRET/, "the Turnstile check is gone");
  assert.match(contactWorker, /env\.RATE_LIMITER/, "the per-IP rate limit is gone");
  assert.match(contactWorker, /env\.GLOBAL_LIMITER/, "the global rate limit is gone");
  // Refusals are a 404, not a 401, and no credential is read.
  assert.match(contactWorker, /return status\(404\);/, "refusals are no longer a 404");
  assert.ok(!/status\(401\)/.test(contactWorker), "the contact Worker now sends 401");
  assert.ok(!/headers\.get\(\s*["'`]authorization["'`]/i.test(contactWorker), "the contact Worker now reads a credential");
});

test("the docs do not describe how the contact endpoint's checks respond", async () => {
  const skill = await read(".well-known/agent-skills/contact-burrows-applications/SKILL.md");
  for (const [name, text] of [["auth.md", authMd], ["developers.md", developers], ["SKILL.md", skill]] as const) {
    for (const phrase of [/\b403\b/, /not callable/i, /no program/i, /only from the form/i, /rejects every other/i, /Origin` header/]) {
      assert.ok(!phrase.test(text), `${name} matches ${phrase}`);
    }
  }
});

test("no Worker reads a credential or challenges for one, which is what auth.md says", async () => {
  const worker = readdirSync(new URL("workers/agent-readiness/", REPO))
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "testing.ts")
    .map((file) => `workers/agent-readiness/${file}`);
  assert.ok(worker.length >= 7, `only ${worker.length} Worker sources found`);
  for (const file of ["workers/contact/index.js", ...worker]) {
    const source = await read(file);
    assert.ok(!/www-authenticate/i.test(source), `${file} sends WWW-Authenticate`);
    assert.ok(!/(?:status\s*:|json\(|[(,])\s*401\s*[,)}]/.test(source), `${file} sends a 401`);
    assert.ok(!/headers\.(?:get|has)\(\s*["'`]authorization["'`]/i.test(source), `${file} reads the Authorization header`);
  }
});
