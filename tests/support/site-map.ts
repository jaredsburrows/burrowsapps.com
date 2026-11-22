// The truthfulness check that every list of published URLs goes through: a URL
// on the site is real when it names a published file (one that exists and is
// not in .assetsignore) or a path the Worker owns.

import { existsSync } from "node:fs";
import { isOwned } from "../../workers/agent-readiness/router.ts";
import { isIgnored } from "./static-site.ts";

const SITE_ORIGIN = "https://burrowsapps.com";
const REPO = new URL("../../", import.meta.url);

export function resolveSiteUrl(raw: string): "file" | "worker" | null {
  let url: URL;
  try {
    url = new URL(raw, `${SITE_ORIGIN}/`);
  } catch {
    return null;
  }
  if (url.origin !== SITE_ORIGIN) return null;
  const path = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
  const relative = decodeURIComponent(path).slice(1);
  if (existsSync(new URL(`./${relative}`, REPO)) && !isIgnored(relative)) return "file";
  if (isOwned(url.pathname)) return "worker";
  return null;
}
