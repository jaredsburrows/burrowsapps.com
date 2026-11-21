import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGES, estimateTokens, formatLinks, prefersMarkdown } from "./handler.ts";

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
      + '</.well-known/agent-skills/index.json>; rel="describedby"; type="application/json", '
      + '</.well-known/ai-catalog.json>; rel="describedby"; type="application/json", '
      + '</privacy.html>; rel="privacy-policy"',
  );
});
