import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SERVICES } from "../workers/agent-readiness/facts.ts";
import { mainOf, textOf } from "./support/html-text.ts";

const REPO = new URL("../", import.meta.url);
const read = async (path: string): Promise<string> => readFile(new URL(path, REPO), "utf8");

// The inner HTML of every element with this tag, in document order. Only for
// tags that never nest inside themselves on these pages.
const elements = (html: string, tag: string): string[] =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map(([, inner]) => inner);

// Non-blank lines of a markdown file.
const markdownLines = async (path: string): Promise<string[]> =>
  (await read(path)).split("\n").filter((line) => line.trim() !== "");

// The line that follows `line` exactly once in `lines`, or a failure.
const lineAfter = (lines: readonly string[], line: string): string => {
  const index = lines.indexOf(line);
  assert.ok(index >= 0, `index.md has no line "${line}"`);
  assert.equal(lines.indexOf(line, index + 1), -1, `index.md has "${line}" more than once`);
  assert.ok(index + 1 < lines.length, `nothing follows "${line}" in index.md`);
  return lines[index + 1];
};

// A: services.

test("A1: the homepage has one service card per entry of SERVICES, in order, and no other", async () => {
  const main = mainOf(await read("index.html"));
  const opening = [...main.matchAll(/<article\b[^>]*>/gi)].map(([tag]) => tag);
  assert.deepEqual(
    opening,
    SERVICES.map(({ id }) => `<article class="service" id="service-${id}">`),
  );
});

test("A2: each service card has its name as the one <h3> and its description as the one <p>", async () => {
  const main = mainOf(await read("index.html"));
  for (const { id, name, description } of SERVICES) {
    const match = main.match(new RegExp(`<article class="service" id="service-${id}">([\\s\\S]*?)<\\/article>`));
    assert.ok(match, `no card for ${id}`);
    const headings = elements(match[1], "h3").map(textOf);
    const paragraphs = elements(match[1], "p").map(textOf);
    assert.deepEqual(headings, [name], `the card for ${id} has the wrong heading`);
    assert.deepEqual(paragraphs, [description], `the card for ${id} has the wrong paragraph`);
  }
});

test("A3: index.md lists each service as a ### heading followed by its description, in order", async () => {
  const lines = await markdownLines("index.md");
  const headings = lines.filter((line) => line.startsWith("### "));
  const serviceHeadings = headings.filter((line) => SERVICES.some(({ name }) => line === `### ${name}`));
  assert.deepEqual(serviceHeadings, SERVICES.map(({ name }) => `### ${name}`));
  for (const { name, description } of SERVICES) {
    assert.equal(lineAfter(lines, `### ${name}`), description, `the description of "${name}" in index.md differs`);
  }
});
