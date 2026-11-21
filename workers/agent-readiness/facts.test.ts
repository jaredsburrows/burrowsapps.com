import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveSiteUrl } from "../../tests/support/site-map.ts";
import { COMPANY, CONTACT, SERVICES, contactOptions } from "./facts.ts";

const REPO = new URL("../../", import.meta.url);
const read = (path: string): Promise<string> => readFile(new URL(path, REPO), "utf8");

const strings = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
};

const published = [...strings(COMPANY), ...strings(CONTACT)].filter(
  (value) => value.startsWith("https://") || value.includes("@"),
);

for (const value of published) {
  test(`${value} is in index.md or SKILL.md, or resolves on the site`, async () => {
    const text = (await read("index.md")) + (await read(".well-known/agent-skills/contact-burrows-applications/SKILL.md"));
    assert.ok(text.includes(value) || resolveSiteUrl(value) !== null, `${value} is not published anywhere`);
  });
}

test("the tagline appears in index.md", async () => {
  assert.ok((await read("index.md")).includes(COMPANY.tagline));
});

test("the founder appears in SKILL.md", async () => {
  assert.ok((await read(".well-known/agent-skills/contact-burrows-applications/SKILL.md")).includes(COMPANY.founder));
});

test("the platforms named in the facts appear in index.md", async () => {
  const text = await read("index.md");
  const facts = JSON.stringify({ COMPANY, SERVICES });
  for (const word of ["Android", "iOS", "Kotlin Multiplatform"]) {
    assert.ok(facts.includes(word), `facts do not mention ${word}`);
    assert.ok(text.includes(word), `index.md does not mention ${word}`);
  }
});

test("the form limits equal the contact Worker's", async () => {
  const source = await read("workers/contact/index.js");
  const constant = (name: string): number => {
    const match = source.match(new RegExp(`const ${name} = (\\d+);`));
    assert.ok(match, `${name} not found in workers/contact/index.js`);
    return Number(match[1]);
  };
  assert.equal(CONTACT.formFields.name.maxLength, constant("MAX_NAME"));
  assert.equal(CONTACT.formFields.email.maxLength, constant("MAX_EMAIL"));
  assert.equal(CONTACT.formFields.message.maxLength, constant("MAX_MESSAGE"));
});

test("contactOptions is the contact facts and nothing else", async () => {
  assert.deepEqual(contactOptions(), { ...CONTACT });
});
