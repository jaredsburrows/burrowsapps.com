import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type Rule = { matchPackageNames?: string[]; matchUpdateTypes?: string[]; automerge?: boolean; minimumReleaseAge?: string };
type Manager = { customType: string; managerFilePatterns: string[]; matchStrings: string[]; depNameTemplate: string; datasourceTemplate: string };
type Config = { packageRules: Rule[]; customManagers?: Manager[] };

const CONFIG: Config = JSON.parse(await readFile(new URL("../.github/renovate.json", import.meta.url), "utf8"));
const WORKFLOW = await readFile(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
const GUARDED = ["cloudflare/wrangler-action", "wrangler"];

// Renovate applies every matching rule in order, so the last one that sets a
// value wins.
const settingFor = <K extends keyof Rule>(name: string, key: K): Rule[K] | undefined =>
  CONFIG.packageRules.filter((rule) => !rule.matchPackageNames || rule.matchPackageNames.includes(name)).reduce<Rule[K] | undefined>(
    (value, rule) => (key in rule ? rule[key] : value),
    undefined,
  );

test("the deploy action and wrangler are never auto-merged and wait 14 days", async () => {
  for (const name of GUARDED) {
    assert.equal(settingFor(name, "automerge"), false, name);
    assert.equal(settingFor(name, "minimumReleaseAge"), "14 days", name);
  }
});

test("everything else still auto-merges", async () => {
  assert.equal(settingFor("actions/checkout", "automerge"), true);
});

test("a regex manager finds both wrangler pins in the workflow", async () => {
  const manager = (CONFIG.customManagers ?? []).find((candidate) => candidate.depNameTemplate === "wrangler");
  assert.ok(manager, "no custom manager for wrangler");
  assert.equal(manager.customType, "regex");
  assert.equal(manager.datasourceTemplate, "npm");
  assert.ok(manager.managerFilePatterns.some((pattern) => new RegExp(pattern.slice(1, -1)).test(".github/workflows/build.yml")));
  const found = manager.matchStrings.flatMap((source) => [...WORKFLOW.matchAll(new RegExp(source, "g"))].map((match) => match.groups?.currentValue));
  assert.equal(found.length, 2);
  assert.equal(new Set(found).size, 1);
});
