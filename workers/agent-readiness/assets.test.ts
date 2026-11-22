// What the visitor gets when the ASSETS binding misbehaves, through the entry
// point, for both pages and both representations. Today's site answers a
// failed markdown read with the HTML page, and passes an origin's own
// non-200 answer through unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "./index.ts";
import type { Env } from "./http.ts";

const PAGES = [
  { path: "/", html: "/", markdown: "/index.md" },
  { path: "/privacy.html", html: "/privacy", markdown: "/privacy.md" },
] as const;
const ACCEPTS = { html: "text/html,*/*;q=0.8", markdown: "text/markdown" } as const;

const page = (): Response =>
  new Response("<!DOCTYPE html><title>Burrows Applications</title>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
const markdown = (): Response =>
  new Response("# Burrows Applications\n", { status: 200, headers: { "Content-Type": "text/markdown; charset=utf-8" } });

type Answer = (request: Request, call: number) => Response | Promise<Response>;

// An ASSETS binding that serves the page and its markdown, except where
// answer returns something else for a path.
function binding(answer: Answer): { env: Env; paths: string[] } {
  const paths: string[] = [];
  const env: Env = {
    ASSETS: {
      fetch: async (request) => {
        paths.push(new URL(request.url).pathname);
        return answer(request, paths.length);
      },
    },
  };
  return { env, paths };
}

const visit = (path: string, accept: string, env: Env, method = "GET"): Promise<Response> =>
  worker.fetch(new Request(`https://burrowsapps.com${path}`, { method, headers: { Accept: accept } }), env, { passThroughOnException() {} });

const normal: Answer = (request) => (new URL(request.url).pathname.endsWith(".md") ? markdown() : page());

// How the markdown read can go wrong. Each must end in the decorated HTML page.
const BAD_MARKDOWN: [string, (request: Request) => Response | Promise<Response>][] = [
  ["a 307", () => new Response(null, { status: 307, headers: { Location: "/elsewhere" } })],
  ["a 404 page", () => new Response("<!DOCTYPE html>not found", { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } })],
  ["a 500", () => new Response("error", { status: 500, headers: { "Content-Type": "text/plain" } })],
  ["a 200 with an HTML body", () => page()],
  ["an empty body", () => new Response("", { status: 200, headers: { "Content-Type": "text/markdown; charset=utf-8" } })],
  ["a body of only whitespace", () => new Response(" \n", { status: 200, headers: { "Content-Type": "text/markdown; charset=utf-8" } })],
  [
    "a throw",
    () => {
      throw new Error("assets unavailable");
    },
  ],
];

for (const { path, html, markdown: markdownPath } of PAGES) {
  test(`${path}: the happy path reads ${html} and ${markdownPath}, never the redirecting path`, async () => {
    const asHtml = binding(normal);
    const response = await visit(path, ACCEPTS.html, asHtml.env);
    assert.equal(response.status, 200);
    assert.deepEqual(asHtml.paths, [html]);
    assert.match(response.headers.get("Link") ?? "", /rel="alternate"/);
    const asMarkdown = binding(normal);
    const md = await visit(path, ACCEPTS.markdown, asMarkdown.env);
    assert.equal(md.headers.get("Content-Type"), "text/markdown; charset=utf-8");
    assert.deepEqual(asMarkdown.paths, [markdownPath]);
  });

  for (const [label, bad] of BAD_MARKDOWN) {
    test(`${path}: markdown asked for and the binding answers ${label}: the HTML page, decorated`, async (t) => {
      t.mock.method(console, "error", () => {});
      const { env, paths } = binding((request) => (new URL(request.url).pathname === markdownPath ? bad(request) : page()));
      for (const method of ["GET", "HEAD"]) {
        const response = await visit(path, ACCEPTS.markdown, env, method);
        assert.equal(response.status, 200, method);
        assert.match(response.headers.get("Content-Type") ?? "", /^text\/html/, method);
        assert.match(response.headers.get("Link") ?? "", /rel="alternate"/, method);
        assert.match(response.headers.get("Vary") ?? "", /Accept/, method);
        if (method === "GET") assert.match(await response.text(), /Burrows Applications/);
      }
      assert.deepEqual(paths, [markdownPath, html, markdownPath, html]);
    });
  }

  for (const [label, status] of [["a 307", 307], ["a 404", 404], ["a 500", 500]] as const) {
    test(`${path}: the page itself answered with ${label} goes to the visitor as it is, undecorated`, async () => {
      const { env } = binding(() => new Response(null, { status, headers: status === 307 ? { Location: "/elsewhere" } : {} }));
      for (const accept of Object.values(ACCEPTS)) {
        const response = await visit(path, accept, env);
        assert.equal(response.status, status);
        assert.equal(response.headers.get("Link"), null);
      }
    });
  }

  test(`${path}: an empty page body is answered empty, decorated, and not turned into an error`, async () => {
    const { env } = binding(() => new Response("", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }));
    const response = await visit(path, ACCEPTS.html, env);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
    assert.match(response.headers.get("Link") ?? "", /rel="alternate"/);
  });

  test(`${path}: a conditional request answered 304 stays a decorated 304`, async () => {
    const { env } = binding(() => new Response(null, { status: 304, headers: { ETag: '"abc"' } }));
    const response = await visit(path, ACCEPTS.html, env);
    assert.equal(response.status, 304);
    assert.match(response.headers.get("Link") ?? "", /rel="alternate"/);
  });

  test(`${path}: a throw on the page fails open to a second read, and a second throw is not hidden`, async (t) => {
    t.mock.method(console, "error", () => {});
    const once = binding((request, call) => {
      if (call === 1) throw new Error("assets unavailable");
      return normal(request, call);
    });
    assert.equal((await visit(path, ACCEPTS.html, once.env)).status, 200);
    const always = binding(() => {
      throw new Error("assets unavailable");
    });
    await assert.rejects(visit(path, ACCEPTS.html, always.env), /assets unavailable/);
  });
}

// The real asset router answers a request for "/privacy.html" with a 307 to
// "/privacy". The fail-open retry asks for the visitor's own path, so a
// transient failure on the first read sends the visitor to the undecorated
// page instead of serving it. Today's site serves the page on the retry.
test("B13: /privacy.html after one failed read is served, not redirected", { todo: "B13" }, async (t) => {
  t.mock.method(console, "error", () => {});
  const router: Answer = (request, call) => {
    const pathname = new URL(request.url).pathname;
    if (call === 1) throw new Error("assets unavailable");
    if (pathname === "/privacy.html") return new Response(null, { status: 307, headers: { Location: "/privacy" } });
    return normal(request, call);
  };
  const response = await visit("/privacy.html", ACCEPTS.html, binding(router).env);
  assert.equal(response.status, 200);
});
