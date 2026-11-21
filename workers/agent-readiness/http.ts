// Shared types and small response helpers for every path the Worker owns.

import type { OriginFetch } from "./handler.ts";

export type { OriginFetch };
export type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

export type Env = {
  PUBLIC_LIMITER?: RateLimiter;
};

export type Deps = {
  originFetch: OriginFetch;
  passThrough(): void;
  now(): number;
  log(line: string): void;
};

export const ORIGIN = "https://burrowsapps.com";
export const CORS: Readonly<Record<string, string>> = { "Access-Control-Allow-Origin": "*" };

export function json(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

// For documents that are constants: GET, HEAD, and a CORS preflight.
export function staticDoc(request: Request, body: string, contentType: string, headers?: Record<string, string>): Response {
  if (request.method === "OPTIONS") return preflight("GET, HEAD, OPTIONS", "Content-Type, If-None-Match");
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD, OPTIONS");
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      ...CORS,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

export function preflight(methods: string, allowHeaders: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers": allowHeaders,
      "Access-Control-Max-Age": "86400",
    },
  });
}

export function methodNotAllowed(allowed: string): Response {
  return json(405, { error: "method_not_allowed" }, { Allow: allowed });
}

// Reads at most maxBytes of the body. Returns null when the declared length or
// the bytes that actually arrive exceed the cap; never buffers more than that.
export async function readBody(request: Request, maxBytes: number): Promise<string | null> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) > maxBytes) return null;
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// A missing binding or a throwing limiter is treated per onError: "open"
// allows the request, "closed" refuses it.
export async function allow(limiter: RateLimiter | undefined, key: string, onError: "open" | "closed"): Promise<boolean> {
  if (!limiter) return onError === "open";
  try {
    const { success } = await limiter.limit({ key });
    return success === true;
  } catch (error) {
    console.error("rate limiter error:", String(error));
    return onError === "open";
  }
}

export function tooMany(): Response {
  return json(429, { error: "rate_limited" }, { "Retry-After": "60" });
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
