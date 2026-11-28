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

// Each name is the heading of its card on the homepage, and each description
// is the card's paragraph, so the API and the page say the same thing.
export const SERVICES = [
  { id: "platform-migration", name: "iOS to Android and Android to iOS migration", description: "Bring an Android app to iOS, or an iOS app to Android, as a native app that keeps the features and behavior its users already know." },
  { id: "kotlin-multiplatform", name: "Kotlin Multiplatform (KMP) development", description: "Share business logic, networking, and storage between Android and iOS with Kotlin Multiplatform, adopted one module at a time or from the start." },
  { id: "native-mobile", name: "Native Android and iOS apps", description: "New native apps for Android and iOS, built for each platform from the first screen to release." },
  { id: "web", name: "Custom websites built from scratch", description: "Modern websites built from a blank page, fast and accessible, for a product that needs a home on the web." },
  { id: "security-analysis", name: "Mobile app and website security analysis", description: "A review of a mobile app or website for security weaknesses, from how data is stored and sent to dependencies and server headers, with a written list of findings and fixes." },
  { id: "code-modernization", name: "Java to Kotlin migration and modernization", description: "Bring an aging codebase up to date: Java to Kotlin, outdated libraries and build tooling replaced, and tests added so the next change is safer." },
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
