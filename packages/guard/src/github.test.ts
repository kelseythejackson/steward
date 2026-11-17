import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSystemModel, type StewardConfig } from "@steward/model";
import { describe, expect, it } from "vitest";
import { STATIC_CHECKS_NOTE } from "./check.js";
import { checkContext } from "./context.js";
import { fingerprintOf, lineComments, markdown, SUMMARY_MARKER, summaryComment, summaryHeadline } from "./github.js";
import { reviewFiles, type SourceFile } from "./review.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const ctx = checkContext(parseSystemModel(readFileSync(join(FIXTURE, ".steward/system.json"), "utf8")));
const WARN: StewardConfig = { mode: "warn", rules: {} };
const SCOPE = { kind: "changes", base: "origin/main" } as const;

const CODE = [
  "export const New = () => (",
  '  <div className="p-4">',
  '    <p className="mt-[13px] text-[#6b7280]">Hi</p>',
  '    <button className="bg-[#2563eb]">Go</button>',
  '    <img src="x.png" />',
  "  </div>",
  ");",
  "",
].join("\n");

function review(lines: number[], config = WARN, code = CODE) {
  const files: SourceFile[] = [{ path: "src/pages/New.tsx", code, lines: new Set(lines) }];
  const result = reviewFiles(files, ctx, config, SCOPE);
  return { result, comments: lineComments(result, files, { pathPrefix: "app/" }) };
}

const suggestionOf = (body: string) => /```suggestion\n([\s\S]*?)\n```/.exec(body)?.[1];

describe("lineComments", () => {
  it("puts every exact fix on a line into one suggestion that replaces the whole line", () => {
    const [c] = review([3]).comments;
    expect(c).toMatchObject({ path: "app/src/pages/New.tsx", line: 3, oneClick: 2 });
    expect(suggestionOf(c!.body)).toBe('    <p className="mt-3 text-gray-500">Hi</p>');
    expect(c!.body).toContain("One-click fix for all of these:");
  });

  it("leaves out fixes that change another line (adding an import), and says how many the suggestion covers", () => {
    const [c] = review([4]).comments;
    expect(c!.oneClick).toBe(1);
    expect(suggestionOf(c!.body)).toBe('    <button className="bg-blue-600">Go</button>');
    expect(c!.body).toContain("One-click fix for 1 of these:");
    expect(c!.body).toContain("This is a raw `<button>`.");
  });

  it("gives advice without a suggestion when nothing can be fixed safely", () => {
    const [c] = review([5]).comments;
    expect(c!.oneClick).toBe(0);
    expect(c!.body).not.toContain("```suggestion");
    expect(c!.body).toMatch(/^This image has no alt text/);
    expect(c!.body).toContain("Why: &lt;img&gt; with no alt attribute.");
  });

  it("marks each comment with a fingerprint that stays the same when the line moves", () => {
    const before = review([3]).comments[0]!;
    const moved = review([4], WARN, CODE.replace("(\n", "(\n\n")).comments[0]!;
    expect(moved.line).toBe(4);
    expect(moved.fingerprint).toBe(before.fingerprint);
    expect(fingerprintOf(before.body)).toBe(before.fingerprint);
    expect(fingerprintOf("A comment someone else wrote")).toBeNull();
  });

  it("changes the fingerprint when the line or its findings change", () => {
    const before = review([3]).comments[0]!;
    const edited = review([3], WARN, CODE.replace("mt-[13px]", "mt-[14px]")).comments[0]!;
    expect(edited.fingerprint).not.toBe(before.fingerprint);
  });
});

describe("markdown", () => {
  it("escapes HTML outside code spans and leaves code spans alone", () => {
    expect(markdown("<button> & `<Button>`")).toBe("&lt;button&gt; &amp; `<Button>`");
  });
});

describe("summary", () => {
  it("splits off-system values from accessibility issues and counts one-click fixes", () => {
    const { result } = review([3, 4, 5]);
    expect(summaryHeadline(result, 3)).toBe("Steward Review found 4 off-system values and 1 accessibility issue · 3 can be fixed in one click");
    expect(summaryHeadline(review([5]).result, 0)).toBe("Steward Review found 1 accessibility issue");
    expect(summaryHeadline(review([3]).result, 2)).toBe("Steward Review found 2 off-system values · 2 can be fixed in one click");
    expect(summaryHeadline(review([1]).result, 0)).toBe("Steward Review found nothing to change on the changed lines");
    expect(summaryHeadline(reviewFiles([], ctx, WARN, SCOPE), 0)).toBe("Steward Review: no TSX or JSX files changed, so there was nothing to check");
  });

  it("starts with the hidden marker, has a table by rule, the mode and the static-checks note", () => {
    const body = summaryComment(review([3, 4, 5]).result, { oneClick: 3 });
    expect(body.startsWith(`${SUMMARY_MARKER}\n### Steward Review found 4 off-system values`)).toBe(true);
    expect(body).toContain("| Colors outside the system | 2 |\n| Spacing off the scale | 1 |\n| Components to swap for the system's | 1 |\n| Images without alt text | 1 |");
    expect(body).toContain("**Commit suggestion** applies it.");
    expect(body).toContain("Checked 3 changed lines in 1 file, compared with `origin/main`.");
    expect(body).toContain("Mode: warn, so this never fails the check.");
    expect(body).toContain(`<sub>${STATIC_CHECKS_NOTE}</sub>`);
  });

  it("lists comments that couldn't go on their lines, and why posting failed", () => {
    const { result, comments } = review([5]);
    const body = summaryComment(result, { oneClick: 0, unposted: comments, postingProblem: "GitHub said no <403>." });
    expect(body).toContain("> GitHub said no &lt;403&gt;.");
    expect(body).toContain("<details><summary>1 comment couldn't be posted on its line</summary>");
    expect(body).toContain("**app/src/pages/New.tsx:5**");
    expect(body).not.toMatch(/steward-review:fp=/);
  });

  it("in error mode, says the check fails", () => {
    expect(summaryComment(review([5], { mode: "error", rules: {} }).result, { oneClick: 0 })).toContain("Mode: error, so this check fails");
  });

  it("never calls the code accessible", () => {
    expect(summaryComment(review([1]).result, { oneClick: 0 }).replace(STATIC_CHECKS_NOTE, "")).not.toMatch(/accessible/i);
  });
});
