import type { ElementUse, ParsedFile } from "../parse.js";
import { hasTextContent } from "../parse.js";
import type { GuardRule, Hit } from "../rule.js";

/** Attributes that give an element an accessible name. `title` is a weak one, but it counts. */
const NAME_ATTRIBUTES = ["aria-label", "aria-labelledby", "title"];

const hasName = (e: ElementUse) => NAME_ATTRIBUTES.some((a) => e.attributes.has(a) && e.values.get(a) !== "");

const hitAt = (e: ElementUse, systemRule: string): Pick<Hit, "line" | "column" | "range" | "found" | "systemRule"> => ({
  line: e.line,
  column: e.column,
  range: e.nameRange,
  found: e.openingTag,
  systemRule,
});

// ---------------------------------------------------------------------------
// 4. img-alt
// ---------------------------------------------------------------------------

/**
 * `<img>` with no `alt`. `alt=""` is fine: it marks a decorative image. No
 * automatic fix: only a person knows what the image shows.
 */
export const a11yImgAlt: GuardRule = {
  id: "a11y-img-alt",
  description: 'Images need alt text that describes them, or alt="" when they\'re only decoration.',
  category: "accessibility",
  severity: "warn",
  covers: () => [{ label: "image alt text", systemRule: "a11y-img-alt" }],
  check: (file) =>
    file.elements
      .filter((e) => e.name === "img" && !e.attributes.has("alt") && !e.spread)
      .map((e) => ({
        ...hitAt(e, "a11y-img-alt"),
        message: 'This image has no alt text, so screen readers can\'t say what it shows. Add alt text, or alt="" if it\'s only decoration?',
        evidence: "<img> with no alt attribute",
        fix: { description: 'Add alt text that describes the image, like `alt="Team photo"`, or `alt=""` if it\'s only decoration.' },
      })),
};

// ---------------------------------------------------------------------------
// 5. accessible-name
// ---------------------------------------------------------------------------

/**
 * Buttons and links whose only content is an icon, with nothing that gives
 * them a name. No automatic fix: the label needs words a person chooses.
 */
export const a11yAccessibleName: GuardRule = {
  id: "a11y-accessible-name",
  description: "Icon-only buttons and links need an aria-label that says what they do.",
  category: "accessibility",
  severity: "warn",
  covers: () => [{ label: "names for icon-only buttons and links", systemRule: "a11y-icon-button-label" }],
  check(file, ctx) {
    const buttons = new Set(["button", ...(ctx.button ? [ctx.button.name] : [])]);
    return file.elements
      .filter((e) => (buttons.has(e.name) || e.name === "a") && !e.spread && !hasName(e))
      .filter((e) => e.node.children.some((c) => c.type === "JSXElement") && !hasTextContent(e.node.children))
      .map((e) => {
        const link = e.name === "a";
        return {
          ...hitAt(e, "a11y-icon-button-label"),
          message: link
            ? "This icon link has no label, so screen readers will just say \"link\" or read out the address. Add aria-label?"
            : 'This icon button has no label, so screen readers will just say "button." Add aria-label?',
          evidence: `<${e.name}> with only an icon inside, and no text, aria-label, aria-labelledby or title`,
          fix: {
            description: link
              ? 'Add an aria-label that says where it goes, like `aria-label="Open settings"`.'
              : 'Add an aria-label that says what it does, like `aria-label="Close dialog"`.',
          },
        };
      });
  },
};

// ---------------------------------------------------------------------------
// 6. label-inputs
// ---------------------------------------------------------------------------

const FIELDS = new Set(["input", "select", "textarea"]);
/** Input types that don't need a label: hidden ones, and buttons named by their value or alt. */
const UNLABELLED_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

/** How an attribute was written, so `htmlFor={id}` matches `id={id}` and `htmlFor="email"` matches `id="email"`. */
const written = (e: ElementUse, name: string): string | undefined => {
  const v = e.values.get(name);
  if (v !== undefined) return `"${v}"`;
  const x = e.expressions.get(name);
  return x === undefined ? undefined : `{${x}}`;
};

/**
 * Form fields with no label: not inside a `<label>`, no `<label htmlFor>`
 * pointing at their id, and no aria-label or aria-labelledby. A placeholder
 * doesn't count, since it disappears once someone types.
 */
export const a11yLabelInputs: GuardRule = {
  id: "a11y-label-inputs",
  description: "Inputs, selects and textareas need a linked <label> or an aria-label; a placeholder isn't enough.",
  category: "accessibility",
  severity: "warn",
  covers: () => [{ label: "form field labels", systemRule: "a11y-input-label" }],
  check(file: ParsedFile) {
    const labelled = new Set(file.elements.filter((e) => e.name === "label").map((e) => written(e, "htmlFor")).filter((v): v is string => v !== undefined));
    return file.elements
      .filter((e) => FIELDS.has(e.name) && !e.spread)
      .filter((e) => !(e.name === "input" && UNLABELLED_TYPES.has(e.values.get("type") ?? "")))
      .filter((e) => !["aria-label", "aria-labelledby"].some((a) => e.attributes.has(a) && e.values.get(a) !== ""))
      .filter((e) => !e.ancestors.includes("label"))
      .filter((e) => {
        const id = written(e, "id");
        return id === undefined || !labelled.has(id);
      })
      .map((e) => {
        const noun = e.name === "select" ? "dropdown" : e.name === "textarea" ? "text box" : "input";
        const placeholder = e.values.get("placeholder")?.trim();
        const suggestion = placeholder ? `aria-label="${placeholder.replace(/[.…]+$/, "")}"` : "aria-label";
        return {
          ...hitAt(e, "a11y-input-label"),
          message:
            `This ${noun} has no label, so screen readers can't say what it's for.` +
            (placeholder ? " Its placeholder disappears once someone types, so it doesn't count." : "") +
            ` Add ${suggestion}?`,
          evidence: `<${e.name}> with no <label>, aria-label or aria-labelledby${placeholder ? `; placeholder "${placeholder}"` : ""}`,
          fix: { description: `Add a visible \`<label htmlFor>\` that matches its \`id\`, or \`${suggestion}\` if a visible label doesn't fit the design.` },
        };
      });
  },
};

// ---------------------------------------------------------------------------
// 7. interactive-element
// ---------------------------------------------------------------------------

const NON_INTERACTIVE = new Set(["div", "span"]);
const KEY_HANDLERS = ["onKeyDown", "onKeyUp", "onKeyPress"];
/** `(e) => e.stopPropagation()`: keeps a click from reaching a parent; nobody clicks it on purpose. */
const STOP_ONLY = /^\(?\s*(\w+)(?:\s*:\s*[\w.<>]+)?\s*\)?\s*=>\s*\{?\s*\1\.stopPropagation\(\)\s*;?\s*\}?$/;
/** A full-screen overlay (`fixed inset-0`): a modal backdrop, where a click is a mouse shortcut for a close control. */
const isOverlay = (e: ElementUse) => /(?:^|\s)fixed(?:\s|$)/.test(e.values.get("className") ?? "") && /(?:^|\s)inset-0(?:\s|$)/.test(e.values.get("className") ?? "");

/** `<div onClick>` → `<button type="button" onClick>`, everything else as written. */
function asButton(e: ElementUse): string {
  const out = e.source.replace(new RegExp(`^<${e.name}(?=[\\s/>])`), '<button type="button"');
  return out.endsWith(`</${e.name}>`) ? `${out.slice(0, -(e.name.length + 3))}</button>` : out;
}

/**
 * Click handlers on `<div>` and `<span>`, which keyboard users can't reach
 * and screen readers don't announce. Fine when the element already has a
 * role, a tabIndex and a key handler. Not flagged: handlers that only stop
 * propagation, and full-screen overlays (`fixed inset-0`), whose click is a
 * mouse shortcut for a close control. No automatic fix: a button lays out
 * differently from a div.
 */
export const a11yInteractiveElement: GuardRule = {
  id: "a11y-interactive-element",
  description: "Put click handlers on buttons and links, not on divs or spans, so keyboard and screen reader users can use them.",
  category: "accessibility",
  severity: "warn",
  covers: () => [{ label: "click handlers on divs and spans", systemRule: "a11y-click-target" }],
  check: (file) =>
    file.elements
      .filter((e) => NON_INTERACTIVE.has(e.name) && e.attributes.has("onClick") && !e.spread)
      .filter((e) => !STOP_ONLY.test(e.expressions.get("onClick") ?? "") && !isOverlay(e))
      .filter((e) => !(e.attributes.has("role") && e.attributes.has("tabIndex") && KEY_HANDLERS.some((k) => e.attributes.has(k))))
      .map((e) => ({
        ...hitAt(e, "a11y-click-target"),
        message: `This \`<${e.name}>\` has a click handler, but keyboard users can't reach it and screen readers won't say it's clickable. Use a \`<button type="button">\`?`,
        evidence: `<${e.name}> with onClick and no role, tabIndex or key handler`,
        fix: {
          description: `Change it to \`<button type="button">\`, which works with the keyboard and screen readers on its own. You may need \`w-full text-left\` to keep the layout.`,
          replacement: asButton(e),
        },
      })),
};
