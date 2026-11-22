import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import worker from "./index.ts";
import type { Env } from "./http.ts";

const BROWSER_ACCEPT = "text/html,application/xhtml+xml,*/*;q=0.8";

const homeRequest = (): Request => new Request("https://burrowsapps.com/", { headers: { Accept: BROWSER_ACCEPT } });

const htmlResponse = (): Response =>
  new Response("<!DOCTYPE html><title>Burrows Applications</title>", {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

type AssetsMock = { calls: Request[]; env: Env };

// An ASSETS binding that answers with handler, recording each request.
const assets = (handler: (request: Request, call: number) => Promise<Response> | Response): AssetsMock => {
  const calls: Request[] = [];
  return {
    calls,
    env: {
      ASSETS: {
        fetch: async (request) => {
          calls.push(request);
          return handler(request, calls.length);
        },
      },
    },
  };
};

// Site content must never come from the global fetch: it throws, and each
// test checks that it was never called.
const forbidGlobalFetch = (t: TestContext): (() => number) => {
  const mock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("the global fetch must not be called");
  });
  return () => mock.mock.callCount();
};

test("passThroughOnException is called exactly once", async (t) => {
  const globalFetches = forbidGlobalFetch(t);
  const { env } = assets(() => htmlResponse());
  const ctx = { passThroughOnException: t.mock.fn() };
  await worker.fetch(homeRequest(), env, ctx);
  assert.equal(ctx.passThroughOnException.mock.callCount(), 1);
  assert.equal(globalFetches(), 0);
});

test("a normal request is decorated through the asset binding", async (t) => {
  const globalFetches = forbidGlobalFetch(t);
  const mock = assets(() => htmlResponse());
  const ctx = { passThroughOnException: t.mock.fn() };
  const request = homeRequest();
  const response = await worker.fetch(request, mock.env, ctx);
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0], request);
  assert.match(response.headers.get("Link") ?? "", /rel="describedby"/);
  assert.equal(globalFetches(), 0);
});

test("an asset failure fails open with a second plain asset fetch", async (t) => {
  const globalFetches = forbidGlobalFetch(t);
  t.mock.method(console, "error", () => {});
  const fallback = htmlResponse();
  const mock = assets((_request, call) => {
    if (call === 1) throw new Error("assets unavailable");
    return fallback;
  });
  const ctx = { passThroughOnException: t.mock.fn() };
  const request = homeRequest();
  const response = await worker.fetch(request, mock.env, ctx);
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[1], request);
  assert.equal(response, fallback);
  assert.equal(response.headers.get("Link"), null);
  assert.equal(globalFetches(), 0);
});

test("the entry module exports only a default handler with fetch", async () => {
  const module = await import("./index.ts");
  assert.deepEqual(Object.keys(module), ["default"]);
  assert.equal(typeof module.default.fetch, "function");
});
