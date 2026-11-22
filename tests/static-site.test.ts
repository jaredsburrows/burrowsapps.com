import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  CONSUMED_TOP_LEVEL,
  PUBLIC_TOP_LEVEL,
  headerRules,
  headersFor,
  ignoreRules,
  isIgnored,
  publishedFile,
  publishedPaths,
  ruleMatches,
  servedPath,
  site,
} from "./support/static-site.ts";

const REPO = new URL("../", import.meta.url);
const SITE = "https://burrowsapps.com";
const get = (path: string, init?: RequestInit): Promise<Response> => site(new Request(`${SITE}${path}`, init));
const NOT_FOUND_PAGE = readFileSync(new URL("404.html", REPO), "utf8");

test("every top-level entry is published, consumed by wrangler, or in .assetsignore", async () => {
  const unclassified = readdirSync(REPO).filter(
    (entry) => !PUBLIC_TOP_LEVEL.includes(entry) && !CONSUMED_TOP_LEVEL.includes(entry) && !isIgnored(entry),
  );
  assert.deepEqual(unclassified, [], `add to PUBLIC_TOP_LEVEL or .assetsignore: ${unclassified.join(", ")}`);
});

test("no published top-level entry is also ignored", async () => {
  for (const entry of [...PUBLIC_TOP_LEVEL, ...CONSUMED_TOP_LEVEL]) assert.ok(!isIgnored(entry), `${entry} is ignored`);
});

test("every .assetsignore rule is a bare name or **/name", async () => {
  const rules = ignoreRules();
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    const name = rule.startsWith("**/") ? rule.slice(3) : rule;
    assert.match(name, /^[^/!*?[\]\\\s]+$/, `unsupported rule: ${rule}`);
  }
});

test("local state, source, and repository documents are not published", async () => {
  for (const path of [".team", ".git", ".wrangler", "node_modules", "tests", "workers", "wrangler.jsonc", "README.md", "CNAME", "static/img/.DS_Store", ".team/STATUS.md", "workers/contact/index.js"]) {
    assert.ok(isIgnored(path), `${path} would be published`);
  }
});

test("site files are published", async () => {
  for (const path of [".well-known/security.txt", "static/js/home.js", "index.html", "robots.txt"]) {
    assert.ok(!isIgnored(path), `${path} is ignored`);
  }
});

test("_headers stays within Cloudflare's limits and every header line is Name: value", async () => {
  const rules = headerRules();
  assert.ok(rules.length > 0 && rules.length <= 100, `${rules.length} rules`);
  const lines = readFileSync(new URL("_headers", REPO), "utf8").split("\n");
  for (const line of lines) assert.ok(line.length <= 2000, `line over 2,000 characters: ${line.slice(0, 40)}`);
  for (const line of lines.filter((candidate) => /^\s+\S/.test(candidate) && !candidate.trim().startsWith("#"))) {
    assert.match(line, /^\s+[A-Za-z][A-Za-z0-9-]*: \S.*$/, `not a header line: ${line}`);
  }
  for (const rule of rules) assert.ok(rule.pattern.startsWith("/") && rule.headers.length > 0, `empty or invalid rule ${rule.pattern}`);
});

test("no header from the /* rule is set again, and no two other rules match one file", async () => {
  const rules = headerRules();
  const all = rules.find((rule) => rule.pattern === "/*");
  assert.ok(all, "no /* rule");
  const shared = all.headers.map(([name]) => name.toLowerCase());
  for (const rule of rules.filter((candidate) => candidate !== all)) {
    for (const [name] of rule.headers) assert.ok(!shared.includes(name.toLowerCase()), `${rule.pattern} sets ${name} again`);
  }
  const others = rules.filter((rule) => rule !== all);
  const files = publishedPaths();
  assert.ok(files.length > 20, `only ${files.length} published files`);
  for (const file of files) {
    for (const path of new Set([servedPath(file), `/${file}`])) {
      const matching = others.filter((rule) => ruleMatches(rule.pattern, path)).map((rule) => rule.pattern);
      assert.ok(matching.length <= 1, `${path} matches ${matching.join(" and ")}`);
    }
  }
});

test("every _headers rule with an exact path names a published file", async () => {
  for (const { pattern } of headerRules().filter((rule) => !rule.pattern.includes("*"))) {
    assert.notEqual(publishedFile(pattern), null, `${pattern} is not a published file`);
  }
});

test("the two pages get no cache lifetime, Link, or Vary from _headers", async () => {
  for (const path of ["/", "/index.html", "/privacy", "/privacy.html"]) {
    const matching = headerRules().filter((rule) => ruleMatches(rule.pattern, path)).map((rule) => rule.pattern);
    assert.deepEqual(matching, ["/*"], `${path} matches ${matching.join(", ")}`);
    const headers = headersFor(path);
    for (const name of ["Cache-Control", "CDN-Cache-Control", "Expires", "Link", "Vary"]) {
      assert.equal(headers.get(name), null, `${path} gets ${name}`);
    }
  }
});

test("the markdown files are served as text/markdown with UTF-8 and CORS", async () => {
  for (const path of ["/index.md", "/privacy.md", "/auth.md", "/developers.md", "/.well-known/agent-skills/contact-burrows-applications/SKILL.md"]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("Content-Type"), "text/markdown; charset=utf-8", path);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*", path);
  }
});

test("the discovery JSON files are served as application/json with CORS", async () => {
  for (const path of ["/.well-known/ai-catalog.json", "/.well-known/ard.json"]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("Content-Type"), "application/json", path);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*", path);
  }
});

test("styles get an hour of cache and images a month", async () => {
  assert.equal((await get("/static/css/home.css")).headers.get("Cache-Control"), "public, max-age=3600");
  assert.equal((await get("/static/img/og.jpg")).headers.get("Cache-Control"), "public, max-age=2592000");
});

test("repository files that are not part of the site answer with the 404 page", async () => {
  for (const path of ["/README.md", "/tests/robots.test.ts", "/workers/contact/index.js", "/wrangler.jsonc", "/.team/STATUS.md", "/CNAME"]) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), NOT_FOUND_PAGE, path);
  }
});
