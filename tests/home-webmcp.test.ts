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
