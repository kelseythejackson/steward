import { parseSpacingClass, snapToScale } from "@steward/scanner";
import { CHECK_RULES, type CheckContext, type SpacingStep } from "../context.js";
import type { Finding } from "../findings.js";
import type { ClassUse, Snippet } from "../jsx.js";

/** `md:-mt-[7px]!` with property `mt` and key `2` → `md:-mt-2!`. */
function withKey(className: string, property: string, key: string): string {
  const important = className.endsWith("!") ? "!" : "";
  const at = className.lastIndexOf(`${property}-`);
  return `${className.slice(0, at + property.length + 1)}${key}${important}`;
}

const stepText = (property: string, s: SpacingStep) => `\`${property}-${s.key}\` (${s.px}px)`;

function checkClass(ctx: CheckContext, use: ClassUse): Finding | null {
  const parsed = parseSpacingClass(use.className);
  // Sizes (`w-[42px]`) aren't spacing; the scanner leaves them out of the scale too.
  if (!parsed || parsed.category !== "spacing") return null;
  const scale = ctx.spacing.map((s) => s.px);
  const snap = snapToScale(parsed.px, scale);
  if (snap.kind === "on-scale") return null;

  const { property, px } = parsed;
  const arbitrary = use.className.includes("[");
  const base = { check: "arbitrary-spacing" as const, ruleId: CHECK_RULES["arbitrary-spacing"]!, category: "spacing" as const, line: use.line, column: use.column, found: use.className };
  const scaleText = `your scale is ${scale.join(", ")}px`;

  if (snap.kind === "beyond-scale") {
    const largest = ctx.spacing[ctx.spacing.length - 1]!;
    return {
      ...base,
      message: `\`${use.className}\` (${px}px) is bigger than your largest spacing step, ${stepText(property, largest)}.`,
      evidence: `${px}px; ${scaleText}`,
      fix: { description: `Use \`${withKey(use.className, property, largest.key)}\`, or add a new step to the system if this size is intentional.` },
    };
  }

  const step = ctx.spacing.find((s) => s.px === snap.step)!;
  const replacement = withKey(use.className, property, step.key);
  if (arbitrary) {
    return {
      ...base,
      message: `\`${use.className}\` is an arbitrary value (${px}px), not a step on your spacing scale.`,
      evidence: `${px}px; nearest step ${step.px}px; ${scaleText}`,
      fix: { description: `Use \`${replacement}\` (${step.px}px), the nearest step.`, replacement },
    };
  }
  // A Tailwind step that isn't on the team's scale: name the steps either side.
  const below = [...ctx.spacing].reverse().find((s) => s.px < px);
  const above = ctx.spacing.find((s) => s.px > px);
  const options = [below, above].filter((s): s is SpacingStep => s !== undefined).map((s) => stepText(property, s));
  return {
    ...base,
    message: `\`${use.className}\` (${px}px) isn't on your spacing scale.`,
    evidence: `${px}px; ${scaleText}`,
    fix: { description: `Use ${options.join(" or ")}.`, replacement },
  };
}

/**
 * Spacing outside the team's scale: arbitrary values (`p-[13px]`) and
 * Tailwind steps the scale doesn't have (`p-5` when there's no 20px step).
 * Suggests the nearest step.
 */
export function checkArbitrarySpacing(snippet: Snippet, ctx: CheckContext): Finding[] {
  if (ctx.spacing.length === 0) return [];
  return snippet.classes.map((c) => checkClass(ctx, c)).filter((f): f is Finding => f !== null);
}
