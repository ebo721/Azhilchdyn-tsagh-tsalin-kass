import { readFile, writeFile } from "node:fs/promises";

for (const file of [
  "../api-client-react/src/generated/api.ts",
  "../api-zod/src/generated/api.ts",
]) {
  const content = await readFile(new URL(file, import.meta.url), "utf8");
  await writeFile(new URL(file, import.meta.url), `${content.replace(/\s+$/u, "")}\n`);
}