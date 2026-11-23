// The contact Worker's Turnstile gate, driven through its fetch handler with
// siteverify and the email binding stubbed. No network, no wrangler.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
// @ts-expect-error: plain JavaScript Worker with no type declarations.
import worker from "../workers/contact/index.js";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SECRET = "test-secret";
const TOKEN = "test-token";

type Outcome = Record<string, unknown>;
type SiteverifyCall = { url: string; fields: Record<string, string> };

const realFetch = globalThis.fetch;
const realConsoleError = console.error;
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realConsoleError;
});

// Stubs siteverify: each call takes the next response from the list.
const stubSiteverify = (...responses: Array<Outcome | "network-error" | number>): SiteverifyCall[] => {
  const calls: SiteverifyCall[] = [];
  console.error = () => {};
  globalThis.fetch = (async (input: string, init: { body: FormData }) => {
    const fields: Record<string, string> = {};
    for (const [key, value] of init.body.entries()) fields[key] = String(value);
    calls.push({ url: String(input), fields });
    const next = responses[calls.length - 1] ?? "network-error";
    if (next === "network-error") throw new TypeError("fetch failed");
    if (typeof next === "number") return new Response("", { status: next });
    return Response.json(next);
  }) as typeof fetch;
  return calls;
};

const passing = (overrides: Outcome = {}): Outcome => ({
  success: true,
  action: "contact",
  hostname: "burrowsapps.com",
  ...overrides,
});

const makeEnv = (secret: string | null = SECRET) => {
  const sent: unknown[] = [];
  return {
    sent,
    env: {
      ...(secret === null ? {} : { TURNSTILE_SECRET: secret }),
      CONTACT: { send: async (message: unknown) => void sent.push(message) },
    },
  };
};

const post = (fields: Record<string, string>) => {
  const body = JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", message: "Hello", company: "", ...fields });
  return new Request("https://burrowsapps.com/api/contact", {
    method: "POST",
    headers: {
      Origin: "https://burrowsapps.com",
      "Content-Type": "application/json",
      "Content-Length": String(new TextEncoder().encode(body).length),
      "CF-Connecting-IP": "203.0.113.7",
    },
    body,
  });
};

test("a passing token for action contact on the site's hostname sends the message", async () => {
  const calls = stubSiteverify(passing());
  const { env, sent } = makeEnv();
  const res = await worker.fetch(post({ "cf-turnstile-response": TOKEN }), env);
  assert.equal(res.status, 204);
  assert.equal(sent.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SITEVERIFY);
  assert.equal(calls[0].fields.secret, SECRET);
  assert.equal(calls[0].fields.response, TOKEN);
  assert.equal(calls[0].fields.remoteip, "203.0.113.7");
});

test("the www hostname passes too", async () => {
  stubSiteverify(passing({ hostname: "www.burrowsapps.com" }));
  const { env, sent } = makeEnv();
  assert.equal((await worker.fetch(post({ "cf-turnstile-response": TOKEN }), env)).status, 204);
  assert.equal(sent.length, 1);
});

const rejected: Array<[string, Outcome]> = [
  ["success false (a replayed or expired token)", { success: false, "error-codes": ["timeout-or-duplicate"] }],
  ["another action", passing({ action: "login" })],
  ["no action", passing({ action: undefined })],
  ["another hostname", passing({ hostname: "evil.example" })],
  ["localhost", passing({ hostname: "localhost" })],
];
for (const [label, outcome] of rejected) {
  test(`a token with ${label} is refused with 403 and nothing is sent`, async () => {
    stubSiteverify(outcome);
    const { env, sent } = makeEnv();
    assert.equal((await worker.fetch(post({ "cf-turnstile-response": TOKEN }), env)).status, 403);
    assert.equal(sent.length, 0);
  });
}

test("a missing or oversized token is refused without calling siteverify", async () => {
  for (const fields of [{}, { "cf-turnstile-response": "" }, { "cf-turnstile-response": "x".repeat(2049) }]) {
    const calls = stubSiteverify(passing());
    const { env, sent } = makeEnv();
    assert.equal((await worker.fetch(post(fields), env)).status, 403);
    assert.equal(calls.length, 0);
    assert.equal(sent.length, 0);
  }
});

test("siteverify failing twice fails closed", async () => {
  for (const responses of [["network-error", "network-error"], [500, 502]] as const) {
    const calls = stubSiteverify(...responses);
    const { env, sent } = makeEnv();
    assert.equal((await worker.fetch(post({ "cf-turnstile-response": TOKEN }), env)).status, 403);
    assert.equal(calls.length, 2);
    assert.equal(sent.length, 0);
  }
});

test("one retry after a siteverify failure reuses the idempotency key", async () => {
  const calls = stubSiteverify("network-error", passing());
  const { env, sent } = makeEnv();
  assert.equal((await worker.fetch(post({ "cf-turnstile-response": TOKEN }), env)).status, 204);
  assert.equal(sent.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].fields.idempotency_key);
  assert.equal(calls[0].fields.idempotency_key, calls[1].fields.idempotency_key);
});

test("without TURNSTILE_SECRET the check is off and siteverify is not called", async () => {
  const calls = stubSiteverify();
  const { env, sent } = makeEnv(null);
  assert.equal((await worker.fetch(post({}), env)).status, 204);
  assert.equal(calls.length, 0);
  assert.equal(sent.length, 1);
});

test("the form's widget uses the action and the script that the Worker expects", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../workers/contact/index.js", import.meta.url), "utf8");
  const action = source.match(/const TURNSTILE_ACTION = "([^"]+)";/)?.[1];
  assert.ok(action, "TURNSTILE_ACTION is gone from the Worker");
  const form = html.match(/<form id="contact-form"[\s\S]*?<\/form>/)?.[0] ?? "";
  const widget = form.match(/<div class="cf-turnstile"[^>]*>/)?.[0];
  assert.ok(widget, "the Turnstile widget is not inside #contact-form");
  assert.match(widget, /\bid="cf-turnstile"/);
  assert.match(widget, /\bdata-sitekey="0x[0-9A-Za-z_-]+"/);
  assert.ok(widget.includes(`data-action="${action}"`), "the widget's data-action does not match the Worker");
  assert.ok(form.indexOf(widget) < form.indexOf('id="cf-submit"'), "the widget is not above the submit button");
  assert.match(html, /<script src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js" async defer><\/script>/);
});
