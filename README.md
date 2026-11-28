# burrowsapps.com

Burrows Applications website

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](http://www.apache.org/licenses/LICENSE-2.0)
[![Build](https://github.com/jaredsburrows/burrowsapps.com/workflows/build/badge.svg)](https://github.com/jaredsburrows/burrowsapps.com/actions)
[![Twitter Follow](https://img.shields.io/twitter/follow/jaredsburrows.svg?style=social)](https://twitter.com/jaredsburrows)

Business website: static files plus a small Worker, served by Cloudflare as the Worker `burrowsapps-com`. No build step. CI deploys it on every push to `gh-pages`.

### Preview the website

Open `index.html` in a browser, or serve the directory:

```
python3 -m http.server
```

For a preview with production routing, `_headers`, and the 404 page:

```
npx wrangler dev
```

### Agent readiness

Files and endpoints that tell AI agents and crawlers what this site is and how to use it. Everything here describes something the site really has. There is no login: nothing on the site takes a credential, and the OAuth documents and `auth.md` exist to say so.

#### What is published

| Path | Purpose | Served by | Spec |
|---|---|---|---|
| `/robots.txt` | Crawl policy, with explicit groups for AI crawlers and a `Content-Signal` line in every group | File | [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309), [Content Signals](https://contentsignals.org/) |
| `/index.md`, `/privacy.md` | Markdown versions of `/` and `/privacy.html`; also served from those URLs to `Accept: text/markdown` | File, negotiated by the Worker | [Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/) |
| `/.well-known/agent-skills/index.json` and the skill it lists | What Burrows Applications builds and how to get in touch | File | [Agent Skills Discovery v0.2.0](https://github.com/cloudflare/agent-skills-discovery-rfc) |
| `/.well-known/ai-catalog.json`, `/.well-known/ard.json` | ARD manifest: the skill, the MCP server, the A2A agent, and the public API. Identical bytes at both paths | File | [ARD](https://github.com/ards-project/ard-spec) |
| `/developers.md` | Documentation for the API, the MCP server, and the A2A agent | File | |
| `/api/v1`, `/api/v1/company`, `/api/v1/services`, `/api/v1/status` | Read-only JSON API with the company facts from `workers/agent-readiness/facts.ts` | Worker | |
| `/api/v1/openapi.json` | OpenAPI 3.1 description of that API | Worker | [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) |
| `/.well-known/api-catalog` | API catalog listing the API, the MCP server, and the A2A agent | File, generated | [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727) |
| `/mcp` | Stateless, read-only MCP server with three tools (2026-07-28, plus the `initialize` handshake for 2025-06-18 and 2025-11-25 clients) | Worker | [MCP](https://modelcontextprotocol.io/) |
| `/mcp/server-card`, `/.well-known/mcp/server-card.json` | MCP server card, one document at both paths | File, generated | SEP-2127 |
| `/a2a` | Stateless, read-only A2A agent (protocol 1.0, JSON-RPC) with three skills; answers every `SendMessage` with a message, never a task | Worker | [A2A](https://a2a-protocol.org/latest/specification/) |
| `/.well-known/agent-card.json` | A2A Agent Card for `/a2a` | File, generated | [A2A](https://a2a-protocol.org/latest/specification/) |
| `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` | OAuth metadata that says `"status": "not_offered"`: no authorization server runs here | File, generated | [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414), [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) |
| `/auth.md` | Says that no authentication is required, offered, or possible, and that `/api/contact` is meant only for the contact form | File | [auth.md](https://workos.com/auth-md/docs/auth-md) |
| `static/js/home.js` | Registers the contact form as the WebMCP tool `send_contact_message` in browsers that support it | File | [WebMCP](https://webmachinelearning.github.io/webmcp/) |
| `_index._agents.burrowsapps.com` | DNS-AID record (see below) | DNS | DNS-AID draft |

"Generated" files are written from constants in the Worker source by `workers/agent-readiness/tools/write-documents.ts` and committed.

#### Keeping things in sync

The tests fail when any of these drift:

- Edit `index.html` or `privacy.html`: make the same edit in `index.md` or `privacy.md`.
- Edit the company facts in `workers/agent-readiness/facts.ts`: they must still appear in `index.md` or `SKILL.md`, and the form limits must equal the ones in `workers/contact/index.js`.
- Change `PUBLIC_LIMITER` in the root `wrangler.jsonc`: change the figure in `developers.md` too.
- Edit `CATALOG`, `CARD`, `AGENT_CARD`, or the OAuth documents: run `node workers/agent-readiness/tools/write-documents.ts` and commit the result.
- Publish a new file: add it to `PUBLISHED_FILES` in `tests/support/published-files.ts`, run `node tests/support/write-assetsignore.ts`, and commit both. Nothing else is uploaded.
- Edit `SKILL.md`: recompute its digest and put it in `index.json` as `sha256:<hash>`:

  ```
  shasum -a 256 .well-known/agent-skills/contact-burrows-applications/SKILL.md
  ```

- Edit `.well-known/ai-catalog.json`: copy it over `.well-known/ard.json` (`cp .well-known/ai-catalog.json .well-known/ard.json`).
- Add anything that reads a credential or answers `401`: the OAuth documents and `auth.md` are then wrong, and a test says so.
- Edit a service: change it in `workers/agent-readiness/facts.ts`, in its card in `index.html`, in `index.md`, and in the `hasOfferCatalog` block in `index.html`; a changed name also in the list in `SKILL.md` (then recompute the digest). The tests fail until all of them agree.
- Add or remove a technology: change the chip in `index.html`, the list in `index.md`, `knowsAbout` in the structured data, and the approved list in `tests/home-content.test.ts`.
- Change the homepage title or search description: change all three copies in `<head>` (the tag itself, the Open Graph one, the Twitter one) and the constant in `tests/home-content.test.ts`.
- Change `static/css/home.css`: raise the number in `?v=` on the stylesheet link in `index.html`, `privacy.html`, and `404.html`. Browsers keep the stylesheet for an hour.

#### Running the tests

Node 24 or later, no install step:

```
node --test "tests/*.test.ts" "workers/agent-readiness/*.test.ts"
```

#### How it is served

`wrangler.jsonc` at the repository root deploys this directory as static assets with the Worker in `workers/agent-readiness`. Cloudflare's asset router answers first. The Worker runs only for the paths in `assets.run_worker_first` and for requests that match no file:

- `/` and `/privacy.html`: the Worker adds `Link` headers and answers `Accept: text/markdown` with the markdown file (`Cache-Control: private, no-store`, `Vary: Accept`); browsers still get HTML. The query string is not part of the match, so `/?utm_source=x` runs the Worker too. The Worker reads the pages through the `ASSETS` binding: `/` and `/privacy`, where the asset router serves `index.html` and `privacy.html`.
- `/mcp`: the MCP server.
- `/a2a`: the A2A agent. Its card is a file.
- `/api/v1` and `/api/v1/*` (which covers `/api/v1/`): the JSON API, rate limited by `PUBLIC_LIMITER`, with a clock in `/status`.

The paths the Worker answers itself never fall through to a file; an internal error there is a JSON `500`. If decorating a page fails, the visitor gets the plain file.

Every other path is a file and costs no Worker request. A path with no file gets `404.html` with status `404`. `/index.html` and `/404.html` redirect to `/` and `/404`.

- `_headers` sets CORS and `nosniff` on every file, cache lifetimes for `static/` and the favicon, the markdown content type, and the type, cache, and `Link` headers of the generated documents. Responses the Worker builds itself (the API, the MCP server, the A2A agent, the markdown variants) set their own headers in code; the two HTML pages, read through the binding, keep the headers `_headers` gives their files. `/` must never be given a cache lifetime: it has two representations, and a test fails if a rule for it is added.
- `.assetsignore` is an allowlist generated from `PUBLISHED_FILES` in `tests/support/published-files.ts`: it ignores everything, then re-includes each published folder and file. `wrangler deploy` uploads the working tree, not only committed files, so a denylist would publish any stray file (a `.env`, a `.dev.vars`, a backup). A test fails when `.assetsignore` differs from the list, when a listed file is missing, or when a file in a published folder is not listed.

Workers Free allows 100,000 Worker requests a day per account, shared with the contact Worker. Files do not count. Over the limit, files are still served, and `/`, `/privacy.html`, `/mcp`, `/a2a`, and `/api/v1` answer `429` until the daily reset.

There is no origin behind the Worker: GitHub Pages is switched off, so an uncaught error is an error page, not a fallback copy of the site.

#### Deploy

CI deploys: `.github/workflows/build.yml` runs the checks, and on a push to `gh-pages` the "Deploy to Cloudflare" job runs `wrangler deploy` with the repository secret `CLOUDFLARE_API_TOKEN`. The token is a Cloudflare user API token with exactly one permission, Account > Workers Scripts > Edit. Cloudflare cannot scope it to one Worker: it can replace or delete every Worker in the account, the contact Worker included. Give it an expiry (a year at most) and rotate it before then; never widen it. Pull requests run only the checks, ending with a credential-free `wrangler deploy --dry-run`.

To deploy again without a new commit, run the workflow from the Actions tab on `gh-pages`.

To roll back, list the versions and roll back to one, then revert the commit so the next push does not deploy it again:

```
npx wrangler deployments list
npx wrangler rollback <version-id>
```

#### Cloudflare settings outside this repository

- Custom Domain: `burrowsapps.com` on the Worker `burrowsapps-com` (DNS lists it as a `Worker` record). It is not in `wrangler.jsonc`, so a deploy never changes it and the deploy token needs no zone permission. The contact Worker's routes, `burrowsapps.com/api/contact*` and `www.burrowsapps.com/api/contact*`, still answer those paths: checked 2026-11-27, `OPTIONS /api/contact` gets the contact Worker's `204` with `Access-Control-Allow-Methods: POST, OPTIONS`.
- Redirect Rule for `www`: filter `(http.host eq "www.burrowsapps.com" and not starts_with(http.request.uri.path, "/api/contact"))`, dynamic target `concat("https://burrowsapps.com", http.request.uri.path)`, status `301`, query string preserved.
- Apex DNS: no `A` or `AAAA` records and none pointing at GitHub; the Custom Domain owns the apex. The `www` record is a proxied CNAME to the apex. GitHub Pages is switched off for this repository. Keep the `_github-pages-challenge` TXT record: it keeps `burrowsapps.com` verified to the GitHub account, so no one else can claim the name on their own Pages site. Never add a DNS record that points at GitHub.
- The DNS-AID record below.

#### DNS records

One DNS-AID record, created in the Cloudflare dashboard. The zone is already DNSSEC-signed. Zone-file form:

```
_index._agents.burrowsapps.com. 300 IN SVCB 1 burrowsapps.com. alpn="h2,h3" port=443
```

DNS > Records > Add record:

| Field | Value |
|---|---|
| Type | `SVCB` |
| Name | `_index._agents` |
| Priority | `1` |
| Target | `burrowsapps.com` |
| Value | `alpn="h2,h3" port=443` |
| TTL | `5 min` |

It says the site's agent index (`/.well-known/ard.json`) is served by `burrowsapps.com` on port 443. Check it after saving:

```
curl -s -H 'accept: application/dns-json' 'https://cloudflare-dns.com/dns-query?name=_index._agents.burrowsapps.com&type=SVCB&do=1'
```

The answer must contain a record of type 64 and `"AD":true`. A resolver that asked before the record existed may answer "no data" for up to 30 minutes.

#### Checks after a deploy

```
curl -sI https://burrowsapps.com/ | grep -i '^link:'
curl -s -D - -o /dev/null -H 'Accept: text/markdown' https://burrowsapps.com/ | grep -iE '^(content-type|cache-control|vary|x-markdown-tokens):'
curl -s -D - -o /dev/null -H 'Accept: text/markdown' 'https://burrowsapps.com/?cb=1' | grep -i '^content-type:'
curl -s -o /dev/null -w '%{content_type}\n' https://burrowsapps.com/
curl -s -o /dev/null -w '%{content_type}\n' https://burrowsapps.com/.well-known/api-catalog
curl -s https://burrowsapps.com/api/v1/status
curl -s -o /dev/null -w '%{content_type}\n' https://burrowsapps.com/.well-known/oauth-authorization-server
curl -s -o /dev/null -w '%{content_type}\n' https://burrowsapps.com/.well-known/mcp/server-card.json
curl -s -X POST https://burrowsapps.com/mcp -H 'Content-Type: application/json' -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: server/discover' -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
curl -s -D - -o /dev/null https://burrowsapps.com/.well-known/agent-card.json | grep -iE '^(content-type|access-control-allow-origin|cache-control):'
curl -s -X POST https://burrowsapps.com/a2a -H 'Content-Type: application/json' -H 'A2A-Version: 1.0' -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"m-1","role":"ROLE_USER","parts":[{"text":"What does Burrows Applications build?"}]}}}'
curl -s https://burrowsapps.com/.well-known/agent-skills/contact-burrows-applications/SKILL.md | shasum -a 256
for p in README.md LICENSE CNAME wrangler.jsonc _headers .assetsignore .gitignore tests/robots.test.ts workers/contact/index.js workers/agent-readiness/facts.ts .github/workflows/build.yml; do curl -s -o /dev/null -w "%{http_code} /$p\n" "https://burrowsapps.com/$p"; done
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'https://www.burrowsapps.com/privacy.html?x=1'
```

Expected, in order: a `Link` line that includes `rel="api-catalog"`; a markdown content type, `private, no-store`, a `vary` that includes `Accept`, and a token count; a markdown content type; `text/html`; `application/linkset+json`; `{"status":"ok",...}`; `application/json`; `application/json`; a JSON-RPC result with `"resultType":"complete"`; the digest from `.well-known/agent-skills/index.json`; `404` for every repository file; `301 https://burrowsapps.com/privacy.html?x=1`.

#### The markdown probe log

The scanner's markdown probe never reached the Worker on the old exact routes, and why is not known; the leading guess is a query string the exact route did not match. The Worker writes one line to Workers Logs for every request whose `Accept` mentions markdown or that comes from Cloudflare Browser Rendering (`cf-brapi-devtools`). The line records the method, path, query parameter names (not values), `Accept`, `cf-worker`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest`, what was served, and the status. It never records an IP address, user agent, cookie, referrer, or query value. Search the logs for `"event":"probe"` around the time of a scan:

| Scanner says | Probe lines at scan time | Meaning | Follow-up |
|---|---|---|---|
| pass | a line with `served: "markdown"` | Fixed. `queryKeys` shows what the exact route missed. | Remove the probe log in a small follow-up change. |
| fail | a line with `accept` containing `text/markdown` and `served: "markdown"` | The Worker answered markdown and the scanner still saw HTML. | Compare the line's `path`, `fetchMode`, and `status` with the scan evidence; report to Cloudflare with both. |
| fail | only Browser Rendering lines whose `accept` has no `markdown` | The header does not arrive as the scanner reports it. | Fallbacks below. |
| fail | no line at all near the probe's time | The request does not run Workers on this zone. | Fallbacks below. |

Fallbacks, for the owner to choose from: the zone's "Markdown for Agents" setting (Pro plan or higher); a URL Rewrite Rule that sends `Accept: text/markdown` requests for `/` to `/index.md`; or accepting 14 of 15.

#### AI crawler policy

The policy lives only in `robots.txt`: every crawler may fetch everything, and `Content-Signal: search=yes, ai-input=yes, ai-train=yes` permits search, answer-time use, and training. To opt out of AI training, change the "AI training crawlers" group to `Disallow: /` and set `ai-train=no` on every `Content-Signal` line. The robots test expects the current policy, so update `tests/robots.test.ts` with it.

License
=======

```
Copyright (C) 2026 Jared Burrows

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
