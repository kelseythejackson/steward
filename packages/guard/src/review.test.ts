import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSystemModel, type StewardConfig } from "@steward/model";
import { describe, expect, it } from "vitest";
import { STATIC_CHECKS_NOTE } from "./check.js";
import { checkContext } from "./context.js";
import { checkFile, coverage } from "./engine.js";
import { formatReview, reviewFiles, rulesOff, unknownRules, type SourceFile } from "./review.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const model = parseSystemModel(readFileSync(join(FIXTURE, ".steward/system.json"), "utf8"));
const ctx = checkContext(model);
const read = (path: string): SourceFile => ({ path, code: readFileSync(join(FIXTURE, path), "utf8") });
const WARN: StewardConfig = { mode: "warn", rules: {} };
const ERROR: StewardConfig = { mode: "error", rules: {} };
const CHANGES = { kind: "changes", base: "main" } as const;

describe("config rule switches", () => {
  it("finds rule ids that aren't Review rules", () => {
    expect(unknownRules({ mode: "warn", rules: { "a11y-img-alt": "off", "no-colour": "off", "a11y-alt": "on" } })).toEqual(["a11y-alt", "no-colour"]);
  });

  it("lists the rules turned off, in rule order", () => {
    expect(rulesOff({ mode: "warn", rules: { "a11y-img-alt": "off", "no-hardcoded-color": "off", "no-arbitrary-spacing": "on" } })).toEqual([
      "no-hardcoded-color",
      "a11y-img-alt",
    ]);
  });

  it("a rule turned off in config doesn't run and is listed as skipped", () => {
    const dashboard = read("src/pages/Dashboard.tsx");
    const on = checkFile(dashboard, ctx);
    const off = checkFile(dashboard, ctx, { off: ["no-hardcoded-color"] });
    expect(on.findings.some((f) => f.rule === "no-hardcoded-color")).toBe(true);
    expect(off.findings.some((f) => f.rule === "no-hardcoded-color")).toBe(false);
    expect(off.findings).toEqual(on.findings.filter((f) => f.rule !== "no-hardcoded-color"));
    expect(off.skipped).toEqual(["colors outside the system"]);
    expect(coverage(ctx, { off: ["no-hardcoded-color"] })).toEqual({ checked: off.checked, skipped: off.skipped });
  });

  it("config can't turn back on a rule that system.json turned off", () => {
    const rules = model.rules.map((r) => (r.id === "a11y-img-alt" ? { ...r, enabled: false } : r));
    const r = reviewFiles([read("src/components/Navbar.tsx")], { ...model, rules }, { mode: "warn", rules: { "a11y-img-alt": "on" } }, { kind: "all" });
    expect(r.findings.some((f) => f.rule === "a11y-img-alt")).toBe(false);
    expect(r.skipped).toEqual(["image alt text"]);
  });
});

describe("reviewFiles", () => {
  it("keeps only findings on the given lines", () => {
    const billing = read("src/pages/Billing.tsx");
    const all = checkFile(billing, ctx).findings;
    const lines = new Set([all[0]!.line, all[all.length - 1]!.line]);
    const r = reviewFiles([{ ...billing, lines }], ctx, WARN, CHANGES);
    expect(r.findings).toEqual(all.filter((f) => lines.has(f.line)));
    expect(r.changedLines).toBe(2);
  });

  it("checks whole files when no lines are given, sorted by path", () => {
    const r = reviewFiles([read("src/pages/Settings.tsx"), read("src/pages/Billing.tsx")], ctx, WARN, { kind: "all" });
    expect(r.files).toEqual(["src/pages/Billing.tsx", "src/pages/Settings.tsx"]);
    expect(r.changedLines).toBeUndefined();
    expect(r.findings[0]!.file).toBe("src/pages/Billing.tsx");
    expect(r.findings.at(-1)!.file).toBe("src/pages/Settings.tsx");
  });

  it("warn mode never fails; error mode fails only when something is found", () => {
    const billing = read("src/pages/Billing.tsx");
    expect(reviewFiles([billing], ctx, WARN, CHANGES).failed).toBe(false);
    expect(reviewFiles([billing], ctx, ERROR, CHANGES).failed).toBe(true);
    expect(reviewFiles([{ ...billing, lines: new Set() }], ctx, ERROR, CHANGES).failed).toBe(false);
  });

  it("reports a file it can't read as JSX instead of stopping", () => {
    const r = reviewFiles([{ path: "src/Broken.tsx", code: "export const X = () => <div className=" }, read("src/pages/Billing.tsx")], ctx, WARN, { kind: "all" });
    expect(r.unreadable.map((u) => u.path)).toEqual(["src/Broken.tsx"]);
    expect(r.findings.length).toBeGreaterThan(0);
  });
});

describe("formatReview", () => {
  const button = { path: "src/pages/New.tsx", code: 'export const New = () => (\n  <div className="p-4">\n    <button className="bg-[#2563eb] p-[13px]">Go</button>\n  </div>\n);\n' };

  it("groups findings by file with line:column, why and fix, then the totals and the mode", () => {
    const text = formatReview(reviewFiles([{ ...button, lines: new Set([3]) }], ctx, WARN, CHANGES));
    const lines = text.split("\n");
    expect(lines[0]).toBe("Checked 1 changed line in 1 file, compared with main.");
    expect(lines[2]).toBe("src/pages/New.tsx");
    expect(lines[3]).toBe("  3:5   This is a raw `<button>`. Your system has a shared `Button` for this.");
    expect(lines[4]).toBe("        Why: <button> element; Button is the shared component that renders buttons.");
    expect(text).toMatch(/\nFound \d+ things to change in 1 file \(\d+ with an exact fix\)\.\n/);
    expect(text).toContain("\nMode: warn, so this never fails the build.\n");
    expect(text.endsWith(`${STATIC_CHECKS_NOTE}\n`)).toBe(true);
  });

  it("says when nothing changed, and when nothing was found", () => {
    expect(formatReview(reviewFiles([], ctx, WARN, CHANGES))).toMatch(/^No TSX or JSX files changed since main, so there was nothing to check\.\n/);
    const clean = formatReview(reviewFiles([{ ...button, lines: new Set([1]) }], ctx, ERROR, CHANGES));
    expect(clean).toMatch(/\nNothing to change on the changed lines\. Checked colors outside the system, .+\.\n/);
    expect(clean).toContain("Mode: error. Nothing was found, so the build passes.");
  });

  it("in error mode, says the build fails and how to relax it", () => {
    const text = formatReview(reviewFiles([button], ctx, ERROR, { kind: "all" }));
    expect(text).toMatch(/^Checked every file: 1 file\.\n/);
    expect(text).toContain("Mode: error, so this fails the build. Change these lines, or turn a rule off in .steward/config.json.");
  });

  it("lists what's turned off and what couldn't be read", () => {
    const r = reviewFiles([{ path: "src/Broken.tsx", code: "<div className=" }], ctx, { mode: "warn", rules: { "a11y-img-alt": "off" } }, { kind: "all" });
    const text = formatReview(r);
    expect(text).toContain("Couldn't read 1 file as JSX, so it wasn't checked:\n  src/Broken.tsx (it isn't valid TSX or JSX; check that it compiles)");
    expect(text).toContain("Not checked, because they're turned off: image alt text.");
  });

  it("never calls the code accessible", () => {
    const text = formatReview(reviewFiles([{ ...button, lines: new Set([1]) }], ctx, WARN, CHANGES));
    expect(text.replace(STATIC_CHECKS_NOTE, "")).not.toMatch(/accessible/i);
  });
});
