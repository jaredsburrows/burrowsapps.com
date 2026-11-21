import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { COMPANY, CONTACT, INQUIRY_API, SERVICES, contactOptions } from "./facts.ts";
import { isOwned } from "./router.ts";

const REPO = new URL("../../", import.meta.url);
const read = (path: string): Promise<string> => readFile(new URL(path, REPO), "utf8");

// Temporary until tests/support/site-map.ts exists (T21): a site URL is real
// when Pages has a file for it or the Worker owns its path.
const resolves = (raw: string): boolean => {
  const url = new URL(raw);
  if (url.origin !== "https://burrowsapps.com") return false;
  if (isOwned(url.pathname)) return true;
  const path = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
  return existsSync(new URL(`.${path}`, REPO));
};

const strings = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
};

const published = [...strings(COMPANY), ...strings(CONTACT), ...strings(INQUIRY_API)].filter(
  (value) => value.startsWith("https://") || value.includes("@"),
);

// URLs whose file arrives in a later task.
const PENDING: Record<string, string> = {
  "https://burrowsapps.com/developers.md": "developers.md arrives in T21",
  "https://burrowsapps.com/auth.md": "auth.md arrives in T33",
};

for (const value of published) {
  test(`${value} is in index.md or SKILL.md, or resolves on the site`, { todo: PENDING[value] ?? false }, async () => {
    const text = (await read("index.md")) + (await read(".well-known/agent-skills/contact-burrows-applications/SKILL.md"));
    assert.ok(text.includes(value) || (value.startsWith("https://") && resolves(value)), `${value} is not published anywhere`);
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

test("contactOptions names the inquiry API only when the authorization server is on", async () => {
  assert.equal("inquiryApi" in contactOptions(false), false);
  assert.deepEqual(contactOptions(true).inquiryApi, INQUIRY_API);
  assert.equal(contactOptions(true).email, CONTACT.email);
});
