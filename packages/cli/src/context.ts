import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { DESIGN_MD_MARKER, generateDesignMd } from "@steward/context";
import { readModel } from "./review.js";
import { assertDirectory, StewardError } from "./scan.js";

export const DESIGN_MD_FILE = "design.md";

export interface ContextRun {
  markdown: string;
  /** Absolute path written, or `null` when printing only. */
  writtenTo: string | null;
}

/**
 * Builds design.md from `.steward/system.json`. With `file`, writes it to the
 * repo root, but only over a design.md Steward wrote before: a hand-written
 * one is left alone.
 */
export async function runContext(target: string, options: { file?: boolean; shownAs?: string } = {}): Promise<ContextRun> {
  const root = resolve(target);
  const shown = options.shownAs ?? target;
  await assertDirectory(root, shown);
  const model = await readModel(root, shown);
  const markdown = generateDesignMd(model, { name: basename(root) });
  if (!options.file) return { markdown, writtenTo: null };

  const path = join(root, DESIGN_MD_FILE);
  let existing: string | null = null;
  try {
    existing = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (existing !== null && !existing.startsWith(DESIGN_MD_MARKER)) {
    throw new StewardError(
      `There's already a ${DESIGN_MD_FILE} in ${shown} that Steward didn't write, so I left it alone. Rename or move it, then run this again. Or run \`steward context ${shown}\` without --file to print it instead.`,
    );
  }
  const tmp = `${path}.tmp`;
  await writeFile(tmp, markdown, "utf8");
  await rename(tmp, path);
  return { markdown, writtenTo: path };
}

/** Pure: what `steward context --file` prints after writing. */
export function formatContextReport(run: ContextRun, shownPath: string): string {
  const lines = run.markdown.split("\n").length - 1;
  return `Wrote ${shownPath} (${lines} lines) from .steward/system.json.\nNext: point your AI coding tool at it. Run this again after each scan or review to keep it current.\n`;
}
