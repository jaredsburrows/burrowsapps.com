// Contact Worker for burrowsapps.com — the original of the pair that
// the-cigar-guys/workers/contact/index.js was ported from; the two are kept
// identical apart from the site constants below:
// Cloudflare Email Service send_email binding (no third party, no API keys),
// honeypot, optional Turnstile, per-IP + global rate limits, origin
// allow-list, JSON (fetch) and form-encoded (no-JS) submissions.
//
// This file is the source of record as of 2026-09. The Worker predates it —
// it was created by dashboard upload, so every earlier revision exists only in
// Cloudflare's version list for burrowsapps-contact-form, not in git.
//
// One-time setup: `npx wrangler email sending enable burrowsapps.com`
// (adds DKIM/SPF sending records on the Cloudflare zone — MX untouched).

const ALLOWED_ORIGINS = [
  "https://burrowsapps.com",
  "https://www.burrowsapps.com",
];
const ALLOWED_PATHS = ["/api/contact"];
const FROM_ADDRESS = "contactform@burrowsapps.com";
const TO_ADDRESS = "burrowsapps+contactform@gmail.com";
const MAX_BODY_BYTES = 32 * 1024;
const MAX_FORM_BYTES = 96 * 1024;
const MAX_NAME = 200;
const MAX_EMAIL = 254;
const MAX_MESSAGE = 5000;
const MAX_TURNSTILE_TOKEN = 2048;
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function status(code, extraHeaders = {}) {
  return new Response(null, {
    status: code,
    headers: { "Cache-Control": "no-store", ...extraHeaders },
  });
}

function redirect(url) {
  return new Response(null, {
    status: 303,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}

function cleanName(value) {
  return String(value ?? "")
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029"\\<>@,;:]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMessage(value) {
  return String(value ?? "").replace(/[^\P{Cc}\n\t]/gu, "").trim();
}

async function verifyTurnstile(env, token, ip) {
  const idempotencyKey = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const body = new FormData();
      body.append("secret", env.TURNSTILE_SECRET);
      body.append("response", token);
      body.append("idempotency_key", idempotencyKey);
      if (ip) body.append("remoteip", ip);
      const res = await fetch(SITEVERIFY, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const outcome = await res.json();
      if (outcome.metadata?.result_with_testing_key === true) {
        return outcome.success === true;
      }
      const hostnames = ALLOWED_ORIGINS.map((o) => new URL(o).hostname);
      const ok = outcome.success === true && hostnames.includes(outcome.hostname);
      if (!ok) console.error("turnstile rejected:", JSON.stringify(outcome));
      return ok;
    } catch (e) {
      console.error("turnstile attempt", attempt, String(e));
    }
  }
  return false;
}

async function handle(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") ?? "";
  const originAllowed = ALLOWED_ORIGINS.includes(origin);
  const cors = originAllowed ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};

  if (request.method === "OPTIONS") {
    if (!originAllowed) return status(404);
    if (!ALLOWED_PATHS.includes(url.pathname)) return status(404);
    return status(204, {
      ...cors,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
  }
  if (request.method !== "POST") return status(404);
  if (!ALLOWED_PATHS.includes(url.pathname)) return status(404);
  if (!originAllowed) return status(404);

  const contentType = request.headers.get("Content-Type") ?? "";
  const isJson = contentType.includes("application/json");
  const isForm =
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");
  if (!isJson && !isForm) return status(404);

  // No-JS form posts bounce back to the one-pager's #contact section; fetch
  // gets status codes. Redirect base comes from the request host so a post from
  // www lands back on www instead of being thrown across to the apex.
  const ok = () => (isForm ? redirect(`${url.origin}/?sent=1#contact`) : status(204, cors));
  const fail = (code) => (isForm ? redirect(`${url.origin}/?error=1#contact`) : status(code, cors));

  const contentLength = request.headers.get("Content-Length");
  const maxBytes = isForm ? MAX_FORM_BYTES : MAX_BODY_BYTES;
  if (contentLength === null || !/^\d+$/.test(contentLength)) return status(404);
  const bodyBytes = Number(contentLength);
  if (bodyBytes <= 0 || bodyBytes > maxBytes) return status(404);

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  try {
    if (env.RATE_LIMITER) {
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return fail(429);
    }
  } catch (e) {
    console.error("rate limiter error:", String(e));
  }

  let data;
  try {
    if (isJson) {
      data = await request.json();
    } else {
      data = Object.fromEntries(await request.formData());
    }
  } catch {
    return fail(400);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return fail(400);
  }
  for (const key of ["name", "email", "message", "company", "cf-turnstile-response"]) {
    if (data[key] !== void 0 && typeof data[key] !== "string") return fail(400);
  }

  // Honeypot: bots that fill "company" get a fake success and learn nothing.
  if (data.company?.trim()) return ok();

  // Turnstile activates automatically once a TURNSTILE_SECRET is set.
  if (env.TURNSTILE_SECRET) {
    const token = data["cf-turnstile-response"];
    if (!token || token.length > MAX_TURNSTILE_TOKEN) return fail(403);
    if (!(await verifyTurnstile(env, token, ip))) return fail(403);
  }

  const name = cleanName(data.name);
  const email = String(data.email ?? "").trim();
  const message = cleanMessage(data.message);
  if (
    !name ||
    name.length > MAX_NAME ||
    !message ||
    message.length > MAX_MESSAGE ||
    email.length > MAX_EMAIL ||
    !EMAIL_RE.test(email)
  ) {
    return fail(400);
  }

  try {
    if (env.GLOBAL_LIMITER) {
      const { success } = await env.GLOBAL_LIMITER.limit({ key: "global" });
      if (!success) return fail(429);
    }
  } catch (e) {
    console.error("global limiter error:", String(e));
  }

  try {
    const safeName = name.replace(/[\r\n]+/g, " ").slice(0, 60);
    await env.CONTACT.send({
      from: { email: FROM_ADDRESS, name: "burrowsapps.com" },
      to: TO_ADDRESS,
      replyTo: email,
      subject: `burrowsapps.com \u2014 new message from ${safeName}`,
      text: `A visitor submitted the contact form on burrowsapps.com.

From: ${name} <${email}>
Received: ${new Date().toUTCString()}

Message:
${message}

\u2014 Sent automatically by the contact form at https://burrowsapps.com
  Submitted from IP address ${ip}
`,
    });
  } catch (e) {
    console.error("email send failed:", e?.code ?? "", String(e));
    return fail(500);
  }
  return ok();
}

const worker = {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      console.error("unhandled error:", String(e));
      return status(500);
    }
  },
};

export default worker;
