// The company facts, one source for the public API and the MCP tools. The same
// facts are written out in index.md and the agent skill; facts.test.ts ties
// them together.

export const COMPANY = {
  name: "Burrows Applications",
  tagline: "Software, built with care.",
  description: "Burrows Applications specializes in mobile-first development: native apps for Android and iOS, Kotlin Multiplatform for cross-platform, and modern websites when a product needs a home on the web.",
  founder: "Jared Burrows",
  website: "https://burrowsapps.com/",
  privacyPolicy: "https://burrowsapps.com/privacy.html",
} as const;

export const SERVICES = [
  { id: "native-mobile", name: "Native mobile apps", description: "Native apps for Android and iOS." },
  { id: "kotlin-multiplatform", name: "Kotlin Multiplatform", description: "Cross-platform apps built with Kotlin Multiplatform." },
  { id: "web", name: "Websites", description: "Modern websites when a product needs a home on the web." },
] as const;

export const CONTACT = {
  form: "https://burrowsapps.com/#contact",
  formFields: { name: { maxLength: 200 }, email: { maxLength: 254 }, message: { maxLength: 5000 } },
  email: "contact@burrowsapps.com",
  linkedin: "https://linkedin.com/company/burrows-applications",
  x: "https://x.com/burrowsapps",
  developers: "https://burrowsapps.com/developers.md",
} as const;

export function contactOptions(): Record<string, unknown> {
  return { ...CONTACT };
}
