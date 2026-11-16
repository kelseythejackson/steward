import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSystemModel, type SystemModel } from "@steward/model";
import { describe, expect, it } from "vitest";
import { describeCheck, STATIC_CHECKS_NOTE } from "./check.js";
import { applyFixes, checkFile } from "./engine.js";
import type { Finding, RuleId } from "./findings.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/messy-app", import.meta.url));
const model: SystemModel = parseSystemModel(readFileSync(`${FIXTURE}/.steward/system.json`, "utf8"));
const withRule = (id: string, change: { enabled?: boolean; severity?: "warn" | "error" }): SystemModel => ({
  ...model,
  rules: model.rules.map((r) => (r.id === id ? { ...r, ...change } : r)),
});

const walk = (dir: string): string[] =>
  readdirSync(dir)
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
    })
    .sort();
const files = walk(join(FIXTURE, "src")).map((p) => ({ path: relative(FIXTURE, p), code: readFileSync(p, "utf8") }));
const fixture = (rule: RuleId, m: SystemModel = model) => files.flatMap((f) => checkFile(f, m, { rules: [rule] }).findings);
const snippet = (rule: RuleId, code: string, path?: string) => checkFile(path ? { path, code } : { code }, model, { rules: [rule] }).findings;
const where = (f: Finding) => `${f.file!.replace(/^src\//, "")}:${f.line}`;

describe("a11y-img-alt", () => {
  it("flags the Navbar logo, the only image without alt in the fixture", () => {
    const found = fixture("a11y-img-alt");
    expect(found.map(where)).toEqual(["components/Navbar.tsx:20"]);
    expect(found[0]!.message).toBe('This image has no alt text, so screen readers can\'t say what it shows. Add alt text, or alt="" if it\'s only decoration?');
    expect(found[0]!.fix.edits).toBeUndefined();
  });

  it('accepts alt="", an alt expression and spread props', () => {
    expect(snippet("a11y-img-alt", `<><img src="a" alt="" /><img src="b" alt={t("logo")} /><img {...props} /></>`)).toEqual([]);
  });
});

describe("a11y-accessible-name", () => {
  it("flags the Modal's icon-only close button, and not the Navbar's buttons with text", () => {
    const found = fixture("a11y-accessible-name");
    expect(found.map(where)).toEqual(["components/Modal.tsx:34"]);
    expect(found[0]!.message).toBe('This icon button has no label, so screen readers will just say "button." Add aria-label?');
    expect(found[0]!.systemRule).toBe("a11y-icon-button-label");
  });

  it("covers icon-only links and the shared Button too", () => {
    const found = snippet("a11y-accessible-name", `<><a href="/settings"><GearIcon /></a><Button variant="ghost"><XIcon /></Button></>`);
    expect(found.map((f) => f.found)).toEqual(['<a href="/settings">', '<Button variant="ghost">']);
    expect(found[0]!.message).toBe('This icon link has no label, so screen readers will just say "link" or read out the address. Add aria-label?');
  });

  it("accepts text, sr-only text, an aria-label, aria-labelledby or title", () => {
    const code = `<>
      <button><XIcon /> Close</button>
      <button><XIcon /><span className="sr-only">Close</span></button>
      <a href="/" aria-label="Home"><HomeIcon /></a>
      <button aria-labelledby="close-label"><XIcon /></button>
      <button title="Close"><XIcon /></button>
    </>`;
    expect(snippet("a11y-accessible-name", code)).toEqual([]);
  });
});

describe("a11y-label-inputs", () => {
  it("flags the Dashboard search input and suggests a label from its placeholder", () => {
    const found = fixture("a11y-label-inputs");
    expect(found.map(where)).toEqual(["pages/Dashboard.tsx:23"]);
    expect(found[0]!.message).toBe(
      "This input has no label, so screen readers can't say what it's for. Its placeholder disappears once someone types, so it doesn't count. Add aria-label=\"Search events\"?",
    );
    expect(found[0]!.systemRule).toBe("a11y-input-label");
  });

  it("accepts TextField's <label htmlFor={id}> and Settings' wrapped checkboxes", () => {
    const flagged = fixture("a11y-label-inputs").map((f) => f.file);
    expect(flagged).not.toContain("src/components/TextField.tsx");
    expect(flagged).not.toContain("src/pages/Settings.tsx");
  });

  it("matches static ids, accepts aria labels, and skips hidden inputs, buttons and spreads", () => {
    const code = `<>
      <label htmlFor="email">Email</label><input id="email" />
      <select aria-label="Plan"><option>Pro</option></select>
      <textarea aria-labelledby="notes-label" />
      <input type="hidden" name="token" />
      <input type="submit" value="Save" />
      <input {...field} />
    </>`;
    expect(snippet("a11y-label-inputs", code)).toEqual([]);
  });

  it("names selects and textareas in plain words, and still flags an empty aria-label", () => {
    const found = snippet("a11y-label-inputs", `<><select /><textarea /><input aria-label="" /></>`);
    expect(found.map((f) => f.message.split(" has")[0])).toEqual(["This dropdown", "This text box", "This input"]);
    expect(found[0]!.message.endsWith("Add aria-label?")).toBe(true);
  });
});

describe("a11y-interactive-element", () => {
  it("flags the Billing invoice row, and not the Modal's backdrop or its stopPropagation wrapper", () => {
    const found = fixture("a11y-interactive-element");
    expect(found.map(where)).toEqual(["pages/Billing.tsx:59"]);
    expect(found[0]!.message).toBe(
      "This `<div>` has a click handler, but keyboard users can't reach it and screen readers won't say it's clickable. Use a `<button type=\"button\">`?",
    );
    expect(found[0]!.fix.replacement).toMatch(/^<button type="button" onClick=\{\(\) => setSelected\(inv\.id\)\}[\s\S]*<\/button>$/);
    expect(found[0]!.fix.edits).toBeUndefined();
  });

  it("flags spans too, and accepts elements with a role, a tabIndex and a key handler", () => {
    const code = `<>
      <span onClick={open}>More</span>
      <div role="button" tabIndex={0} onClick={open} onKeyDown={onKey}>Ok</div>
      <div role="button" onClick={open}>Not enough</div>
    </>`;
    expect(snippet("a11y-interactive-element", code).map((f) => f.found)).toEqual(["<span onClick={open}>", '<div role="button" onClick={open}>']);
  });
});

describe("a11y-focus-visible", () => {
  it("flags TextField's outline-none with only a border change, and adds focus-visible:ring-2", () => {
    const found = fixture("a11y-focus-visible");
    expect(found.map(where)).toEqual(["components/TextField.tsx:18"]);
    expect(found[0]!.message).toBe("This input removes its focus outline and has nothing to replace it, so keyboard users can't see where they are. Add `focus-visible:ring-2`?");
    expect(found[0]!.evidence).toBe("`outline-none` with no ring, outline or shadow on focus; a border color change alone isn't enough");
    const tf = files.find((f) => f.path === "src/components/TextField.tsx")!;
    const fixed = applyFixes(tf.code, found).code;
    expect(fixed).toContain("outline-none focus-visible:ring-2");
    expect(checkFile({ path: tf.path, code: fixed }, model, { rules: ["a11y-focus-visible"] }).findings).toEqual([]);
  });

  it("flags focus:outline-none too, and leaves elements with a replacement alone", () => {
    const code = `<><button className="focus:outline-none">A</button><a href="/" className="outline-none focus-visible:ring-2">B</a></>`;
    const found = snippet("a11y-focus-visible", code);
    expect(found.map((f) => f.found)).toEqual(['<button className="focus:outline-none">']);
    expect(applyFixes(code, found).code).toContain('className="focus:outline-none focus-visible:ring-2"');
  });
});

describe("a11y-text-contrast", () => {
  const rows = () => fixture("a11y-text-contrast").map((f) => `${where(f)} ${f.found}`);

  // Every failing pair in FIXTURE_NOTES §5b is checked against the notes themselves in fixture-notes.test.ts.

  it("never flags the passing pairs in FIXTURE_NOTES §5b", () => {
    expect(rows().filter((r) => / (gray-500 on white|gray-700 on white|gray-900 on white|white on blue-600|red-600 on white)$/.test(r))).toEqual([]);
  });

  it("suggests the fix the team accepted, with the ratio as evidence", () => {
    const f = fixture("a11y-text-contrast").find((x) => where(x) === "components/Card.tsx:13")!;
    expect(f.message).toBe("`gray-400` on `white` is 2.5:1, below the 4.5:1 that text needs, so it's hard to read for many people. Use `gray-500` (4.8:1)?");
    expect(f.evidence).toBe("contrast 2.5:1, needs 4.5:1 for text; gray-500 is the fix your team accepted for this pair");
    expect(f.systemRule).toBe("contrast-gray-400-on-white");
  });

  it("changes the background when the text can't change, and says when a parent's background was assumed", () => {
    const button = fixture("a11y-text-contrast").find((x) => where(x) === "components/Button.tsx:21")!;
    expect(button.message).toContain("Use a `blue-600` background (5.1:1)?");
    const field = fixture("a11y-text-contrast").find((x) => where(x) === "components/TextField.tsx:21")!;
    expect(field.evidence).toContain("background assumed white, because a parent component sets it");
  });

  it("says so when no color in the system passes, and names the computed shade", () => {
    const f = fixture("a11y-text-contrast").find((x) => where(x) === "pages/Settings.tsx:45")!;
    expect(f.message).toMatch(/^On hover, `red-600` on `red-50` is 4\.4:1, .* No color in your system passes here\. Add a shade like `#[0-9a-f]{6}` \(4\.\d:1\)\?$/);
    expect(f.fix.edits).toBeUndefined();
  });

  it("swaps a token class on the element itself, and only gives advice for hardcoded colors", () => {
    const code = `<p className="bg-white text-gray-400">Due today</p>`;
    const [f] = snippet("a11y-text-contrast", code);
    expect(f).toMatchObject({ found: "text-gray-400", column: 24, fix: { replacement: "text-gray-500", description: "Use `text-gray-500` instead of `text-gray-400`." } });
    expect(applyFixes(code, [f!]).code).toBe(`<p className="bg-white text-gray-500">Due today</p>`);
    const [hex] = snippet("a11y-text-contrast", `<p className="bg-white text-[#9ca3af]">Due today</p>`);
    expect(hex!.fix.edits).toBeUndefined();
  });

  it("when one class sits on two backgrounds, only the color that passes on both is applied", () => {
    // Billing.tsx:66: the invoice date is on white, and on gray-100 when the row is selected.
    const billing = files.find((f) => f.path === "src/pages/Billing.tsx")!;
    const round1 = applyFixes(billing.code, checkFile(billing, model).findings).code; // text-[#9ca3af] → text-gray-400
    const row = checkFile({ path: billing.path, code: round1 }, model, { rules: ["a11y-text-contrast"] }).findings.filter((f) => f.line === 66);
    expect(row.map((f) => [f.found, f.fix.replacement ?? null, Boolean(f.fix.edits)])).toEqual([
      ["text-gray-400", "text-gray-700", true],
      ["text-gray-400", null, false],
    ]);
    expect(row[1]!.fix.description).toBe("This class also sits on another background here, so it needs a color that passes on both. `text-gray-700` works on both, so that one fix covers this too.");
    const round2 = applyFixes(round1, row).code;
    expect(checkFile({ path: billing.path, code: round2 }, model, { rules: ["a11y-text-contrast"] }).findings.filter((f) => f.line === 66)).toEqual([]);
  });

  it("keeps variants when it swaps a hover color", () => {
    const code = `<a href="/" className="bg-white text-gray-900 hover:text-gray-400">Docs</a>`;
    const [f] = snippet("a11y-text-contrast", code);
    expect(f!.message.startsWith("On hover, ")).toBe(true);
    expect(f!.fix.replacement).toBe("hover:text-gray-500");
  });

  it("uses the severity a person set, and stops when they turn the rule off", () => {
    expect(fixture("a11y-text-contrast", withRule("contrast-gray-400-on-white", { severity: "error" })).find((x) => where(x) === "components/Card.tsx:13")!.severity).toBe("error");
    expect(fixture("a11y-text-contrast", withRule("a11y-text-contrast", { enabled: false }))).toEqual([]);
  });
});

describe("what the report claims", () => {
  it("never says code is accessible, even when nothing is found", () => {
    const outputs = [
      describeCheck(checkFile({ code: `<p className="text-gray-900">Hi</p>` }, model)),
      ...files.map((f) => describeCheck(checkFile(f, model))),
    ];
    for (const text of outputs) {
      expect(text.endsWith(`${STATIC_CHECKS_NOTE}\n`)).toBe(true);
      expect(text.replace(STATIC_CHECKS_NOTE, "")).not.toMatch(/\baccessible\b/i);
    }
  });
});
