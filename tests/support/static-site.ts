// The deployed site, emulated from the repository. Cloudflare is given this
// directory, .assetsignore, _headers, and wrangler.jsonc; the functions here
// read the same inputs and apply the rules Cloudflare documents for them, so
// tests can check what will be served and not only what the Worker returns.
// Each rule names the Cloudflare Workers documentation page it follows.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { route } from "../../workers/agent-readiness/router.ts";
import { makeBaseEnv, makeDeps } from "../../workers/agent-readiness/testing.ts";
import type { TestEnv } from "../../workers/agent-readiness/testing.ts";

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

// The patterns in assets.run_worker_first, as written in wrangler.jsonc.
export function workerFirstPatterns(): string[] {
  return siteConfig().assets.run_worker_first;
}

// A run_worker_first pattern: "*" matches any run of characters, including
// "/" and none at all (Static Assets, "run_worker_first"). Measured under
// wrangler dev: "/api/v1/*" answers "/api/v1/", and the match uses the path
// alone, so "/?x=1" matches "/".
export function globMatches(pattern: string, pathname: string): boolean {
  const source = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}$`).test(pathname);
}

export function runsWorkerFirst(pathname: string): boolean {
  return workerFirstPatterns().some((pattern) => globMatches(pattern, pathname));
}

export type HeaderRule = { pattern: string; headers: [string, string][] };

// The rules in _headers, in file order: a line that starts with "/" opens a
// rule, and the indented "Name: value" lines under it are its headers.
export function headerRules(): HeaderRule[] {
  const rules: HeaderRule[] = [];
  for (const line of readFileSync(new URL("_headers", REPO), "utf8").split("\n")) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: [] });
      continue;
    }
    const current = rules.at(-1);
    const colon = line.indexOf(":");
    if (!current || colon < 0) throw new Error(`_headers: unexpected line ${JSON.stringify(line)}`);
    current.headers.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

// A pattern matches a path exactly, or as a prefix when it ends in "*".
export const ruleMatches = (pattern: string, pathname: string): boolean =>
  pattern.endsWith("*") ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern;

// The headers _headers adds to a file at this path. Every matching rule
// applies, and a header named by two of them is joined with ", " (Static
// Assets, "Headers").
export function headersFor(pathname: string): Headers {
  const headers = new Headers();
  for (const rule of headerRules()) {
    if (!ruleMatches(rule.pattern, pathname)) continue;
    for (const [name, value] of rule.headers) headers.append(name, value);
  }
  return headers;
}

// Assumption, checked under wrangler dev and after the deploy: the type
// Cloudflare infers from each extension. ".md" and extensionless files get no
// type here, so they are usable only through a Content-Type rule in _headers.
const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

// Cloudflare's Cache-Control on every asset that _headers gives none
// (Static Assets, "Headers").
const DEFAULT_CACHE = "public, max-age=0, must-revalidate";

const extension = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
};

// For a path ending in ".html" whose file is published, the path the asset
// router redirects it to: "/index.html" to "/", "/privacy.html" to "/privacy"
// (Static Assets, "HTML handling").
function htmlRedirect(pathname: string): string | null {
  if (!pathname.endsWith(".html")) return null;
  const relative = pathname.slice(1);
  if (isIgnored(relative) || !isFile(new URL(`./${relative}`, REPO))) return null;
  return servedPath(relative);
}

// What env.ASSETS.fetch() is documented to answer. Only the path is used
// (Static Assets, "Binding"). A path with no file gets 404.html with status
// 404, because not_found_handling is "404-page".
export async function assetFetch(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const location = htmlRedirect(pathname);
  if (location !== null) return new Response(null, { status: 307, headers: { Location: location } });
  const file = publishedFile(pathname);
  if (file === null) {
    const body = request.method === "HEAD" ? null : readFileSync(new URL("404.html", REPO));
    return new Response(body, { status: 404, headers: { "Content-Type": TYPES[".html"] } });
  }
  const headers = headersFor(pathname);
  const type = TYPES[extension(file.pathname)];
  if (!headers.has("Content-Type") && type) headers.set("Content-Type", type);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", DEFAULT_CACHE);
  return new Response(request.method === "HEAD" ? null : readFileSync(file), { status: 200, headers });
}

// The deployed site: the asset router in front of the Worker.
//   - A path in run_worker_first runs the Worker, which reads files through
//     env.ASSETS (here, assetFetch).
//   - Otherwise a GET or HEAD for a file is answered by the asset router.
//   - Otherwise a browser navigation gets the 404 page without the Worker
//     (Static Assets, "Routing": Sec-Fetch-Mode navigate).
//   - Anything else runs the Worker, as a request that matches no file does.
export async function site(request: Request, env: TestEnv = makeBaseEnv()): Promise<Response> {
  const { pathname } = new URL(request.url);
  const deps = makeDeps();
  deps.setOrigin(assetFetch);
  if (runsWorkerFirst(pathname)) return route(request, env, deps);
  const isRead = request.method === "GET" || request.method === "HEAD";
  if (isRead && (publishedFile(pathname) !== null || htmlRedirect(pathname) !== null)) return assetFetch(request);
  if (request.headers.get("Sec-Fetch-Mode") === "navigate") return assetFetch(request);
  return route(request, env, deps);
}
