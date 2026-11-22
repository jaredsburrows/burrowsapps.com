// Test helpers only. Nothing in the Worker imports this file.

import type { Deps, Env, RateLimiter } from "./http.ts";

export type FakeLimiter = RateLimiter & { counts: Map<string, number>; keys: string[]; throws: boolean };

// Counts per key and refuses once a key is past its limit. Set throws to make
// every call reject, as an unavailable binding would.
export function fakeLimiter(limit: number): FakeLimiter {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const limiter: FakeLimiter = {
    counts,
    keys,
    throws: false,
    async limit({ key }) {
      if (limiter.throws) throw new Error("limiter unavailable");
      keys.push(key);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= limit };
    },
  };
  return limiter;
}

export type TestDeps = Deps & {
  originCalls: Request[];
  logs: string[];
  passThroughCalls: number;
  clock: { ms: number };
  setOrigin(handler: (request: Request) => Promise<Response> | Response): void;
};

export const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);

const defaultOrigin = (request: Request): Response => {
  const path = new URL(request.url).pathname;
  if (path.endsWith(".md")) {
    return new Response("# Burrows Applications\n\nSoftware, built with care.\n", {
      status: 200,
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }
  return new Response("<!DOCTYPE html><title>Burrows Applications</title>", {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};

export function makeDeps(overrides: Partial<Deps> = {}): TestDeps {
  let origin: (request: Request) => Promise<Response> | Response = defaultOrigin;
  const deps: TestDeps = {
    originCalls: [],
    logs: [],
    passThroughCalls: 0,
    clock: { ms: T0 },
    setOrigin(handler) {
      origin = handler;
    },
    async originFetch(request) {
      deps.originCalls.push(request);
      return origin(request);
    },
    passThrough() {
      deps.passThroughCalls += 1;
    },
    now() {
      return deps.clock.ms;
    },
    log(line) {
      deps.logs.push(line);
    },
    ...overrides,
  };
  return deps;
}

export type TestEnv = Env & { PUBLIC_LIMITER: FakeLimiter };

// The limit matches PUBLIC_LIMITER in the root wrangler.jsonc. Tests read
// files through deps.originFetch, so reaching the binding directly fails.
export function makeBaseEnv(): TestEnv {
  return {
    ASSETS: {
      fetch: async () => {
        throw new Error("use deps.originFetch");
      },
    },
    PUBLIC_LIMITER: fakeLimiter(60),
  };
}

export const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
