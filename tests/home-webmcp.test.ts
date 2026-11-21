import { test } from "node:test";
import assert from "node:assert/strict";
import { ENDPOINT, createFakeDom, plain } from "./support/fake-dom.ts";
import type { FakeDom } from "./support/fake-dom.ts";

const VALID = { name: "Ada Lovelace", email: "ada@example.com", message: "I would like an Android app." };
const SENT_STATUS = "Message sent — thanks. I'll get back to you soon.";

const fillValid = (dom: FakeDom): void => {
  dom.fields.name.value = VALID.name;
  dom.fields.email.value = VALID.email;
  dom.fields.message.value = VALID.message;
};

// The request the human submit path sends today. The tool must send the same.
const assertContactPost = (dom: FakeDom): void => {
  assert.equal(dom.fetchCalls.length, 1);
  const [call] = dom.fetchCalls;
  assert.equal(call.url, ENDPOINT);
  assert.equal(call.init.method, "POST");
  assert.deepEqual(plain(call.init.headers), { "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(call.init.body), { ...VALID, company: "" });
};

test("the human submit path posts the form as JSON and shows the success status", async () => {
  const dom = createFakeDom();
  dom.run();
  assert.equal(dom.form.noValidate, true);
  assert.equal(dom.form.submitListeners.length, 1);
  fillValid(dom);
  await dom.submitForm();
  assertContactPost(dom);
  assert.equal(dom.status.className, "form-status ok");
  assert.equal(dom.status.innerHTML, SENT_STATUS);
  assert.equal(dom.form.resets, 1);
  assert.equal(dom.submit.disabled, false);
  assert.equal(dom.submit.textContent, "Send message");
});

test("without a modelContext the script runs and registers nothing", async () => {
  const dom = createFakeDom();
  assert.doesNotThrow(() => dom.run());
  assert.equal(dom.form.submitListeners.length, 1);
  assert.ok(["John Doe", "Jane Doe"].includes(dom.fields.name.placeholder));
});

type Tool = {
  name: string;
  title?: string;
  description: string;
  inputSchema: { type: string; properties: Record<string, unknown>; required: string[] };
  execute: (input: unknown) => Promise<Record<string, unknown>>;
};

type FakeModelContext = { registerTool: (tool: Tool) => unknown; tools: Tool[] };

const fakeModelContext = (result: () => unknown = async () => undefined): FakeModelContext => {
  const context: FakeModelContext = {
    tools: [],
    registerTool: (tool) => {
      context.tools.push(tool);
      return result();
    },
  };
  return context;
};

test("document.modelContext gets exactly one well-formed tool", async () => {
  const modelContext = fakeModelContext();
  createFakeDom({ documentModelContext: modelContext }).run();
  assert.equal(modelContext.tools.length, 1);
  const [tool] = modelContext.tools;
  assert.equal(tool.name, "send_contact_message");
  assert.match(tool.name, /^[A-Za-z0-9_.-]{1,128}$/);
  assert.ok(tool.description.length > 0);
  assert.equal(tool.inputSchema.type, "object");
  assert.deepEqual(plain(tool.inputSchema.required), ["name", "email", "message"]);
  assert.ok(!("company" in tool.inputSchema.properties));
  assert.equal(typeof tool.execute, "function");
});

test("navigator.modelContext is used when document has none", async () => {
  const modelContext = fakeModelContext();
  createFakeDom({ navigatorModelContext: modelContext }).run();
  assert.equal(modelContext.tools.length, 1);
});

test("document.modelContext wins over navigator.modelContext", async () => {
  const onDocument = fakeModelContext();
  const onNavigator = fakeModelContext();
  createFakeDom({ documentModelContext: onDocument, navigatorModelContext: onNavigator }).run();
  assert.equal(onDocument.tools.length, 1);
  assert.equal(onNavigator.tools.length, 0);
});

test("a registerTool that throws does not break the page", async () => {
  const dom = createFakeDom({
    documentModelContext: {
      registerTool: () => {
        throw new Error("InvalidStateError");
      },
    },
  });
  assert.doesNotThrow(() => dom.run());
  assert.equal(dom.form.submitListeners.length, 1);
});

test("a registerTool that rejects leaves no unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    const modelContext = fakeModelContext(() => Promise.reject(new Error("NotAllowedError")));
    createFakeDom({ documentModelContext: modelContext }).run();
    assert.equal(modelContext.tools.length, 1);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  assert.deepEqual(unhandled, []);
});

test("a registerTool that returns undefined is fine", async () => {
  const modelContext = fakeModelContext(() => undefined);
  const dom = createFakeDom({ documentModelContext: modelContext });
  assert.doesNotThrow(() => dom.run());
  assert.equal(modelContext.tools.length, 1);
});
