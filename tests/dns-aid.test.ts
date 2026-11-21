import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CARD } from "../workers/agent-readiness/mcp.ts";
import { resolveSiteUrl } from "./support/site-map.ts";

const README = await readFile(new URL("../README.md", import.meta.url), "utf8");
const EXPECTED = '_index._agents.burrowsapps.com. 300 IN SVCB 1 burrowsapps.com. alpn="h2,h3" port=443';

// Zone-file lines inside the README's fenced blocks.
const records = [...README.matchAll(/```\n([\s\S]*?)```/g)]
  .flatMap(([, block]) => block.split("\n"))
  .filter((line) => /^_[\w-]+\._agents\./.test(line));

test("the README gives exactly one DNS-AID record, as planned", async () => {
  assert.deepEqual(records, [EXPECTED]);
});

test("the record is a ServiceMode SVCB record at the DNS-AID index name", async () => {
  const [owner, ttl, klass, type, priority, target, ...params] = records[0].split(/\s+/);
  assert.equal(owner, "_index._agents.burrowsapps.com.");
  assert.ok(Number(ttl) > 0);
  assert.equal(klass, "IN");
  assert.equal(type, "SVCB");
  assert.ok(Number(priority) >= 1, "priority 0 would be AliasMode");
  assert.equal(target, "burrowsapps.com.");
  assert.ok(!target.includes("_"), "the TargetName must not contain underscores");
  const keys = Object.fromEntries(params.map((param) => param.split("=")));
  assert.ok(keys.alpn, "alpn is missing");
  assert.equal(keys.port, "443");
  for (const key of (keys.mandatory ?? "").split(",").filter(Boolean)) {
    assert.notEqual(key, "mandatory");
    assert.ok(key in keys, `mandatory names ${key}, which the record does not carry`);
  }
});

test("the record's target is the host that serves the MCP server and the agent index", async () => {
  const remote = new URL((CARD.remotes as { url: string }[])[0].url);
  assert.equal(`${remote.hostname}.`, records[0].split(/\s+/)[5]);
  assert.equal(resolveSiteUrl("https://burrowsapps.com/.well-known/ard.json"), "file");
});

test("the dashboard table in the README matches the record", async () => {
  for (const row of ["| Type | `SVCB` |", "| Name | `_index._agents` |", "| Priority | `1` |", "| Target | `burrowsapps.com` |", '| Value | `alpn="h2,h3" port=443` |', "| TTL | `5 min` |"]) {
    assert.ok(README.includes(row), `README lacks ${row}`);
  }
});
