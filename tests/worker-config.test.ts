import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PAGES } from "../workers/agent-readiness/handler.ts";
import { OWNED_EXACT } from "../workers/agent-readiness/router.ts";
import { resolveSiteUrl } from "./support/site-map.ts";
import { globMatches, publishedFile, publishedPaths, runsWorkerFirst, servedPath, workerFirstPatterns } from "./support/static-site.ts";

const REPO = new URL("../", import.meta.url);
const SITE_CONFIG = new URL("wrangler.jsonc", REPO);
const CONTACT_CONFIG = new URL("workers/contact/wrangler.jsonc", REPO);
const HTTP_SOURCE = new URL("workers/agent-readiness/http.ts", REPO);
const ALLOWED_RELS = ["alternate", "api-catalog", "service-desc", "service-doc", "describedby", "privacy-policy"];
const RUN_WORKER_FIRST = ["/", "/privacy.html", "/mcp", "/api/v1", "/api/v1/*"];

// The route that attaches the site Worker to the zone. It is kept in the
// Cloudflare dashboard, not in wrangler.jsonc, so no deploy can change it.
const SITE_ROUTE = "burrowsapps.com/*";

type Config = {
  name?: string;
  main: string;
  route?: unknown;
  routes?: { pattern: string }[];
  workers_dev?: boolean;
  preview_urls?: boolean;
  assets?: Record<string, unknown>;
  send_email?: unknown;
  ratelimits?: { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
};

// Both configs use whole-line comments only, so dropping those lines leaves
// plain JSON. "//" inside URL strings is never at the start of a line.
const withoutComments = async (config: URL): Promise<string> =>
  (await readFile(config, "utf8")).split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");

const readConfig = async (config: URL): Promise<Config> => JSON.parse(await withoutComments(config));

const patternsOf = async (config: URL): Promise<string[]> => ((await readConfig(config)).routes ?? []).map((r) => r.pattern);

const repoFile = (path: string): URL => new URL(`.${path}`, REPO);

// The binding names declared in the Env type, by declared type.
const envBindings = async (): Promise<string[]> => {
  const source = await readFile(HTTP_SOURCE, "utf8");
  const block = source.match(/export type Env = \{([^}]*)\}/);
  assert.ok(block, "Env type not found in http.ts");
  return [...block[1].matchAll(/(\w+)\?:\s*RateLimiter;/g)].map(([, name]) => name);
};

test("the site config declares no route: the dashboard keeps the Worker's route", async () => {
  const config = await readConfig(SITE_CONFIG);
  assert.equal(config.routes, undefined);
  assert.equal(config.route, undefined);
});

test("the site Worker is named burrowsapps-com", async () => {
  assert.equal((await readConfig(SITE_CONFIG)).name, "burrowsapps-com");
});

test("the site has no workers.dev copy and no preview URLs", async () => {
  const config = await readConfig(SITE_CONFIG);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
});

test("the assets settings are exactly the ones the Worker and the tests depend on", async () => {
  assert.deepEqual((await readConfig(SITE_CONFIG)).assets, {
    directory: ".",
    binding: "ASSETS",
    html_handling: "auto-trailing-slash",
    not_found_handling: "404-page",
    run_worker_first: RUN_WORKER_FIRST,
  });
});

// Wrangler refuses a run_worker_first list in which a glob entry makes another
// entry redundant ("rule '/api/v1/*' makes it redundant").
test("no run_worker_first entry is covered by another entry in the list", async () => {
  const patterns = workerFirstPatterns();
  assert.equal(new Set(patterns).size, patterns.length, "duplicate entries");
  for (const glob of patterns.filter((pattern) => pattern.includes("*"))) {
    for (const entry of patterns.filter((pattern) => pattern !== glob)) {
      assert.ok(!globMatches(glob, entry), `${glob} makes ${entry} redundant`);
    }
  }
});

test("/api/v1/ still runs the Worker through the /api/v1/* entry", async () => {
  assert.ok(runsWorkerFirst("/api/v1/"));
  assert.ok(runsWorkerFirst("/api/v1/status"));
  assert.ok(!runsWorkerFirst("/api/v1x"));
});

test("every page the Worker decorates and every path it owns runs the Worker first", async () => {
  for (const path of [...Object.keys(PAGES), ...OWNED_EXACT]) assert.ok(runsWorkerFirst(path), `${path} is not in run_worker_first`);
});

test("every page's asset path is served from an HTML file", async () => {
  for (const [path, page] of Object.entries(PAGES)) {
    const file = publishedFile(page.asset);
    assert.ok(file, `${path}: ${page.asset} is not a published file`);
    assert.ok(file.pathname.endsWith(".html"), `${path}: ${page.asset} is ${file.pathname}`);
  }
});

test("no published file runs the Worker first, apart from the pages it decorates", async () => {
  const files = publishedPaths();
  assert.ok(files.includes("static/css/home.css"), "no published files found");
  for (const file of files) {
    const path = servedPath(file);
    if (Object.hasOwn(PAGES, path)) continue;
    assert.ok(!runsWorkerFirst(path), `${path} (${file}) matches run_worker_first`);
    assert.ok(!runsWorkerFirst(`/${file}`) || Object.hasOwn(PAGES, `/${file}`), `/${file} matches run_worker_first`);
  }
});

test("Env declares the ASSETS binding the config names", async () => {
  const source = await readFile(HTTP_SOURCE, "utf8");
  const block = source.match(/export type Env = \{([^}]*)\}/);
  assert.ok(block, "Env type not found in http.ts");
  assert.match(block[1], /^\s*ASSETS: AssetFetcher;$/m);
  assert.equal((await readConfig(SITE_CONFIG)).assets?.binding, "ASSETS");
});

test("the old Worker config is gone", async () => {
  assert.ok(!existsSync(new URL("workers/agent-readiness/wrangler.jsonc", REPO)));
});

test("the contact Worker's apex route is more specific than the site route", async () => {
  const contact = await patternsOf(CONTACT_CONFIG);
  const apex = contact.filter((pattern) => !pattern.startsWith("www."));
  assert.ok(apex.length > 0);
  for (const pattern of apex) assert.ok(pattern.length > SITE_ROUTE.length, `${pattern} must be longer than ${SITE_ROUTE}`);
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

test("the config's rate limiters are exactly the limiter names in Env", async () => {
  const config = await readConfig(SITE_CONFIG);
  const names = (config.ratelimits ?? []).map((binding) => binding.name).sort();
  assert.deepEqual(names, (await envBindings()).sort());
  assert.deepEqual(names, ["PUBLIC_LIMITER"]);
});

test("the Worker cannot send email", async () => {
  assert.equal((await readConfig(SITE_CONFIG)).send_email, undefined);
});

test("the rate limiter namespaces do not collide with the contact Worker's", async () => {
  const site = ((await readConfig(SITE_CONFIG)).ratelimits ?? []).map((limiter) => limiter.namespace_id);
  const contact = ((await readConfig(CONTACT_CONFIG)).ratelimits ?? []).map((limiter) => limiter.namespace_id);
  assert.equal(new Set(site).size, site.length);
  for (const id of site) assert.ok(!contact.includes(id), `namespace ${id} is also the contact Worker's`);
});

test("the config declares no storage and no variables", async () => {
  const config = await withoutComments(SITE_CONFIG);
  for (const key of ["kv_namespaces", "durable_objects", "d1_databases", "vars"]) {
    assert.ok(!new RegExp(`"${key}"\\s*:`).test(config), `config declares ${key}`);
  }
});

test("the config's main file exists next to it", async () => {
  const { main } = await readConfig(SITE_CONFIG);
  assert.ok(existsSync(new URL(main, SITE_CONFIG)), `${main} does not exist`);
});
