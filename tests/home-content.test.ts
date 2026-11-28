import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SERVICES } from "../workers/agent-readiness/facts.ts";
import { decodeEntities, mainOf, textOf } from "./support/html-text.ts";
import { isPublished, site } from "./support/static-site.ts";

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

// F: the other pages.

const stylesheets = (html: string): string[] =>
  [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/gi)].map(([tag]) => {
    const href = tag.match(/href="([^"]+)"/);
    assert.ok(href, `a stylesheet link has no href: ${tag}`);
    return href[1];
  });

test("F1: the three pages share one versioned stylesheet link to a published file", async () => {
  const links = await Promise.all(PAGES.map(async (page) => stylesheets(await read(page))));
  for (const [index, page] of PAGES.entries()) assert.equal(links[index].length, 1, `${page} needs exactly one stylesheet`);
  const [href] = links[0];
  for (const [index, page] of PAGES.entries()) assert.equal(links[index][0], href, `${page} links a different stylesheet`);
  assert.match(href, /^\/static\/css\/home\.css\?v=\d+$/);
  assert.ok(isPublished(href.slice(1).split("?")[0]), `${href} is not a published file`);
});

test("F2: the section links on the privacy and 404 pages name ids on the homepage", async () => {
  const ids = new Set(idsOf(await read("index.html")));
  for (const page of ["privacy.html", "404.html"]) {
    const targets = [...(await read(page)).matchAll(/href="\/#([^"]*)"/g)].map(([, target]) => target);
    for (const target of targets) assert.ok(ids.has(target), `${page} links /#${target}, which names no id`);
    for (const section of ["services", "technologies"]) {
      assert.ok(targets.includes(section), `${page} does not link /#${section}`);
    }
  }
});

// States the assumption that the asset router serves a file with a query
// string as the file; the local preview measures it.
test("F3: the versioned stylesheet URL is served as the stylesheet", async () => {
  const [href] = stylesheets(await read("index.html"));
  const response = await site(new Request(`https://burrowsapps.com${href}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "text/css; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");
});

// E: title, descriptions, and structured data. The title and the description
// are the owner's wording (2026-11-27); the lede is the hero's, unchanged.

const TITLE = "Burrows Applications | Android, iOS & Kotlin Multiplatform Apps";
const DESCRIPTION =
  "Native Android and iOS apps, iOS and Android migration, Kotlin Multiplatform, Java to Kotlin modernization, security analysis, and websites built from scratch.";
const LEDE =
  "Burrows Applications specializes in mobile-first development — native apps for Android and iOS, Kotlin Multiplatform for cross-platform, and modern websites when your product needs a home on the web.";

const metaContent = (html: string, attribute: "name" | "property", key: string): string => {
  const matches = [...html.matchAll(new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="([^"]*)"`, "g"))];
  assert.equal(matches.length, 1, `expected one <meta ${attribute}="${key}">`);
  return decodeEntities(matches[0][1]);
};

const titleOf = (html: string): string => {
  const titles = elements(html, "title");
  assert.equal(titles.length, 1, "expected one <title>");
  return textOf(titles[0]);
};

type StructuredData = {
  description: string;
  knowsAbout: string[];
  hasOfferCatalog: { itemListElement: { "@type": string; itemOffered: { "@type": string; name: string; description: string } }[] };
};

const jsonLdBlocks = (html: string): string[] =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(([, body]) => body);

const structuredData = (html: string): StructuredData => {
  const blocks = jsonLdBlocks(html);
  assert.equal(blocks.length, 1, "expected one application/ld+json block");
  return JSON.parse(blocks[0]);
};

test("E1: the homepage has one structured-data block, and it parses", async () => {
  const blocks = jsonLdBlocks(await read("index.html"));
  assert.equal(blocks.length, 1);
  assert.doesNotThrow(() => JSON.parse(blocks[0]));
});

test("E2: the offer catalog lists SERVICES, in order", async () => {
  const data = structuredData(await read("index.html"));
  assert.deepEqual(
    data.hasOfferCatalog.itemListElement,
    SERVICES.map(({ name, description }) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name, description } })),
  );
});

test("E3: knowsAbout has every chip, 18 entries, no duplicate, and none of the removed entries", async () => {
  const { knowsAbout } = structuredData(await read("index.html"));
  for (const chip of TECHNOLOGIES.flatMap(({ chips }) => chips)) {
    assert.ok(knowsAbout.includes(chip), `knowsAbout is missing ${chip}`);
  }
  assert.equal(new Set(knowsAbout).size, knowsAbout.length, "knowsAbout has a duplicate");
  assert.equal(knowsAbout.length, 18);
  for (const removed of ["Java", "Android", "iOS", "Room", "Koin"]) {
    assert.ok(!knowsAbout.includes(removed), `knowsAbout has ${removed}`);
  }
});

test("E4: the title, og:title, and twitter:title are the approved title", async () => {
  const html = await read("index.html");
  assert.equal(titleOf(html), TITLE);
  assert.equal(metaContent(html, "property", "og:title"), TITLE);
  assert.equal(metaContent(html, "name", "twitter:title"), TITLE);
});

test("E5: the meta, Open Graph, and Twitter descriptions are the approved description", async () => {
  const html = await read("index.html");
  assert.equal(metaContent(html, "name", "description"), DESCRIPTION);
  assert.equal(metaContent(html, "property", "og:description"), DESCRIPTION);
  assert.equal(metaContent(html, "name", "twitter:description"), DESCRIPTION);
});

test("E6: the structured-data description is the hero lede, which is unchanged", async () => {
  const html = await read("index.html");
  const ledes = [...html.matchAll(/<p class="lede">([\s\S]*?)<\/p>/g)].map(([, inner]) => textOf(inner));
  assert.deepEqual(ledes, [LEDE]);
  assert.equal(structuredData(html).description, LEDE);
});

test("E7: the privacy and 404 pages keep their titles", async () => {
  assert.equal(titleOf(await read("privacy.html")), "Privacy Policy | Burrows Applications");
  assert.equal(titleOf(await read("404.html")), "404 | Burrows Applications");
});
