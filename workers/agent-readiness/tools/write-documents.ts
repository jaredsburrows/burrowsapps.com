// Writes the generated static documents into the repository. Run it after
// changing CATALOG, CARD, AGENT_CARD, or the OAuth documents, and commit the
// result:
//   node workers/agent-readiness/tools/write-documents.ts

import { mkdir, writeFile } from "node:fs/promises";
import { DOCUMENTS } from "../documents.ts";

const REPO = new URL("../../../", import.meta.url);

for (const [path, content] of Object.entries(DOCUMENTS)) {
  const file = new URL(`.${path}`, REPO);
  await mkdir(new URL(".", file), { recursive: true });
  await writeFile(file, content);
  console.log(`wrote ${path}`);
}
