import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { compareStrings } from "@steward/model";
import type { SkippedFile, SourceFile } from "./types.js";

/** Build output, dependencies and caches. Never hand-written UI code. */
export const IGNORED_DIRS = new Set([
  ".cache", ".git", ".netlify", ".next", ".output", ".parcel-cache", ".steward", ".turbo", ".vercel",
  "build", "coverage", "dist", "node_modules", "out", "storybook-static", "vendor",
]);

/** Minified files (`app.min.css`) are generated, so they aren't scanned. */
const MINIFIED = /\.min\.[a-z]+$/;

/** Files bigger than this are almost always generated (GraphQL types, bundled CSS), so they're skipped and listed. */
export const MAX_FILE_BYTES = 1024 * 1024;

/** How many files are read at once, so huge repos don't run out of file handles. */
const READ_CONCURRENCY = 32;

/** Lists files under `root` (sorted, repo-relative, forward slashes), skipping build and dependency folders and minified files. */
export async function listFiles(root: string, include: (path: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await visit(full);
      } else if (entry.isFile() && !MINIFIED.test(entry.name)) {
        const rel = relative(root, full).split(sep).join("/");
        if (include(rel)) out.push(rel);
      }
    }
  };
  await visit(root);
  return out.sort(compareStrings);
}

/** Runs `task` over `items` with at most `limit` running at once, keeping results in order. */
async function mapLimited<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface RepoFiles {
  files: SourceFile[];
  /** Files left out, with why (e.g. too big to be hand-written). */
  skipped: SkippedFile[];
}

/** Reads files for a scan, a few at a time, skipping any over `maxBytes` and saying so. */
export async function readRepoFiles(root: string, paths: readonly string[], maxBytes = MAX_FILE_BYTES): Promise<RepoFiles> {
  const read = await mapLimited(paths, READ_CONCURRENCY, async (path): Promise<SourceFile | SkippedFile> => {
    const full = join(root, path);
    const { size } = await stat(full);
    if (size > maxBytes) {
      return { file: path, reason: `larger than ${Math.round(maxBytes / 1024 / 1024)} MB (${(size / 1024 / 1024).toFixed(1)} MB), so probably generated` };
    }
    return { path, content: await readFile(full, "utf8") };
  });
  return {
    files: read.filter((r): r is SourceFile => "content" in r),
    skipped: read.filter((r): r is SkippedFile => "reason" in r),
  };
}

/** Reads every listed file, a few at a time. Used by the single-extractor helpers; `scanRepo` uses `readRepoFiles`. */
export async function readSourceFiles(root: string, paths: readonly string[]): Promise<SourceFile[]> {
  return mapLimited(paths, READ_CONCURRENCY, async (path) => ({ path, content: await readFile(join(root, path), "utf8") }));
}
