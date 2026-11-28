import assert from "node:assert/strict";

// Plain-text helpers shared by the tests that compare page text: the markdown
// parity test and the homepage content test.

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&nbsp;": " ",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

export const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

// Loops until stable so that removing one tag can never leave another behind.
export const stripTags = (html: string): string => {
  let previous: string;
  let current = html;
  do {
    previous = current;
    current = previous.replace(/<[^>]+>/g, "");
  } while (current !== previous);
  return current;
};

export const decodeEntities = (text: string): string =>
  text.replace(/&(amp|nbsp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity]);

export const mainOf = (html: string): string => {
  const match = html.match(/<main\b[^>]*>([\s\S]*)<\/main>/i);
  assert.ok(match, "no <main> element");
  return match[1];
};

// Visible text of a fragment. Comments go first: the one above the form's
// challenge widget names a vendor, and comment text is not shown to anyone.
export const textOf = (html: string): string => {
  let previous: string;
  let current = html;
  do {
    previous = current;
    current = previous.replace(/<!--[\s\S]*?-->/g, "");
  } while (current !== previous);
  return collapse(decodeEntities(stripTags(current)));
};
