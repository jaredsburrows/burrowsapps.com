import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROBOTS_URL = new URL("../robots.txt", import.meta.url);

const AI_TOKENS = [
  "OAI-SearchBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "ChatGPT-User",
  "Claude-User",
  "Perplexity-User",
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Bytespider",
  "Amazonbot",
];

const SIGNAL = "search=yes, ai-input=yes, ai-train=yes";

type RobotsLine = { field: string; value: string };
type Group = { agents: string[]; rules: RobotsLine[] };

const readRobots = async (): Promise<string> => readFile(ROBOTS_URL, "utf8");

const records = (text: string): RobotsLine[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const colon = line.indexOf(":");
      return { field: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
    });

// RFC 9309: consecutive User-agent lines start a group; the rules that follow belong to it.
// Sitemap is not a group member, so it is left out of the groups.
const parseGroups = (text: string): Group[] => {
  const groups: Group[] = [];
  let current: Group | null = null;
  let previousWasAgent = false;
  for (const { field, value } of records(text)) {
    const name = field.toLowerCase();
    if (name === "user-agent") {
      if (!previousWasAgent || current === null) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value);
      previousWasAgent = true;
      continue;
    }
    previousWasAgent = false;
    if (name === "sitemap") continue;
    current?.rules.push({ field: name, value });
  }
  return groups;
};

test("every record line is a known field followed by a value", async () => {
  const text = await readRobots();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    assert.match(line, /^(User-agent|Allow|Disallow|Content-Signal|Sitemap): \S/, `unexpected line: ${line}`);
  }
});

test("a wildcard group exists", async () => {
  const groups = parseGroups(await readRobots());
  assert.ok(groups.some((group) => group.agents.includes("*")));
});

test("each AI token appears in exactly one group", async () => {
  const groups = parseGroups(await readRobots());
  for (const token of AI_TOKENS) {
    const matches = groups.filter((group) =>
      group.agents.some((agent) => agent.toLowerCase() === token.toLowerCase()),
    );
    assert.equal(matches.length, 1, `${token} is in ${matches.length} groups`);
  }
});

test("every group has one Content-Signal line before its Allow", async () => {
  const groups = parseGroups(await readRobots());
  assert.ok(groups.length > 0);
  for (const group of groups) {
    const label = group.agents.join(", ");
    const signals = group.rules.filter((rule) => rule.field === "content-signal");
    assert.equal(signals.length, 1, `group ${label} has ${signals.length} Content-Signal lines`);
    assert.equal(signals[0].value, SIGNAL, `group ${label}`);
    const signalIndex = group.rules.findIndex((rule) => rule.field === "content-signal");
    const allowIndex = group.rules.findIndex((rule) => rule.field === "allow");
    assert.ok(allowIndex > signalIndex, `group ${label}: Content-Signal must come before Allow`);
  }
});

test("every group allows everything and nothing is disallowed", async () => {
  const text = await readRobots();
  for (const group of parseGroups(text)) {
    assert.ok(
      group.rules.some((rule) => rule.field === "allow" && rule.value === "/"),
      `group ${group.agents.join(", ")} lacks Allow: /`,
    );
  }
  assert.ok(!records(text).some((record) => record.field.toLowerCase() === "disallow"));
});

test("the sitemap is listed exactly once", async () => {
  const lines = (await readRobots()).split("\n");
  const sitemaps = lines.filter((line) => line === "Sitemap: https://burrowsapps.com/sitemap.xml");
  assert.equal(sitemaps.length, 1);
});

test("the file ends with a single newline and has no CR characters", async () => {
  const text = await readRobots();
  assert.ok(!text.includes("\r"));
  assert.ok(text.endsWith("\n"));
  assert.ok(!text.endsWith("\n\n"));
});
