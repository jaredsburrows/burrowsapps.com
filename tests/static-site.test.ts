import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { assetsIgnore, PUBLISHED_FILES, publishedFolders } from "./support/published-files.ts";
import {
  assetFetch,
  existsExactly,
  headerRules,
  headersFor,
  isPublished,
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

const TO_PUBLISH = "to publish a file, add it to PUBLISHED_FILES in tests/support/published-files.ts and run node tests/support/write-assetsignore.ts";

test(".assetsignore is exactly the allowlist generated from PUBLISHED_FILES", async () => {
  assert.equal(readFileSync(new URL(".assetsignore", REPO), "utf8"), assetsIgnore(), `.assetsignore is out of date: ${TO_PUBLISH}`);
});

test(".assetsignore ignores everything, then re-includes folders, then files", async () => {
  const rules = assetsIgnore().split("\n").filter((line) => line !== "" && !line.startsWith("#"));
  assert.equal(rules[0], "*");
  const firstFile = rules.findIndex((rule) => rule.startsWith("!/"));
  for (const rule of rules.slice(1, firstFile)) assert.match(rule, /^![^/!*][^!*]*\/$/, `not a folder rule: ${rule}`);
  for (const rule of rules.slice(firstFile)) assert.match(rule, /^!\/[^!*]+[^/]$/, `not a file rule: ${rule}`);
  assert.equal(rules.length, 1 + publishedFolders().length + PUBLISHED_FILES.length);
});

test("every published file exists with exactly that name", async () => {
  assert.equal(new Set(PUBLISHED_FILES).size, PUBLISHED_FILES.length, "a file is listed twice");
  for (const file of PUBLISHED_FILES) assert.ok(existsExactly(file), `${file} is listed but does not exist`);
});

test("every file in a published folder is on the list, so none is forgotten", async () => {
  const walk = (folder: string): string[] =>
    readdirSync(new URL(`./${folder}`, REPO), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(`${folder}${entry.name}/`) : [`${folder}${entry.name}`]);
  const unlisted = publishedFolders()
    .filter((folder) => !folder.includes("/"))
    .flatMap((folder) => walk(`${folder}/`))
    .filter((file) => !file.endsWith("/.DS_Store") && !isPublished(file));
  assert.deepEqual(unlisted, [], `not published: ${unlisted.join(", ")}; ${TO_PUBLISH}, or remove the file`);
});

test("the list names no repository file, local state, or wrangler input", async () => {
  for (const file of PUBLISHED_FILES) {
    const top = file.split("/")[0];
    assert.ok(!["tests", "workers", ".github", ".team", ".git", ".wrangler", "node_modules"].includes(top), file);
    assert.ok(!["README.md", "LICENSE", "CNAME", ".nojekyll", "wrangler.jsonc", "_headers", ".assetsignore", ".gitignore"].includes(file), file);
    assert.ok(!top.startsWith(".") || top === ".well-known", file);
  }
});

test("secrets, backups, and local state are not published", async () => {
  for (const path of [".env", ".dev.vars", "static/notes.bak", "static/img/.DS_Store", ".team/STATUS.md", "README.md", "CNAME", "_headers", "tests/robots.test.ts", "workers/contact/index.js"]) {
    assert.ok(!isPublished(path), `${path} would be published`);
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
  for (const path of ["/README.md", "/tests/robots.test.ts", "/workers/contact/index.js", "/wrangler.jsonc", "/.team/STATUS.md", "/CNAME", "/_headers", "/.assetsignore", "/.gitignore", "/.github/workflows/build.yml", "/workers/agent-readiness/facts.ts", "/LICENSE", "/.env", "/.dev.vars", "/static/notes.bak"]) {
    const response = await get(path);
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), NOT_FOUND_PAGE, path);
  }
});

test("/privacy.html is the decorated page, not the asset router's redirect", async () => {
  const response = await get("/privacy.html");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("Link"), '</privacy.md>; rel="alternate"; type="text/markdown"');
  assert.equal(await response.text(), readFileSync(new URL("privacy.html", REPO), "utf8"));
  const plain = await assetFetch(new Request(`${SITE}/privacy.html`));
  assert.equal(plain.status, 307);
  assert.equal(plain.headers.get("Location"), "/privacy");
});

test("a method other than GET or HEAD on a file is a 405 from the asset router", async () => {
  for (const [path, method] of [["/robots.txt", "POST"], ["/.well-known/ard.json", "OPTIONS"], ["/index.md", "PUT"]]) {
    const response = await get(path, { method });
    assert.equal(response.status, 405, `${method} ${path}`);
    assert.equal(await response.text(), "", `${method} ${path}`);
  }
});

test("files are typed by extension as Cloudflare infers it", async () => {
  assert.equal((await get("/favicon.ico")).headers.get("Content-Type"), "image/vnd.microsoft.icon");
  assert.equal((await get("/robots.txt")).headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.equal((await get("/sitemap.xml")).headers.get("Content-Type"), "application/xml");
});


// Answers measured under wrangler dev, replayed against the emulated site.

test("other methods on the two pages reach the binding and get its 405", async () => {
  for (const [method, path] of [["OPTIONS", "/"], ["POST", "/"], ["PUT", "/"], ["OPTIONS", "/privacy.html"], ["DELETE", "/privacy.html"]]) {
    const response = await get(path, { method });
    assert.equal(response.status, 405, `${method} ${path}`);
    assert.equal(await response.text(), "", `${method} ${path}`);
  }
});

test("OPTIONS on the MCP server and the API is the Worker's preflight", async () => {
  for (const path of ["/mcp", "/api/v1/company"]) {
    const response = await get(path, { method: "OPTIONS" });
    assert.equal(response.status, 204, path);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*", path);
  }
});

test("paths are case-sensitive", async () => {
  for (const path of ["/ROBOTS.TXT", "/Index.md", "/readme.md", "/Static/css/home.css"]) {
    assert.equal((await get(path)).status, 404, path);
  }
});

test("the asset router's redirects keep the query string", async () => {
  for (const [path, location] of [["/privacy/", "/privacy"], ["/index.html?q=1", "/?q=1"], ["//", "/"], ["/404.html", "/404"]]) {
    const response = await get(path);
    assert.equal(response.status, 307, path);
    assert.equal(response.headers.get("Location"), location, path);
  }
});

test("a folder is not a page", async () => {
  for (const path of ["/static", "/static/", "/.well-known/", "/mcp/"]) assert.equal((await get(path)).status, 404, path);
});

test("the 404 page carries the headers of the /* rule", async () => {
  const response = await get("/nope");
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("the two pages carry nosniff from the /* rule through the binding", async () => {
  for (const path of ["/", "/privacy.html"]) {
    const response = await get(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff", path);
  }
});

test("with Accept-Encoding gzip the page is compressed and Vary still names only Accept", async () => {
  const response = await get("/", { headers: { "Accept-Encoding": "gzip, br" } });
  assert.equal(response.headers.get("Content-Encoding"), "gzip");
  assert.equal(response.headers.get("Vary"), "Accept");
  const body = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
  assert.equal(body, readFileSync(new URL("index.html", REPO), "utf8"));
});
