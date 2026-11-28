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

test("there are six services", async () => {
  assert.equal(SERVICES.length, 6);
});

test("service ids are unique and kebab-case", async () => {
  const ids = SERVICES.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z]+(?:-[a-z]+)*$/, `${id} is not kebab-case`);
});

test("the original three service ids are still present", async () => {
  const ids: readonly string[] = SERVICES.map(({ id }) => id);
  for (const id of ["native-mobile", "kotlin-multiplatform", "web"]) assert.ok(ids.includes(id), `${id} is missing`);
});

test("every service has a name and a description", async () => {
  for (const { id, name, description } of SERVICES) {
    assert.ok(name.trim() !== "", `${id} has no name`);
    assert.ok(description.trim() !== "", `${id} has no description`);
  }
});

// The same sentence is shown on the page and returned by the API, so it must
// read correctly in both: a period at the end, short, and no person speaking.
test("every service description is one short impersonal sentence", async () => {
  for (const { id, description } of SERVICES) {
    assert.ok(description.endsWith("."), `${id}: the description does not end with a period`);
    assert.ok(description.length <= 200, `${id}: the description is ${description.length} characters`);
    assert.doesNotMatch(description, /\b(?:you|your|we|our)\b/i, `${id}: the description addresses someone`);
    assert.doesNotMatch(description, /\bI\b/, `${id}: the description says "I"`);
  }
});
