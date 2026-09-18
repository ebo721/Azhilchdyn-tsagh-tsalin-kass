import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const postingFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "journal-posting.ts");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [file] : [];
  }));
  return nested.flat();
}

describe("journal posting boundary", () => {
  it("keeps journal entry status writes inside the posting engine", async () => {
    const violations: string[] = [];
    for (const file of await sourceFiles(srcDir)) {
      if (file === postingFile) continue;
      const source = await readFile(file, "utf8");
      if (/\b(?:insert|update)\s*\(\s*journalEntriesTable\s*\)/.test(source)) {
        violations.push(path.relative(srcDir, file));
      }
    }
    assert.deepEqual(
      violations,
      [],
      "journal_entries writes must go through postJournalEntry/voidJournalEntry; direct SQL could mark an unbalanced entry posted",
    );
  });
});