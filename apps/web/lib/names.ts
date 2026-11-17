/** Token naming, safe for the browser (no file access). */

/** `color.gray.200` → `gray-200`: how it's written in a class. */
export const tokenName = (path: string) => path.replace(/^color\./, "").replaceAll(".", "-");

/** A suggested name for a color moved out on its own, unique among `taken`: `color.gray.e4e4e7`. */
export function nameForMovedColor(fromPath: string, hex: string, taken: readonly string[]): string {
  const family = fromPath.split(".").slice(0, -1).join(".") || "color";
  const base = `${family}.${hex.slice(1).toLowerCase()}`;
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}-${n}`;
  return name;
}
