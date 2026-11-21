import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolveSiteUrl } from "./support/site-map.ts";

const REPO = new URL("../", import.meta.url);
const SITE = "https://burrowsapps.com/";
const INDEX_URL = new URL(".well-known/agent-skills/index.json", SITE);
const SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
// auth.md is added in T33; remove this entry there.
const NOT_YET_PUBLISHED = ["https://burrowsapps.com/auth.md"];

type Skill = { name: string; type: string; description: string; url: string; digest: string };
type SkillsIndex = { $schema: string; skills: Skill[] };

// Maps a URL on the site to the repo file GitHub Pages serves for it.
const repoFileFor = (url: URL): URL => {
  const path = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
  return new URL(`.${path}`, REPO);
};

const readIndex = async (): Promise<SkillsIndex> =>
  JSON.parse(await readFile(new URL(".well-known/agent-skills/index.json", REPO), "utf8"));

const frontmatter = (text: string): Record<string, string> => {
  assert.ok(text.startsWith("---\n"), "SKILL.md must start with YAML frontmatter");
  const end = text.indexOf("\n---\n", 4);
  assert.ok(end > 0, "frontmatter is not closed");
  const fields: Record<string, string> = {};
  for (const line of text.slice(4, end).split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return fields;
};

test("index.json declares the v0.2.0 schema and lists skills", async () => {
  const index = await readIndex();
  assert.equal(index.$schema, SCHEMA);
  assert.ok(Array.isArray(index.skills) && index.skills.length > 0);
});

test("each skill entry has exactly the required fields in the right format", async () => {
  for (const skill of (await readIndex()).skills) {
    assert.deepEqual(Object.keys(skill).sort(), ["description", "digest", "name", "type", "url"]);
    assert.match(skill.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(skill.name.length <= 64);
    assert.equal(skill.type, "skill-md");
    assert.ok(skill.description.length >= 1 && skill.description.length <= 1024);
    assert.match(skill.digest, /^sha256:[0-9a-f]{64}$/);
  }
});

test("each skill url maps to a file in the repo", async () => {
  for (const skill of (await readIndex()).skills) {
    const file = repoFileFor(new URL(skill.url, INDEX_URL));
    assert.ok(existsSync(file), `${skill.url} has no file at ${fileURLToPath(file)}`);
  }
});

test("each digest matches the sha256 of the served bytes", async () => {
  for (const skill of (await readIndex()).skills) {
    const bytes = await readFile(repoFileFor(new URL(skill.url, INDEX_URL)));
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    assert.equal(skill.digest, digest, `digest for ${skill.name} is stale`);
  }
});

test("SKILL.md frontmatter matches the index entry and its directory", async () => {
  for (const skill of (await readIndex()).skills) {
    const url = new URL(skill.url, INDEX_URL);
    const fields = frontmatter(await readFile(repoFileFor(url), "utf8"));
    const directory = url.pathname.split("/").at(-2);
    assert.equal(fields.name, skill.name);
    assert.equal(fields.name, directory);
    assert.equal(fields.description, skill.description);
  }
});

test("every burrowsapps.com URL in SKILL.md is a file in the repo or a Worker path", async () => {
  for (const skill of (await readIndex()).skills) {
    const text = await readFile(repoFileFor(new URL(skill.url, INDEX_URL)), "utf8");
    const urls = text.match(/https:\/\/burrowsapps\.com\/[^\s)`]*/g) ?? [];
    assert.ok(urls.length > 0);
    for (const raw of urls) {
      const url = new URL(raw.replace(/[.,;:]+$/, ""));
      url.hash = "";
      if (NOT_YET_PUBLISHED.includes(url.href)) continue;
      assert.notEqual(resolveSiteUrl(url.href), null, `${raw} does not resolve`);
    }
  }
});

test("the WebMCP tool named in SKILL.md is the one home.js registers", async () => {
  const tool = "send_contact_message";
  const skill = await readFile(new URL(".well-known/agent-skills/contact-burrows-applications/SKILL.md", REPO), "utf8");
  const script = await readFile(new URL("static/js/home.js", REPO), "utf8");
  assert.ok(skill.includes(`\`${tool}\``), `SKILL.md does not name ${tool}`);
  assert.ok(script.includes(`'${tool}'`), `home.js does not register ${tool}`);
});
