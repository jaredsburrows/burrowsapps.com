# Burrows Applications for developers and agents

Machine-readable ways to learn what Burrows Applications does and to get in touch. Everything here is served from https://burrowsapps.com/.

## Public API (no authentication)

Base URL: `https://burrowsapps.com/api/v1`. Read-only JSON, `GET` and `HEAD` only, CORS enabled.

| Endpoint | Returns |
|---|---|
| `GET /api/v1` | An index of the endpoints below |
| `GET /api/v1/company` | Company profile, services, and contact options |
| `GET /api/v1/services` | The services the company offers |
| `GET /api/v1/status` | Health check: `"status": "ok"` with the API version and the time |
| `GET /api/v1/openapi.json` | OpenAPI 3.1 description of this API |

API catalog (RFC 9727): https://burrowsapps.com/.well-known/api-catalog

## MCP server (no authentication)

Endpoint: `https://burrowsapps.com/mcp`. Streamable HTTP, `POST` only, JSON responses, stateless.

Protocol versions: `2026-07-28`, and `2025-11-25` and `2025-06-18` through the `initialize` handshake.

Server card: https://burrowsapps.com/mcp/server-card

Tools, all read-only and without arguments: `get_company_profile`, `list_services`, `get_contact_options`.

## A2A agent (no authentication)

Endpoint: `https://burrowsapps.com/a2a`. A2A protocol `1.0`, JSON-RPC binding, `POST` only, stateless. Send the `A2A-Version: 1.0` header.

Agent Card: https://burrowsapps.com/.well-known/agent-card.json

Skills: `company-profile`, `services`, `contact-options`. `SendMessage` answers with a message, never a task; pick a skill with `metadata.skillId` or ask in plain words. No streaming, no push notifications.

## No login

Nothing here needs a credential, and none is offered. The contact form's endpoint, `/api/contact`, is meant only for the form on burrowsapps.com and is protected by bot checks and rate limits. To send a message, use the form or email.

## Limits

Public API, MCP, and A2A: 60 requests a minute for each IP address. A `429` response carries `Retry-After`.

## Other ways to get in touch

- Contact form: https://burrowsapps.com/#contact
- Email: contact@burrowsapps.com
- Agents in a browser: the homepage registers a WebMCP tool named `send_contact_message`.

Privacy policy: https://burrowsapps.com/privacy.html
