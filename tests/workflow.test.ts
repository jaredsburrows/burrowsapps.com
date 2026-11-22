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

test("no job uses a GitHub Environment; the token is a repository secret", async () => {
  assert.ok(!/^ {4}environment:/m.test(job("deploy")));
  assert.ok(!/^ {4}environment:/m.test(job("checks")));
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
  assert.match(checks, /run: npx --yes wrangler@\d+\.\d+\.\d+ deploy --dry-run$/m);
  assert.ok(!checks.includes("secrets."));
  assert.ok(checks.indexOf("deploy --dry-run") > checks.indexOf("node --test"), "the dry run must come after the tests");
});

// Everything before the first job: triggers, permissions, concurrency, env.
const HEADER = WORKFLOW.slice(0, WORKFLOW.indexOf("\njobs:"));

test("no secret is read at workflow level, where every job would receive it", async () => {
  assert.ok(!HEADER.includes("secrets."), "a workflow-level secret reaches the checks job and the dry run");
  assert.ok(!/^env:\n(?: {2}.*\n)*? {2}\S+: .*secrets/m.test(HEADER));
});

test("the workflow permissions are read-only, and no job widens them", async () => {
  assert.match(HEADER, /^permissions:\n {2}contents: read$/m);
  assert.ok(!/^ {4}permissions:/m.test(job("checks")), "the checks job sets its own permissions");
  assert.ok(!/^ {4}permissions:/m.test(job("deploy")), "the deploy job sets its own permissions");
});

test("deploys queue and a running upload is never canceled", async () => {
  const concurrency = job("deploy").match(/^ {4}concurrency:\n {6}group: (.+)\n {6}cancel-in-progress: (.+)$/m);
  assert.ok(concurrency, "the deploy job has no concurrency block");
  assert.equal(concurrency[1], "cloudflare-deploy");
  assert.equal(concurrency[2], "false");
  assert.ok(!/^ {4}concurrency:/m.test(job("checks")), "only the deploy job shares a group");
});

test("the deploy job has one third-party action, and no checkout keeps credentials", async () => {
  const uses = [...job("deploy").matchAll(/uses: (\S+)/g)].map(([, action]) => action.split("@")[0]);
  assert.deepEqual(uses.sort(), ["actions/checkout", "cloudflare/wrangler-action"]);
  const checkouts = WORKFLOW.split("uses: actions/checkout@").slice(1);
  assert.equal(checkouts.length, 2);
  for (const checkout of checkouts) assert.match(checkout.split("\n\n")[0], /persist-credentials: false/);
});

// Both jobs run one exact wrangler, so a new release changes nothing until a
// reviewed commit moves both pins together.
test("the dry run and the deploy use the same exact wrangler version", async () => {
  const dryRun = job("checks").match(/npx --yes wrangler@(\d+\.\d+\.\d+) deploy --dry-run/)?.[1];
  const deploy = job("deploy").match(/^ {10}wranglerVersion: "(\d+\.\d+\.\d+)"$/m)?.[1];
  assert.ok(dryRun, "the dry run does not pin wrangler");
  assert.ok(deploy, "the deploy action does not pin wrangler");
  assert.equal(dryRun, deploy);
  assert.equal(WORKFLOW.split("wrangler@").length - 1, 1, "wrangler is run somewhere else too");
});
