import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./index.ts";

const BROWSER_ACCEPT = "text/html,application/xhtml+xml,*/*;q=0.8";

const homeRequest = (): Request => new Request("https://burrowsapps.com/", { headers: { Accept: BROWSER_ACCEPT } });

const htmlResponse = (): Response =>
  new Response("<!DOCTYPE html><title>Burrows Applications</title>", {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

test("passThroughOnException is called exactly once", async (t) => {
  t.mock.method(globalThis, "fetch", async () => htmlResponse());
  const ctx = { passThroughOnException: t.mock.fn() };
  await worker.fetch(homeRequest(), {}, ctx);
  assert.equal(ctx.passThroughOnException.mock.callCount(), 1);
});

test("a normal request is decorated through the global fetch", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => htmlResponse());
  const ctx = { passThroughOnException: t.mock.fn() };
  const response = await worker.fetch(homeRequest(), {}, ctx);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.match(response.headers.get("Link") ?? "", /rel="describedby"/);
});

test("an origin failure fails open with a second plain fetch", async (t) => {
  t.mock.method(console, "error", () => {});
  const fallback = htmlResponse();
  let calls = 0;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) throw new Error("origin down");
    return fallback;
  });
  const ctx = { passThroughOnException: t.mock.fn() };
  const request = homeRequest();
  const response = await worker.fetch(request, {}, ctx);
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.equal(fetchMock.mock.calls[1].arguments[0], request);
  assert.equal(response, fallback);
  assert.equal(response.headers.get("Link"), null);
});

test("the entry module exports only a default handler with fetch", async () => {
  const module = await import("./index.ts");
  assert.deepEqual(Object.keys(module), ["default"]);
  assert.equal(typeof module.default.fetch, "function");
});
