// A stateless, read-only A2A agent at /a2a: protocol 1.0, JSON-RPC binding.
// It never creates a task. Every SendMessage is answered with one direct
// Message holding fixed company facts from facts.ts, chosen by simple rules.
// Its Agent Card is a static file generated from AGENT_CARD (see documents.ts).

import { COMPANY, CONTACT, SERVICES, contactOptions } from "./facts.ts";
import { json } from "./http.ts";
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

export async function endpoint(_request: Request, _env: Env): Promise<Response> {
  return json(200, { jsonrpc: "2.0", id: null, error: { code: -32601, message: "Method not found" } });
}
