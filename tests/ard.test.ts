import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveSiteUrl } from "./support/site-map.ts";

const REPO = new URL("../", import.meta.url);
const CATALOG = new URL(".well-known/ai-catalog.json", REPO);
const ARD = new URL(".well-known/ard.json", REPO);
const SITE = "https://burrowsapps.com/";
const IDENTIFIER = /^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/;

type Entry = {
  identifier: string;
  displayName: string;
  type: string;
  url?: string;
  data?: unknown;
  representativeQueries?: string[];
};
type Manifest = { specVersion: string; host: Record<string, string>; entries: Entry[] };

const readManifest = async (): Promise<Manifest> => JSON.parse(await readFile(CATALOG, "utf8"));

test("ai-catalog.json and ard.json are byte-identical", async () => {
  assert.ok((await readFile(CATALOG)).equals(await readFile(ARD)));
});

test("top level has only specVersion, host, and entries", async () => {
  const manifest = await readManifest();
  assert.deepEqual(Object.keys(manifest).sort(), ["entries", "host", "specVersion"]);
  assert.equal(manifest.specVersion, "1.0");
});

test("host uses only schema-allowed keys and has a display name", async () => {
  const { host } = await readManifest();
  const allowed = ["displayName", "identifier", "documentationUrl", "logoUrl"];
  for (const key of Object.keys(host)) assert.ok(allowed.includes(key), `unexpected host key ${key}`);
  assert.ok(typeof host.displayName === "string" && host.displayName.length > 0);
});

test("each entry is well formed", async () => {
  const { entries } = await readManifest();
  assert.ok(Array.isArray(entries) && entries.length > 0);
  for (const entry of entries) {
    assert.match(entry.identifier, IDENTIFIER);
    assert.equal(entry.identifier.split(":")[2], "burrowsapps.com");
    assert.ok(entry.displayName.length > 0);
    assert.ok(entry.type.length > 0);
    assert.equal(("url" in entry ? 1 : 0) + ("data" in entry ? 1 : 0), 1, `${entry.identifier}: exactly one of url or data`);
    const queries = entry.representativeQueries ?? [];
    assert.ok(queries.length >= 2 && queries.length <= 5, `${entry.identifier}: 2 to 5 representativeQueries`);
  }
});

test("each entry url is a file in this repo or a Worker path", async () => {
  for (const entry of (await readManifest()).entries) {
    if (entry.url === undefined) continue;
    assert.ok(entry.url.startsWith(SITE), `${entry.url} is not on ${SITE}`);
    assert.notEqual(resolveSiteUrl(entry.url), null, `${entry.url} does not resolve`);
  }
});

test("entry identifiers are unique", async () => {
  const ids = (await readManifest()).entries.map((entry) => entry.identifier);
  assert.equal(new Set(ids).size, ids.length);
});

test("the MCP server card entry points at the published server card file", async () => {
  const entry = (await readManifest()).entries.find((candidate) => candidate.type === "application/mcp-server-card+json");
  assert.ok(entry?.url, "no application/mcp-server-card+json entry");
  assert.equal(entry.url, "https://burrowsapps.com/mcp/server-card");
  assert.equal(resolveSiteUrl(entry.url), "file");
});

test("the A2A entry points at the published Agent Card file", async () => {
  const entry = (await readManifest()).entries.find((candidate) => candidate.type === "application/a2a-agent-card+json");
  assert.ok(entry?.url, "no application/a2a-agent-card+json entry");
  assert.equal(entry.url, "https://burrowsapps.com/.well-known/agent-card.json");
  assert.equal(resolveSiteUrl(entry.url), "file");
});
