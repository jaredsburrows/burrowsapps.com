import { test } from "node:test";
import assert from "node:assert/strict";
import { A2A_VERSION, AGENT_CARD, AGENT_CARD_PATH, ANSWERS, SKILLS, endpoint } from "./a2a.ts";
import { resolveSiteUrl } from "../../tests/support/site-map.ts";
import { makeBaseEnv } from "./testing.ts";
import type { TestEnv } from "./testing.ts";

const ENDPOINT = "https://burrowsapps.com/a2a";
const ERROR_INFO = "type.googleapis.com/google.rpc.ErrorInfo";

type Rpc = {
  jsonrpc: string;
  id?: string | number | null;
  result?: Record<string, any>;
  error?: { code: number; message: string; data?: any[] };
};

const send = async (init: RequestInit, env: TestEnv = makeBaseEnv(), url = ENDPOINT): Promise<Response> =>
  endpoint(new Request(url, init), env);

const post = (body: unknown, headers: Record<string, string | null> = {}): RequestInit => {
  const all: Record<string, string> = { "Content-Type": "application/json", "A2A-Version": "1.0" };
  for (const [name, value] of Object.entries(headers)) {
    if (value === null) delete all[name];
    else all[name] = value;
  }
  return { method: "POST", headers: all, body: typeof body === "string" ? body : JSON.stringify(body) };
};

// One JSON-RPC call with A2A-Version: 1.0 unless headers say otherwise.
const a2a = (method: string, params?: unknown, headers: Record<string, string | null> = {}): RequestInit =>
  post({ jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) }, headers);

const rpc = async (response: Response): Promise<Rpc> => JSON.parse(await response.text());

const expectError = async (response: Response, status: number, code: number): Promise<Rpc> => {
  assert.equal(response.status, status);
  const body = await rpc(response);
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.error?.code, code, JSON.stringify(body));
  assert.equal(body.result, undefined);
  return body;
};

// An A2A error: HTTP 200, the code, and one ErrorInfo with the reason.
const expectA2aError = async (response: Response, code: number, reason: string): Promise<Rpc> => {
  const body = await expectError(response, 200, code);
  assert.equal(body.error?.data?.length, 1);
  assert.equal(body.error?.data?.[0]["@type"], ERROR_INFO);
  assert.equal(body.error?.data?.[0].reason, reason);
  assert.equal(body.error?.data?.[0].domain, "a2a-protocol.org");
  return body;
};

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

// Version

for (const [label, value] of [["missing", null], ["empty", ""], ["0.3", "0.3"], ["2.0", "2.0"], ["7.31", "7.31"], ["banana", "banana"]] as const) {
  test(`version: A2A-Version ${label} is -32009 with the supported version and no echo`, async () => {
    const response = await send(a2a("ListTasks", {}, { "A2A-Version": value }));
    const text = await response.clone().text();
    const body = await expectA2aError(response, -32009, "VERSION_NOT_SUPPORTED");
    assert.equal(body.id, 1);
    assert.deepEqual(body.error?.data?.[0].metadata, { supportedVersions: "1.0" });
    if (value === "banana" || value === "7.31") assert.ok(!text.includes(value), "the requested version is not echoed");
  });
}

for (const value of ["1.0", "1.0.0", " 1.0 "]) {
  test(`version: A2A-Version ${JSON.stringify(value)} is accepted`, async () => {
    const body = await rpc(await send(a2a("nope", {}, { "A2A-Version": value })));
    assert.notEqual(body.error?.code, -32009);
  });
}

test("version: the A2A-Version query parameter is accepted without the header", async () => {
  const body = await rpc(await send(a2a("nope", {}, { "A2A-Version": null }), makeBaseEnv(), `${ENDPOINT}?A2A-Version=1.0`));
  assert.notEqual(body.error?.code, -32009);
});

test("version: a notification gets 202 even without a version", async () => {
  const response = await send(post({ jsonrpc: "2.0", method: "SendMessage" }, { "A2A-Version": null }));
  assert.equal(response.status, 202);
});

// Params

test("params: params that are not an object are -32602", async () => {
  for (const params of [[], "x", 1, null]) {
    const body = await expectError(await send(a2a("ListTasks", params)), 200, -32602);
    assert.equal(body.error?.data, undefined);
  }
});

test("params: a tenant is -32602 Unknown tenant; an empty one is ignored", async () => {
  const body = await expectError(await send(a2a("ListTasks", { tenant: "acme" })), 200, -32602);
  assert.equal(body.error?.message, "Unknown tenant");
  assert.ok(!JSON.stringify(body).includes("acme"));
  const empty = await rpc(await send(a2a("nope", { tenant: "" })));
  assert.equal(empty.error?.code, -32601);
});

// Transport

for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
  test(`transport: ${method} is 405 with Allow`, async () => {
    const response = await send({ method });
    assert.equal(response.headers.get("Allow"), "POST, OPTIONS");
    const body = await expectError(response, 405, -32600);
    assert.equal("id" in body, false);
  });
}

test("transport: OPTIONS is a 204 preflight allowing the four request headers", async () => {
  const response = await send({ method: "OPTIONS" });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type, Accept, A2A-Version, A2A-Extensions");
});

test("transport: a text/plain body is 415", async () => {
  await expectError(await send(a2a("ListTasks", {}, { "Content-Type": "text/plain" })), 415, -32600);
});

test("transport: no Content-Type is 415", async () => {
  await expectError(await send(a2a("ListTasks", {}, { "Content-Type": null })), 415, -32600);
});

test("transport: application/a2a+json is accepted", async () => {
  const response = await send(a2a("nope", {}, { "Content-Type": "application/a2a+json" }));
  assert.equal(response.status, 200);
});

test("transport: a body of 65537 bytes is 413; 65536 bytes is read", async () => {
  await expectError(await send(post("a".repeat(65537))), 413, -32600);
  const padded = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "nope" });
  const exact = padded + " ".repeat(65536 - padded.length);
  const body = await rpc(await send(post(exact)));
  assert.equal(body.error?.code, -32601);
});

test("transport: a malformed Origin is 403; an https Origin is served", async () => {
  await expectError(await send(a2a("ListTasks", {}, { Origin: "null" })), 403, -32600);
  const response = await send(a2a("nope", {}, { Origin: "https://example.com" }));
  assert.equal(response.status, 200);
});

test("transport: a refusing limiter is 429 with Retry-After, keyed by client IP", async () => {
  const env = makeBaseEnv();
  for (let i = 0; i < 60; i += 1) await send(a2a("nope", {}, { "CF-Connecting-IP": "203.0.113.9" }), env);
  const response = await send(a2a("nope", {}, { "CF-Connecting-IP": "203.0.113.9" }), env);
  assert.equal(response.headers.get("Retry-After"), "60");
  await expectError(response, 429, 429);
  assert.equal(env.PUBLIC_LIMITER.counts.get("203.0.113.9"), 61);
});

test("transport: a throwing limiter fails open", async () => {
  const env = makeBaseEnv();
  env.PUBLIC_LIMITER.throws = true;
  const response = await send(a2a("nope"), env);
  assert.equal(response.status, 200);
});

test("transport: bad JSON is -32700 with id null", async () => {
  const body = await expectError(await send(post("{")), 200, -32700);
  assert.equal(body.id, null);
});

test("transport: a batch is -32600 with id null", async () => {
  const body = await expectError(await send(post([{ jsonrpc: "2.0", id: 1, method: "ListTasks" }])), 200, -32600);
  assert.equal(body.id, null);
  assert.equal(body.error?.message, "Batch requests are not supported");
});

for (const [label, value] of [
  ["an object id", { jsonrpc: "2.0", id: {}, method: "ListTasks" }],
  ["a 129-character id", { jsonrpc: "2.0", id: "x".repeat(129), method: "ListTasks" }],
  ["a null id", { jsonrpc: "2.0", id: null, method: "ListTasks" }],
  ["a wrong jsonrpc", { jsonrpc: "1.0", id: 1, method: "ListTasks" }],
  ["a missing method", { jsonrpc: "2.0", id: 1 }],
  ["a number body", 1],
] as const) {
  test(`transport: ${label} is -32600 with id null`, async () => {
    const body = await expectError(await send(post(JSON.stringify(value))), 200, -32600);
    assert.equal(body.id, null);
  });
}

test("transport: a 128-character string id and a number id are answered with that id", async () => {
  const long = "x".repeat(128);
  assert.equal((await rpc(await send(post({ jsonrpc: "2.0", id: long, method: "nope" })))).id, long);
  assert.equal((await rpc(await send(post({ jsonrpc: "2.0", id: 7, method: "nope" })))).id, 7);
});

test("transport: a body without id is 202 with no body", async () => {
  const response = await send(post({ jsonrpc: "2.0", method: "SendMessage", params: {} }));
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
});

// Every response

test("every JSON response: application/json, CORS *, no-store, nosniff", async () => {
  const requests: RequestInit[] = [
    a2a("ListTasks"),
    a2a("nope"),
    a2a("ListTasks", {}, { "A2A-Version": null }),
    { method: "GET" },
    post("{"),
    a2a("ListTasks", {}, { "Content-Type": "text/plain" }),
    post("a".repeat(65537)),
  ];
  for (const init of requests) {
    const response = await send(init);
    assert.equal(response.headers.get("Content-Type"), "application/json");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
});
