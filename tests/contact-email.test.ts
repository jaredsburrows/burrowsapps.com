// The email the contact Worker sends: the country flag after the sender's IP.
// Turnstile is off (no TURNSTILE_SECRET), so no fetch is stubbed.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error: plain JavaScript Worker with no type declarations.
import worker from "../workers/contact/index.js";

type SentMessage = { text: string; subject: string };

// Sends one valid message with request.cf.country set to `country` (or no cf
// object at all for undefined) and returns the line that names the IP.
const ipLine = async (country?: unknown, hasCf = true): Promise<string> => {
  const sent: SentMessage[] = [];
  const env = { CONTACT: { send: async (message: SentMessage) => void sent.push(message) } };
  const body = JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", message: "Hello", company: "" });
  const request = new Request("https://burrowsapps.com/api/contact", {
    method: "POST",
    headers: {
      Origin: "https://burrowsapps.com",
      "Content-Type": "application/json",
      "Content-Length": String(new TextEncoder().encode(body).length),
      "CF-Connecting-IP": "203.0.113.7",
    },
    body,
  });
  // Workers set request.cf at the edge; a plain Request has none.
  if (hasCf) Object.defineProperty(request, "cf", { value: { country } });
  const res = await worker.fetch(request, env);
  assert.equal(res.status, 204);
  assert.equal(sent.length, 1);
  const line = sent[0].text.split("\n").find((l) => l.includes("Submitted from IP address"));
  assert.ok(line, "the IP line is gone from the email");
  return line.trim();
};

test("the IP line ends with the sender's country flag and code", async () => {
  assert.equal(await ipLine("US"), "Submitted from IP address 203.0.113.7 \u{1F1FA}\u{1F1F8} US");
  assert.equal(await ipLine("de"), "Submitted from IP address 203.0.113.7 \u{1F1E9}\u{1F1EA} DE");
});

test("no usable country leaves the IP line as it was", async () => {
  const plain = "Submitted from IP address 203.0.113.7";
  for (const country of ["T1", "XX", "", "USA", "U1", "🇺🇸", 42, null, undefined]) {
    assert.equal(await ipLine(country), plain, `country ${JSON.stringify(country)}`);
  }
  assert.equal(await ipLine(undefined, false), plain, "a request without cf");
});
