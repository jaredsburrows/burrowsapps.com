// Writes .assetsignore from PUBLISHED_FILES. Run it after changing the list
// and commit the result:
//   node tests/support/write-assetsignore.ts

import { writeFile } from "node:fs/promises";
import { assetsIgnore } from "./published-files.ts";

await writeFile(new URL("../../.assetsignore", import.meta.url), assetsIgnore());
console.log("wrote .assetsignore");
