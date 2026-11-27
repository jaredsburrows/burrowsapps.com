// The Content-Security-Policy in _headers, checked against the pages it has to
// allow. A hash in the policy is only right while the inline script it names
// is byte-for-byte unchanged, so these tests recompute every hash from the
// HTML: edit an inline script without updating _headers and they fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { headerRules, site } from "./support/static-site.ts";

const REPO = new URL("../", import.meta.url);
const SITE = "https://burrowsapps.com";
const PAGES = ["index.html", "privacy.html", "404.html"];

const sha256 = (text: string): string => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

function policy(): Map<string, string[]> {
  const all = headerRules().find((rule) => rule.pattern === "/*");
  assert.ok(all, "no /* rule");
  const values = all.headers.filter(([name]) => name.toLowerCase() === "content-security-policy").map(([, value]) => value);
  assert.equal(values.length, 1, "the /* rule must set Content-Security-Policy exactly once");
  const directives = new Map<string, string[]>();
  for (const part of values[0].split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    assert.ok(!directives.has(name), `${name} is listed twice`);
    directives.set(name, sources);
  }
  return directives;
}

const directive = (name: string): string[] => {
  const sources = policy().get(name);
  assert.ok(sources, `no ${name}`);
  return sources;
};

type Script = { attributes: string; body: string };

function scripts(file: string): Script[] {
  const html = readFileSync(new URL(file, REPO), "utf8");
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => ({ attributes: match[1] ?? "", body: match[2] }));
}

// A data block such as JSON-LD is never run, so CSP does not apply to it.
const runs = (script: Script): boolean => {
  const type = /\btype="([^"]*)"/.exec(script.attributes)?.[1];
  return type === undefined || type === "" || type === "text/javascript" || type === "module";
};

const scriptHashes = (): Set<string> =>
  new Set(PAGES.flatMap((file) => scripts(file).filter((script) => runs(script) && !/\bsrc=/.test(script.attributes)).map((script) => sha256(script.body))));

test("every inline script on every page is allowed by its hash", () => {
  const allowed = directive("script-src");
  for (const file of PAGES) {
    for (const script of scripts(file).filter((candidate) => runs(candidate) && !/\bsrc=/.test(candidate.attributes))) {
      assert.ok(allowed.includes(sha256(script.body)), `${file}: inline script ${sha256(script.body)} is not in script-src`);
    }
  }
});

test("script-src lists no hash that no page uses", () => {
  const used = scriptHashes();
  for (const source of directive("script-src").filter((candidate) => candidate.startsWith("'sha256-"))) {
    assert.ok(used.has(source), `${source} matches no inline script`);
  }
});

test("every external script's origin is allowed", () => {
  const allowed = directive("script-src");
  for (const file of PAGES) {
    for (const script of scripts(file)) {
      const src = /\bsrc="([^"]+)"/.exec(script.attributes)?.[1];
      if (!src) continue;
      const url = new URL(src, SITE);
      const ok = url.origin === SITE ? allowed.includes("'self'") : allowed.includes(url.origin);
      assert.ok(ok, `${file}: ${src} is not allowed by script-src`);
    }
  }
});

test("script-src allows no inline script, eval, or wildcard", () => {
  for (const source of directive("script-src")) {
    assert.ok(!["'unsafe-inline'", "'unsafe-eval'", "*", "https:", "data:"].includes(source), `script-src has ${source}`);
  }
});

test("the pages use no inline event handler or javascript: URL", () => {
  for (const file of PAGES) {
    const html = readFileSync(new URL(file, REPO), "utf8");
    assert.doesNotMatch(html, /<[^>]+\son[a-z]+\s*=/i, file);
    assert.doesNotMatch(html, /javascript:/i, file);
  }
});

test("every inline style attribute is allowed by its hash", () => {
  const allowed = directive("style-src");
  for (const file of PAGES) {
    const html = readFileSync(new URL(file, REPO), "utf8");
    for (const [, style] of html.matchAll(/\sstyle="([^"]*)"/g)) {
      assert.ok(allowed.includes(sha256(style)), `${file}: style="${style}" is not in style-src`);
    }
  }
});

test("the Turnstile widget may load and render, and the form posts to this site", () => {
  assert.ok(directive("script-src").includes("https://challenges.cloudflare.com"));
  assert.ok(directive("frame-src").includes("https://challenges.cloudflare.com"));
  const html = readFileSync(new URL("index.html", REPO), "utf8");
  const action = /<form[^>]*\saction="([^"]+)"/.exec(html)?.[1];
  assert.ok(action, "no form action");
  assert.equal(new URL(action, SITE).origin, SITE, "the form posts off-site, which form-action 'self' would block");
  assert.deepEqual(directive("form-action"), ["'self'"]);
});

test("Google Analytics may send hits", () => {
  for (const name of ["img-src", "connect-src"]) {
    assert.ok(directive(name).includes("https://*.google-analytics.com"), name);
    assert.ok(directive(name).includes("https://*.googletagmanager.com"), name);
  }
  assert.ok(directive("connect-src").includes("https://*.analytics.google.com"));
});

test("plugins, <base>, and framing by other sites are blocked", () => {
  assert.deepEqual(directive("object-src"), ["'none'"]);
  assert.deepEqual(directive("base-uri"), ["'none'"]);
  assert.deepEqual(directive("frame-ancestors"), ["'none'"]);
  assert.deepEqual(directive("default-src"), ["'self'"]);
});

test("the pages and the 404 page are served with the policy", async () => {
  const expected = headerRules().find((rule) => rule.pattern === "/*")?.headers.find(([name]) => name === "Content-Security-Policy")?.[1];
  for (const path of ["/", "/privacy.html", "/privacy", "/nope"]) {
    const response = await site(new Request(`${SITE}${path}`, { headers: { "Sec-Fetch-Mode": "navigate" } }));
    assert.equal(response.headers.get("Content-Security-Policy"), expected, path);
  }
});
