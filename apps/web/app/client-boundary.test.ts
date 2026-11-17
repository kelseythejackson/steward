/**
 * A component that attaches event handlers (onClick, onChange…) must be a
 * client component ("use client"). Rendered from a server page otherwise,
 * Next.js refuses with "Event handlers cannot be passed to Client
 * Component props" and the page fails to load. (Report did, once.)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP = fileURLToPath(new URL(".", import.meta.url));
const tsx = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tsx(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : []));

describe("client components", () => {
  it('every file that attaches event handlers starts with "use client"', () => {
    const missing = tsx(APP).filter((f) => {
      const code = readFileSync(f, "utf8");
      return /\son(Click|Change|Submit|Drag\w*|Drop|Key\w+|Input|Focus|Blur)=\{/.test(code) && !/^\s*["']use client["']/.test(code);
    });
    expect(missing.map((f) => relative(APP, f))).toEqual([]);
  });
});
