import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGES, estimateTokens, formatLinks, handle, prefersMarkdown } from "./handler.ts";
import type { OriginFetch } from "./handler.ts";

const ACCEPT_CASES: ReadonlyArray<[string | null, boolean]> = [
  [null, false],
  ["", false],
  ["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", false],
  ["*/*", false],
  ["text/*", false],
  ["text/markdown", true],
  ["TEXT/Markdown", true],
  ["text/markdown, text/html", true],
  ["text/markdown, text/html;q=0.9", true],
  ["text/html, text/markdown;q=0.9", false],
  ["text/markdown;q=0", false],
  ["text/markdown;q=0.5, */*", true],
  ["text/markdown; charset=utf-8; q=0.8, text/html;q=0.7", true],
  ["text/markdown;q=abc", true],
];

for (const [accept, expected] of ACCEPT_CASES) {
  test(`prefersMarkdown(${JSON.stringify(accept)}) is ${expected}`, async () => {
    assert.equal(prefersMarkdown(accept), expected);
  });
}

test("estimateTokens is zero for an empty string", async () => {
  assert.equal(estimateTokens(""), 0);
});

test("estimateTokens divides ASCII bytes by four", async () => {
  assert.equal(estimateTokens("abcdefgh"), 2);
});

test("estimateTokens counts UTF-8 bytes, not characters", async () => {
  // Four characters each: "é" is two bytes in UTF-8 and "€" is three.
  assert.equal(estimateTokens("éééé"), 2);
  assert.equal(estimateTokens("€€€€"), 3);
});

test("formatLinks renders the homepage links exactly", async () => {
  assert.equal(
    formatLinks(PAGES["/"].links),
    '</index.md>; rel="alternate"; type="text/markdown", '
      + '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json", '
      + '</api/v1/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json", '
      + '</developers.md>; rel="service-doc"; type="text/markdown", '
      + '</.well-known/agent-skills/index.json>; rel="describedby"; type="application/json", '
      + '</.well-known/ai-catalog.json>; rel="describedby"; type="application/json", '
      + '</privacy.html>; rel="privacy-policy"',
  );
});

const BROWSER_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const HTML = "<!DOCTYPE html><title>Burrows Applications</title>";
const MARKDOWN = "# Burrows Applications\n\nSoftware, built with care.\n";
const HOME_LINKS = formatLinks(PAGES["/"].links);
const PRIVACY_LINKS = formatLinks(PAGES["/privacy.html"].links);

type Route = () => Response;
type StubOrigin = { fetch: OriginFetch; calls: Request[] };

// Records every request and answers from a URL -> factory map. A missing URL
// is a test bug, so it throws loudly.
const stubOrigin = (routes: Record<string, Route>): StubOrigin => {
  const calls: Request[] = [];
  return {
    calls,
    fetch: async (request) => {
      calls.push(request);
      const route = routes[request.url];
      if (!route) throw new Error(`unexpected origin request: ${request.url}`);
      return route();
    },
  };
};

const htmlPage = (status = 200, headers: Record<string, string> = {}): Route => () =>
  new Response(status === 200 ? HTML : null, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Vary": "Accept-Encoding", ...headers },
  });

const markdownFile = (body = MARKDOWN, contentType = "text/markdown; charset=utf-8"): Route => () =>
  new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "max-age=600",
      "Access-Control-Allow-Origin": "*",
    },
  });

const get = (url: string, accept: string | null = BROWSER_ACCEPT, method = "GET"): Request =>
  new Request(url, { method, headers: accept === null ? {} : { Accept: accept } });

const varyTokens = (response: Response): string[] =>
  (response.headers.get("Vary") ?? "").split(",").map((token) => token.trim().toLowerCase());

const assertDecoratedHtml = async (response: Response, links = HOME_LINKS): Promise<void> => {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("Link"), links);
  assert.ok(varyTokens(response).includes("accept"));
  assert.equal(await response.text(), HTML);
};

test("handle: browser GET / passes the same request through and adds Link and Vary", async () => {
  const origin = stubOrigin({ "https://burrowsapps.com/": htmlPage() });
  const request = get("https://burrowsapps.com/");
  const response = await handle(request, origin.fetch);
  assert.equal(origin.calls.length, 1);
  assert.equal(origin.calls[0], request);
  await assertDecoratedHtml(response);
  assert.deepEqual(varyTokens(response), ["accept-encoding", "accept"]);
});

test("handle: an origin Vary that already names Accept is not duplicated", async () => {
  const origin = stubOrigin({ "https://burrowsapps.com/": htmlPage(200, { "Vary": "accept-encoding, ACCEPT" }) });
  const response = await handle(get("https://burrowsapps.com/"), origin.fetch);
  assert.deepEqual(varyTokens(response), ["accept-encoding", "accept"]);
});

test("handle: Accept text/markdown on / serves /index.md as markdown", async () => {
  const origin = stubOrigin({ "https://burrowsapps.com/index.md": markdownFile() });
  const response = await handle(get("https://burrowsapps.com/", "text/markdown"), origin.fetch);
  assert.equal(origin.calls.length, 1);
  assert.equal(origin.calls[0].url, "https://burrowsapps.com/index.md");
  assert.equal(origin.calls[0].method, "GET");
  assert.equal(origin.calls[0].headers.get("Accept"), "text/markdown");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/markdown; charset=utf-8");
  assert.equal(response.headers.get("Vary"), "Accept");
  assert.equal(response.headers.get("X-Markdown-Tokens"), String(estimateTokens(MARKDOWN)));
  assert.equal(response.headers.get("Link"), HOME_LINKS);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(await response.text(), MARKDOWN);
});

test("handle: markdown on www is fetched from www", async () => {
  const origin = stubOrigin({ "https://www.burrowsapps.com/index.md": markdownFile() });
  const response = await handle(get("https://www.burrowsapps.com/", "text/markdown"), origin.fetch);
  assert.equal(origin.calls.length, 1);
  assert.equal(new URL(origin.calls[0].url).host, "www.burrowsapps.com");
  assert.equal(response.headers.get("Content-Type"), "text/markdown; charset=utf-8");
});

test("handle: /privacy.html serves /privacy.md and links only its alternate", async () => {
  const origin = stubOrigin({
    "https://burrowsapps.com/privacy": htmlPage(),
    "https://burrowsapps.com/privacy.md": markdownFile(),
  });
  const markdown = await handle(get("https://burrowsapps.com/privacy.html", "text/markdown"), origin.fetch);
  assert.equal(origin.calls[0].url, "https://burrowsapps.com/privacy.md");
  assert.equal(markdown.headers.get("Content-Type"), "text/markdown; charset=utf-8");
  assert.equal(markdown.headers.get("Link"), PRIVACY_LINKS);
  assert.equal(PRIVACY_LINKS, '</privacy.md>; rel="alternate"; type="text/markdown"');

  const html = await handle(get("https://burrowsapps.com/privacy.html"), origin.fetch);
  assert.equal(origin.calls[1].url, "https://burrowsapps.com/privacy");
  assert.equal(origin.calls[1].method, "GET");
  assert.equal(origin.calls[1].headers.get("Accept"), BROWSER_ACCEPT);
  await assertDecoratedHtml(html, PRIVACY_LINKS);
  assert.equal(origin.calls.length, 2);
});

test("handle: a conditional HEAD for /privacy.html asks for /privacy with the same method and headers", async () => {
  const origin = stubOrigin({ "https://burrowsapps.com/privacy": htmlPage(304, { ETag: '"abc"' }) });
  const request = new Request("https://burrowsapps.com/privacy.html", {
    method: "HEAD",
    headers: { Accept: BROWSER_ACCEPT, "If-None-Match": '"abc"' },
  });
  const response = await handle(request, origin.fetch);
  assert.equal(origin.calls.length, 1);
  assert.equal(origin.calls[0].url, "https://burrowsapps.com/privacy");
  assert.equal(origin.calls[0].method, "HEAD");
  assert.equal(origin.calls[0].headers.get("If-None-Match"), '"abc"');
  assert.equal(origin.calls[0].headers.get("Accept"), BROWSER_ACCEPT);
  assert.equal(response.status, 304);
  assert.equal(response.headers.get("Link"), PRIVACY_LINKS);
});

test("handle: HEAD with Accept text/markdown returns markdown headers and no body", async () => {
  const origin = stubOrigin({ "https://burrowsapps.com/index.md": markdownFile() });
  const response = await handle(get("https://burrowsapps.com/", "text/markdown", "HEAD"), origin.fetch);
  assert.equal(origin.calls.length, 1);
  assert.equal(origin.calls[0].method, "GET");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/markdown; charset=utf-8");
  assert.equal(response.headers.get("X-Markdown-Tokens"), String(estimateTokens(MARKDOWN)));
  assert.equal(response.body, null);
});

const FALLBACKS: ReadonlyArray<[string, Route]> = [
  ["returns 404", () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/html" } })],
  ["throws", () => {
    throw new Error("network down");
  }],
  ["returns 200 text/html", markdownFile(HTML, "text/html; charset=utf-8")],
  ["returns 200 with a blank body", markdownFile(" \n\t\n")],
];

for (const [label, markdownRoute] of FALLBACKS) {
  test(`handle: markdown origin ${label} falls back to decorated HTML`, async () => {
    const origin = stubOrigin({
      "https://burrowsapps.com/index.md": markdownRoute,
      "https://burrowsapps.com/": htmlPage(),
    });
    const request = get("https://burrowsapps.com/", "text/markdown");
    const response = await handle(request, origin.fetch);
    assert.equal(origin.calls.length, 2);
    assert.equal(origin.calls[0].url, "https://burrowsapps.com/index.md");
    assert.equal(origin.calls[1], request);
    await assertDecoratedHtml(response);
  });
}

test("handle: POST / is passed through untouched", async () => {
  const upstream = new Response("ok", { status: 200, headers: { "Content-Type": "text/html" } });
  const origin = stubOrigin({ "https://burrowsapps.com/": () => upstream });
  const request = new Request("https://burrowsapps.com/", { method: "POST", body: "x", headers: { Accept: "text/markdown" } });
  const response = await handle(request, origin.fetch);
  assert.equal(origin.calls.length, 1);
  assert.equal(origin.calls[0], request);
  assert.equal(response, upstream);
  assert.equal(response.headers.get("Link"), null);
});

test("handle: a path that is not a page is passed through untouched", async () => {
  const upstream = new Response("body{}", { status: 200, headers: { "Content-Type": "text/css" } });
  const origin = stubOrigin({ "https://burrowsapps.com/static/css/home.css": () => upstream });
  const response = await handle(get("https://burrowsapps.com/static/css/home.css", "text/markdown"), origin.fetch);
  assert.equal(origin.calls.length, 1);
  assert.equal(response, upstream);
  assert.equal(response.headers.get("Link"), null);
});

for (const status of [404, 500, 301]) {
  test(`handle: origin ${status} on / is returned untouched`, async () => {
    const upstream = new Response(null, { status, headers: status === 301 ? { Location: "https://burrowsapps.com/" } : {} });
    const origin = stubOrigin({ "https://burrowsapps.com/": () => upstream });
    const response = await handle(get("https://burrowsapps.com/"), origin.fetch);
    assert.equal(origin.calls.length, 1);
    assert.equal(response, upstream);
    assert.equal(response.headers.get("Link"), null);
  });
}

test("handle: origin 304 on / gets Link and Vary", async () => {
  const origin = stubOrigin({ "https://burrowsapps.com/": htmlPage(304) });
  const response = await handle(get("https://burrowsapps.com/"), origin.fetch);
  assert.equal(origin.calls.length, 1);
  assert.equal(response.status, 304);
  assert.equal(response.headers.get("Link"), HOME_LINKS);
  assert.ok(varyTokens(response).includes("accept"));
});

test("handle: the handler itself ignores the query string", async () => {
  const origin = stubOrigin({ "https://burrowsapps.com/?sent=1": htmlPage() });
  const response = await handle(get("https://burrowsapps.com/?sent=1"), origin.fetch);
  assert.equal(origin.calls.length, 1);
  await assertDecoratedHtml(response);
});

test("handle: a failing HTML origin fetch rejects", async () => {
  const origin = stubOrigin({
    "https://burrowsapps.com/": () => {
      throw new Error("origin down");
    },
  });
  await assert.rejects(handle(get("https://burrowsapps.com/"), origin.fetch), /origin down/);
});

// ---- QA additions: inputs the planned cases skip ----

const ODD_ACCEPT_CASES: ReadonlyArray<[string, boolean]> = [
  [" text/markdown ; q = 0.5 , text/html ; q = 0.4 ", true],
  ["text/markdown;Q=0", false],
  ["text/markdown;q=0.5;q=0", false],
  ["text/markdown;q=0.5, text/markdown;q=0.9, text/html;q=0.8", true],
  ["text/markdown;q=0.1, text/markdown;q=0.9, text/html;q=0.95", false],
  ["text/markdown;q=5, text/html;q=1", true],
  ["text/markdown;q=-1", false],
  ["text/html;q=7, text/markdown;q=1", true],
  ["application/xhtml+xml, text/markdown;q=0.9", false],
  ["text/markdown, text/html;q=0", true],
  ["text/markdown;q=0.5,text/html;q=0.5", true],
  [",,, text/markdown", true],
  ["text/markdownx", false],
  ["text/markdown/extra", false],
  ["application/text/markdown", false],
];

for (const [accept, expected] of ODD_ACCEPT_CASES) {
  test(`prefersMarkdown(${JSON.stringify(accept)}) is ${expected} (odd forms)`, async () => {
    assert.equal(prefersMarkdown(accept), expected);
  });
}

const NOT_PAGES = [
  "https://burrowsapps.com//",
  "https://burrowsapps.com/index.html",
  "https://burrowsapps.com/PRIVACY.html",
  "https://burrowsapps.com/privacy.html/",
  "https://burrowsapps.com/privacy%2Ehtml",
  "https://burrowsapps.com/index.md",
];

for (const url of NOT_PAGES) {
  test(`handle: ${url} is not a page and passes through untouched`, async () => {
    const upstream = new Response("x", { status: 200, headers: { "Content-Type": "text/html" } });
    const origin = stubOrigin({ [new URL(url).href]: () => upstream });
    const response = await handle(get(url, "text/markdown"), origin.fetch);
    assert.equal(origin.calls.length, 1);
    assert.equal(response, upstream);
    assert.equal(response.headers.get("Link"), null);
  });
}

test("handle: a trailing-dot host still gets the page treatment and stays on that host", async () => {
  const origin = stubOrigin({ "https://burrowsapps.com./index.md": markdownFile() });
  const response = await handle(get("https://burrowsapps.com./", "text/markdown"), origin.fetch);
  assert.equal(response.headers.get("Content-Type"), "text/markdown; charset=utf-8");
});

test("handle: HEAD on the HTML branch gets Link and Vary and no body", async () => {
  const origin = stubOrigin({
    "https://burrowsapps.com/": () =>
      new Response(null, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }),
  });
  const request = get("https://burrowsapps.com/", BROWSER_ACCEPT, "HEAD");
  const response = await handle(request, origin.fetch);
  assert.equal(origin.calls[0], request);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Link"), HOME_LINKS);
  assert.ok(varyTokens(response).includes("accept"));
  assert.equal(response.body, null);
});

test("handle: an origin Link header is kept and the page links are added after it", async () => {
  const origin = stubOrigin({ "https://burrowsapps.com/": htmlPage(200, { Link: "</x.css>; rel=preload; as=style" }) });
  const response = await handle(get("https://burrowsapps.com/"), origin.fetch);
  assert.equal(response.headers.get("Link"), `</x.css>; rel=preload; as=style, ${HOME_LINKS}`);
});

test("handle: a response from a real fetch (immutable headers) is still decorated", async () => {
  const { createServer } = await import("node:http");
  const server = createServer((_request, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Vary", "Accept-Encoding");
    res.end(HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as { port: number };
    const real = await fetch(`http://127.0.0.1:${port}/`);
    assert.throws(() => real.headers.set("X-Probe", "1"), TypeError);
    const response = await handle(get("https://burrowsapps.com/"), async () => real);
    await assertDecoratedHtml(response);
  } finally {
    server.close();
  }
});

for (const [label, body] of [["only a BOM", "﻿"], ["a BOM and whitespace", "﻿ \n"]] as const) {
  test(`handle: markdown origin with ${label} falls back to decorated HTML`, async () => {
    const origin = stubOrigin({
      "https://burrowsapps.com/index.md": markdownFile(body),
      "https://burrowsapps.com/": htmlPage(),
    });
    await assertDecoratedHtml(await handle(get("https://burrowsapps.com/", "text/markdown"), origin.fetch));
  });
}

test("handle: a markdown file with a leading BOM is served without it", async () => {
  const origin = stubOrigin({ "https://burrowsapps.com/index.md": markdownFile(`﻿${MARKDOWN}`) });
  const response = await handle(get("https://burrowsapps.com/", "text/markdown"), origin.fetch);
  assert.equal(await response.text(), MARKDOWN);
  assert.equal(response.headers.get("X-Markdown-Tokens"), String(estimateTokens(MARKDOWN)));
});

test("handle: an upper-case text/html markdown content type falls back", async () => {
  const origin = stubOrigin({
    "https://burrowsapps.com/index.md": markdownFile(HTML, "TEXT/HTML; charset=UTF-8"),
    "https://burrowsapps.com/": htmlPage(),
  });
  await assertDecoratedHtml(await handle(get("https://burrowsapps.com/", "text/markdown"), origin.fetch));
});

// B1: Vary "*" must stay alone; "*, Accept" is not a valid Vary field value.
test("handle: an origin Vary of * is left as *", async () => {
  const origin = stubOrigin({ "https://burrowsapps.com/": htmlPage(200, { Vary: "*" }) });
  const response = await handle(get("https://burrowsapps.com/"), origin.fetch);
  assert.equal(response.headers.get("Vary"), "*");
});

test("handle: the markdown response is never storable, whatever the origin says", async () => {
  for (const path of ["/", "/privacy.html"]) {
    const file = path === "/" ? "/index.md" : "/privacy.md";
    const origin = stubOrigin({ [`https://burrowsapps.com${file}`]: markdownFile() });
    const response = await handle(get(`https://burrowsapps.com${path}`, "text/markdown"), origin.fetch);
    assert.equal(response.headers.get("Content-Type"), "text/markdown; charset=utf-8");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Vary"), "Accept");
  }
});
