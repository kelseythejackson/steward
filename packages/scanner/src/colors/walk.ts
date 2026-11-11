import { readdir, readFile, realpath, stat } from "node:fs/promises";
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

const toRel = (root: string, full: string) => relative(root, full).split(sep).join("/");
const isInside = (root: string, path: string) => path === root || path.startsWith(root + sep);

/**
 * Lists files under `root` (sorted, repo-relative, forward slashes),
 * skipping build and dependency folders and minified files.
 *
 * Symlinks are followed when they point inside the repo; a file reached by
 * more than one path is listed once, under its real path when that's in the
 * repo. Links that point outside the repo (or are broken) aren't followed;
 * pass `outside` to collect them.
 */
export async function listFiles(root: string, include: (path: string) => boolean, outside?: string[]): Promise<string[]> {
  const realRoot = await realpath(root);
  const found = new Map<string, { rel: string; viaLink: boolean }>(); // real path → how it was reached
  // Real directories already walked, and whether only through a link. A link to an ancestor can't loop,
  // and a folder first reached through a link is walked again by its real path so files keep their real names.
  const visited = new Map<string, boolean>();

  const visit = async (dir: string, realDir: string, viaLink: boolean) => {
    const before = visited.get(realDir);
    if (before !== undefined && (before === false || viaLink)) return;
    visited.set(realDir, viaLink);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      let real = join(realDir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      let linked = viaLink;
      if (entry.isSymbolicLink()) {
        try {
          real = await realpath(full);
          const target = await stat(real);
          isDir = target.isDirectory();
          isFile = target.isFile();
        } catch {
          isDir = isFile = false; // broken link
        }
        if ((!isDir && !isFile) || !isInside(realRoot, real)) {
          outside?.push(toRel(root, full));
          continue;
        }
        linked = true;
      }
      if (isDir) {
        if (!IGNORED_DIRS.has(entry.name)) await visit(full, real, linked);
      } else if (isFile && !MINIFIED.test(entry.name)) {
        const rel = toRel(root, full);
        if (!include(rel)) continue;
        const seen = found.get(real);
        // Prefer the path that isn't through a link, then the first in sorted order, so the result is stable.
        if (!seen || (seen.viaLink && !linked) || (seen.viaLink === linked && compareStrings(rel, seen.rel) < 0)) found.set(real, { rel, viaLink: linked });
      }
    }
  };
  await visit(root, realRoot, false);
  outside?.sort(compareStrings);
  return [...found.values()].map((f) => f.rel).sort(compareStrings);
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
