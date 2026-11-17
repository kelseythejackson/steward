import type { ContrastUse } from "@steward/model";
import {
  chooseFix,
  contrastRatio,
  deltaE,
  extractJsxContrast,
  formatRatio,
  JUST_NOTICEABLE_DELTA_E,
  REQUIRED_RATIO,
  type ContrastExtraction,
  type FocusFinding,
  type PairOccurrence,
} from "@steward/scanner";
import { contrastKey, tokenName, type CheckContext, type ColorRef } from "../context.js";
import type { TextEdit } from "../findings.js";
import type { ClassUse, ElementUse, ParsedFile } from "../parse.js";
import type { GuardRule, Hit } from "../rule.js";

// ---------------------------------------------------------------------------
// Shared: the scanner's per-file contrast and focus extraction, run once per file
// ---------------------------------------------------------------------------

const cache = new WeakMap<ParsedFile, WeakMap<CheckContext, ContrastExtraction>>();

/**
 * The color pairs and focus problems in one file, from the same code
 * `steward scan` uses. Loose markup is wrapped in a fragment (on line 1, so
 * line numbers don't move). A file the scanner can't read yields nothing.
 */
function extraction(file: ParsedFile, ctx: CheckContext): ContrastExtraction {
  let byCtx = cache.get(file);
  if (!byCtx) cache.set(file, (byCtx = new WeakMap()));
  let out = byCtx.get(ctx);
  if (!out) {
    const theme = Object.fromEntries(ctx.colors.map((c) => [c.name, c.hex]));
    const code = file.isModule ? file.code : `<>${file.code}</>`;
    try {
      out = extractJsxContrast(code, file.path ?? "snippet.tsx", theme);
    } catch {
      out = { pairs: [], focus: [], skipped: [] };
    }
    byCtx.set(ctx, out);
  }
  return out;
}

const lineAt = (code: string, offset: number) => code.slice(0, offset).split("\n").length;

/** Elements whose opening tag covers `line`, innermost (latest-starting) first. */
function elementsOnLine(file: ParsedFile, line: number): ElementUse[] {
  return file.elements
    .filter((e) => {
      const start = e.nameRange.start - 1;
      return e.line <= line && line <= lineAt(file.code, start + e.openingTag.length);
    })
    .sort((a, b) => b.nameRange.start - a.nameRange.start);
}

/** Classes written inside an element's opening tag. */
function classesIn(file: ParsedFile, e: ElementUse): ClassUse[] {
  const start = e.nameRange.start - 1;
  const end = start + e.openingTag.length;
  return file.classes.filter((c) => c.range.start >= start && c.range.end <= end);
}

const at = (line: number, e: ElementUse | undefined) => ({ line, column: e?.column ?? 1, range: e?.nameRange ?? { start: 0, end: 0 } });

// ---------------------------------------------------------------------------
// 8. focus-visible
// ---------------------------------------------------------------------------

const OUTLINE_REMOVED = /(?:^|:)outline-none$/;

/**
 * Focusable elements that remove their focus outline (`outline-none`,
 * `focus:outline-none`) with no ring, outline or shadow to replace it. A
 * border color change alone isn't enough. The fix only adds
 * `focus-visible:ring-2` next to the outline class.
 */
export const a11yFocusVisible: GuardRule = {
  id: "a11y-focus-visible",
  description: "Keep a visible focus style: if you remove the outline, add a replacement such as focus-visible:ring-2.",
  category: "accessibility",
  severity: "warn",
  covers: () => [{ label: "visible focus styles", systemRule: "a11y-focus-visible" }],
  check(file, ctx) {
    return extraction(file, ctx).focus.map((f: FocusFinding): Hit => {
      const e = elementsOnLine(file, f.line).find((x) => x.name === f.element);
      const outline = e ? classesIn(file, e).filter((c) => OUTLINE_REMOVED.test(c.className)) : [];
      const outlineClass = /\(`([^`]+)`\)/.exec(f.reason)?.[1] ?? "outline-none";
      const borderOnly = f.reason.includes("border color change");
      const noun = f.element === "a" ? "link" : ["input", "select", "textarea", "button"].includes(f.element) ? f.element : "element";
      const pos = at(f.line, e);
      const hit: Hit = {
        ...pos,
        found: e?.openingTag ?? `<${f.element}>`,
        systemRule: "a11y-focus-visible",
        message: `This ${noun} removes its focus outline and has nothing to replace it, so keyboard users can't see where they are. Add \`focus-visible:ring-2\`?`,
        evidence: `\`${outlineClass}\` with no ring, outline or shadow on focus${borderOnly ? "; a border color change alone isn't enough" : ""}`,
        fix: { description: `Add \`focus-visible:ring-2\` (or another visible focus style) next to \`${outlineClass}\`.` },
      };
      // Only when there's exactly one outline class on the element itself to put the ring next to.
      if (outline.length === 1) hit.data = { insertAt: outline[0]!.range.end } satisfies FocusData;
      return hit;
    });
  },
  fix(_file, hit) {
    const data = hit.data as FocusData | undefined;
    return data ? [{ start: data.insertAt, end: data.insertAt, text: " focus-visible:ring-2" }] : null;
  },
};

interface FocusData {
  insertAt: number;
}

// ---------------------------------------------------------------------------
// 9. text-contrast
// ---------------------------------------------------------------------------

const FOREGROUND_UTILITIES = new Set(["text", "border", "fill", "stroke", "outline", "ring", "decoration"]);
const COLOR_CLASS = /^((?:[\w-]+:)*)([a-z]+)-([a-z]+(?:-\d+)?)(\/\d+)?$/;

/** Which interaction state a class's variants apply in; responsive prefixes count as the base state. */
function stateOf(variants: string): PairOccurrence["state"] {
  const v = variants.split(":");
  if (v.includes("hover")) return "hover";
  if (v.includes("focus") || v.includes("focus-visible")) return "focus";
  return "base";
}

interface Named {
  name: string;
  hex: string;
}

/** The token a color is (or looks the same as), or its hex when it isn't one. */
function named(ctx: CheckContext, hex: string): Named {
  let best: { c: ColorRef; d: number } | null = null;
  for (const c of ctx.colors) {
    if (c.alpha !== undefined) continue;
    const d = c.hex === hex ? 0 : deltaE(c.hex, hex);
    if (!best || d < best.d) best = { c, d };
  }
  return best && best.d <= JUST_NOTICEABLE_DELTA_E ? { name: best.c.name, hex: best.c.hex } : { name: hex, hex };
}

interface Suggestion {
  replaces: "foreground" | "background";
  name: string;
  hex: string;
  ratio: number;
  existing: boolean;
  /** True when a person accepted this exact fix in system.json. */
  accepted: boolean;
  systemRule?: string;
}

/** The fix a person accepted for this pair; otherwise the scanner's choice of the smallest passing change. */
function suggest(ctx: CheckContext, fg: Named, bg: Named, use: ContrastUse): Suggestion | null {
  const accepted = ctx.contrastFixes.get(contrastKey(fg.hex, bg.hex, use));
  if (accepted) {
    const s: Suggestion = { replaces: accepted.replaces, name: accepted.name, hex: accepted.hex, ratio: accepted.ratio, existing: accepted.existing, accepted: true };
    if (accepted.systemRule) s.systemRule = accepted.systemRule;
    return s;
  }
  const tokens = ctx.colors.filter((c) => c.alpha === undefined).map((c) => ({ path: c.path, hex: c.hex }));
  const fix = chooseFix(fg.hex, bg.hex, REQUIRED_RATIO[use], tokens);
  if (!fix) return null;
  // Every fix is a token or a Tailwind palette step, so it always has a class name.
  return { replaces: fix.replaces, name: tokenName(fix.path), hex: fix.hex, ratio: fix.ratio, existing: fix.existing, accepted: false };
}

const NEEDS: Readonly<Record<ContrastUse, string>> = { text: "text", "large-text": "large text", ui: "icons and form borders" };
const STATE_PREFIX: Readonly<Record<PairOccurrence["state"], string>> = { base: "", hover: "On hover, ", focus: "On focus, " };

interface ContrastData {
  edit: TextEdit;
  /** The replacement color and every pair this hit covers, to settle clashes between hits on the same class. */
  hex: string;
  side: "foreground" | "background";
  pair: { foreground: string; background: string; use: ContrastUse };
}

/**
 * One class can sit in several failing pairs (text on a row that's white,
 * or gray when selected). Each pair suggests its own fix, so keep the
 * automatic edit only on a hit whose color passes in every pair that class
 * is in; the others keep their advice. Without one, nothing is edited.
 */
function settleSharedClasses(hits: Hit[]): void {
  const groups = new Map<string, Hit[]>();
  for (const h of hits) {
    const d = h.data as ContrastData | undefined;
    if (!d) continue;
    const key = `${d.edit.start}:${d.edit.end}`;
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  for (const group of groups.values()) {
    if (new Set(group.map((h) => (h.data as ContrastData).edit.text)).size <= 1) continue;
    const passesAll = (d: ContrastData) =>
      group.every((h) => {
        const p = (h.data as ContrastData).pair;
        const ratio = d.side === "foreground" ? contrastRatio(d.hex, p.background) : contrastRatio(p.foreground, d.hex);
        return ratio >= REQUIRED_RATIO[p.use];
      });
    const keeper = group.find((h) => passesAll(h.data as ContrastData));
    for (const h of group) {
      if (h === keeper) continue;
      const d = h.data as ContrastData;
      delete h.data;
      delete h.fix.replacement;
      h.range = d.edit;
      const other = keeper ? ` \`${(keeper.data as ContrastData).edit.text}\` works on both, so that one fix covers this too.` : "";
      h.fix.description = `This class also sits on another background here, so it needs a color that passes on both.${other}`;
    }
  }
}

/**
 * Text, icons and form borders whose colors fail WCAG AA against their
 * background (4.5:1 for text, 3:1 for large text, icons and borders),
 * including hover and focus states. Suggests the fix a person accepted for
 * that pair, or else the smallest passing change, preferring tokens. The
 * automatic fix only swaps one token class on the element for another token.
 */
export const a11yTextContrast: GuardRule = {
  id: "a11y-text-contrast",
  description: "Text needs 4.5:1 contrast with its background (3:1 for large text, icons and form borders); use a pair that passes.",
  category: "accessibility",
  severity: "warn",
  covers: (ctx) => (ctx.colors.length === 0 ? [] : [{ label: "color contrast", systemRule: "a11y-text-contrast" }]),
  check(file, ctx) {
    if (ctx.colors.length === 0) return [];
    const hits: Hit[] = [];
    for (const p of extraction(file, ctx).pairs) {
      const required = REQUIRED_RATIO[p.use];
      const ratio = contrastRatio(p.foreground, p.background);
      if (ratio >= required) continue;
      const fg = named(ctx, p.foreground);
      const bg = named(ctx, p.background);
      const fix = suggest(ctx, fg, bg, p.use);
      const elements = elementsOnLine(file, p.line);
      const pos = at(p.line, elements[0]);

      // The class to swap: a token class for the side that changes, in the right state, on this element.
      let edit: TextEdit | undefined;
      let swap: { from: string; to: string } | undefined;
      if (fix?.existing) {
        const side = fix.replaces === "foreground" ? fg : bg;
        const candidates = elements.flatMap((e) => classesIn(file, e)).flatMap((c) => {
          const m = COLOR_CLASS.exec(c.className);
          if (!m) return [];
          const [, variants = "", utility = "", name = "", opacity = ""] = m;
          const token = ctx.colors.find((t) => t.name === name);
          const right = fix.replaces === "foreground" ? FOREGROUND_UTILITIES.has(utility) : utility === "bg";
          if (!token || token.hex !== side.hex || !right || stateOf(variants) !== p.state) return [];
          return [{ c, to: `${variants}${utility}-${fix.name}${opacity}` }];
        });
        if (candidates.length === 1) {
          const { c, to } = candidates[0]!;
          edit = { ...c.range, text: to };
          swap = { from: c.className, to };
        }
      }

      const hard = p.use === "ui" ? "hard to see" : "hard to read for many people";
      const pairText = `\`${fg.name}\` on \`${bg.name}\``;
      let ask: string;
      let description: string;
      if (!fix) {
        ask = "Pick a lighter or darker color for one side?";
        description = "No change to either color reaches the required contrast; pick a different pair.";
      } else if (!fix.existing) {
        ask = `No color in your system passes here. Add Tailwind's \`${fix.name}\` (${fix.hex}, ${formatRatio(fix.ratio)})?`;
        description = `Add \`${fix.name}\` to the system for the ${fix.replaces === "foreground" ? "text" : "background"} (accept the contrast fix in Setup), or choose a different pair.`;
      } else {
        const what = fix.replaces === "foreground" ? `\`${fix.name}\`` : `a \`${fix.name}\` background`;
        ask = `Use ${what} (${formatRatio(fix.ratio)})?`;
        description = swap ? `Use \`${swap.to}\` instead of \`${swap.from}\`.` : `Use ${what} for this ${fix.replaces === "foreground" ? "color" : "element"}.`;
      }

      const evidence = [
        `contrast ${formatRatio(ratio)}, needs ${required}:1 for ${NEEDS[p.use]}`,
        ...(p.backgroundAssumed ? ["background assumed white, because a parent component sets it"] : []),
        ...(fix?.accepted ? [`${fix.name} is the fix your team accepted for this pair`] : []),
      ].join("; ");

      const hit: Hit = {
        ...pos,
        found: swap?.from ?? `${fg.name} on ${bg.name}`,
        systemRule: fix?.systemRule ?? "a11y-text-contrast",
        message: `${STATE_PREFIX[p.state]}${pairText} is ${formatRatio(ratio)}, below the ${required}:1 that ${NEEDS[p.use]} need${p.use === "text" ? "s" : ""}, so it's ${hard}. ${ask}`,
        evidence,
        fix: swap ? { description, replacement: swap.to } : { description },
      };
      if (edit) {
        hit.range = { start: edit.start, end: edit.end };
        hit.column = file.classes.find((c) => c.range.start === edit.start)?.column ?? hit.column;
        hit.data = { edit, hex: fix!.hex, side: fix!.replaces, pair: { foreground: fg.hex, background: bg.hex, use: p.use } } satisfies ContrastData;
      }
      hits.push(hit);
    }
    settleSharedClasses(hits);
    return hits;
  },
  fix(_file, hit) {
    const data = hit.data as ContrastData | undefined;
    return data ? [data.edit] : null;
  },
};
