import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

/**
 * The app's name for design.md's title: its package.json `name` (without an
 * `@scope/`), else the folder's name. A folder is often called something
 * like `app` or `web`; the package usually says what the product is.
 */
export async function projectName(root: string): Promise<string> {
  try {
    const name = (JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { name?: unknown }).name;
    if (typeof name === "string" && name.trim() !== "") return name.trim().replace(/^@[^/]+\//, "");
  } catch {
    // no package.json, or not JSON: use the folder's name
  }
  return basename(root);
}
