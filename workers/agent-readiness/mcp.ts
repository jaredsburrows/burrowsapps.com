// A stateless, read-only MCP server at /mcp. It speaks the 2026-07-28
// revision, where every request carries its protocol version, and answers the
// initialize handshake of 2025-03-26 to 2025-11-25 for older clients. JSON
// responses only: no sessions, no SSE stream, nothing kept between requests.

import { COMPANY, SERVICES, contactOptions } from "./facts.ts";
import { allow, clientIp, json, preflight, readBody, staticDoc } from "./http.ts";
import type { Deps, Env } from "./http.ts";

export const SERVER = { name: "com.burrowsapps/site", title: "Burrows Applications", version: "1.0.0" } as const;
export const MODERN_VERSION = "2026-07-28";
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const SUPPORTED_VERSIONS: readonly string[] = [MODERN_VERSION, ...LEGACY_VERSIONS];
export const INSTRUCTIONS = "Read-only facts about Burrows Applications, a software company that builds native Android and iOS apps, Kotlin Multiplatform apps, and websites. Call get_contact_options to learn how to send an inquiry; this server cannot send one.";

const META_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";
const MAX_BODY = 65536;
const TTL_MS = 3600000;
const CAPABILITIES = { tools: { listChanged: false } } as const;

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const NO_ARGUMENTS = { type: "object", additionalProperties: false } as const;

export const TOOLS: readonly Tool[] = [
  {
    name: "get_company_profile",
    title: "Company profile",
    description: "What Burrows Applications is and what it specializes in.",
    inputSchema: NO_ARGUMENTS,
    annotations: READ_ONLY,
  },
  {
    name: "list_services",
    title: "Services",
    description: "The kinds of software Burrows Applications builds.",
    inputSchema: NO_ARGUMENTS,
    annotations: READ_ONLY,
  },
  {
    name: "get_contact_options",
    title: "Contact options",
    description: "How to get in touch with Burrows Applications, including the contact form's field limits.",
    inputSchema: NO_ARGUMENTS,
    annotations: READ_ONLY,
  },
];

function toolData(name: unknown, authOn: boolean): Record<string, unknown> | null {
  switch (name) {
    case "get_company_profile":
      return { ...COMPANY };
    case "list_services":
      return { services: SERVICES };
    case "get_contact_options":
      return contactOptions(authOn);
    default:
      return null;
  }
}

const ENDPOINT_PATH = "/mcp";

// One document for both locations: the current server card format ($schema,
// name, version, description, remotes) plus the SEP-1649 fields that older
// readers look for (serverInfo, protocolVersion, transport, capabilities).
export const CARD: Record<string, unknown> = {
  $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
  name: SERVER.name,
  version: SERVER.version,
  title: SERVER.title,
  description: "Read-only facts about Burrows Applications: what it builds and how to get in touch.",
  websiteUrl: "https://burrowsapps.com/",
  remotes: [
    {
      type: "streamable-http",
      url: `https://burrowsapps.com${ENDPOINT_PATH}`,
      supportedProtocolVersions: SUPPORTED_VERSIONS,
    },
  ],
  serverInfo: { name: SERVER.name, title: SERVER.title, version: SERVER.version },
  protocolVersion: MODERN_VERSION,
  transport: { type: "streamable-http", endpoint: ENDPOINT_PATH },
  capabilities: CAPABILITIES,
};

const CARD_BODY = JSON.stringify(CARD);
const CARD_HEADERS = {
  "Cache-Control": "public, max-age=3600",
  "Access-Control-Allow-Methods": "GET",
  "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
  "Access-Control-Expose-Headers": "ETag",
};

export function card(request: Request, url: URL): Response {
  const contentType = url.pathname === "/mcp/server-card" ? "application/mcp-server-card+json" : "application/json";
  return staticDoc(request, CARD_BODY, contentType, CARD_HEADERS);
}

type Message = { jsonrpc: "2.0"; method: string; id?: string | number; params?: unknown };

const NO_STORE = { "Cache-Control": "no-store" };

function rpcResult(id: string | number | undefined, result: unknown, status = 200): Response {
  return json(status, { jsonrpc: "2.0", ...(id === undefined ? {} : { id }), result }, NO_STORE);
}

function rpcError(
  id: string | number | undefined,
  code: number,
  message: string,
  status: number,
  data?: unknown,
  headers: Record<string, string> = {},
): Response {
  const error = data === undefined ? { code, message } : { code, message, data };
  return json(status, { jsonrpc: "2.0", ...(id === undefined ? {} : { id }), error }, { ...NO_STORE, ...headers });
}

function accepted(): Response {
  return new Response(null, { status: 202, headers: { "Access-Control-Allow-Origin": "*", ...NO_STORE } });
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function validOrigin(origin: string | null): boolean {
  if (origin === null) return true;
  try {
    const { protocol } = new URL(origin);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

// Mcp-Name may be sent as "=?base64?<b64>?=" for names that are not plain ASCII.
function decodeName(header: string | null): string | null {
  if (header === null) return null;
  if (!header.startsWith("=?base64?") || !header.endsWith("?=")) return header;
  try {
    const binary = atob(header.slice("=?base64?".length, -"?=".length));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function hasNoArguments(params: Record<string, unknown>): boolean {
  if (!("arguments" in params) || params.arguments === undefined) return true;
  return isObject(params.arguments) && Object.keys(params.arguments).length === 0;
}

// The tools/call result for a known tool, or null for an unknown one.
function callTool(params: Record<string, unknown>, authOn: boolean): Record<string, unknown> | null {
  const data = toolData(params.name, authOn);
  if (data === null) return null;
  if (!hasNoArguments(params)) {
    return { content: [{ type: "text", text: "This tool takes no arguments." }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, isError: false };
}

function modern(request: Request, message: Message, params: Record<string, unknown>, authOn: boolean): Response {
  if (message.id === undefined) return accepted();
  const id = message.id;
  const meta = isObject(params._meta) ? params._meta : {};
  const version = meta[META_VERSION];
  if (typeof version !== "string" || !isObject(meta[META_CAPABILITIES])) {
    return rpcError(id, -32602, "Missing required _meta fields", 400);
  }
  if (request.headers.get("MCP-Protocol-Version") !== version) {
    return rpcError(id, -32020, "Header mismatch: MCP-Protocol-Version", 400);
  }
  if (version !== MODERN_VERSION) {
    return rpcError(id, -32022, "Unsupported protocol version", 400, { supported: SUPPORTED_VERSIONS, requested: version });
  }
  if (request.headers.get("Mcp-Method") !== message.method) {
    return rpcError(id, -32020, "Header mismatch: Mcp-Method", 400);
  }
  if (message.method === "tools/call" && decodeName(request.headers.get("Mcp-Name")) !== params.name) {
    return rpcError(id, -32020, "Header mismatch: Mcp-Name", 400);
  }

  const complete = (result: Record<string, unknown>): Response =>
    rpcResult(id, {
      ...result,
      resultType: "complete",
      _meta: { [META_SERVER_INFO]: { name: SERVER.name, version: SERVER.version } },
    });

  switch (message.method) {
    case "server/discover":
      return complete({
        supportedVersions: SUPPORTED_VERSIONS,
        capabilities: CAPABILITIES,
        instructions: INSTRUCTIONS,
        ttlMs: TTL_MS,
        cacheScope: "public",
      });
    case "tools/list":
      return complete({ tools: TOOLS, ttlMs: TTL_MS, cacheScope: "public" });
    case "tools/call": {
      const result = callTool(params, authOn);
      if (result === null) return rpcError(id, -32602, "Unknown tool", 400);
      return complete(result);
    }
    default:
      return rpcError(id, -32601, "Method not found", 404);
  }
}

// 2025-03-26 to 2025-11-25: JSON-RPC errors travel with HTTP 200. No state is
// kept, so a client that skips initialize is still served.
function legacy(message: Message, params: Record<string, unknown>, authOn: boolean): Response {
  if (message.id === undefined) return accepted();
  const id = message.id;
  switch (message.method) {
    case "initialize": {
      const requested = params.protocolVersion;
      const protocolVersion = typeof requested === "string" && (LEGACY_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : "2025-11-25";
      return rpcResult(id, { protocolVersion, capabilities: CAPABILITIES, serverInfo: SERVER, instructions: INSTRUCTIONS });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const result = callTool(params, authOn);
      if (result === null) return rpcError(id, -32602, "Unknown tool", 200);
      return rpcResult(id, result);
    }
    default:
      return rpcError(id, -32601, "Method not found", 200);
  }
}

export async function endpoint(request: Request, env: Env, _deps: Deps, authOn: boolean): Promise<Response> {
  if (request.method === "OPTIONS") {
    return preflight("POST, OPTIONS", "Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id");
  }
  if (request.method !== "POST") {
    return rpcError(undefined, -32600, "Method not allowed. Send JSON-RPC over POST.", 405, undefined, { Allow: "POST, OPTIONS" });
  }
  // The server holds no credentials and no private data, so any web origin may
  // call it; the check rejects only malformed origins.
  if (!validOrigin(request.headers.get("Origin"))) return rpcError(undefined, -32600, "Origin not allowed", 403);
  if (!(await allow(env.PUBLIC_LIMITER, clientIp(request), "open"))) {
    return rpcError(undefined, 429, "Too many requests", 429, undefined, { "Retry-After": "60" });
  }
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) {
    return rpcError(undefined, -32600, "Content-Type must be application/json", 415);
  }
  const text = await readBody(request, MAX_BODY);
  if (text === null) return rpcError(undefined, -32600, "Request too large", 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return rpcError(undefined, -32700, "Parse error", 400);
  }
  if (
    !isObject(parsed)
    || parsed.jsonrpc !== "2.0"
    || typeof parsed.method !== "string"
    || ("id" in parsed && !(typeof parsed.id === "string" || (typeof parsed.id === "number" && Number.isFinite(parsed.id))))
  ) {
    return rpcError(undefined, -32600, "Invalid Request", 400);
  }
  const message = parsed as Message;
  const params = isObject(message.params) ? message.params : {};
  const metaVersion = isObject(params._meta) ? params._meta[META_VERSION] : undefined;
  const header = request.headers.get("MCP-Protocol-Version");
  const isModern = typeof metaVersion === "string" || (header !== null && !(LEGACY_VERSIONS as readonly string[]).includes(header));
  if (isModern) return modern(request, message, params, authOn);
  return legacy(message, params, authOn);
}
