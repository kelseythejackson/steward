import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { compareStrings } from "@steward/model";
import type { SourceFile } from "./types.js";

export const IGNORED_DIRS = new Set([".git", ".next", ".steward", ".turbo", "build", "coverage", "dist", "node_modules", "out"]);

/** Lists files under `root` (sorted, repo-relative, forward slashes), skipping build and dependency folders. */
export async function listFiles(root: string, include: (path: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await visit(full);
      } else if (entry.isFile()) {
        const rel = relative(root, full).split(sep).join("/");
        if (include(rel)) out.push(rel);
      }
    }
  };
  await visit(root);
  return out.sort(compareStrings);
}

export async function readSourceFiles(root: string, paths: readonly string[]): Promise<SourceFile[]> {
  return Promise.all(paths.map(async (path) => ({ path, content: await readFile(join(root, path), "utf8") })));
}
