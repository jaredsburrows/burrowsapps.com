import { test } from "node:test";
import assert from "node:assert/strict";
import { allow, clientIp, isObject, json, methodNotAllowed, preflight, readBody, staticDoc, tooMany, validOrigin } from "./http.ts";
import { fakeLimiter } from "./testing.ts";

const post = (body: BodyInit | null, headers: Record<string, string> = {}): Request =>
  new Request("https://burrowsapps.com/x", { method: "POST", body, headers });

// A body whose length the Request cannot know, so no Content-Length is set.
const streamed = (bytes: number): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      let left = bytes;
      while (left > 0) {
        const size = Math.min(left, 1000);
        controller.enqueue(new Uint8Array(size).fill(97));
        left -= size;
      }
      controller.close();
    },
  });

const streamedPost = (bytes: number, headers: Record<string, string> = {}): Request =>
  new Request("https://burrowsapps.com/x", { method: "POST", body: streamed(bytes), headers, duplex: "half" } as RequestInit);

test("readBody returns a body under the cap", async () => {
  assert.equal(await readBody(post("hello"), 10), "hello");
});

test("readBody returns a body exactly at the cap", async () => {
  assert.equal(await readBody(post("a".repeat(10)), 10), "a".repeat(10));
  assert.equal(await readBody(streamedPost(10), 10), "a".repeat(10));
});

test("readBody refuses a body over the cap", async () => {
  assert.equal(await readBody(post("a".repeat(11)), 10), null);
});

test("readBody refuses a streamed body over the cap without Content-Length", async () => {
  const request = streamedPost(5000);
  assert.equal(request.headers.get("Content-Length"), null);
  assert.equal(await readBody(request, 4096), null);
});

test("readBody reads a streamed body under the cap without Content-Length", async () => {
  assert.equal((await readBody(streamedPost(3000), 4096))?.length, 3000);
});

test("readBody refuses a declared Content-Length over the cap", async () => {
  assert.equal(await readBody(streamedPost(1, { "Content-Length": "999999" }), 4096), null);
});

test("readBody does not trust a Content-Length that understates the body", async () => {
  assert.equal(await readBody(streamedPost(5000, { "Content-Length": "10" }), 4096), null);
});

test("readBody returns an empty string when there is no body", async () => {
  assert.equal(await readBody(new Request("https://burrowsapps.com/x", { method: "POST" }), 10), "");
});

test("readBody decodes UTF-8 and counts bytes, not characters", async () => {
  assert.equal(await readBody(post("€€"), 6), "€€");
  assert.equal(await readBody(post("€€"), 5), null);
});

test("allow is true when the limiter succeeds", async () => {
  assert.equal(await allow(fakeLimiter(1), "k", "closed"), true);
});

test("allow is false when the limiter refuses, in both modes", async () => {
  const limiter = fakeLimiter(1);
  await limiter.limit({ key: "k" });
  assert.equal(await allow(limiter, "k", "open"), false);
  assert.equal(await allow(limiter, "k", "closed"), false);
});

test("allow with a missing binding is true when open and false when closed", async () => {
  assert.equal(await allow(undefined, "k", "open"), true);
  assert.equal(await allow(undefined, "k", "closed"), false);
});

test("allow with a throwing limiter is true when open and false when closed", async (t) => {
  t.mock.method(console, "error", () => {});
  const limiter = fakeLimiter(1);
  limiter.throws = true;
  assert.equal(await allow(limiter, "k", "open"), true);
  assert.equal(await allow(limiter, "k", "closed"), false);
});

test("staticDoc GET returns the body with the default headers", async () => {
  const response = staticDoc(new Request("https://burrowsapps.com/d"), "{}", "application/json", { Link: "<x>" });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "{}");
  assert.equal(response.headers.get("Content-Type"), "application/json");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("Link"), "<x>");
});

test("staticDoc HEAD has the same headers and no body", async () => {
  const get = staticDoc(new Request("https://burrowsapps.com/d"), "{}", "application/json");
  const head = staticDoc(new Request("https://burrowsapps.com/d", { method: "HEAD" }), "{}", "application/json");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.deepEqual([...head.headers], [...get.headers]);
});

test("staticDoc OPTIONS is a preflight", async () => {
  const response = staticDoc(new Request("https://burrowsapps.com/d", { method: "OPTIONS" }), "{}", "application/json");
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, HEAD, OPTIONS");
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type, If-None-Match");
  assert.equal(response.headers.get("Access-Control-Max-Age"), "86400");
});

test("staticDoc POST is 405 with Allow", async () => {
  const response = staticDoc(post("x"), "{}", "application/json");
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, HEAD, OPTIONS");
  assert.deepEqual(await response.json(), { error: "method_not_allowed" });
});

test("json sets the default headers and lets the caller override them", async () => {
  const response = json(400, { a: 1 });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { a: 1 });
  assert.equal(response.headers.get("Content-Type"), "application/json");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(json(200, {}, { "Cache-Control": "public" }).headers.get("Cache-Control"), "public");
});

test("preflight, methodNotAllowed, and tooMany have their documented shapes", async () => {
  const pre = preflight("POST, OPTIONS", "Content-Type");
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  const notAllowed = methodNotAllowed("POST");
  assert.equal(notAllowed.status, 405);
  assert.equal(notAllowed.headers.get("Allow"), "POST");
  const many = tooMany();
  assert.equal(many.status, 429);
  assert.equal(many.headers.get("Retry-After"), "60");
  assert.deepEqual(await many.json(), { error: "rate_limited" });
});

test("clientIp reads CF-Connecting-IP or says unknown", async () => {
  assert.equal(clientIp(new Request("https://burrowsapps.com/", { headers: { "CF-Connecting-IP": "203.0.113.9" } })), "203.0.113.9");
  assert.equal(clientIp(new Request("https://burrowsapps.com/")), "unknown");
});

test("isObject accepts plain objects and refuses arrays, null, and primitives", () => {
  assert.equal(isObject({}), true);
  assert.equal(isObject({ a: 1 }), true);
  for (const value of [null, undefined, [], [1], "x", 1, true]) assert.equal(isObject(value), false, String(value));
});

test("validOrigin accepts no Origin and http or https origins, and refuses the rest", () => {
  assert.equal(validOrigin(null), true);
  assert.equal(validOrigin("https://example.com"), true);
  assert.equal(validOrigin("http://localhost:8787"), true);
  for (const origin of ["null", "", "file:///etc", "javascript:alert(1)", "not a url"]) {
    assert.equal(validOrigin(origin), false, origin);
  }
});
