// QA, iteration 5: inputs the main A2A tests skip. Each test drives the
// endpoint through route() (or the emulated site for routing) and pins what
// ARCHITECTURE I5.5 and I5.6 say it must answer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { COMPANY } from "./facts.ts";
import { route } from "./router.ts";
import { makeBaseEnv, makeDeps } from "./testing.ts";
import { site } from "../../tests/support/static-site.ts";

const SITE = "https://burrowsapps.com";
const ENDPOINT = `${SITE}/a2a`;
const HEADERS = { "Content-Type": "application/json", "A2A-Version": "1.0" };

type Rpc = {
  id?: unknown;
  result?: Record<string, any>;
  error?: { code: number; message: string; data?: any[] };
};

const send = (init: RequestInit, url = ENDPOINT): Promise<Response> =>
  route(new Request(url, init), makeBaseEnv(), makeDeps());

const raw = (body: string, headers: Record<string, string> = {}): RequestInit =>
  ({ method: "POST", headers: { ...HEADERS, ...headers }, body });

const call = (body: Record<string, unknown>, headers: Record<string, string> = {}): RequestInit =>
  raw(JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }), headers);

const message = (parts: unknown, extra: Record<string, unknown> = {}, params: Record<string, unknown> = {}): RequestInit =>
  call({ method: "SendMessage", params: { message: { messageId: "m-1", role: "ROLE_USER", parts, ...extra }, ...params } });

const ask = (text: string, extra: Record<string, unknown> = {}, params: Record<string, unknown> = {}): RequestInit =>
  message([{ text }], extra, params);

const rpc = async (response: Response): Promise<Rpc> => JSON.parse(await response.text());

const skillOf = async (init: RequestInit): Promise<string> => {
  const body = await rpc(await send(init));
  assert.ok(body.result, JSON.stringify(body));
  return body.result.message.metadata.skillId;
};

const codeOf = async (init: RequestInit): Promise<number | undefined> => (await rpc(await send(init))).error?.code;

test("transport: HEAD and PATCH are 405 with Allow, like GET", async () => {
  for (const method of ["HEAD", "PATCH"]) {
    const response = await send({ method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("Allow"), "POST, OPTIONS");
  }
});

test("transport: text/json and a missing Content-Type are 415; a charset parameter is fine", async () => {
  assert.equal((await send(raw("{}", { "Content-Type": "text/json" }))).status, 415);
  const ok = await send(call({ method: "ListTasks" }, { "Content-Type": "application/json; charset=utf-8" }));
  assert.equal(ok.status, 200);
  assert.ok((await rpc(ok)).result);
});

test("transport: an empty body is -32700 and an empty batch is -32600, both with id null", async () => {
  const empty = await rpc(await send(raw("")));
  assert.equal(empty.error?.code, -32700);
  assert.equal(empty.id, null);
  const batch = await rpc(await send(raw("[]")));
  assert.equal(batch.error?.code, -32600);
  assert.equal(batch.id, null);
});

test("transport: a body of 65537 bytes made of two-byte characters is 413", async () => {
  // 32769 characters, 65538 bytes: the cap counts bytes, not characters.
  assert.equal((await send(raw("é".repeat(32769)))).status, 413);
});

test("transport: id null or boolean is -32600; a fractional number id is answered", async () => {
  for (const id of [null, true]) {
    const body = await rpc(await send(raw(JSON.stringify({ jsonrpc: "2.0", id, method: "ListTasks" }))));
    assert.equal(body.error?.code, -32600, String(id));
    assert.equal(body.id, null);
  }
  const body = await rpc(await send(raw(JSON.stringify({ jsonrpc: "2.0", id: 1.5, method: "ListTasks" }))));
  assert.equal(body.id, 1.5);
  assert.ok(body.result);
});

test("transport: jsonrpc other than 2.0 or a non-string method is -32600", async () => {
  for (const body of [{ jsonrpc: "1.0", id: 1, method: "ListTasks" }, { jsonrpc: "2.0", id: 1, method: 5 }, { id: 1, method: "ListTasks" }]) {
    assert.equal(await codeOf(raw(JSON.stringify(body))), -32600, JSON.stringify(body));
  }
});

test("transport: Origin null (sandboxed frames) is refused like any non-http origin", async () => {
  assert.equal((await send(call({ method: "ListTasks" }, { Origin: "null" }))).status, 403);
});

test("version: a list, a v prefix, and leading zeros are refused", async () => {
  for (const version of ["1.0, 0.3", "v1.0", "01.00", "1", "1.0.0.0"]) {
    assert.equal(await codeOf(call({ method: "ListTasks" }, { "A2A-Version": version })), -32009, version);
  }
});

test("version: the header wins over the query parameter", async () => {
  const body = call({ method: "ListTasks" }, { "A2A-Version": "0.3" });
  const response = await send(body, `${ENDPOINT}?A2A-Version=1.0`);
  assert.equal((await rpc(response)).error?.code, -32009);
});

test("methods: names that exist on Object.prototype are -32601", async () => {
  for (const method of ["toString", "constructor", "__proto__", "hasOwnProperty", "sendmessage", "message/send"]) {
    assert.equal(await codeOf(call({ method })), -32601, method);
  }
});

test("SendMessage: skillId of the wrong type falls through to the text", async () => {
  for (const skillId of [3, ["services"], { id: "services" }, null, true]) {
    assert.equal(await skillOf(ask("services", { metadata: { skillId } })), "services", JSON.stringify(skillId));
  }
  assert.equal(await skillOf(ask("hello", { metadata: "services" })), "help");
});

test("SendMessage: prototype names are not skills, as skillId or as text", async () => {
  for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    assert.equal(await skillOf(ask(name)), "help", name);
    assert.equal(await skillOf(ask("hello", { metadata: { skillId: name } })), "help", name);
  }
});

test("SendMessage: request metadata.skillId is used when the message has none", async () => {
  assert.equal(await skillOf(ask("hello", {}, { metadata: { skillId: "contact-options" } })), "contact-options");
});

test("SendMessage: the exact id is matched case-insensitively and trimmed", async () => {
  assert.equal(await skillOf(ask("  SERVICES  ")), "services");
  assert.equal(await skillOf(ask("Company-Profile")), "company-profile");
});

test("SendMessage: empty and whitespace-only text get the help reply", async () => {
  for (const text of ["", "   ", "\n\t"]) assert.equal(await skillOf(ask(text)), "help", JSON.stringify(text));
});

test("SendMessage: unicode and 60,000-character text are answered without echo", async () => {
  const marker = "Zq9é你好🙂";
  for (const text of [`¿Quién es? ${marker}`, `${marker}${"x".repeat(60000)}`]) {
    const response = await send(ask(text));
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.ok(!body.includes(marker), "the reply repeats the user's text");
    assert.ok(!body.includes("xxxxxxxxxx"), "the reply repeats the user's text");
  }
});

test("SendMessage: no error message repeats a request value", async () => {
  const marker = "QAMARKER7731";
  const cases: RequestInit[] = [
    call({ method: marker }),
    call({ method: "ListTasks" }, { "A2A-Version": marker }),
    call({ method: "ListTasks", params: { tenant: marker } }),
    call({ method: "GetTask", params: { id: marker } }),
    ask("hi", { contextId: `${marker} bad` }),
    ask("hi", { taskId: marker }),
    ask("hi", {}, { configuration: { acceptedOutputModes: [`image/${marker}`] } }),
    message([{ text: "hi" }, { data: { marker } }]),
    message([{ text: "hi", mediaType: `text/${marker}` }]),
    call({ method: "SendMessage", params: { message: { messageId: "m", role: marker, parts: [{ text: "hi" }] } } }),
    raw(`{"jsonrpc":"2.0","id":1,"method":"${marker}"`),
    raw(JSON.stringify([{ jsonrpc: "2.0", id: 1, method: marker }])),
  ];
  for (const init of cases) {
    const body = await (await send(init)).text();
    assert.ok(body.includes('"error"'), body);
    assert.ok(!body.includes(marker), body);
  }
});

test("SendMessage: a part with no content, or a 0.3-style file part, is -32602", async () => {
  assert.equal(await codeOf(message([{}])), -32602);
  assert.equal(await codeOf(message([{ kind: "file", file: { uri: "https://example.com/a.png" } }])), -32602);
  assert.equal(await codeOf(message([{ kind: "text", text: "hi" }, "text"])), -32602);
});

test("SendMessage: text next to a data, url, or raw part is -32005", async () => {
  for (const other of [{ data: { a: 1 } }, { url: "https://example.com/a.png" }, { raw: "aGk=" }]) {
    assert.equal(await codeOf(message([{ text: "services" }, other])), -32005, JSON.stringify(other));
  }
});

test("SendMessage: a null or numeric text is -32602, not -32005", async () => {
  assert.equal(await codeOf(message([{ text: null }])), -32602);
  assert.equal(await codeOf(message([{ text: 5 }])), -32602);
});

test("SendMessage (B18): text/plain with a charset or in capitals is a text part", async () => {
  for (const type of ["text/plain; charset=utf-8", "TEXT/PLAIN", " text/plain "]) {
    assert.equal(await skillOf(message([{ text: "services", mediaType: type }])), "services", type);
  }
  for (const type of ["text/markdown", "text/plainx", 5]) {
    assert.equal(await codeOf(message([{ text: "services", mediaType: type }])), -32005, String(type));
  }
});

test("SendMessage: configuration null is no configuration; a non-object one is -32602", async () => {
  assert.equal(await skillOf(ask("services", {}, { configuration: null })), "services");
  assert.equal(await codeOf(ask("services", {}, { configuration: "x" })), -32602);
  assert.equal(await codeOf(ask("services", {}, { configuration: { acceptedOutputModes: "text/plain" } })), -32602);
});

test("SendMessage: acceptedOutputModes matches parameters and case, and ignores non-strings", async () => {
  const body = await rpc(await send(ask("services", {}, { configuration: { acceptedOutputModes: [5, "Application/JSON; charset=utf-8"] } })));
  assert.deepEqual(body.result?.message.parts.map((part: { mediaType: string }) => part.mediaType), ["application/json"]);
});

test("SendMessage: a non-string contextId is -32602", async () => {
  for (const contextId of [5, {}, "", "a".repeat(129), "has space"]) {
    assert.equal(await codeOf(ask("hi", { contextId })), -32602, JSON.stringify(contextId));
  }
});

test("SendMessage: each skill's data is what /api/v1 serves for the same facts", async () => {
  const api = async (path: string) => JSON.parse(await (await route(new Request(`${SITE}/api/v1/${path}`), makeBaseEnv(), makeDeps())).text());
  const data = async (skillId: string) => (await rpc(await send(ask("x", { metadata: { skillId } })))).result?.message.parts[1].data;
  const company = await api("company");
  const { services, contact, ...profile } = company;
  assert.deepEqual(await data("company-profile"), profile);
  assert.deepEqual(await data("services"), await api("services"));
  assert.deepEqual((await data("services")).services, services);
  assert.deepEqual(await data("contact-options"), contact);
  assert.equal(profile.name, COMPANY.name);
});

test("SendMessage: the ARD representative queries reach a skill, not the help reply", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../.well-known/ard.json", import.meta.url), "utf8"));
  const entry = manifest.entries.find((candidate: { type: string }) => candidate.type === "application/a2a-agent-card+json");
  const expected = ["services", "contact-options"];
  assert.deepEqual(await Promise.all(entry.representativeQueries.map((query: string) => skillOf(ask(query)))), expected);
});

test("SendMessage: a message naming two skills gets the first rule's skill only", async () => {
  assert.equal(await skillOf(ask("Who founded the company, and how do I contact them?")), "contact-options");
  assert.equal(await skillOf(ask("Tell me about your Android apps")), "services");
});

test("routing: /a2a/, /A2A, and the legacy /.well-known/agent.json are not the agent", async () => {
  for (const [method, path] of [["POST", "/a2a/"], ["POST", "/A2A"], ["GET", "/a2a/"], ["GET", "/.well-known/agent.json"]]) {
    const response = await site(new Request(`${SITE}${path}`, { method, headers: HEADERS, body: method === "POST" ? "{}" : undefined }));
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.match(response.headers.get("Content-Type") ?? "", /^text\/html/);
  }
});

test("routing: the card through the emulated site is application/json, CORS *, an hour of cache", async () => {
  const response = await site(new Request(`${SITE}/.well-known/agent-card.json`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/json");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});
