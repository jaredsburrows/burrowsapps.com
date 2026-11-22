import { test } from "node:test";
import assert from "node:assert/strict";
import { A2A_VERSION, AGENT_CARD, AGENT_CARD_PATH, ANSWERS, SKILLS } from "./a2a.ts";
import { COMPANY, SERVICES, contactOptions } from "./facts.ts";
import { resolveSiteUrl } from "../../tests/support/site-map.ts";
import { route } from "./router.ts";
import { makeBaseEnv, makeDeps } from "./testing.ts";
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
  route(new Request(url, init), env, makeDeps());

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
  for (const { url } of value.supportedInterfaces) assert.equal(resolveSiteUrl(url), "worker", url);
  for (const url of [value.provider.url, value.iconUrl, value.documentationUrl]) {
    assert.equal(resolveSiteUrl(url), "file", url);
  }
});

// SendMessage

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type MessageOptions = { metadata?: unknown; contextId?: unknown; parts?: unknown; extra?: Record<string, unknown> };

const userMessage = (text: string, options: MessageOptions = {}): Record<string, unknown> => ({
  messageId: "m-1",
  role: "ROLE_USER",
  parts: options.parts ?? [{ text }],
  ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  ...(options.contextId === undefined ? {} : { contextId: options.contextId }),
  ...options.extra,
});

const say = (text: string, options: MessageOptions = {}, params: Record<string, unknown> = {}): RequestInit =>
  a2a("SendMessage", { message: userMessage(text, options), ...params });

// The agent's message from a successful SendMessage, with its shape checked.
const expectMessage = async (response: Response): Promise<Record<string, any>> => {
  assert.equal(response.status, 200);
  const body = await rpc(response);
  assert.equal(body.error, undefined, JSON.stringify(body));
  assert.equal(body.id, 1);
  assert.deepEqual(Object.keys(body.result ?? {}), ["message"], "a message, never a task");
  const message = body.result?.message;
  assert.equal(message.role, "ROLE_AGENT");
  assert.match(message.messageId, UUID);
  assert.equal(typeof message.contextId, "string");
  assert.equal(message.taskId, undefined);
  return message;
};

const EXPECTED: Record<string, unknown> = {
  "company-profile": { ...COMPANY },
  services: { services: SERVICES },
  "contact-options": contactOptions(),
};

const expectSkill = (message: Record<string, any>, skillId: string): void => {
  assert.deepEqual(message.metadata, { skillId });
  assert.equal(message.parts.length, 2);
  assert.equal(message.parts[0].mediaType, "text/plain");
  assert.equal(typeof message.parts[0].text, "string");
  assert.equal(message.parts[1].mediaType, "application/json");
  assert.deepEqual(message.parts[1].data, EXPECTED[skillId]);
};

for (const skill of SKILLS) {
  test(`SendMessage: metadata.skillId ${skill.id} answers that skill with its facts`, async () => {
    expectSkill(await expectMessage(await send(say("hello", { metadata: { skillId: skill.id } }))), skill.id);
  });

  test(`SendMessage: request metadata.skillId ${skill.id} answers that skill`, async () => {
    expectSkill(await expectMessage(await send(say("hello", {}, { metadata: { skillId: skill.id } }))), skill.id);
  });

  test(`SendMessage: the text "${skill.id}" answers that skill`, async () => {
    expectSkill(await expectMessage(await send(say(` ${skill.id.toUpperCase()} `))), skill.id);
  });

  for (const example of skill.examples) {
    test(`SendMessage: the card example "${example}" routes to ${skill.id}`, async () => {
      expectSkill(await expectMessage(await send(say(example))), skill.id);
    });
  }
}

for (const [text, skillId] of [
  ["What's Burrows Applications?", "company-profile"],
  ["What\u2019s Burrows Applications?", "company-profile"],
  ["What do you do?", "company-profile"],
  ["what  do\tyou do", "company-profile"],
  ["What do you make?", "services"],
  ["Are you hiring?", "help"],
  ["I want to reach more users with my app", "services"],
  ["Can I reach you about a project?", "contact-options"],
  ["How do I get in touch?", "contact-options"],
] as const) {
  test(`SendMessage: "${text}" routes to ${skillId}`, async () => {
    const message = await expectMessage(await send(say(text)));
    assert.deepEqual(message.metadata, { skillId });
  });
}

test("SendMessage: message metadata wins over request metadata", async () => {
  const message = await expectMessage(await send(say("hello", { metadata: { skillId: "services" } }, { metadata: { skillId: "contact-options" } })));
  expectSkill(message, "services");
});

test("SendMessage: an unknown skillId falls through to the text", async () => {
  expectSkill(await expectMessage(await send(say("how do I contact you", { metadata: { skillId: "nope" } }))), "contact-options");
});

test("SendMessage: text parts are joined before the rules run", async () => {
  const message = await expectMessage(await send(say("", { parts: [{ text: "Do you build" }, { text: "Android apps?", mediaType: "text/plain" }] })));
  expectSkill(message, "services");
});

test("SendMessage: the text part is rendered from the same facts as the data", async () => {
  const profile = await expectMessage(await send(say("company-profile")));
  assert.equal(profile.parts[0].text, `${COMPANY.name}: ${COMPANY.description} Founded by ${COMPANY.founder}. Website: ${COMPANY.website}`);
  const services = await expectMessage(await send(say("services")));
  for (const service of SERVICES) assert.ok(services.parts[0].text.includes(`- ${service.name}: ${service.description}`));
  const contact = await expectMessage(await send(say("contact-options")));
  const options = contactOptions() as Record<string, any>;
  for (const value of [options.form, options.email, options.linkedin, options.x, String(options.formFields.message.maxLength)]) {
    assert.ok(contact.parts[0].text.includes(value), value);
  }
  assert.ok(contact.parts[0].text.endsWith("This agent cannot send a message for you."));
});

test("SendMessage: text with no keyword gets the help reply listing the skills", async () => {
  const message = await expectMessage(await send(say("hello")));
  assert.deepEqual(message.metadata, { skillId: "help" });
  for (const skill of SKILLS) assert.ok(message.parts[0].text.includes(`- ${skill.id}: ${skill.name}`), skill.id);
  assert.deepEqual(message.parts[1].data, {
    skills: SKILLS.map(({ id, name, description }) => ({ id, name, description })),
  });
});

test("SendMessage: the reply never repeats the user's text", async () => {
  const marker = `zq${"x9".repeat(40)}unique`;
  for (const text of [`<script>alert(1)</script> ${marker}`, `contact <script> ${marker}`, `services ${marker}`]) {
    const response = await send(say(text));
    const raw = await response.clone().text();
    await expectMessage(response);
    assert.ok(!raw.includes("<script>"), text);
    assert.ok(!raw.includes(marker), text);
  }
});

test("SendMessage: taskId null is no taskId", async () => {
  expectSkill(await expectMessage(await send(say("services", { extra: { taskId: null } }))), "services");
});

test("SendMessage: contextId null is no contextId, and a fresh UUID is used", async () => {
  const message = await expectMessage(await send(say("services", { extra: { contextId: null } })));
  assert.match(message.contextId, UUID);
});

test("SendMessage: a supplied contextId is returned unchanged", async () => {
  const message = await expectMessage(await send(say("hello", { contextId: "ctx-1.a:b_c" })));
  assert.equal(message.contextId, "ctx-1.a:b_c");
});

test("SendMessage: without a contextId a fresh UUID is used each time", async () => {
  const first = await expectMessage(await send(say("hello")));
  const second = await expectMessage(await send(say("hello")));
  assert.match(first.contextId, UUID);
  assert.notEqual(first.contextId, second.contextId);
  assert.notEqual(first.messageId, second.messageId);
});

for (const contextId of ["", "has space", "x".repeat(129), "<b>", 5]) {
  test(`SendMessage: contextId ${JSON.stringify(contextId).slice(0, 20)} is -32602`, async () => {
    await expectError(await send(say("hello", { contextId })), 200, -32602);
  });
}

test("SendMessage: acceptedOutputModes text/plain gives only the text part", async () => {
  const message = await expectMessage(await send(say("services", {}, { configuration: { acceptedOutputModes: ["text/plain"] } })));
  assert.deepEqual(message.parts.map((part: { mediaType: string }) => part.mediaType), ["text/plain"]);
});

test("SendMessage: acceptedOutputModes application/json gives only the data part", async () => {
  const message = await expectMessage(await send(say("services", {}, { configuration: { acceptedOutputModes: ["application/json"] } })));
  assert.deepEqual(message.parts, [{ data: { services: SERVICES }, mediaType: "application/json" }]);
});

test("SendMessage: an empty acceptedOutputModes gives both parts", async () => {
  const message = await expectMessage(await send(say("services", {}, { configuration: { acceptedOutputModes: [] } })));
  assert.equal(message.parts.length, 2);
});

const modesOf = async (accepted: unknown[]): Promise<string[]> => {
  const message = await expectMessage(await send(say("services", {}, { configuration: { acceptedOutputModes: accepted } })));
  return message.parts.map((part: { mediaType: string }) => part.mediaType);
};

test("SendMessage: acceptedOutputModes */* gives both parts", async () => {
  assert.deepEqual(await modesOf(["*/*"]), ["text/plain", "application/json"]);
});

test("SendMessage: acceptedOutputModes text/* gives only the text part; application/* only the data part", async () => {
  assert.deepEqual(await modesOf(["text/*"]), ["text/plain"]);
  assert.deepEqual(await modesOf(["Application/*"]), ["application/json"]);
});

test("SendMessage: wildcards that match neither part are still -32005", async () => {
  for (const accepted of [["image/*"], ["text/html", "image/*"], ["*/plain"]]) {
    await expectA2aError(
      await send(say("services", {}, { configuration: { acceptedOutputModes: accepted } })),
      -32005,
      "CONTENT_TYPE_NOT_SUPPORTED",
    );
  }
});

test("SendMessage: acceptedOutputModes image/png is -32005", async () => {
  await expectA2aError(
    await send(say("services", {}, { configuration: { acceptedOutputModes: ["image/png"] } })),
    -32005,
    "CONTENT_TYPE_NOT_SUPPORTED",
  );
});

test("SendMessage: returnImmediately and historyLength are accepted and change nothing", async () => {
  const message = await expectMessage(await send(say("services", {}, { configuration: { returnImmediately: true, historyLength: 5 } })));
  expectSkill(message, "services");
});

// SendMessage refusals

const INVALID: readonly (readonly [string, Record<string, unknown>])[] = [
  ["no message", {}],
  ["a message that is not an object", { message: "hi" }],
  ["role ROLE_AGENT", { message: { ...userMessage("hi"), role: "ROLE_AGENT" } }],
  ["no role", { message: { messageId: "m-1", parts: [{ text: "hi" }] } }],
  ["no messageId", { message: { role: "ROLE_USER", parts: [{ text: "hi" }] } }],
  ["an empty messageId", { message: { ...userMessage("hi"), messageId: "" } }],
  ["a 129-character messageId", { message: { ...userMessage("hi"), messageId: "m".repeat(129) } }],
  ["no parts", { message: { messageId: "m-1", role: "ROLE_USER" } }],
  ["empty parts", { message: userMessage("hi", { parts: [] }) }],
  ["17 parts", { message: userMessage("hi", { parts: Array.from({ length: 17 }, () => ({ text: "hi" })) }) }],
  ["a part with text and data", { message: userMessage("hi", { parts: [{ text: "hi", data: {} }] }) }],
  ["a part with no content", { message: userMessage("hi", { parts: [{ mediaType: "text/plain" }] }) }],
  ["a part that is not an object", { message: userMessage("hi", { parts: ["hi"] }) }],
  ["a text part that is not a string", { message: userMessage("hi", { parts: [{ text: 5 }] }) }],
  ["a non-empty tenant", { message: userMessage("hi"), tenant: "acme" }],
  ["a configuration that is not an object", { message: userMessage("hi"), configuration: "x" }],
  ["acceptedOutputModes that is not an array", { message: userMessage("hi"), configuration: { acceptedOutputModes: "text/plain" } }],
];

for (const [label, params] of INVALID) {
  test(`SendMessage: ${label} is -32602`, async () => {
    const body = await expectError(await send(a2a("SendMessage", params)), 200, -32602);
    assert.equal(body.error?.data, undefined);
  });
}

for (const [label, part] of [
  ["a data part", { data: { q: 1 } }],
  ["a url part", { url: "https://example.com/a.txt" }],
  ["a raw part", { raw: "aGk=" }],
  ["a text part of another media type", { text: "hi", mediaType: "text/html" }],
] as const) {
  test(`SendMessage: ${label} is -32005`, async () => {
    await expectA2aError(await send(say("", { parts: [{ text: "hi" }, part] })), -32005, "CONTENT_TYPE_NOT_SUPPORTED");
  });
}

test("SendMessage: a taskId is -32001, since no task exists", async () => {
  await expectA2aError(await send(say("hi", { extra: { taskId: "task-1" } })), -32001, "TASK_NOT_FOUND");
});

for (const key of ["taskPushNotificationConfig", "pushNotificationConfig"]) {
  test(`SendMessage: configuration.${key} is -32003`, async () => {
    await expectA2aError(
      await send(say("hi", {}, { configuration: { [key]: { url: "https://example.com/hook" } } })),
      -32003,
      "PUSH_NOTIFICATION_NOT_SUPPORTED",
    );
  });
}

// Methods other than SendMessage

test("ListTasks: answers an empty list, because no task is ever created", async () => {
  const response = await send(a2a("ListTasks", {}));
  assert.equal(response.status, 200);
  const body = await rpc(response);
  assert.equal(body.id, 1);
  assert.equal(body.error, undefined);
  assert.deepEqual(body.result, { tasks: [], nextPageToken: "", pageSize: 0, totalSize: 0 });
});

test("ListTasks: answers the same without params", async () => {
  const body = await rpc(await send(a2a("ListTasks")));
  assert.deepEqual(body.result, { tasks: [], nextPageToken: "", pageSize: 0, totalSize: 0 });
});

test("GetTask: a task id is -32001 Task not found", async () => {
  const body = await expectA2aError(await send(a2a("GetTask", { id: "task-1" })), -32001, "TASK_NOT_FOUND");
  assert.equal(body.id, 1);
  assert.ok(!JSON.stringify(body).includes("task-1"), "the task id is not echoed");
});

test("GetTask: no task id is -32602", async () => {
  const body = await expectError(await send(a2a("GetTask", {})), 200, -32602);
  assert.equal(body.error?.data, undefined);
});

test("CancelTask: a task id is -32001 Task not found", async () => {
  await expectA2aError(await send(a2a("CancelTask", { id: "task-1" })), -32001, "TASK_NOT_FOUND");
});

test("CancelTask: an empty or non-string task id is -32602", async () => {
  await expectError(await send(a2a("CancelTask", { id: "" })), 200, -32602);
  await expectError(await send(a2a("CancelTask", { id: 5 })), 200, -32602);
});

test("SendStreamingMessage: -32004, streaming is off", async () => {
  await expectA2aError(await send(a2a("SendStreamingMessage", { message: {} })), -32004, "UNSUPPORTED_OPERATION");
});

test("SubscribeToTask: -32004, streaming is off", async () => {
  await expectA2aError(await send(a2a("SubscribeToTask", { id: "task-1" })), -32004, "UNSUPPORTED_OPERATION");
});

test("GetExtendedAgentCard: -32004, there is no extended card", async () => {
  await expectA2aError(await send(a2a("GetExtendedAgentCard", {})), -32004, "UNSUPPORTED_OPERATION");
});

test("CreateTaskPushNotificationConfig: -32003, push notifications are off", async () => {
  await expectA2aError(await send(a2a("CreateTaskPushNotificationConfig", { taskId: "t" })), -32003, "PUSH_NOTIFICATION_NOT_SUPPORTED");
});

test("GetTaskPushNotificationConfig: -32003, push notifications are off", async () => {
  await expectA2aError(await send(a2a("GetTaskPushNotificationConfig", { taskId: "t", id: "c" })), -32003, "PUSH_NOTIFICATION_NOT_SUPPORTED");
});

test("ListTaskPushNotificationConfigs: -32003, push notifications are off", async () => {
  await expectA2aError(await send(a2a("ListTaskPushNotificationConfigs", { taskId: "t" })), -32003, "PUSH_NOTIFICATION_NOT_SUPPORTED");
});

test("DeleteTaskPushNotificationConfig: -32003, push notifications are off", async () => {
  await expectA2aError(await send(a2a("DeleteTaskPushNotificationConfig", { taskId: "t", id: "c" })), -32003, "PUSH_NOTIFICATION_NOT_SUPPORTED");
});

for (const method of ["message/send", "tasks/get", "nope"]) {
  test(`${method}: -32601 Method not found, with no data`, async () => {
    const body = await expectError(await send(a2a(method, {})), 200, -32601);
    assert.equal(body.error?.data, undefined);
    assert.ok(!JSON.stringify(body).includes(method), "the method name is not echoed");
  });
}

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
    const body = await rpc(await send(a2a("ListTasks", {}, { "A2A-Version": value })));
    assert.equal(body.error, undefined, JSON.stringify(body));
    assert.deepEqual(body.result?.tasks, []);
  });
}

test("version: the A2A-Version query parameter is accepted without the header", async () => {
  const body = await rpc(await send(a2a("ListTasks", {}, { "A2A-Version": null }), makeBaseEnv(), `${ENDPOINT}?A2A-Version=1.0`));
  assert.equal(body.error, undefined, JSON.stringify(body));
  assert.deepEqual(body.result?.tasks, []);
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
