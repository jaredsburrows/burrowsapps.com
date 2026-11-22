import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DOCUMENTS } from "../workers/agent-readiness/documents.ts";
import { CARD_PATH, CARD_WELL_KNOWN_PATH } from "../workers/agent-readiness/mcp.ts";
import { runsWorkerFirst } from "./support/static-site.ts";

const REPO = new URL("../", import.meta.url);
const committed = (path: string): Promise<string> => readFile(new URL(`.${path}`, REPO), "utf8");

test("there are five generated documents", async () => {
  assert.deepEqual(Object.keys(DOCUMENTS).sort(), [
    "/.well-known/api-catalog",
    "/.well-known/mcp/server-card.json",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/mcp/server-card",
  ]);
});

for (const [path, content] of Object.entries(DOCUMENTS)) {
  test(`${path} is committed exactly as generated (run workers/agent-readiness/tools/write-documents.ts)`, async () => {
    assert.equal(await committed(path), content);
  });
}

test("no generated document runs the Worker first", async () => {
  for (const path of Object.keys(DOCUMENTS)) assert.ok(!runsWorkerFirst(path), `${path} matches run_worker_first`);
});

test("the two server card paths have identical bytes", async () => {
  assert.equal(await committed(CARD_PATH), await committed(CARD_WELL_KNOWN_PATH));
});
