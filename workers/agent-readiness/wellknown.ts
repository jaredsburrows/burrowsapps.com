// The two OAuth metadata documents. They exist to say that this site has no
// login: no authorization server runs here and nothing takes a credential.
// The standard fields are there because readers of the format expect them,
// and every endpoint field points at /auth.md, which says the same thing.
// There is deliberately no jwks_uri: there are no keys.
//
// They are served by the Worker because GitHub Pages cannot give an
// extensionless file the application/json type.

import { staticDoc } from "./http.ts";

const SITE = "https://burrowsapps.com";
const AUTH_MD = `${SITE}/auth.md`;
const NO_LOGIN = "Burrows Applications has no login. No authorization server runs on this origin, and nothing here needs or accepts a credential.";

const DISCOVERY = {
  mcp_url: `${SITE}/mcp`,
  mcp_server_card_url: `${SITE}/.well-known/mcp/server-card.json`,
  api_catalog_url: `${SITE}/.well-known/api-catalog`,
} as const;

export const AUTHORIZATION_SERVER: Record<string, unknown> = {
  status: "not_offered",
  available: false,
  message: NO_LOGIN,
  description: `This document exists so that tools looking for OAuth metadata get an explicit answer. The standard fields are present because readers of this format expect them, and the grant, response, scope and identity values are placeholders: none describes a working flow. Every endpoint field points at ${AUTH_MD}, which explains that there is no login. Clients must not attempt authorization, registration, claim or token requests.`,
  issuer: SITE,
  authorization_endpoint: `${AUTH_MD}?endpoint=authorization`,
  token_endpoint: `${AUTH_MD}?endpoint=token`,
  grant_types_supported: ["authorization_code"],
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
  scopes_supported: ["public"],
  service_documentation: AUTH_MD,
  agent_auth: {
    status: "not_offered",
    available: false,
    message: "Burrows Applications has no login. There is nothing to register, nothing to claim and no credential to obtain.",
    skill: AUTH_MD,
    register_uri: `${AUTH_MD}?endpoint=register`,
    claim_uri: `${AUTH_MD}?endpoint=claim`,
    identity_types_supported: ["anonymous"],
    anonymous: {
      status: "not_offered",
      available: false,
      message: "Every request to Burrows Applications is already anonymous. No credential is issued, and one sent is ignored.",
      credential_types_supported: ["access_token"],
    },
  },
  ...DISCOVERY,
};

export const PROTECTED_RESOURCE: Record<string, unknown> = {
  status: "not_offered",
  available: false,
  message: NO_LOGIN,
  description: "This document exists so that tools looking for OAuth metadata get an explicit answer. The standard fields are present because readers of this format expect them, and the scope and bearer values are placeholders: nothing on this origin is protected and none of this describes a working flow. Clients must not attempt authorization, registration, claim or token requests; every URL here can be fetched without a credential.",
  resource: SITE,
  authorization_servers: [SITE],
  scopes_supported: ["public"],
  bearer_methods_supported: ["header"],
  resource_documentation: AUTH_MD,
  ...DISCOVERY,
};

const BODIES: Readonly<Record<string, string>> = {
  "/.well-known/oauth-authorization-server": JSON.stringify(AUTHORIZATION_SERVER, null, 2),
  "/.well-known/oauth-protected-resource": JSON.stringify(PROTECTED_RESOURCE, null, 2),
};

export const OAUTH_PATHS: readonly string[] = Object.keys(BODIES);

export function oauthDocument(request: Request, url: URL): Response {
  return staticDoc(request, BODIES[url.pathname], "application/json", { "Cache-Control": "public, max-age=3600" });
}
