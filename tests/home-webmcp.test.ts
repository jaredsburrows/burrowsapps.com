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

// S1: the confirmation instruction must live in the tool itself, since an in-page
// agent may never load SKILL.md. Checked by meaning (a confirmation verb and every
// required field), not by exact wording.
test("the tool description tells the agent to confirm every required field with the user first", async () => {
  const modelContext = fakeModelContext();
  createFakeDom({ documentModelContext: modelContext }).run();
  const [tool] = modelContext.tools;
  const sentence = tool.description.split(/(?<=\.)\s+/).find((part) => /\bconfirm/i.test(part));
  assert.ok(sentence, "no sentence asks for confirmation");
  assert.match(sentence, /\buser\b/i);
  for (const field of tool.inputSchema.required) assert.match(sentence, new RegExp(`\\b${field}\\b`, "i"));
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

const registeredTool = (): { dom: FakeDom; tool: Tool } => {
  const modelContext = fakeModelContext();
  const dom = createFakeDom({ documentModelContext: modelContext });
  dom.run();
  assert.equal(modelContext.tools.length, 1);
  return { dom, tool: modelContext.tools[0] };
};

test("execute with valid input fills the form and sends what the human path sends", async () => {
  const { dom, tool } = registeredTool();
  const result = plain(await tool.execute({ ...VALID }));
  assert.equal(result.status, "sent");
  assertContactPost(dom);
  assert.deepEqual(dom.fetchCalls[0].fields, VALID);
  assert.equal(dom.status.innerHTML, SENT_STATUS);
});

for (const behavior of ["not-ok", "reject"] as const) {
  test(`execute reports failed when fetch is ${behavior}`, async () => {
    const { dom, tool } = registeredTool();
    dom.fetchBehavior = behavior;
    const result = plain(await tool.execute({ ...VALID }));
    assert.equal(result.status, "failed");
    assert.equal(dom.fetchCalls.length, 1);
    assert.equal(dom.status.className, "form-status error");
  });
}

const INVALID_INPUTS: ReadonlyArray<[string, unknown, string[]]> = [
  ["an invalid email", { ...VALID, email: "not-an-email" }, ["email"]],
  ["a missing field", { name: VALID.name, email: VALID.email }, ["message"]],
  ["a non-object input", "send it", ["name", "email", "message"]],
  ["a 5,001-character message", { ...VALID, message: "x".repeat(5001) }, ["message"]],
];

for (const [label, input, badFields] of INVALID_INPUTS) {
  test(`execute with ${label} sends nothing and names the bad fields`, async () => {
    const { dom, tool } = registeredTool();
    const result = plain(await tool.execute(input));
    assert.equal(result.status, "invalid");
    assert.equal(dom.fetchCalls.length, 0);
    const errors = result.errors as Record<string, string>;
    assert.deepEqual(Object.keys(errors).sort(), [...badFields].sort());
    for (const field of badFields) {
      assert.ok(errors[field].length > 0);
      assert.equal(dom.fields[field as "name" | "email" | "message"].invalid, true);
    }
  });
}

// ---- QA additions: exit paths, button state, and overlapping sends ----

const FAILED_STATUS_START = "Something went wrong. Email ";

for (const behavior of ["not-ok", "reject"] as const) {
  test(`human submit with fetch ${behavior} shows the error, keeps the values, and restores the button`, async () => {
    const dom = createFakeDom();
    dom.run();
    fillValid(dom);
    dom.fetchBehavior = behavior;
    await dom.submitForm();
    assert.equal(dom.fetchCalls.length, 1);
    assert.equal(dom.status.className, "form-status error");
    assert.ok(dom.status.innerHTML.startsWith(FAILED_STATUS_START));
    assert.equal(dom.form.resets, 0);
    assert.equal(dom.fields.message.value, VALID.message);
    assert.equal(dom.submit.disabled, false);
    assert.equal(dom.submit.textContent, "Send message");
  });
}

test("human submit with an invalid form sends nothing, focuses the first bad field, and leaves the button alone", async () => {
  const dom = createFakeDom();
  dom.run();
  dom.fields.name.value = VALID.name;
  dom.fields.email.value = "nope";
  await dom.submitForm();
  assert.equal(dom.fetchCalls.length, 0);
  assert.equal(dom.fields.email.focused, 1);
  assert.equal(dom.fields.message.invalid, true);
  assert.equal(dom.submit.disabled, false);
  assert.equal(dom.submit.textContent, "Send message");
  assert.equal(dom.status.innerHTML, "");
});

test("the button is disabled and reads Sending… while a send is in flight", async () => {
  const dom = createFakeDom();
  dom.run();
  fillValid(dom);
  let release!: () => void;
  dom.fetchGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = dom.submitForm();
  assert.equal(dom.submit.disabled, true);
  assert.equal(dom.submit.textContent, "Sending…");
  release();
  await pending;
  assert.equal(dom.submit.disabled, false);
  assert.equal(dom.submit.textContent, "Send message");
});

for (const behavior of ["ok", "not-ok", "reject"] as const) {
  test(`execute leaves the button enabled and labeled after fetch ${behavior}`, async () => {
    const { dom, tool } = registeredTool();
    dom.fetchBehavior = behavior;
    await tool.execute({ ...VALID });
    assert.equal(dom.submit.disabled, false);
    assert.equal(dom.submit.textContent, "Send message");
  });
}

test("execute replaces whatever a human had typed in the form", async () => {
  // Accepted behavior: the tool drives the visible form, so its values win.
  const { dom, tool } = registeredTool();
  dom.fields.name.value = "Typed by a person";
  dom.fields.message.value = "A half-written draft";
  await tool.execute({ ...VALID });
  assert.equal(dom.fetchCalls[0].fields.name, VALID.name);
  assert.equal(dom.fetchCalls[0].fields.message, VALID.message);
});

test("execute does not touch the honeypot field", async () => {
  const { dom, tool } = registeredTool();
  await tool.execute({ ...VALID, company: "Acme" });
  assert.equal(JSON.parse(dom.fetchCalls[0].init.body).company, "");
});

test("execute ignores non-string field values", async () => {
  const { dom, tool } = registeredTool();
  const result = plain(await tool.execute({ name: 5, email: ["a@b.co"], message: { x: 1 } }));
  assert.equal(result.status, "invalid");
  assert.equal(dom.fetchCalls.length, 0);
});

// B2: the tool bypasses the disabled button, so a second call, or a call during a
// human submit, posts a second message.
test("execute while a send is in flight does not post a second message", async () => {
  const { dom, tool } = registeredTool();
  let release!: () => void;
  dom.fetchGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = tool.execute({ ...VALID });
  const second = tool.execute({ ...VALID });
  release();
  await Promise.all([first, second]);
  assert.equal(dom.fetchCalls.length, 1);
});

const holdFetch = (dom: FakeDom): (() => void) => {
  let release!: () => void;
  dom.fetchGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => release();
};

// Fields and the button are checked synchronously after each overlapping call,
// before the held fetch is released, so a regression fails instead of hanging.
test("a second execute during a tool send is busy and leaves the first message alone", async () => {
  const { dom, tool } = registeredTool();
  const release = holdFetch(dom);
  const first = tool.execute({ ...VALID });
  const second = tool.execute({ name: "Someone Else", email: "else@example.com", message: "Other text" });
  try {
    assert.equal(dom.fields.name.value, VALID.name);
    assert.equal(dom.fields.message.value, VALID.message);
    assert.equal(dom.submit.disabled, true);
    assert.equal(dom.submit.textContent, "Sending…");
  } finally {
    release();
  }
  const [firstResult, secondResult] = (await Promise.all([first, second])).map(plain);
  assert.equal(firstResult.status, "sent");
  assert.equal(secondResult.status, "busy");
  assert.ok(String(secondResult.message).length > 0);
  assert.equal(dom.fetchCalls.length, 1);
  assert.deepEqual(dom.fetchCalls[0].fields, VALID);
});

test("execute during a human submit is busy and sends nothing", async () => {
  const { dom, tool } = registeredTool();
  fillValid(dom);
  const release = holdFetch(dom);
  const human = dom.submitForm();
  const agent = tool.execute({ name: "Agent", email: "agent@example.com", message: "Hi" });
  try {
    assert.equal(dom.fields.name.value, VALID.name);
  } finally {
    release();
  }
  await human;
  assert.equal(plain(await agent).status, "busy");
  assert.equal(dom.fetchCalls.length, 1);
  assert.equal(dom.status.innerHTML, SENT_STATUS);
});

test("a human submit during a tool send posts nothing more", async () => {
  const { dom, tool } = registeredTool();
  const release = holdFetch(dom);
  const sent = tool.execute({ ...VALID });
  const human = dom.submitForm();
  release();
  await Promise.all([sent, human]);
  assert.equal(dom.fetchCalls.length, 1);
});

test("execute works again once the earlier send has finished", async () => {
  const { dom, tool } = registeredTool();
  dom.fetchBehavior = "not-ok";
  assert.equal(plain(await tool.execute({ ...VALID })).status, "failed");
  dom.fetchBehavior = "ok";
  assert.equal(plain(await tool.execute({ ...VALID })).status, "sent");
  assert.equal(dom.fetchCalls.length, 2);
});

// B3: whitespace-only values pass validity (valueMissing ignores spaces) and are
// trimmed to empty by send(), so the server rejects them after the tool said nothing was wrong.
test("execute with whitespace-only fields reports invalid and sends nothing", async () => {
  const { dom, tool } = registeredTool();
  const result = plain(await tool.execute({ name: "   ", email: VALID.email, message: "\n\n" }));
  assert.equal(result.status, "invalid");
  assert.equal(dom.fetchCalls.length, 0);
  assert.deepEqual(Object.keys(result.errors as Record<string, string>).sort(), ["message", "name"]);
});

test("execute trims surrounding whitespace before sending", async () => {
  const { dom, tool } = registeredTool();
  const result = plain(await tool.execute({ name: ` ${VALID.name} `, email: `${VALID.email}\n`, message: `\n${VALID.message}  ` }));
  assert.equal(result.status, "sent");
  assertContactPost(dom);
});

// The human path's handling of whitespace-only fields predates the tool and is
// deliberately unchanged: it still posts, and the server rejects it.
test("a human submit of whitespace-only fields still posts, as it did before the tool", async () => {
  const dom = createFakeDom();
  dom.run();
  dom.fields.name.value = "   ";
  dom.fields.email.value = VALID.email;
  dom.fields.message.value = "\n\n";
  await dom.submitForm();
  assert.equal(dom.fetchCalls.length, 1);
});
