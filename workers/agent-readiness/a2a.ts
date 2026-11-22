// A stateless, read-only A2A agent at /a2a: protocol 1.0, JSON-RPC binding.
// It never creates a task. Every SendMessage is answered with one direct
// Message holding fixed company facts from facts.ts, chosen by simple rules.
// Its Agent Card is a static file generated from AGENT_CARD (see documents.ts).

import { COMPANY, CONTACT, SERVICES, contactOptions } from "./facts.ts";
import { allow, clientIp, isObject, json, preflight, readBody, validOrigin } from "./http.ts";
import type { Env } from "./http.ts";

export const A2A_VERSION = "1.0";
export const AGENT_CARD_PATH = "/.well-known/agent-card.json";

const ENDPOINT_URL = "https://burrowsapps.com/a2a";
const MODES = ["text/plain", "application/json"] as const;

export type Skill = {
  id: string;
  name: string;
  description: string;
  tags: readonly string[];
  examples: readonly string[];
  inputModes: readonly string[];
  outputModes: readonly string[];
};

export const SKILLS: readonly Skill[] = [
  {
    id: "company-profile",
    name: "Company profile",
    description: "What Burrows Applications is, what it specializes in, and who founded it. Chosen when the message asks who the company is or what it is about, or when metadata.skillId is company-profile. The reply is one text part and one JSON data part with the company profile.",
    tags: ["company", "profile", "software-development"],
    examples: ["Who is Burrows Applications?", "Tell me about the company"],
    inputModes: ["text/plain"],
    outputModes: MODES,
  },
  {
    id: "services",
    name: "Services",
    description: "The kinds of software Burrows Applications builds: native Android and iOS apps, Kotlin Multiplatform apps, and websites. Chosen when the message asks what the company builds or offers, or names a platform, or when metadata.skillId is services. The reply is one text part and one JSON data part listing the services.",
    tags: ["services", "android", "ios", "kotlin-multiplatform", "websites"],
    examples: ["What does Burrows Applications build?", "Do you build Kotlin Multiplatform apps?"],
    inputModes: ["text/plain"],
    outputModes: MODES,
  },
  {
    id: "contact-options",
    name: "Contact options",
    description: "How to get in touch with Burrows Applications: the contact form and its field limits, email, and social links. Chosen when the message asks how to contact or hire the company, or when metadata.skillId is contact-options. This agent cannot send the message itself. The reply is one text part and one JSON data part with the contact options.",
    tags: ["contact", "hire", "inquiry"],
    examples: ["How do I contact Burrows Applications?", "How can I hire you to build an app?"],
    inputModes: ["text/plain"],
    outputModes: MODES,
  },
];

export const AGENT_CARD: Record<string, unknown> = {
  name: "Burrows Applications",
  description: "Read-only facts about Burrows Applications, a software company that builds native Android and iOS apps, Kotlin Multiplatform apps, and websites. Replies are fixed company data chosen by simple rules, not generated text. This agent cannot send a message, book work, or store anything you send. Anonymous; no login.",
  supportedInterfaces: [{ url: ENDPOINT_URL, protocolBinding: "JSONRPC", protocolVersion: A2A_VERSION }],
  provider: { organization: "Burrows Applications", url: "https://burrowsapps.com/" },
  iconUrl: "https://burrowsapps.com/static/img/apple-touch-icon.png",
  documentationUrl: "https://burrowsapps.com/developers.md",
  version: "1.0.0",
  capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: MODES,
  skills: SKILLS,
};

export type Answer = { text: string; data: Record<string, unknown> };

// The dispatch table: what SendMessage answers for each skill on the card.
// The text is rendered from the same facts as the data.
export const ANSWERS: Readonly<Record<string, () => Answer>> = {
  "company-profile": () => ({
    text: `${COMPANY.name}: ${COMPANY.description} Founded by ${COMPANY.founder}. Website: ${COMPANY.website}`,
    data: { ...COMPANY },
  }),
  services: () => ({
    text: [`${COMPANY.name} builds:`, ...SERVICES.map(({ name, description }) => `- ${name}: ${description}`)].join("\n"),
    data: { services: SERVICES },
  }),
  "contact-options": () => {
    const { name, email, message } = CONTACT.formFields;
    return {
      text: [
        `Contact form: ${CONTACT.form} (name up to ${name.maxLength} characters, email up to ${email.maxLength}, message up to ${message.maxLength}).`,
        `Email: ${CONTACT.email}`,
        `LinkedIn: ${CONTACT.linkedin}`,
        `X: ${CONTACT.x}`,
        "This agent cannot send a message for you.",
      ].join("\n"),
      data: contactOptions(),
    };
  },
};

export function helpAnswer(): Answer {
  return {
    text: [
      "This agent answers with fixed facts about Burrows Applications. It cannot send messages, book work, or store anything. Ask about one of these, or set metadata.skillId to its id:",
      ...SKILLS.map(({ id, name }) => `- ${id}: ${name}`),
    ].join("\n"),
    data: { skills: SKILLS.map(({ id, name, description }) => ({ id, name, description })) },
  };
}

const MAX_BODY = 65536;
const MAX_ID_LENGTH = 128;
const VERSION_PATTERN = /^(\d+)\.(\d+)(?:\.\d+)?$/;
// What an empty or missing A2A-Version means, per the specification.
const DEFAULT_VERSION = "0.3";
const NO_STORE = { "Cache-Control": "no-store" };

type Id = string | number;
type RpcRequest = { jsonrpc: "2.0"; method: string; id?: Id; params?: unknown };

// The A2A errors, each with the ErrorInfo reason its data array carries.
// Standard JSON-RPC errors carry no data.
const REASONS: Readonly<Record<number, string>> = {
  [-32001]: "TASK_NOT_FOUND",
  [-32003]: "PUSH_NOTIFICATION_NOT_SUPPORTED",
  [-32004]: "UNSUPPORTED_OPERATION",
  [-32005]: "CONTENT_TYPE_NOT_SUPPORTED",
  [-32009]: "VERSION_NOT_SUPPORTED",
};

function errorInfo(code: number): unknown[] | undefined {
  const reason = REASONS[code];
  if (reason === undefined) return undefined;
  const info: Record<string, unknown> = { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "a2a-protocol.org" };
  if (code === -32009) info.metadata = { supportedVersions: A2A_VERSION };
  return [info];
}

function rpcResult(id: Id, result: unknown): Response {
  return json(200, { jsonrpc: "2.0", id, result }, NO_STORE);
}

// id undefined: omitted (the body was never read). id null: the body was read
// but no usable id was found in it.
function rpcError(
  id: Id | null | undefined,
  code: number,
  message: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const data = errorInfo(code);
  const error = data === undefined ? { code, message } : { code, message, data };
  return json(status, { jsonrpc: "2.0", ...(id === undefined ? {} : { id }), error }, { ...NO_STORE, ...headers });
}

function accepted(): Response {
  return new Response(null, { status: 202, headers: { "Access-Control-Allow-Origin": "*", ...NO_STORE } });
}

const validId = (id: unknown): id is Id =>
  (typeof id === "string" && id.length <= MAX_ID_LENGTH) || (typeof id === "number" && Number.isFinite(id));

function acceptedContentType(header: string | null): boolean {
  const type = (header ?? "").toLowerCase();
  return type.startsWith("application/json") || type.startsWith("application/a2a+json");
}

// The A2A-Version header, else the query parameter. The value is compared as
// Major.Minor and never echoed.
function supportedVersion(request: Request): boolean {
  const header = request.headers.get("A2A-Version")?.trim() ?? "";
  const query = new URL(request.url).searchParams.get("A2A-Version")?.trim() ?? "";
  const match = VERSION_PATTERN.exec(header || query || DEFAULT_VERSION);
  return match !== null && `${match[1]}.${match[2]}` === A2A_VERSION;
}

// The SendMessageResponse: always a direct message, never a task. Only the
// parts whose media type the client accepts; null when none is left.
function buildReply(skillId: string, answer: Answer, contextId: string, modes: readonly string[]): Record<string, unknown> | null {
  const parts = [
    { text: answer.text, mediaType: "text/plain" },
    { data: answer.data, mediaType: "application/json" },
  ].filter((part) => modes.includes(part.mediaType));
  if (parts.length === 0) return null;
  return {
    message: { messageId: crypto.randomUUID(), contextId, role: "ROLE_AGENT", parts, metadata: { skillId } },
  };
}

const PART_KINDS = ["text", "raw", "url", "data"] as const;
const MAX_PARTS = 16;
const CONTEXT_ID = /^[A-Za-z0-9._:-]{1,128}$/;

// Checked in order; the first match wins.
const KEYWORDS: readonly (readonly [string, RegExp])[] = [
  ["contact-options", /\b(contact|email|e-mail|reach|touch|hire|hiring|inquiry|inquire|quote)\b/],
  ["services", /\b(services?|builds?|building|offers?|platforms?|android|ios|kotlin|multiplatform|kmp|websites?|apps?)\b/],
  ["company-profile", /\b(who|about|company|profile|founder|founded|what is)\b/],
];

const knownSkill = (value: unknown): value is string => typeof value === "string" && Object.hasOwn(ANSWERS, value);

function metadataSkill(metadata: unknown): unknown {
  return isObject(metadata) ? metadata.skillId : undefined;
}

// metadata.skillId on the message, then on the request; then the text equal
// to a skill id; then the keyword rules; otherwise the help reply.
function chooseSkill(message: Record<string, unknown>, params: Record<string, unknown>, text: string): string {
  for (const candidate of [metadataSkill(message.metadata), metadataSkill(params.metadata)]) {
    if (knownSkill(candidate)) return candidate;
  }
  if (knownSkill(text)) return text;
  for (const [skillId, pattern] of KEYWORDS) {
    if (pattern.test(text)) return skillId;
  }
  return "help";
}

function validParts(parts: unknown): parts is Record<string, unknown>[] {
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > MAX_PARTS) return false;
  return parts.every((part) => isObject(part) && PART_KINDS.filter((kind) => part[kind] !== undefined).length === 1);
}

const isTextPart = (part: Record<string, unknown>): boolean =>
  typeof part.text === "string" && (part.mediaType === undefined || part.mediaType === "text/plain");

const mediaType = (value: unknown): string =>
  typeof value === "string" ? (value.split(";")[0] ?? "").trim().toLowerCase() : "";

function sendMessage(id: Id, params: Record<string, unknown>): Response {
  const message = params.message;
  if (
    !isObject(message)
    || message.role !== "ROLE_USER"
    || typeof message.messageId !== "string"
    || message.messageId === ""
    || message.messageId.length > MAX_ID_LENGTH
    || !validParts(message.parts)
  ) {
    return rpcError(id, -32602, "Invalid params");
  }
  const parts = message.parts as Record<string, unknown>[];
  if (!parts.every(isTextPart)) {
    if (parts.some((part) => part.text !== undefined && typeof part.text !== "string")) return rpcError(id, -32602, "Invalid params");
    return rpcError(id, -32005, "Content type not supported");
  }
  if (message.taskId !== undefined) return rpcError(id, -32001, "Task not found");
  if (message.contextId !== undefined && (typeof message.contextId !== "string" || !CONTEXT_ID.test(message.contextId))) {
    return rpcError(id, -32602, "Invalid params");
  }
  const configuration = params.configuration ?? {};
  if (!isObject(configuration)) return rpcError(id, -32602, "Invalid params");
  if (configuration.taskPushNotificationConfig !== undefined || configuration.pushNotificationConfig !== undefined) {
    return rpcError(id, -32003, "Push notifications are not supported");
  }
  const accepted = configuration.acceptedOutputModes;
  if (accepted !== undefined && !Array.isArray(accepted)) return rpcError(id, -32602, "Invalid params");
  const modes = Array.isArray(accepted) && accepted.length > 0 ? accepted.map(mediaType) : [...MODES];

  const text = parts.map((part) => part.text).join(" ").toLowerCase().trim();
  const skillId = chooseSkill(message, params, text);
  const answer = skillId === "help" ? helpAnswer() : ANSWERS[skillId]();
  const contextId = typeof message.contextId === "string" ? message.contextId : crypto.randomUUID();
  const reply = buildReply(skillId, answer, contextId, modes);
  if (reply === null) return rpcError(id, -32005, "Content type not supported");
  return rpcResult(id, reply);
}

// No task is ever created, so no task id names one.
function taskById(id: Id, params: Record<string, unknown>): Response {
  if (typeof params.id !== "string" || params.id === "") return rpcError(id, -32602, "Invalid params");
  return rpcError(id, -32001, "Task not found");
}

function dispatch(id: Id, method: string, params: Record<string, unknown>): Response {
  switch (method) {
    case "SendMessage":
      return sendMessage(id, params);
    case "GetTask":
    case "CancelTask":
      return taskById(id, params);
    case "ListTasks":
      return rpcResult(id, { tasks: [], nextPageToken: "", pageSize: 0, totalSize: 0 });
    case "SendStreamingMessage":
    case "SubscribeToTask":
    case "GetExtendedAgentCard":
      return rpcError(id, -32004, "Unsupported operation");
    case "CreateTaskPushNotificationConfig":
    case "GetTaskPushNotificationConfig":
    case "ListTaskPushNotificationConfigs":
    case "DeleteTaskPushNotificationConfig":
      return rpcError(id, -32003, "Push notifications are not supported");
    default:
      return rpcError(id, -32601, "Method not found");
  }
}

export async function endpoint(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return preflight("POST, OPTIONS", "Content-Type, Accept, A2A-Version, A2A-Extensions");
  }
  if (request.method !== "POST") {
    return rpcError(undefined, -32600, "Method not allowed. Send JSON-RPC over POST.", 405, { Allow: "POST, OPTIONS" });
  }
  // The agent holds no credentials and no private data, so any web origin may
  // call it; the check rejects only malformed origins.
  if (!validOrigin(request.headers.get("Origin"))) return rpcError(undefined, -32600, "Origin not allowed", 403);
  if (!(await allow(env.PUBLIC_LIMITER, clientIp(request), "open"))) {
    return rpcError(undefined, 429, "Too many requests", 429, { "Retry-After": "60" });
  }
  if (!acceptedContentType(request.headers.get("Content-Type"))) {
    return rpcError(undefined, -32600, "Content-Type must be application/json", 415);
  }
  const text = await readBody(request, MAX_BODY);
  if (text === null) return rpcError(undefined, -32600, "Request too large", 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return rpcError(null, -32700, "Parse error");
  }
  if (Array.isArray(parsed)) return rpcError(null, -32600, "Batch requests are not supported");
  if (
    !isObject(parsed)
    || parsed.jsonrpc !== "2.0"
    || typeof parsed.method !== "string"
    || ("id" in parsed && !validId(parsed.id))
  ) {
    return rpcError(null, -32600, "Invalid Request");
  }
  const message = parsed as RpcRequest;
  // A notification: A2A defines none, so nothing is processed.
  if (message.id === undefined) return accepted();
  const id = message.id;
  if (!supportedVersion(request)) return rpcError(id, -32009, "Version not supported");
  if (message.params !== undefined && !isObject(message.params)) return rpcError(id, -32602, "Invalid params");
  const params = isObject(message.params) ? message.params : {};
  if (params.tenant !== undefined && params.tenant !== "") return rpcError(id, -32602, "Unknown tenant");
  return dispatch(id, message.method, params);
}
