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

Files that tell AI agents and crawlers what this site is and how to use it. Everything here describes something the site really has; there is no public API, no login, and no MCP server, so nothing claims otherwise.

#### What is published

| File | Purpose | Spec |
|---|---|---|
| `robots.txt` | Crawl policy, with explicit groups for AI crawlers and a `Content-Signal` line in every group | [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309), [Content Signals](https://contentsignals.org/) |
| `index.md`, `privacy.md` | Markdown versions of `/` and `/privacy.html`, linked from each page with `<link rel="alternate" type="text/markdown">` | [Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/) |
| `.well-known/agent-skills/index.json` | Agent Skills discovery index listing one skill | [Agent Skills Discovery v0.2.0](https://github.com/cloudflare/agent-skills-discovery-rfc) |
| `.well-known/agent-skills/contact-burrows-applications/SKILL.md` | The skill: what Burrows Applications builds and how to get in touch | [Agent Skills](https://agentskills.io/) |
| `.well-known/ai-catalog.json`, `.well-known/ard.json` | ARD manifest with one entry (the skill). Identical bytes at the older and the current ARD path | [ARD](https://github.com/ards-project/ard-spec) |
| `static/js/home.js` | Registers the contact form as the WebMCP tool `send_contact_message` in browsers that support it | [WebMCP](https://webmachinelearning.github.io/webmcp/) |
| `workers/agent-readiness/` | Edge Worker that adds `Link` headers and answers `Accept: text/markdown` (see below) | [RFC 8288](https://www.rfc-editor.org/rfc/rfc8288) |

#### Keeping things in sync

The tests fail when any of these drift:

- Edit `index.html` or `privacy.html`: make the same edit in `index.md` or `privacy.md`.
- Edit `SKILL.md`: recompute its digest and put it in `index.json` as `sha256:<hash>`:

  ```
  shasum -a 256 .well-known/agent-skills/contact-burrows-applications/SKILL.md
  ```

- Edit `.well-known/ai-catalog.json`: copy it over `.well-known/ard.json` (`cp .well-known/ai-catalog.json .well-known/ard.json`).

#### Running the tests

Node 24 or later, no install step:

```
node --test "tests/*.test.ts" "workers/agent-readiness/*.test.ts"
```

#### The edge Worker

GitHub Pages cannot set response headers or negotiate content, so `workers/agent-readiness` does both for two pages:

- adds `Link` headers to `/` and `/privacy.html` that point at the markdown versions and the `/.well-known/` files;
- serves `/index.md` or `/privacy.md` as `text/markdown` when the `Accept` header prefers markdown. Browsers still get HTML.

Its four routes are exact (`burrowsapps.com/`, `www.burrowsapps.com/`, and the same two for `/privacy.html`). Cloudflare matches routes against the whole URL including the query string, so `/?sent=1`, `/?error=1`, assets, and `/api/contact` never reach this Worker. It fails open: on any error the visitor gets the GitHub Pages response untouched.

Deploy by hand, and only after the change is merged and GitHub Pages has published it (otherwise the `Link` headers point at files that are not live yet):

```
npx wrangler deploy --config workers/agent-readiness/wrangler.jsonc
```

After each deploy, open each of the four routes in the Cloudflare dashboard and set "Request limit failure mode" to "Fail open". Wrangler has no setting for it.

Remove it (the site then behaves exactly as before the deploy):

```
npx wrangler delete --config workers/agent-readiness/wrangler.jsonc
```

#### Checks after a deploy

```
curl -sI https://burrowsapps.com/ | grep -i '^link:'
curl -s -D - -o /dev/null -H 'Accept: text/markdown' https://burrowsapps.com/ | grep -iE '^(content-type|vary|x-markdown-tokens):'
curl -s -o /dev/null -w '%{content_type}\n' https://burrowsapps.com/
curl -sI 'https://burrowsapps.com/?sent=1' | grep -ci '^link:'
curl -s https://burrowsapps.com/.well-known/agent-skills/contact-burrows-applications/SKILL.md | shasum -a 256
```

Expected, in order: a `Link` line; a markdown content type, a `vary` that includes `Accept`, and a token count; `text/html`; `0` (query-string URLs bypass the Worker); the digest from `.well-known/agent-skills/index.json`.

#### Alternatives and what is not published

On a Cloudflare Pro plan or higher, the zone's "Markdown for Agents" setting plus a Response Header Transform Rule for `Link` can replace the Worker. If you switch to that, delete `workers/agent-readiness` and keep everything else.

The agent-readiness scanner also asks for OAuth/OIDC discovery, OAuth Protected Resource Metadata, `auth.md`, an MCP Server Card, DNS-AID records, and an API catalog. They are left out on purpose because the site has no authorization server, protected resource, MCP server, agent endpoint, or public API to describe. The pull request that added `workers/agent-readiness` gives the reason for each.

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
