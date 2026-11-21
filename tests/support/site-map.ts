// The truthfulness check that every list of published URLs goes through: a URL
// on the site is real when GitHub Pages has a file for it or the edge Worker
// owns its path.

import { existsSync } from "node:fs";
import { isOwned } from "../../workers/agent-readiness/router.ts";

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
  if (existsSync(new URL(`.${decodeURIComponent(path)}`, REPO))) return "file";
  if (isOwned(url.pathname)) return "worker";
  return null;
}
