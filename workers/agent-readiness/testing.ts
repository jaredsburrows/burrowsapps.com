// Test helpers only. Nothing in the Worker imports this file.

import type { Deps, EmailSender, Env, RateLimiter } from "./http.ts";

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

export type FakeEmail = EmailSender & { sent: Record<string, unknown>[]; throws: boolean };

export function fakeEmail(): FakeEmail {
  const email: FakeEmail = {
    sent: [],
    throws: false,
    async send(message) {
      if (email.throws) throw new Error("email unavailable");
      email.sent.push(message);
      return { messageId: "test" };
    },
  };
  return email;
}

export type TestDeps = Deps & {
  originCalls: Request[];
  outboundCalls: { input: unknown; init: RequestInit | undefined }[];
  logs: string[];
  passThroughCalls: number;
  clock: { ms: number };
  setOrigin(handler: (request: Request) => Promise<Response> | Response): void;
  setOutbound(handler: (input: unknown, init: RequestInit | undefined) => Promise<Response> | Response): void;
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
  let outbound: (input: unknown, init: RequestInit | undefined) => Promise<Response> | Response = () =>
    new Response("{}", { status: 500 });
  const deps: TestDeps = {
    originCalls: [],
    outboundCalls: [],
    logs: [],
    passThroughCalls: 0,
    clock: { ms: T0 },
    setOrigin(handler) {
      origin = handler;
    },
    setOutbound(handler) {
      outbound = handler;
    },
    async originFetch(request) {
      deps.originCalls.push(request);
      return origin(request);
    },
    outboundFetch: (async (input: unknown, init?: RequestInit) => {
      deps.outboundCalls.push({ input, init });
      return outbound(input, init);
    }) as typeof fetch,
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
  } as TestDeps;
  return deps;
}

export type TestEnv = Env & {
  PUBLIC_LIMITER: FakeLimiter;
  AUTH_LIMITER: FakeLimiter;
  APPROVE_LIMITER: FakeLimiter;
  ONCE_LIMITER: FakeLimiter;
  INQUIRY_EMAIL: FakeEmail;
};

export type EnvOptions = { signingKey?: string | undefined; turnstileSecret?: string; turnstileSiteKey?: string };

// Limits match workers/agent-readiness/wrangler.jsonc.
export function makeBaseEnv(options: EnvOptions = {}): TestEnv {
  const env: TestEnv = {
    PUBLIC_LIMITER: fakeLimiter(60),
    AUTH_LIMITER: fakeLimiter(10),
    APPROVE_LIMITER: fakeLimiter(3),
    ONCE_LIMITER: fakeLimiter(1),
    INQUIRY_EMAIL: fakeEmail(),
  };
  if (options.signingKey !== undefined) env.OAUTH_SIGNING_KEY = options.signingKey;
  if (options.turnstileSecret !== undefined) env.TURNSTILE_SECRET = options.turnstileSecret;
  if (options.turnstileSiteKey !== undefined) env.TURNSTILE_SITE_KEY = options.turnstileSiteKey;
  return env;
}

export const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
