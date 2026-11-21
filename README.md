# burrowsapps.com

Burrows Applications website

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](http://www.apache.org/licenses/LICENSE-2.0)
[![Build](https://github.com/jaredsburrows/burrowsapps.com/workflows/build/badge.svg)](https://github.com/jaredsburrows/burrowsapps.com/actions)
[![Twitter Follow](https://img.shields.io/twitter/follow/jaredsburrows.svg?style=social)](https://twitter.com/jaredsburrows)

Business website — fully static, no build step. GitHub Pages serves the repo as-is (`.nojekyll`).

### Preview the website

Open `index.html` in a browser, or serve the directory:

```
python3 -m http.server
```

### Agent readiness

Files and endpoints that tell AI agents and crawlers what this site is and how to use it. Everything here describes something the site really has. There is no login: nothing on the site takes a credential, and the OAuth documents and `auth.md` exist to say so.

#### What is published

| Path | Purpose | Served by | Spec |
|---|---|---|---|
| `/robots.txt` | Crawl policy, with explicit groups for AI crawlers and a `Content-Signal` line in every group | Pages | [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309), [Content Signals](https://contentsignals.org/) |
| `/index.md`, `/privacy.md` | Markdown versions of `/` and `/privacy.html`; also served from those URLs to `Accept: text/markdown` | Pages, negotiated by the Worker | [Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/) |
| `/.well-known/agent-skills/index.json` and the skill it lists | What Burrows Applications builds and how to get in touch | Pages | [Agent Skills Discovery v0.2.0](https://github.com/cloudflare/agent-skills-discovery-rfc) |
| `/.well-known/ai-catalog.json`, `/.well-known/ard.json` | ARD manifest: the skill, the MCP server, and the public API. Identical bytes at both paths | Pages | [ARD](https://github.com/ards-project/ard-spec) |
| `/developers.md` | Documentation for the API and the MCP server | Pages | |
| `/api/v1`, `/api/v1/company`, `/api/v1/services`, `/api/v1/status` | Read-only JSON API with the company facts from `workers/agent-readiness/facts.ts` | Worker | |
| `/api/v1/openapi.json` | OpenAPI 3.1 description of that API | Worker | [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) |
| `/.well-known/api-catalog` | API catalog listing the API and the MCP server | Worker | [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727) |
| `/mcp` | Stateless, read-only MCP server with three tools (2026-07-28, plus the `initialize` handshake for 2025-06-18 and 2025-11-25 clients) | Worker | [MCP](https://modelcontextprotocol.io/) |
| `/mcp/server-card`, `/.well-known/mcp/server-card.json` | MCP server card, one document at both paths | Worker | SEP-2127 |
| `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` | OAuth metadata that says `"status": "not_offered"`: no authorization server runs here | Worker | [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414), [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) |
| `/auth.md` | Says that no authentication is required, offered, or possible, and that `/api/contact` is meant only for the contact form | Pages | [auth.md](https://workos.com/auth-md/docs/auth-md) |
| `static/js/home.js` | Registers the contact form as the WebMCP tool `send_contact_message` in browsers that support it | Pages | [WebMCP](https://webmachinelearning.github.io/webmcp/) |
| `_index._agents.burrowsapps.com` | DNS-AID record (see below) | DNS | DNS-AID draft |

#### Keeping things in sync

The tests fail when any of these drift:

- Edit `index.html` or `privacy.html`: make the same edit in `index.md` or `privacy.md`.
- Edit the company facts in `workers/agent-readiness/facts.ts`: they must still appear in `index.md` or `SKILL.md`, and the form limits must equal the ones in `workers/contact/index.js`.
- Change `PUBLIC_LIMITER` in `wrangler.jsonc`: change the figure in `developers.md` too.
- Edit `SKILL.md`: recompute its digest and put it in `index.json` as `sha256:<hash>`:

  ```
  shasum -a 256 .well-known/agent-skills/contact-burrows-applications/SKILL.md
  ```

- Edit `.well-known/ai-catalog.json`: copy it over `.well-known/ard.json` (`cp .well-known/ai-catalog.json .well-known/ard.json`).
- Add anything that reads a credential or answers `401`: the OAuth documents and `auth.md` are then wrong, and a test says so.

#### Running the tests

Node 24 or later, no install step:

```
node --test "tests/*.test.ts" "workers/agent-readiness/*.test.ts"
```

#### The edge Worker

GitHub Pages cannot set response headers, negotiate content, or run code, so `workers/agent-readiness` sits in front of it on two routes:

- `burrowsapps.com/*`, a wildcard, because a route matches a query string only if it ends in `*`. This is what lets `/?utm_source=x` get the `Link` header and markdown.
- `burrowsapps.com/api/v1*`, because an old dashboard route `burrowsapps.com/api/*` may still point at the contact Worker, and the most specific pattern wins. The contact Worker keeps `/api/contact*`, which is longer than both.

`www.burrowsapps.com` is not routed: it redirects to the apex at the origin.

For `/` and `/privacy.html` the Worker adds `Link` headers and answers `Accept: text/markdown` with the markdown file (`Cache-Control: private, no-store`, `Vary: Accept`); browsers still get HTML. The paths in the table above marked "Worker" are answered by the Worker itself and never reach Pages; an internal error there is a JSON `500`. Every other path is passed to Pages untouched and fails open: on any error the visitor gets the Pages response.

Deploy by hand after the change is merged:

```
npx wrangler deploy --config workers/agent-readiness/wrangler.jsonc
```

After each deploy, open both routes in the Cloudflare dashboard and set "Request limit failure mode" to "Fail open". Wrangler has no setting for it. If the four old exact routes (`burrowsapps.com/`, `www.burrowsapps.com/`, and the two `/privacy.html` ones) are still listed, delete them.

Every request to the apex now runs the Worker, including assets, and it counts against the account's 100,000 requests a day on Workers Free. That limit is per account and shared with the contact Worker. When it is used up, the contact form stops working until the daily reset, and the API, the MCP server, the OAuth documents, and the markdown variant are unavailable; with both routes set to fail open, the pages themselves stay up.

If usage ever gets close to the limit, add a route `burrowsapps.com/static/*` with Worker set to "None" in the dashboard, so assets skip the Worker.

Remove it (the site then behaves as before iteration 1):

```
npx wrangler delete --config workers/agent-readiness/wrangler.jsonc
```

#### DNS records

One DNS-AID record, created by the owner in the Cloudflare dashboard. The zone is already DNSSEC-signed. Zone-file form:

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

#### After the merge, in order

1. Deploy the Worker (command above).
2. Owner: set both routes to fail open in the dashboard, and delete the four old exact routes if they are still listed.
3. Owner: add the DNS record above.
4. Wait 10 minutes after the Pages build: Cloudflare caches `robots.txt` and `static/js` at the edge for that long.
5. Scan with isitagentready.com and read the probe log (below).

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
curl -s https://burrowsapps.com/.well-known/agent-skills/contact-burrows-applications/SKILL.md | shasum -a 256
```

Expected, in order: a `Link` line that includes `rel="api-catalog"`; a markdown content type, `private, no-store`, a `vary` that includes `Accept`, and a token count; a markdown content type; `text/html`; `application/linkset+json`; `{"status":"ok",...}`; `application/json`; `application/json`; a JSON-RPC result with `"resultType":"complete"`; the digest from `.well-known/agent-skills/index.json`.

#### The markdown probe log

The scanner's markdown probe never reached the Worker on the old exact routes, and why is not known; the leading guess is a query string the exact route did not match. The Worker writes one line to Workers Logs for every request whose `Accept` mentions markdown or that comes from Cloudflare Browser Rendering (`cf-brapi-devtools`). The line records the method, path, query parameter names (not values), `Accept`, `cf-worker`, `Sec-Fetch-Mode`, `Sec-Fetch-Dest`, what was served, and the status. It never records an IP address, user agent, cookie, referrer, or query value. Search the logs for `"event":"probe"` around the time of a scan:

| Scanner says | Probe lines at scan time | Meaning | Follow-up |
|---|---|---|---|
| pass | a line with `served: "markdown"` | Fixed. `queryKeys` shows what the exact route missed. | Remove the probe log in a small follow-up change. |
| fail | a line with `accept` containing `text/markdown` and `served: "markdown"` | The Worker answered markdown and the scanner still saw HTML. | Compare the line's `path`, `fetchMode`, and `status` with the scan evidence; report to Cloudflare with both. |
| fail | only Browser Rendering lines whose `accept` has no `markdown` | The header does not arrive as the scanner reports it. | Fallbacks below. |
| fail | no line at all near the probe's time | The request does not run Workers on this zone. | Fallbacks below. |

Fallbacks, for the owner to choose from: the zone's "Markdown for Agents" setting (Pro plan or higher); a URL Rewrite Rule that sends `Accept: text/markdown` requests for `/` to `/index.md`; serving the site from a Worker with static assets instead of GitHub Pages; or accepting 14 of 15.

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
