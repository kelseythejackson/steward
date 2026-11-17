import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSystemModel, type StewardConfig } from "@steward/model";
import { describe, expect, it } from "vitest";
import { checkContext } from "./context.js";
import { lineComments, summaryComment, summaryHeadline } from "./github.js";
import { countColorUses, hexOf, PATTERN_MIN_USES, splitPatterns } from "./patterns.js";
import { formatReview, reviewFiles, type SourceFile } from "./review.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const ctx = checkContext(parseSystemModel(readFileSync(join(FIXTURE, ".steward/system.json"), "utf8")));
const WARN: StewardConfig = { mode: "warn", rules: {} };

/** A component using a violet no token looks like (`#7c3aed`) once per line. */
const violet = (path: string, lines: string[]): SourceFile => ({
  path,
  code: ["export const X = () => (", "  <div>", ...lines, "  </div>", ");", ""].join("\n"),
});
const BADGE = '    <span className="bg-[#7c3aed] text-white">New</span>';
const LINK = '    <a className="text-[#7c3aed]" href="/pro">Pro</a>';

describe("hexOf", () => {
  it("pulls a lowercase six-digit hex out of a class or style", () => {
    expect(hexOf("bg-[#7C3AED]/50")).toBe("#7c3aed");
    expect(hexOf('color: "#abc"')).toBe("#aabbcc");
    expect(hexOf("text-purple-500")).toBeNull();
  });
});

describe("countColorUses", () => {
  it("counts places and files for each off-system hex, across the repo", () => {
    const uses = countColorUses([violet("src/a.tsx", [BADGE, LINK]), violet("src/b.tsx", [BADGE])], ctx);
    expect(uses.get("#7c3aed")).toEqual({ uses: 3, files: 2 });
  });

  it("leaves out colors that match a token, since those already have a one-click fix", () => {
    const uses = countColorUses([violet("src/a.tsx", ['    <p className="text-[#6b7280]" />', '    <p className="text-[#6b7280]" />', '    <p className="text-[#6b7280]" />'])], ctx);
    expect(uses.has("#6b7280")).toBe(false);
  });

  it("counts places marked intentional too, since they're still uses", () => {
    const uses = countColorUses([violet("src/a.tsx", ["    {/* steward-ignore no-hardcoded-color: launch badge */}", BADGE, LINK, LINK])], ctx);
    expect(uses.get("#7c3aed")).toEqual({ uses: 3, files: 1 });
  });

  it("skips files it can't read", () => {
    expect(countColorUses([{ path: "src/broken.tsx", code: "<div className=" }], ctx).size).toBe(0);
  });
});

describe("splitPatterns", () => {
  const files = [violet("src/a.tsx", [BADGE, LINK]), violet("src/b.tsx", [BADGE])];

  it(`keeps flagging a color used in fewer than ${PATTERN_MIN_USES} places`, () => {
    const two = countColorUses(files.slice(0, 1), ctx);
    const r = reviewFiles(files.slice(0, 1), ctx, WARN, { kind: "all" }, { colorUses: two });
    expect(r.tokenSuggestions).toEqual([]);
    expect(r.findings.filter((f) => f.rule === "no-hardcoded-color")).toHaveLength(2);
  });

  it(`suggests a token instead of flagging, from ${PATTERN_MIN_USES} places on`, () => {
    const r = reviewFiles(files, ctx, WARN, { kind: "all" }, { colorUses: countColorUses(files, ctx) });
    expect(r.findings.filter((f) => f.rule === "no-hardcoded-color")).toEqual([]);
    expect(r.tokenSuggestions).toHaveLength(3);
    const [first] = r.tokenSuggestions;
    expect(first!.pattern).toEqual({ value: "#7c3aed", uses: 3, files: 2 });
    expect(first!.message).toBe("`#7c3aed` is used in 3 places across 2 files, and none of your tokens look like it, so it may belong in your system. Add it as a color token?");
    expect(first!.evidence).toMatch(/; used 3 times in 2 files$/);
    expect(first!.fix.description).toMatch(/^If it belongs in the system, run `steward scan`: it'll suggest this color as a token, and `steward review` lets you accept or reject it\. Then use its class here\. If it should have been `[\w-]+`, use that instead\./);
  });

  it("checks contrast before suggesting a text color as a token, and names the nearest shade that passes", () => {
    const light = '    <a className="text-[#a78bfa]" href="/pro">Pro</a>';
    const lavender = [violet("src/a.tsx", [light, light, light])];
    const r = reviewFiles(lavender, ctx, WARN, { kind: "all" }, { colorUses: countColorUses(lavender, ctx) });
    expect(r.tokenSuggestions[0]!.fix.description).toMatch(/As text on white it's [\d.]+:1, below the 4\.5:1 text needs, so consider `#[0-9a-f]{6}` \([\d.]+:1\) instead, the nearest shade that passes\.$/);
  });

  it("never fails the build in error mode: a suggestion isn't drift", () => {
    const r = reviewFiles(files, ctx, { mode: "error", rules: {} }, { kind: "all" }, { colorUses: countColorUses(files, ctx) });
    expect(r.findings.filter((f) => f.rule === "no-hardcoded-color")).toEqual([]);
    expect(r.failed).toBe(r.findings.length > 0);
  });

  it("follows the token suggestion: pending and accepted say what's next, rejected is flagged again", () => {
    const uses = countColorUses(files, ctx);
    const status = (s: "pending" | "accepted" | "rejected") => reviewFiles(files, { ...ctx, tokenSuggestions: new Map([["#7c3aed", s]]) }, WARN, { kind: "all" }, { colorUses: uses });
    expect(status("pending").tokenSuggestions[0]!.fix.description).toMatch(/^It's already suggested as a token and waiting for a decision in `steward review`\./);
    expect(status("accepted").tokenSuggestions[0]!.fix.description).toMatch(/^You accepted it as a token, so it joins the system on the next `steward scan`\./);
    const rejected = status("rejected");
    expect(rejected.tokenSuggestions).toEqual([]);
    expect(rejected.findings.filter((f) => f.rule === "no-hardcoded-color")).toHaveLength(3);
  });

  it("does nothing without color counts", () => {
    const flags = reviewFiles(files, ctx, WARN, { kind: "all" }).findings;
    expect(splitPatterns(flags, new Map()).suggestions).toEqual([]);
  });
});

describe("reporting suggestions and exceptions", () => {
  const files = [violet("src/a.tsx", [BADGE, LINK]), violet("src/b.tsx", ["    {/* steward-ignore use-system-component: marketing hero */}", '    <button className="hero">Go</button>', BADGE])];
  const r = reviewFiles(files, ctx, WARN, { kind: "all" }, { colorUses: countColorUses(files, ctx) });

  it("lists them in the readable report", () => {
    const text = formatReview(r);
    expect(text).toContain("Could join your system: 1 color used in 3 or more places, so it's suggested as a token instead of flagged:\nsrc/a.tsx\n  3:22  `#7c3aed` is used in 3 places");
    expect(text).toContain("Marked intentional with steward-ignore (1 flag):\n  src/b.tsx:4  use-system-component: marketing hero");
  });

  it("adds them to the pull request headline and summary", () => {
    expect(summaryHeadline(r, 0)).toMatch(/· 1 color could become a token$/);
    const body = summaryComment(r, { oneClick: 0 });
    expect(body).toContain("**Could join your system:** `#7c3aed` (used in 3 places across 2 files).");
    expect(body).toContain("**Marked intentional:** 1 flag, each with a reason in a `steward-ignore` comment.");
  });

  it("comments on each suggested line, with no one-click fix", () => {
    const comments = lineComments(r, files).filter((c) => c.body.includes("Add it as a color token?"));
    expect(comments.map((c) => `${c.path}:${c.line}`)).toEqual(["src/a.tsx:3", "src/a.tsx:4", "src/b.tsx:5"]);
    expect(comments.every((c) => !c.body.includes("```suggestion"))).toBe(true);
  });

  it("comments on a steward-ignore that needs a reason", () => {
    const noReason = [violet("src/c.tsx", ["    {/* steward-ignore use-system-component */}", '    <button className="hero">Go</button>'])];
    const rr = reviewFiles(noReason, ctx, WARN, { kind: "all" });
    const c = lineComments(rr, noReason).find((x) => x.line === 3)!;
    expect(c.body).toMatch(/^This steward-ignore has no reason, so it isn't applied\./);
  });
});
