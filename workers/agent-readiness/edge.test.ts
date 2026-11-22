// Edge cases for the router and the MCP endpoint that the per-module tests
// leave out: odd paths, other hosts, every method on every owned path, and
// malformed JSON-RPC.

import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNED_EXACT, route } from "./router.ts";
import { makeBaseEnv, makeDeps } from "./testing.ts";

const SITE = "https://burrowsapps.com";
const send = (request: Request) => {
  const deps = makeDeps();
  return route(request, makeBaseEnv(), deps).then((response) => ({ response, deps }));
};

test("paths that only look owned go to the origin untouched", async () => {
  for (const path of ["//", "/API/v1/company", "/api/v1company", "/api/v1x", "/mcpx", "/mcp%2F", "/a2ax", "/a2a%2F", "/api/v1%2Fcompany", "/.well-known/api-catalog/", "/.well-known/API-catalog", "/api/contact", "/api/"]) {
    const { response, deps } = await send(new Request(SITE + path));
    assert.equal(deps.originCalls.length, 1, path);
    assert.equal(response.status, 200, path);
    assert.ok((response.headers.get("Content-Type") ?? "").startsWith("text/html"), path);
  }
});

test("another host is never answered by the Worker", async () => {
  for (const host of ["https://www.burrowsapps.com", "https://example.com"]) {
    const { deps } = await send(new Request(`${host}/api/v1/company`));
    assert.equal(deps.originCalls.length, 1, host);
  }
});

test("every owned path answers GET, HEAD, and OPTIONS, and refuses POST, PUT, and DELETE with Allow", async () => {
  for (const path of OWNED_EXACT.filter((p) => p !== "/mcp" && p !== "/a2a")) {
    for (const method of ["GET", "HEAD"]) {
      const { response, deps } = await send(new Request(SITE + path, { method }));
      assert.equal(response.status, 200, `${method} ${path}`);
      assert.equal(deps.originCalls.length, 0, `${method} ${path}`);
    }
    assert.equal((await send(new Request(SITE + path, { method: "OPTIONS" }))).response.status, 204, path);
    for (const method of ["POST", "PUT", "DELETE"]) {
      const { response } = await send(new Request(SITE + path, { method }));
      assert.equal(response.status, 405, `${method} ${path}`);
      assert.ok(response.headers.get("Allow"), `${method} ${path}`);
    }
  }
});

test("unknown subpaths under the owned prefixes are a JSON 404, never the origin", async () => {
  for (const path of ["/api/v1/nope", "/api/v1//company", "/api/v1/company/", "/mcp/", "/mcp/nope"]) {
    const { response, deps } = await send(new Request(SITE + path));
    assert.equal(response.status, 404, path);
    assert.equal(deps.originCalls.length, 0, path);
  }
});

const rpc = (body: string, headers: Record<string, string> = {}) =>
  send(new Request(`${SITE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body }));

test("mcp: malformed JSON-RPC is rejected with a JSON-RPC error and a 400", async () => {
  for (const body of ["{bad", "", "null", "[]", '[{"jsonrpc":"2.0","id":1,"method":"ping"}]', '{"jsonrpc":"2.0","id":null,"method":"ping"}', '{"jsonrpc":"2.0","id":{},"method":"ping"}', '{"jsonrpc":"1.0","id":1,"method":"ping"}']) {
    const { response } = await rpc(body);
    assert.equal(response.status, 400, body);
    assert.ok((await response.json()).error, body);
  }
});

test("mcp: a notification gets 202 and no body, with or without a version header", async () => {
  for (const headers of [{}, { "MCP-Protocol-Version": "2025-11-25" }]) {
    const { response } = await rpc('{"jsonrpc":"2.0","method":"notifications/initialized"}', headers);
    assert.equal(response.status, 202);
    assert.equal(await response.text(), "");
  }
});

test("mcp: legacy tool calls with bad names or arguments", async () => {
  const call = async (params: unknown) =>
    (await rpc(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params }), { "MCP-Protocol-Version": "2025-11-25" })).response.json();
  for (const name of ["zzz", 5, "__proto__", "constructor"]) assert.equal((await call({ name })).error.code, -32602, String(name));
  for (const args of ["x", null, [], { a: 1 }]) {
    const result = (await call({ name: "list_services", arguments: args })).result;
    assert.equal(result.isError, true, JSON.stringify(args));
  }
  assert.equal((await call({ name: "list_services", arguments: {} })).result.isError, false);
});

test("mcp: GET, DELETE, and an oversized body", async () => {
  for (const method of ["GET", "DELETE", "HEAD"]) {
    const { response } = await send(new Request(`${SITE}/mcp`, { method }));
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("Allow"), "POST, OPTIONS", method);
  }
  const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { x: "a".repeat(70000) } });
  assert.equal((await rpc(big)).response.status, 413);
});
