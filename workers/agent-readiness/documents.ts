// The documents that are committed as static files. Each is generated from
// the constant it describes by tools/write-documents.ts, and
// tests/static-documents.test.ts fails when a committed file differs.
// Nothing the Worker runs imports this module.

import { AGENT_CARD, AGENT_CARD_PATH } from "./a2a.ts";
import { CATALOG } from "./api.ts";
import { CARD, CARD_PATH, CARD_WELL_KNOWN_PATH } from "./mcp.ts";
import { AUTHORIZATION_SERVER, PROTECTED_RESOURCE } from "./wellknown.ts";

// Site path -> exact file content: the body the Worker used to send, plus a
// final newline.
export const DOCUMENTS: Readonly<Record<string, string>> = {
  "/.well-known/api-catalog": `${JSON.stringify(CATALOG)}\n`,
  "/.well-known/oauth-authorization-server": `${JSON.stringify(AUTHORIZATION_SERVER, null, 2)}\n`,
  "/.well-known/oauth-protected-resource": `${JSON.stringify(PROTECTED_RESOURCE, null, 2)}\n`,
  [CARD_PATH]: `${JSON.stringify(CARD)}\n`,
  [CARD_WELL_KNOWN_PATH]: `${JSON.stringify(CARD)}\n`,
  [AGENT_CARD_PATH]: `${JSON.stringify(AGENT_CARD)}\n`,
};
