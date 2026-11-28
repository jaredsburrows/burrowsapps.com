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

// B: technologies. The owner's list (2026-11-27). A change here is a change in
// four places: the chips in index.html, index.md, knowsAbout, and this list.

const TECHNOLOGIES: readonly { group: string; chips: readonly string[] }[] = [
  { group: "Mobile", chips: ["Kotlin", "Jetpack Compose", "Swift", "SwiftUI"] },
  { group: "Cross-platform", chips: ["Kotlin Multiplatform", "Compose Multiplatform", "Ktor", "SQLDelight"] },
  { group: "Web", chips: ["TypeScript", "HTML and CSS"] },
];

const sectionOf = (html: string, id: string): string => {
  const match = html.match(new RegExp(`<section id="${id}"[^>]*>([\\s\\S]*?)<\\/section>`));
  assert.ok(match, `no <section id="${id}">`);
  return match[1];
};

// Each technology group as its heading and its chips, in page order.
const techGroups = (html: string): { group: string; chips: string[]; lists: string[] }[] =>
  sectionOf(html, "technologies")
    .split(/<div class="tech-group">/)
    .slice(1)
    .map((part) => {
      const headings = elements(part, "h3").map(textOf);
      assert.equal(headings.length, 1, "a technology group needs exactly one <h3>");
      return {
        group: headings[0],
        chips: elements(part, "li").map(textOf),
        lists: [...part.matchAll(/<ul\b[^>]*>/gi)].map(([tag]) => tag),
      };
    });

test("B1: the technology groups and their chips are the approved list, in order", async () => {
  const groups = techGroups(await read("index.html"));
  for (const { group, lists } of groups) {
    assert.deepEqual(lists, ['<ul class="chips" role="list">'], `the group "${group}" needs exactly one chip list`);
  }
  assert.deepEqual(
    groups.map(({ group, chips }) => ({ group, chips })),
    TECHNOLOGIES.map(({ group, chips }) => ({ group, chips: [...chips] })),
  );
});

test("B2: chip texts are unique across the page, and so are group names", async () => {
  const groups = techGroups(await read("index.html"));
  const chips = groups.flatMap(({ chips }) => chips);
  assert.equal(new Set(chips).size, chips.length, "a chip appears twice");
  const names = groups.map(({ group }) => group);
  assert.equal(new Set(names).size, names.length, "a group name appears twice");
});

test("B3: index.md lists each technology group's chips, in order, under its ### heading", async () => {
  const lines = await markdownLines("index.md");
  for (const { group, chips } of TECHNOLOGIES) {
    const index = lines.indexOf(`### ${group}`);
    assert.ok(index >= 0, `index.md has no "### ${group}"`);
    const items: string[] = [];
    for (const line of lines.slice(index + 1)) {
      if (!line.startsWith("- ")) break;
      items.push(line.slice(2));
    }
    assert.deepEqual(items, [...chips], `index.md lists the wrong chips under "${group}"`);
  }
});

// C: structure.

const HEADINGS_H2 = ["Mobile and web development services.", "Technologies I use.", "Let's talk."];

const idsOf = (html: string): string[] => [...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id);

test("C1: every id on the homepage is unique", async () => {
  const ids = idsOf(await read("index.html"));
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(repeated, []);
});

test("C2: every in-page link names an id, and each section is linked", async () => {
  const html = await read("index.html");
  const ids = new Set(idsOf(html));
  const targets = [...html.matchAll(/href="#([^"]*)"/g)].map(([, target]) => target);
  for (const target of targets) assert.ok(ids.has(target), `href="#${target}" names no id`);
  for (const section of ["services", "technologies", "contact"]) {
    assert.ok(targets.includes(section), `nothing links to #${section}`);
  }
});

test("C3: one <h1>, and the heading level never skips one going down", async () => {
  const levels = [...(await read("index.html")).matchAll(/<h([1-6])\b/gi)].map(([, level]) => Number(level));
  assert.equal(levels.filter((level) => level === 1).length, 1);
  assert.equal(levels[0], 1, "the first heading is not the <h1>");
  for (const [index, level] of levels.entries()) {
    if (index === 0) continue;
    assert.ok(level <= levels[index - 1] + 1, `heading ${index + 1} jumps from h${levels[index - 1]} to h${level}`);
  }
});

test("C4: every <section> is labeled by an <h2> inside it", async () => {
  const html = await read("index.html");
  const sections = [...html.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi)];
  assert.ok(sections.length > 0);
  for (const [, attributes, inner] of sections) {
    const label = attributes.match(/aria-labelledby="([^"]+)"/);
    assert.ok(label, `a section has no aria-labelledby: ${attributes.trim()}`);
    assert.match(inner, new RegExp(`<h2 id="${label[1]}"`), `no <h2 id="${label[1]}"> inside its section`);
  }
});

test("C5: the sections are services, technologies, then contact", async () => {
  const order = [...(await read("index.html")).matchAll(/<section id="([^"]+)"/g)].map(([, id]) => id);
  assert.deepEqual(order, ["services", "technologies", "contact"]);
});

test("C6: the three <h2> texts are the approved ones, and there are nine <h3>", async () => {
  const html = await read("index.html");
  assert.deepEqual(elements(html, "h2").map(textOf), HEADINGS_H2);
  assert.equal(elements(html, "h3").length, 9);
});

// D: styles.

const PAGES = ["index.html", "privacy.html", "404.html"] as const;

test("D1: home.css loads nothing and animates nothing", async () => {
  const css = await read("static/css/home.css");
  for (const banned of ["@import", "url(", "@keyframes", "animation"]) {
    assert.ok(!css.includes(banned), `home.css contains ${banned}`);
  }
});

// Classes that are hooks for something other than this stylesheet.
const UNSTYLED_CLASSES: Readonly<Record<string, string>> = {
  "cf-turnstile": "Turnstile's script finds its widget by this class and styles it itself",
};

test("D2: every class used on the three pages has a selector in home.css", async () => {
  const css = await read("static/css/home.css");
  const used = new Set<string>();
  for (const page of PAGES) {
    for (const [, value] of (await read(page)).matchAll(/\sclass="([^"]+)"/g)) {
      for (const name of value.split(/\s+/)) if (name !== "") used.add(name);
    }
  }
  const missing = [...used].filter(
    (name) => !(name in UNSTYLED_CLASSES) && !new RegExp(`\\.${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(css),
  );
  assert.deepEqual(missing, [], `classes with no selector in home.css: ${missing.join(", ")}`);
});
