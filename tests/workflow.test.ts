import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const WORKFLOW = await readFile(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
const DEPLOY_IF = "    if: github.event_name != 'pull_request' && github.ref == 'refs/heads/gh-pages'";

// The lines of one job: from "  name:" under jobs to the next job or the end.
const job = (name: string): string => {
  const lines = WORKFLOW.split("\n");
  const start = lines.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `no ${name} job`);
  const end = lines.findIndex((line, index) => index > start && /^ {0,2}\S/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join("\n");
};

test("the workflow has a deploy job that waits for the checks", async () => {
  assert.match(job("deploy"), /^ {4}needs: checks$/m);
});

test("the deploy job runs only on gh-pages and never for a pull request", async () => {
  const lines = job("deploy").split("\n").filter((line) => /^ {4}if:/.test(line));
  assert.deepEqual(lines, [DEPLOY_IF]);
});

test("the Cloudflare token is referenced once, in the deploy job", async () => {
  assert.equal(WORKFLOW.split("secrets.CLOUDFLARE_API_TOKEN").length - 1, 1);
  assert.ok(WORKFLOW.indexOf("secrets.CLOUDFLARE_API_TOKEN") > WORKFLOW.indexOf("\n  deploy:\n"));
  assert.ok(job("deploy").includes("secrets.CLOUDFLARE_API_TOKEN"));
});

test("the token appears nowhere outside the deploy job", async () => {
  const deploy = job("deploy");
  assert.ok(!WORKFLOW.replace(deploy, "").includes("CLOUDFLARE_API_TOKEN"));
});

test("the deploy action is pinned to a full commit SHA", async () => {
  const uses = [...WORKFLOW.matchAll(/uses: cloudflare\/wrangler-action@(\S+)/g)].map(([, ref]) => ref);
  assert.equal(uses.length, 1);
  assert.match(uses[0], /^[0-9a-f]{40}$/);
});

test("the workflow never runs with secrets for a pull request from a fork", async () => {
  assert.ok(!WORKFLOW.includes("pull_request_target"));
});

test("the checks job ends with a credential-free dry run", async () => {
  const checks = job("checks");
  assert.ok(checks.includes("wrangler deploy --dry-run"));
  assert.ok(!checks.includes("secrets."));
  assert.ok(checks.indexOf("wrangler deploy --dry-run") > checks.indexOf("node --test"), "the dry run must come after the tests");
});
