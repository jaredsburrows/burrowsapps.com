import { test } from "node:test";
import assert from "node:assert/strict";
import { COMPANY, SERVICES, contactOptions } from "./facts.ts";
import { MODERN_VERSION, SERVER, SUPPORTED_VERSIONS, TOOLS } from "./mcp.ts";
import { route } from "./router.ts";
import { makeBaseEnv, makeDeps } from "./testing.ts";
import type { TestEnv } from "./testing.ts";

const ENDPOINT = "https://burrowsapps.com/mcp";
const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

type Rpc = { jsonrpc: string; id?: string | number; result?: Record<string, any>; error?: { code: number; message: string; data?: any } };

const send = async (init: RequestInit, env: TestEnv = makeBaseEnv()): Promise<Response> =>
  route(new Request(ENDPOINT, init), env, makeDeps());

const post = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

type ModernOptions = {
  id?: string | number | null;
  params?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  headers?: Record<string, string | null>;
};

// A 2026-07-28 request: _meta in the body plus the three headers.
const modern = (method: string, options: ModernOptions = {}): RequestInit => {
  const meta = options.meta ?? { [META_VERSION]: MODERN_VERSION, [META_CAPABILITIES]: {} };
  const params = { ...(options.params ?? {}), _meta: meta };
  const body: Record<string, unknown> = { jsonrpc: "2.0", method, params };
  if (options.id !== null) body.id = options.id ?? 1;
  const headers: Record<string, string> = { "MCP-Protocol-Version": MODERN_VERSION, "Mcp-Method": method };
  if (method === "tools/call" && typeof options.params?.name === "string") headers["Mcp-Name"] = options.params.name;
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  return post(body, headers);
};

const rpc = async (response: Response): Promise<Rpc> => JSON.parse(await response.text());

const expectError = async (response: Response, status: number, code: number): Promise<Rpc> => {
  assert.equal(response.status, status);
  const body = await rpc(response);
  assert.equal(body.error?.code, code, JSON.stringify(body));
  assert.equal(body.result, undefined);
  return body;
};

const expectComplete = async (response: Response): Promise<Record<string, any>> => {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await rpc(response);
  assert.equal(body.jsonrpc, "2.0");
  assert.ok(body.result, JSON.stringify(body));
  assert.equal(body.result.resultType, "complete");
  assert.deepEqual(body.result._meta, { [META_SERVER_INFO]: { name: SERVER.name, version: SERVER.version } });
  return body.result;
};

// Modern

test("modern: server/discover lists the versions, capabilities, and server info", async () => {
  const result = await expectComplete(await send(modern("server/discover")));
  assert.deepEqual(result.supportedVersions, SUPPORTED_VERSIONS);
  assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
  assert.equal(typeof result.instructions, "string");
  assert.equal(result.ttlMs, 3600000);
  assert.equal(result.cacheScope, "public");
});

test("modern: tools/list returns the three tools with ttlMs and cacheScope", async () => {
  const result = await expectComplete(await send(modern("tools/list")));
  assert.deepEqual(result.tools, TOOLS);
  assert.deepEqual(result.tools.map((tool: { name: string }) => tool.name), ["get_company_profile", "list_services", "get_contact_options"]);
  assert.equal(result.ttlMs, 3600000);
  assert.equal(result.cacheScope, "public");
  for (const tool of result.tools) {
    assert.deepEqual(tool.inputSchema, { type: "object", additionalProperties: false });
    assert.equal(tool.annotations.readOnlyHint, true);
  }
});

const EXPECTED: Record<string, unknown> = {
  get_company_profile: { ...COMPANY },
  list_services: { services: SERVICES },
  get_contact_options: contactOptions(false),
};

for (const [name, data] of Object.entries(EXPECTED)) {
  test(`modern: tools/call ${name} returns the facts as structured content and text`, async () => {
    const result = await expectComplete(await send(modern("tools/call", { params: { name, arguments: {} } })));
    assert.equal(result.isError, false);
    assert.deepEqual(result.structuredContent, data);
    assert.equal(result.content[0].type, "text");
    assert.deepEqual(JSON.parse(result.content[0].text), data);
  });
}

test("modern: tools/call without an arguments member works", async () => {
  const result = await expectComplete(await send(modern("tools/call", { params: { name: "list_services" } })));
  assert.equal(result.isError, false);
});

test("modern: arguments the tool does not take give isError", async () => {
  const result = await expectComplete(await send(modern("tools/call", { params: { name: "list_services", arguments: { x: 1 } } })));
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
});

test("modern: missing clientCapabilities is 400 with -32602", async () => {
  await expectError(await send(modern("tools/list", { meta: { [META_VERSION]: MODERN_VERSION } })), 400, -32602);
});

test("modern: missing MCP-Protocol-Version header is 400 with -32020", async () => {
  await expectError(await send(modern("tools/list", { headers: { "MCP-Protocol-Version": null } })), 400, -32020);
});

test("modern: header and body versions that differ are 400 with -32020", async () => {
  await expectError(await send(modern("tools/list", { headers: { "MCP-Protocol-Version": "2026-08-01" } })), 400, -32020);
});

test("modern: an unsupported version is 400 with -32022 and the supported list", async () => {
  const body = await expectError(
    await send(modern("tools/list", {
      meta: { [META_VERSION]: "1900-01-01", [META_CAPABILITIES]: {} },
      headers: { "MCP-Protocol-Version": "1900-01-01" },
    })),
    400,
    -32022,
  );
  assert.deepEqual(body.error?.data, { supported: SUPPORTED_VERSIONS, requested: "1900-01-01" });
});

test("modern: a wrong Mcp-Method header is 400 with -32020", async () => {
  await expectError(await send(modern("tools/list", { headers: { "Mcp-Method": "server/discover" } })), 400, -32020);
});

test("modern: a missing Mcp-Method header is 400 with -32020", async () => {
  await expectError(await send(modern("tools/list", { headers: { "Mcp-Method": null } })), 400, -32020);
});

test("modern: tools/call with a missing Mcp-Name header is 400 with -32020", async () => {
  await expectError(await send(modern("tools/call", { params: { name: "list_services" }, headers: { "Mcp-Name": null } })), 400, -32020);
});

test("modern: tools/call with a wrong Mcp-Name header is 400 with -32020", async () => {
  await expectError(await send(modern("tools/call", { params: { name: "list_services" }, headers: { "Mcp-Name": "get_company_profile" } })), 400, -32020);
});

test("modern: tools/call with a base64-wrapped Mcp-Name that matches succeeds", async () => {
  const wrapped = `=?base64?${btoa("list_services")}?=`;
  const result = await expectComplete(await send(modern("tools/call", { params: { name: "list_services" }, headers: { "Mcp-Name": wrapped } })));
  assert.equal(result.isError, false);
});

test("modern: tools/call with an undecodable base64 Mcp-Name is 400 with -32020", async () => {
  await expectError(await send(modern("tools/call", { params: { name: "list_services" }, headers: { "Mcp-Name": "=?base64?***?=" } })), 400, -32020);
});

test("modern: an unknown tool is 400 with -32602 and the name is not echoed", async () => {
  const response = await send(modern("tools/call", { params: { name: "delete_everything_marker" } }));
  const text = await response.clone().text();
  assert.ok(!text.includes("delete_everything_marker"));
  await expectError(response, 400, -32602);
});

test("modern: an unknown method is 404 with -32601", async () => {
  await expectError(await send(modern("resources/list")), 404, -32601);
});

test("modern: initialize sent in modern form is 404 with -32601", async () => {
  await expectError(await send(modern("initialize")), 404, -32601);
});

test("modern: a notification is 202 with an empty body", async () => {
  const response = await send(modern("notifications/cancelled", { id: null }));
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "");
});

test("modern: errors carry the request id", async () => {
  const body = await expectError(await send(modern("resources/list", { id: "abc" })), 404, -32601);
  assert.equal(body.id, "abc");
});

// Transport

for (const method of ["GET", "DELETE"]) {
  test(`transport: ${method} is 405 with Allow`, async () => {
    const response = await send({ method });
    assert.equal(response.headers.get("Allow"), "POST, OPTIONS");
    const body = await expectError(response, 405, -32600);
    assert.equal("id" in body, false);
  });
}

test("transport: OPTIONS is a preflight that allows the MCP headers", async () => {
  const response = await send({ method: "OPTIONS" });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assert.equal(
    response.headers.get("Access-Control-Allow-Headers"),
    "Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id",
  );
});

for (const origin of ["null", "not a url", "ftp://example.com"]) {
  test(`transport: Origin ${JSON.stringify(origin)} is 403`, async () => {
    await expectError(await send(modern("tools/list", { headers: { Origin: origin } })), 403, -32600);
  });
}

test("transport: a well-formed foreign Origin is served", async () => {
  await expectComplete(await send(modern("tools/list", { headers: { Origin: "https://example.com" } })));
});

test("transport: a wrong content type is 415", async () => {
  await expectError(await send(modern("tools/list", { headers: { "Content-Type": "text/plain" } })), 415, -32600);
});

test("transport: a 70,000-byte body is 413", async () => {
  await expectError(await send(post({ jsonrpc: "2.0", id: 1, method: "tools/list", pad: "a".repeat(70000) })), 413, -32600);
});

test("transport: invalid JSON is 400 with -32700", async () => {
  await expectError(await send(post("{not json")), 400, -32700);
});

test("transport: a batch array is 400 with -32600", async () => {
  await expectError(await send(post([{ jsonrpc: "2.0", id: 1, method: "tools/list" }])), 400, -32600);
});

for (const [label, message] of [
  ["a wrong jsonrpc version", { jsonrpc: "1.0", id: 1, method: "tools/list" }],
  ["a missing method", { jsonrpc: "2.0", id: 1 }],
  ["an object id", { jsonrpc: "2.0", id: {}, method: "tools/list" }],
  ["a null id", { jsonrpc: "2.0", id: null, method: "tools/list" }],
] as const) {
  test(`transport: ${label} is 400 with -32600`, async () => {
    await expectError(await send(post(message)), 400, -32600);
  });
}

test("transport: a refusing limiter is 429 with Retry-After", async () => {
  const env = makeBaseEnv();
  for (let i = 0; i < 60; i += 1) await env.PUBLIC_LIMITER.limit({ key: "unknown" });
  const response = await send(modern("tools/list"), env);
  assert.equal(response.headers.get("Retry-After"), "60");
  await expectError(response, 429, 429);
});
