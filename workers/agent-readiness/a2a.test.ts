import { test } from "node:test";
import assert from "node:assert/strict";
import { A2A_VERSION, AGENT_CARD, AGENT_CARD_PATH, ANSWERS, SKILLS } from "./a2a.ts";
import { resolveSiteUrl } from "../../tests/support/site-map.ts";

type CardSkill = { id: string; name: string; description: string; tags: string[]; examples?: string[] };
type Card = {
  name: string;
  description: string;
  version: string;
  supportedInterfaces: { url: string; protocolBinding: string; protocolVersion: string; tenant?: string }[];
  provider: { organization: string; url: string };
  iconUrl: string;
  documentationUrl: string;
  capabilities: Record<string, unknown>;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: CardSkill[];
};

// The card as a reader sees it: the JSON the generated file holds.
const card = (): Card => JSON.parse(JSON.stringify(AGENT_CARD));

// Card

test("card: has every field an A2A 1.0 AgentCard requires", () => {
  const value = card();
  for (const key of ["name", "description", "version"] as const) {
    assert.equal(typeof value[key], "string", key);
    assert.ok(value[key].length > 0, key);
  }
  assert.ok(Array.isArray(value.supportedInterfaces));
  assert.equal(typeof value.capabilities, "object");
  assert.ok(value.defaultInputModes.length > 0);
  assert.ok(value.defaultOutputModes.length > 0);
  assert.ok(value.skills.length > 0);
  assert.equal(AGENT_CARD_PATH, "/.well-known/agent-card.json");
});

test("card: one JSON-RPC interface for protocol 1.0 at /a2a, with no tenant", () => {
  assert.equal(A2A_VERSION, "1.0");
  assert.deepEqual(card().supportedInterfaces, [
    { url: "https://burrowsapps.com/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
  ]);
});

test("card: every skill has an id, a name, a description, and tags", () => {
  for (const skill of card().skills) {
    for (const key of ["id", "name", "description"] as const) {
      assert.equal(typeof skill[key], "string", `${skill.id} ${key}`);
      assert.ok(skill[key].length > 0, `${skill.id} ${key}`);
    }
    assert.ok(Array.isArray(skill.tags) && skill.tags.length > 0, `${skill.id} tags`);
    for (const tag of skill.tags) assert.equal(typeof tag, "string");
  }
});

test("card: the skill ids are exactly the ones SendMessage answers", () => {
  const ids = card().skills.map((skill) => skill.id);
  assert.deepEqual(ids, ["company-profile", "services", "contact-options"]);
  assert.deepEqual(ids, Object.keys(ANSWERS));
  assert.deepEqual(SKILLS.map((skill) => skill.id), ids);
});

test("card: no streaming, no push notifications, no extended card", () => {
  assert.deepEqual(card().capabilities, { streaming: false, pushNotifications: false, extendedAgentCard: false });
});

test("card: input is text, output is text and JSON", () => {
  const value = card();
  assert.deepEqual(value.defaultInputModes, ["text/plain"]);
  assert.deepEqual(value.defaultOutputModes, ["text/plain", "application/json"]);
  for (const skill of SKILLS) {
    assert.deepEqual(skill.inputModes, ["text/plain"]);
    assert.deepEqual(skill.outputModes, ["text/plain", "application/json"]);
  }
});

test("card: every URL on it is a published file or a path the Worker owns", () => {
  const value = card();
  for (const url of [value.provider.url, value.iconUrl, value.documentationUrl]) {
    assert.equal(resolveSiteUrl(url), "file", url);
  }
});
