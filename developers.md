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

Protocol versions: `2026-07-28`, and `2025-11-25`, `2025-06-18`, and `2025-03-26` through the `initialize` handshake.

Server card: https://burrowsapps.com/mcp/server-card

Tools, all read-only and without arguments: `get_company_profile`, `list_services`, `get_contact_options`.

## Sending a project inquiry (needs a person's approval)

`POST /api/v1/inquiries` emails a project inquiry to Burrows Applications. It needs an OAuth access token that a person approves in their browser. The steps are in https://burrowsapps.com/auth.md. If that file returns `404`, the inquiry API is switched off; use the contact form or email instead.

## Limits

Public API and MCP: 60 requests a minute for each IP address. A `429` response carries `Retry-After`.

## Other ways to get in touch

- Contact form: https://burrowsapps.com/#contact
- Email: contact@burrowsapps.com
- Agents in a browser: the homepage registers a WebMCP tool named `send_contact_message`.

Privacy policy: https://burrowsapps.com/privacy.html
