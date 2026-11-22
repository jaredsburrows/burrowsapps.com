// The deployed site, emulated from the repository. Cloudflare is given this
// directory, .assetsignore, _headers, and wrangler.jsonc; the functions here
// read the same inputs and apply the rules Cloudflare documents for them, so
// tests can check what will be served and not only what the Worker returns.
// Each rule names the Cloudflare Workers documentation page it follows.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

const REPO = new URL("../../", import.meta.url);

// Top-level entries that are published. Every other entry in the repository
// root must be matched by .assetsignore or be one of CONSUMED_TOP_LEVEL.
export const PUBLIC_TOP_LEVEL: readonly string[] = [
  ".well-known",
  "404.html",
  "auth.md",
  "developers.md",
  "favicon.ico",
  "index.html",
  "index.md",
  "mcp",
  "privacy.html",
  "privacy.md",
  "robots.txt",
  "sitemap.xml",
  "static",
];

// Read by wrangler at deploy time and not published (checked by the local
// preview before the merge).
export const CONSUMED_TOP_LEVEL: readonly string[] = ["_headers", ".assetsignore"];

// The non-comment, non-blank lines of .assetsignore.
export function ignoreRules(): string[] {
  return readFileSync(new URL(".assetsignore", REPO), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

// .assetsignore uses the .gitignore format (Static Assets, "Ignoring
// assets"). Only two forms are used, and a test rejects any other: a bare
// name, which matches that name at any depth, and "**/name", which means the
// same.
export function isIgnored(relativePath: string): boolean {
  const names = ignoreRules().map((rule) => (rule.startsWith("**/") ? rule.slice(3) : rule));
  return relativePath.split("/").some((segment) => names.includes(segment));
}

// Every file that is uploaded, as a path relative to the repository root.
export function publishedPaths(): string[] {
  const walk = (folder: string): string[] =>
    readdirSync(new URL(`./${folder}`, REPO), { withFileTypes: true }).flatMap((entry) => {
      const relative = `${folder}${entry.name}`;
      if (isIgnored(relative) || (folder === "" && CONSUMED_TOP_LEVEL.includes(entry.name))) return [];
      return entry.isDirectory() ? walk(`${relative}/`) : [relative];
    });
  return walk("").sort();
}

// The URL the asset router serves a file at: "a/index.html" at "/a/",
// "a.html" at "/a", anything else at its own path (Static Assets, "HTML
// handling").
export function servedPath(relative: string): string {
  if (relative === "index.html" || relative.endsWith("/index.html")) return `/${relative.slice(0, -"index.html".length)}`;
  if (relative.endsWith(".html")) return `/${relative.slice(0, -".html".length)}`;
  return `/${relative}`;
}

const isFile = (url: URL): boolean => existsSync(url) && statSync(url).isFile();

// The repository file the asset router serves for a path, or null when none
// is served, under the default html_handling "auto-trailing-slash" (Static
// Assets, "HTML handling"). A path ending in ".html" is answered with a
// redirect, not a file.
export function publishedFile(pathname: string): URL | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!path.startsWith("/")) return null;
  // Only plain paths: no empty, "." or ".." segment before the last one.
  const folders = path.slice(1).split("/").slice(0, -1);
  if (folders.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  if (/\/\.\.?$/.test(path)) return null;
  const candidate = (relative: string): URL | null => {
    const file = new URL(`./${relative}`, REPO);
    return !isIgnored(relative) && isFile(file) ? file : null;
  };
  if (path.endsWith("/")) return candidate(`${path.slice(1)}index.html`);
  if (path.endsWith(".html")) return null;
  return candidate(path.slice(1)) ?? candidate(`${path.slice(1)}.html`);
}

type SiteConfig = { assets: { run_worker_first: string[] } };

// wrangler.jsonc uses whole-line comments only, so dropping those lines leaves
// plain JSON.
const siteConfig = (): SiteConfig =>
  JSON.parse(
    readFileSync(new URL("wrangler.jsonc", REPO), "utf8")
      .split("\n")
      .filter((line) => !/^\s*\/\//.test(line))
      .join("\n"),
  );

// True when a path matches assets.run_worker_first: exactly, or as a prefix
// when the pattern ends in "*" (Static Assets, "run_worker_first").
// Assumption, checked under wrangler dev before the merge: a pattern is
// matched against the path alone, so "/?sent=1" matches "/".
export function runsWorkerFirst(pathname: string): boolean {
  return siteConfig().assets.run_worker_first.some((pattern) =>
    pattern.endsWith("*") ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern,
  );
}
