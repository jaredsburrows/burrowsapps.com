# auth.md

Agent authentication and registration discovery for `burrowsapps.com`.

## Summary

**No authentication is required, offered, or possible.** Burrows Applications has no login. Every URL this site publishes can be fetched anonymously, and nothing here issues a credential.

The site does run endpoints, and none of them takes a credential. Three are built for agents and serve read-only facts about the company anonymously: the JSON API under `/api/v1`, an MCP server at `/mcp`, and an A2A agent at `/a2a`. The fourth, `/api/contact`, is the backend of the site's contact form and is meant only for that form. Each is described below so that an agent learns this here rather than discovering it as a `404`.

## Sent here to sign in?

There is no sign-in on this site and nothing to authorize. If an app opened this page asking you to log in, close the window: nothing is waiting for you. Everything on [the home page](/) is free to read without any of this.

## For agents

- **Audience:** any automated client: crawlers, scrapers, research agents, LLM retrieval tools, and in-browser agents.
- **Registration endpoint:** none. No account can be created here, and there is no provisioning route to call.
- **Supported methods:** none. No credential is issued, accepted, or validated. In this spec's vocabulary the only identity type this origin supports is `anonymous`, and it is unconditional rather than a tier: every request is anonymous. The OAuth metadata's registration and claim fields point back at this page, because there is nothing to register and nothing to claim.
- **Credential use:** not applicable. Send no `Authorization` header; one will be ignored rather than honored.
- **Protected resources:** none. There is nothing behind a credential to reach.

No path named anywhere in this document is a registration endpoint. If a discovery scanner has handed you one for this origin, it misread this file: none of the endpoints described below creates an account or issues a credential, and there is nothing here to sign up for.

## The contact form endpoint

`POST /api/contact` is the backend of the contact form at [`/#contact`](/#contact). It is meant only for that form, and it is protected by bot checks and rate limits, not by any identity system: there is no credential, token, or API key for it, and none would be accepted.

Agents should not call it. If a person is present, send them to [the contact form](/#contact) or to contact@burrowsapps.com. In the person's browser, the homepage also registers a WebMCP tool named `send_contact_message` that fills in and submits that same form.

## The endpoints built for agents

`/api/v1` is a read-only JSON API with the company profile, its services, and a status endpoint. It is anonymous: send no credential, from any origin. It is described by [`/api/v1/openapi.json`](/api/v1/openapi.json), which is advertised as `service-desc` in [`/.well-known/api-catalog`](/.well-known/api-catalog). Its documentation is [`/developers.md`](/developers.md).

`/mcp` is a Model Context Protocol server over Streamable HTTP, with three read-only tools that return the same facts. It is anonymous in the same way. Its server card is at [`/mcp/server-card`](/mcp/server-card) and [`/.well-known/mcp/server-card.json`](/.well-known/mcp/server-card.json).

`/a2a` is an A2A agent (protocol 1.0, JSON-RPC) with three read-only skills that return the same facts. It is anonymous in the same way. Its Agent Card is at [`/.well-known/agent-card.json`](/.well-known/agent-card.json).

All three are rate limited for each IP address. None can send a message.

## The OAuth documents say no

[`/.well-known/oauth-authorization-server`](/.well-known/oauth-authorization-server) and [`/.well-known/oauth-protected-resource`](/.well-known/oauth-protected-resource) exist only to say no. Each labels itself `"available": false` and `"status": "not_offered"`, carries the standard fields only because readers of that format expect them, and points every endpoint field back at this page. No authorization server runs here, none of those fields describes a flow that works, and neither names a `jwks_uri`: there are no keys. `/.well-known/openid-configuration` is intentionally absent, since this origin is not an OpenID Provider.

There is no registration or provisioning route here under any name, so probing for one is wasted work. Nothing on this origin is protected and no issuer is operated, so there is no account to create and no credential to issue. Unknown paths answer `404`.

## Access policy

Crawl and training permissions are declared in [`/robots.txt`](/robots.txt) via `Content-Signal`, not here. That file is the authoritative statement of what automated clients may do with this content, and it grants every signal it carries: `search=yes, ai-input=yes, ai-train=yes`.

## Contact

Security reports: [`/.well-known/security.txt`](/.well-known/security.txt)

Anything else reaches Burrows Applications through [the contact form](/#contact), by hand, or at contact@burrowsapps.com.
