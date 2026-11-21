import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const REPO = new URL("../", import.meta.url);

type Pair = {
  html: string;
  markdown: string;
  mustContain: readonly string[];
  // Exact markdown lines that have no heading, paragraph, or list item in the
  // <main> of the HTML page. Every other line must match one, word for word.
  added: readonly string[];
  // Exact markdown lines that match an HTML block except for letter case.
  caseOnly: readonly string[];
};

// One entry per page that has a hand-written markdown copy.
const PAIRS: readonly Pair[] = [
  {
    html: "index.html",
    markdown: "index.md",
    mustContain: ["contact@burrowsapps.com", "https://burrowsapps.com/privacy.html"],
    added: [
      // The page title, which the HTML carries in <title> and the logo rather than in <main>.
      "# Burrows Applications",
      // The hero ticker, a <div> of <span>s rather than a paragraph.
      "Specialties: native mobile · cross-platform · web",
      // Contact details an agent cannot get from the form markup.
      "- Contact form: https://burrowsapps.com/#contact (name, email, and message are all required)",
      "- Email: [contact@burrowsapps.com](mailto:contact@burrowsapps.com)",
      "- LinkedIn: https://linkedin.com/company/burrows-applications",
      "- X / Twitter: https://x.com/burrowsapps",
      // The footer link to the privacy policy.
      "## More",
      "- [Privacy Policy](https://burrowsapps.com/privacy.html)",
    ],
    caseOnly: [],
  },
  {
    html: "privacy.html",
    markdown: "privacy.md",
    mustContain: [],
    // privacy.md is a legal text: nothing may be added to it.
    added: [],
    // The HTML writes the revision line in capitals as a visual style.
    caseOnly: ["Last revised · July 8, 2026"],
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

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();
const normalize = (text: string): string => collapse(text).toLowerCase();

// Loops until stable so that removing one tag can never leave another behind.
const stripTags = (html: string): string => {
  let previous: string;
  let current = html;
  do {
    previous = current;
    current = previous.replace(/<[^>]+>/g, "");
  } while (current !== previous);
  return current;
};

const mainOf = (html: string): string => {
  const match = html.match(/<main\b[^>]*>([\s\S]*)<\/main>/i);
  assert.ok(match, "no <main> element");
  return match[1];
};

// Headings, paragraphs, and list items, as plain text with case kept.
const htmlBlockText = (main: string): string[] =>
  [...main.matchAll(/<(h1|h2|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(([, , inner]) =>
      collapse(stripTags(inner).replace(/&(amp|nbsp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity])),
    )
    .filter((block) => block !== "");

const htmlBlocks = (main: string): string[] => htmlBlockText(main).map(normalize);

const markdownLineText = (line: string): string =>
  collapse(line.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replaceAll("**", "").replace(/^(#{1,6} |- |> )/, ""));

const markdownText = (markdown: string): string => normalize(markdown.split("\n").map(markdownLineText).join("\n"));

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

  test(`every line of ${pair.markdown} is a heading, paragraph, or list item of ${pair.html}`, async () => {
    const blocks = new Set(htmlBlockText(mainOf(await read(pair.html))));
    const lowered = new Set([...blocks].map(normalize));
    const lines = (await read(pair.markdown)).split("\n").filter((line) => line.trim() !== "");
    for (const line of lines) {
      const text = markdownLineText(line);
      if (blocks.has(text) || pair.added.includes(line)) continue;
      if (pair.caseOnly.includes(line) && lowered.has(normalize(text))) continue;
      assert.fail(`${pair.markdown} has a line that is not in the <main> of ${pair.html}: "${line}"`);
    }
    for (const allowed of [...pair.added, ...pair.caseOnly]) {
      assert.ok(lines.includes(allowed), `${pair.markdown} no longer has allow-listed line "${allowed}"`);
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
