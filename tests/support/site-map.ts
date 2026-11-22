// The truthfulness check that every list of published URLs goes through: a URL
// on the site is real when it names a published file (one on the list that
// .assetsignore is generated from) or a path the Worker owns.

import { isOwned } from "../../workers/agent-readiness/router.ts";
import { isPublished } from "./static-site.ts";

const SITE_ORIGIN = "https://burrowsapps.com";

export function resolveSiteUrl(raw: string): "file" | "worker" | null {
  let url: URL;
  try {
    url = new URL(raw, `${SITE_ORIGIN}/`);
  } catch {
    return null;
  }
  if (url.origin !== SITE_ORIGIN) return null;
  const path = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;
  if (isPublished(decodeURIComponent(path).slice(1))) return "file";
  if (isOwned(url.pathname)) return "worker";
  return null;
}
