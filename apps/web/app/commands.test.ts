/**
 * Every command the app tells people to run must work as written. There's
 * no global `steward` command, so instructions use `pnpm steward …` (see
 * lib/commands.ts). This fails on any bare `steward <command>` in UI copy.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name === "node_modules" || e.name === ".next" ? [] : e.isDirectory() ? files(join(dir, e.name)) : /\.(tsx?|ts)$/.test(e.name) && !e.name.includes(".test.") ? [join(dir, e.name)] : [],
  );

describe("instructions in the app", () => {
  it("never tell people to run a bare `steward` command", () => {
    const bad: string[] = [];
    for (const file of [...files(join(WEB, "app")), ...files(join(WEB, "lib"))]) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments are for developers
          if (/(?<!pnpm )\bsteward (scan|check|context|review|history)\b/.test(line)) bad.push(`${relative(WEB, file)}:${i + 1}`);
        });
    }
    expect(bad).toEqual([]);
  });
});
