import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { CONSUMED_TOP_LEVEL, PUBLIC_TOP_LEVEL, ignoreRules, isIgnored } from "./support/static-site.ts";

const REPO = new URL("../", import.meta.url);

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
