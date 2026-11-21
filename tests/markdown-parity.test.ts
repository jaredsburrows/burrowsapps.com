import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const REPO = new URL("../", import.meta.url);

type Pair = { html: string; markdown: string; mustContain: readonly string[] };

// One entry per page that has a hand-written markdown copy.
const PAIRS: readonly Pair[] = [
  {
    html: "index.html",
    markdown: "index.md",
    mustContain: ["contact@burrowsapps.com", "https://burrowsapps.com/privacy.html"],
  },
];

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&nbsp;": " ",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

const mainOf = (html: string): string => {
  const match = html.match(/<main\b[^>]*>([\s\S]*)<\/main>/i);
  assert.ok(match, "no <main> element");
  return match[1];
};

const htmlBlocks = (main: string): string[] =>
  [...main.matchAll(/<(h1|h2|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(([, , inner]) =>
      normalize(inner.replace(/<[^>]+>/g, "").replace(/&(amp|nbsp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity])),
    )
    .filter((block) => block !== "");

const markdownText = (markdown: string): string =>
  normalize(
    markdown
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replaceAll("**", "")
      .split("\n")
      .map((line) => line.replace(/^(#{1,6} |- |> )/, ""))
      .join("\n"),
  );

const read = async (path: string): Promise<string> => readFile(new URL(path, REPO), "utf8");

for (const pair of PAIRS) {
  test(`${pair.markdown} contains every heading, paragraph, and list item of ${pair.html}`, async () => {
    const blocks = htmlBlocks(mainOf(await read(pair.html)));
    assert.ok(blocks.length > 0);
    const text = markdownText(await read(pair.markdown));
    for (const block of blocks) {
      assert.ok(text.includes(block), `${pair.markdown} is missing: "${block}"`);
    }
  });

  test(`${pair.markdown} contains every link target in the <main> of ${pair.html}`, async () => {
    const main = mainOf(await read(pair.html));
    const source = await read(pair.markdown);
    for (const [, href] of main.matchAll(/href="([^"]+)"/g)) {
      if (href.startsWith("https://")) {
        assert.ok(source.includes(href), `${pair.markdown} is missing link ${href}`);
      } else if (href.startsWith("mailto:")) {
        const address = href.slice("mailto:".length).split("?")[0];
        assert.ok(source.includes(address), `${pair.markdown} is missing address ${address}`);
      }
    }
    for (const required of pair.mustContain) {
      assert.ok(source.includes(required), `${pair.markdown} is missing ${required}`);
    }
  });

  test(`${pair.html} links to ${pair.markdown} as its markdown alternate`, async () => {
    const match = (await read(pair.html)).match(/<link rel="alternate" type="text\/markdown" href="([^"]+)"/);
    assert.ok(match, `${pair.html} has no markdown alternate link`);
    assert.equal(match[1], `/${pair.markdown}`);
  });
}
