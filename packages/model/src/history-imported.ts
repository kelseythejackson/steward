/**
 * `.steward/history-imported.json`: the GitHub artifact ids that
 * `steward history import` has already brought in, so later imports skip
 * them before downloading. It sits next to history.jsonl.
 *
 * Product, not people: the file holds artifact ids (numbers) and nothing
 * else: no names, logins or URLs. It's only a shortcut, so a missing or
 * damaged file just means every artifact is downloaded again (and the
 * records already in history.jsonl still aren't added twice).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const HISTORY_IMPORTED_FILE = "history-imported.json";

export function historyImportedPath(repoRoot: string): string {
  return join(repoRoot, ".steward", HISTORY_IMPORTED_FILE);
}

const isArtifactId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

/** Pure: the ids in the file's text. Anything that isn't a JSON array of positive whole numbers counts as empty; stray entries are dropped. */
export function parseImportedArtifacts(text: string): Set<number> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return new Set();
  }
  return new Set(Array.isArray(raw) ? raw.filter(isArtifactId) : []);
}

/** Pure: the file's text. Ids only, deduplicated and sorted, so the same ids always write the same file. */
export function serializeImportedArtifacts(ids: Iterable<number>): string {
  const sorted = [...new Set([...ids].filter(isArtifactId))].sort((a, b) => a - b);
  return `${JSON.stringify(sorted)}\n`;
}

/** The artifact ids imported before. Empty when there's no file yet, or it can't be read. */
export async function readImportedArtifacts(repoRoot: string): Promise<Set<number>> {
  try {
    return parseImportedArtifacts(await readFile(historyImportedPath(repoRoot), "utf8"));
  } catch {
    return new Set();
  }
}

/** Writes the imported artifact ids, replacing the file. Returns the path. */
export async function writeImportedArtifacts(repoRoot: string, ids: Iterable<number>): Promise<string> {
  await mkdir(join(repoRoot, ".steward"), { recursive: true });
  const path = historyImportedPath(repoRoot);
  await writeFile(path, serializeImportedArtifacts(ids), "utf8");
  return path;
}
