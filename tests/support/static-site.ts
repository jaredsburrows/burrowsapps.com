// The deployed site, emulated from the repository. Cloudflare is given this
// directory, .assetsignore (generated from PUBLISHED_FILES), _headers, and
// wrangler.jsonc; the functions here read the same inputs and apply the rules
// Cloudflare documents for them, as measured under wrangler dev, so
// tests can check what will be served and not only what the Worker returns.
// Each rule names the Cloudflare Workers documentation page it follows.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { route } from "../../workers/agent-readiness/router.ts";
import { makeBaseEnv, makeDeps } from "../../workers/agent-readiness/testing.ts";
import type { TestEnv } from "../../workers/agent-readiness/testing.ts";
import { PUBLISHED_FILES } from "./published-files.ts";

const REPO = new URL("../../", import.meta.url);

// True when the file is uploaded: .assetsignore re-includes exactly the files
// in PUBLISHED_FILES. The match is exact and case-sensitive, as the asset
// router's is (measured under wrangler dev: "/ROBOTS.TXT" is a 404), even on
// a case-insensitive filesystem.
export function isPublished(relative: string): boolean {
  return PUBLISHED_FILES.includes(relative);
}

// Every file that is uploaded, as a path relative to the repository root.
export function publishedPaths(): string[] {
  return [...PUBLISHED_FILES].sort();
}

// True when the file exists with exactly this spelling, checked against the
// directory listings so that a case-insensitive filesystem cannot pass a
// path that would not exist on Linux.
export function existsExactly(relative: string): boolean {
  let folder = REPO;
  const parts = relative.split("/");
  for (const [index, part] of parts.entries()) {
    if (!existsSync(folder) || !readdirSync(folder).includes(part)) return false;
    folder = new URL(`./${part}${index < parts.length - 1 ? "/" : ""}`, folder);
  }
  return statSync(folder).isFile();
}

// The URL the asset router serves a file at: "a/index.html" at "/a/",
// "a.html" at "/a", anything else at its own path (Static Assets, "HTML
// handling").
export function servedPath(relative: string): string {
  if (relative === "index.html" || relative.endsWith("/index.html")) return `/${relative.slice(0, -"index.html".length)}`;
  if (relative.endsWith(".html")) return `/${relative.slice(0, -".html".length)}`;
  return `/${relative}`;
}

type Resolved = { file: string } | { redirect: string } | null;

// How the asset router answers a path under html_handling
// "auto-trailing-slash" (Static Assets, "HTML handling"), as measured under
// wrangler dev:
//   "/" and "/a/" serve "index.html" in that folder; "/a" serves "a" or
//   "a.html"; "/a.html" and "/a/index.html" are a 307 to "/a" and "/a/";
//   "/a/" is a 307 to "/a" when only "a.html" exists; "//" is a 307 to "/".
// Redirects keep the query string. A folder with no index.html is no file:
// "/static" and "/static/" are 404s.
function resolve(pathname: string): Resolved {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!path.startsWith("/")) return null;
  if (path.includes("//")) {
    const collapsed = path.replace(/\/{2,}/g, "/");
    return resolve(collapsed) === null ? null : { redirect: collapsed };
  }
  const relative = path.slice(1);
  if (relative.split("/").some((segment) => segment === "." || segment === "..")) return null;
  if (path.endsWith(".html")) return isPublished(relative) ? { redirect: servedPath(relative) } : null;
  if (path.endsWith("/")) {
    if (isPublished(`${relative}index.html`)) return { file: `${relative}index.html` };
    if (path !== "/" && isPublished(`${relative.slice(0, -1)}.html`)) return { redirect: path.slice(0, -1) };
    return null;
  }
  if (isPublished(relative)) return { file: relative };
  if (isPublished(`${relative}.html`)) return { file: `${relative}.html` };
  return null;
}

// The repository file the asset router serves for a path, or null when it
// serves none (a redirect, or no file).
export function publishedFile(pathname: string): URL | null {
  const resolved = resolve(pathname);
  return resolved !== null && "file" in resolved ? new URL(`./${resolved.file}`, REPO) : null;
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

// The type Cloudflare infers from each extension, as measured on
// burrowsapps.com in production (2026-11-27). wrangler dev adds
// "; charset=utf-8" to the text types; production does not, so a charset the
// site needs comes from a Content-Type rule in _headers. Extensionless files
// get no type here, so they are usable only through such a rule too.
const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".md": "text/markdown",
  ".json": "application/json",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/vnd.microsoft.icon",
};

// Cloudflare's Cache-Control on every asset that _headers gives none
// (Static Assets, "Headers").
const DEFAULT_CACHE = "public, max-age=0, must-revalidate";

const extension = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
};

const isRead = (request: Request): boolean => request.method === "GET" || request.method === "HEAD";

// What env.ASSETS.fetch() answers. Only the path is used (Static Assets,
// "Binding"). A file or a redirect is answered for GET and HEAD; any other
// method on such a path is a 405 with no body. A path with no file gets
// 404.html with status 404 (not_found_handling "404-page"), with the _headers
// rules for its path.
export async function assetFetch(request: Request): Promise<Response> {
  const { pathname, search } = new URL(request.url);
  const resolved = resolve(pathname);
  if (resolved !== null && !isRead(request)) return new Response(null, { status: 405 });
  if (resolved !== null && "redirect" in resolved) {
    return new Response(null, { status: 307, headers: { Location: `${resolved.redirect}${search}` } });
  }
  const headers = headersFor(pathname);
  if (resolved === null) {
    headers.set("Content-Type", TYPES[".html"]);
    const body = request.method === "HEAD" ? null : readFileSync(new URL("404.html", REPO));
    return new Response(body, { status: 404, headers });
  }
  const type = TYPES[extension(resolved.file)];
  if (!headers.has("Content-Type") && type) headers.set("Content-Type", type);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", DEFAULT_CACHE);
  const file = new URL(`./${resolved.file}`, REPO);
  return new Response(request.method === "HEAD" ? null : readFileSync(file), { status: 200, headers });
}

const COMPRESSIBLE = /^(?:text\/|application\/(?:json|xml|javascript|[\w.+-]+\+json))/;

// With "Accept-Encoding: gzip", a text response comes back gzip-encoded and
// its Vary is left as it was (measured under wrangler dev: the page had
// "Content-Encoding: gzip" and "Vary: Accept" only).
async function encode(request: Request, response: Response): Promise<Response> {
  const accepts = (request.headers.get("Accept-Encoding") ?? "").toLowerCase().includes("gzip");
  const type = response.headers.get("Content-Type") ?? "";
  if (!accepts || response.status !== 200 || response.body === null || response.headers.has("Content-Encoding") || !COMPRESSIBLE.test(type)) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("Content-Encoding", "gzip");
  headers.delete("Content-Length");
  return new Response(gzipSync(Buffer.from(await response.arrayBuffer())), { status: response.status, headers });
}

// The deployed site: the asset router in front of the Worker.
//   - A path in run_worker_first runs the Worker, which reads files through
//     env.ASSETS (here, assetFetch).
//   - Otherwise a path with a file or a redirect is answered by the asset
//     router without running the Worker, for every method (a 405 for any but
//     GET and HEAD).
//   - Otherwise a browser navigation gets the 404 page without the Worker
//     (Static Assets, "Routing": Sec-Fetch-Mode navigate).
//   - Anything else runs the Worker, as a request that matches no file does.
export async function site(request: Request, env: TestEnv = makeBaseEnv()): Promise<Response> {
  const { pathname } = new URL(request.url);
  const deps = makeDeps();
  deps.setOrigin(assetFetch);
  let response: Response;
  if (runsWorkerFirst(pathname)) response = await route(request, env, deps);
  else if (resolve(pathname) !== null) response = await assetFetch(request);
  else if (request.headers.get("Sec-Fetch-Mode") === "navigate") response = await assetFetch(request);
  else response = await route(request, env, deps);
  return encode(request, response);
}
