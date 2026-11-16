import { hasTextContent } from "../parse.js";
import type { GuardRule } from "../rule.js";

const LABEL_ATTRIBUTES = ["aria-label", "aria-labelledby", "title"];

/**
 * `<img>` with no `alt`. `alt=""` is fine: it marks a decorative image. No
 * automatic fix: only a person knows what the image shows.
 */
export const a11yImgAlt: GuardRule = {
  id: "a11y-img-alt",
  description: "Images need alt text that describes them, or alt=\"\" when they're only decoration.",
  category: "accessibility",
  severity: "warn",
  covers: () => [{ label: "image alt text", systemRule: "a11y-img-alt" }],
  check: (file) =>
    file.elements
      .filter((e) => e.name === "img" && !e.attributes.has("alt") && !e.spread)
      .map((e) => ({
        line: e.line,
        column: e.column,
        range: e.nameRange,
        found: e.openingTag,
        systemRule: "a11y-img-alt",
        message: "This image has no alt text, so screen reader users won't know what it shows.",
        evidence: "<img> with no alt attribute",
        fix: { description: 'Add alt text that describes the image, like `alt="Team photo"`, or `alt=""` if it\'s only decoration.' },
      })),
};

/** Buttons whose only content is an icon, with nothing that gives them a name. No automatic fix: the label needs words a person chooses. */
export const a11yIconButtonLabel: GuardRule = {
  id: "a11y-icon-button-label",
  description: "Icon-only buttons need an aria-label that says what they do.",
  category: "accessibility",
  severity: "warn",
  covers: () => [{ label: "icon-only button labels", systemRule: "a11y-icon-button-label" }],
  check(file, ctx) {
    const buttons = new Set(["button", ...(ctx.button ? [ctx.button.name] : [])]);
    return file.elements
      .filter((e) => buttons.has(e.name) && !e.spread && !LABEL_ATTRIBUTES.some((a) => e.attributes.has(a) && e.values.get(a) !== ""))
      .filter((e) => e.node.children.some((c) => c.type === "JSXElement") && !hasTextContent(e.node.children))
      .map((e) => ({
        line: e.line,
        column: e.column,
        range: e.nameRange,
        found: e.openingTag,
        systemRule: "a11y-icon-button-label",
        message: "This button only has an icon, so screen readers can't say what it does.",
        evidence: `<${e.name}> with no text, aria-label, aria-labelledby or title`,
        fix: { description: 'Add an aria-label that says what it does, like `aria-label="Close dialog"`.' },
      }));
  },
};
