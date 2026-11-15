import { CHECK_RULES, type CheckContext } from "../context.js";
import type { Finding } from "../findings.js";
import { hasTextContent, type Snippet } from "../jsx.js";

const LABEL_ATTRIBUTES = ["aria-label", "aria-labelledby", "title"];

/** `<button …>…</button>` → `<Button …>…</Button>`, everything else as written. */
function renameElement(source: string, from: string, to: string): string {
  let out = source.replace(new RegExp(`^<${from}(?=[\\s/>])`), `<${to}`);
  if (out.endsWith(`</${from}>`)) out = `${out.slice(0, -(from.length + 3))}</${to}>`;
  return out;
}

/** Raw `<button>` elements when the system has a shared button component. */
export function checkRawButtons(snippet: Snippet, ctx: CheckContext): Finding[] {
  const button = ctx.button;
  if (!button) return [];
  const variantHint = button.hasPrimary ? `, with \`variant="primary"\` for the main action on the page` : "";
  return snippet.elements
    .filter((e) => e.name === "button")
    .map((e) => ({
      check: "raw-button" as const,
      ruleId: CHECK_RULES["raw-button"]!,
      category: "component" as const,
      line: e.line,
      column: e.column,
      found: e.openingTag,
      message: `This is a raw \`<button>\`. Your system has a shared \`${button.name}\` for this.`,
      evidence: `<button> element; ${button.name} is the shared component that renders buttons`,
      fix: { description: `Use \`<${button.name}>\`${variantHint}. Import it with \`${button.importLine}\``, replacement: renameElement(e.source, "button", button.name) },
    }));
}

/** `<img>` with no `alt`. `alt=""` is fine: it marks a decorative image. */
export function checkImgAlt(snippet: Snippet): Finding[] {
  return snippet.elements
    .filter((e) => e.name === "img" && !e.attributes.has("alt") && !e.spread)
    .map((e) => ({
      check: "img-alt" as const,
      ruleId: CHECK_RULES["img-alt"]!,
      category: "accessibility" as const,
      line: e.line,
      column: e.column,
      found: e.openingTag,
      message: "This image has no alt text, so screen reader users won't know what it shows.",
      evidence: "<img> with no alt attribute",
      fix: { description: 'Add alt text that describes the image, like `alt="Team photo"`, or `alt=""` if it\'s only decoration.' },
    }));
}

/** Buttons whose only content is an icon, with nothing that gives them a name. */
export function checkIconButtonLabels(snippet: Snippet, ctx: CheckContext): Finding[] {
  const buttons = new Set(["button", ...(ctx.button ? [ctx.button.name] : [])]);
  return snippet.elements
    .filter((e) => buttons.has(e.name) && !e.spread && !LABEL_ATTRIBUTES.some((a) => e.attributes.has(a) && e.values.get(a) !== ""))
    .filter((e) => e.node.children.some((c) => c.type === "JSXElement") && !hasTextContent(e.node.children))
    .map((e) => ({
      check: "icon-button-label" as const,
      ruleId: CHECK_RULES["icon-button-label"]!,
      category: "accessibility" as const,
      line: e.line,
      column: e.column,
      found: e.openingTag,
      message: "This button only has an icon, so screen readers can't say what it does.",
      evidence: `<${e.name}> with no text, aria-label, aria-labelledby or title`,
      fix: { description: 'Add an aria-label that says what it does, like `aria-label="Close dialog"`.' },
    }));
}
