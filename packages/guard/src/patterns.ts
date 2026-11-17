/**
 * Pattern detection: a color outside the system that keeps turning up
 * looks like part of the system, not drift. Once it's used in 3 or more
 * places across the repo, Review suggests adding it as a token instead of
 * flagging it again. Colors only: repeated arbitrary spacing stays a flag,
 * since the spacing scale is kept to standard steps on purpose.
 */
import type { SystemModel } from "@steward/model";
import { contrastRatio, formatRatio, nearestPassingShade, REQUIRED_RATIO } from "@steward/scanner";
import { checkContext, type CheckContext } from "./context.js";
import { checkFile } from "./engine.js";
import type { Finding } from "./findings.js";
import { SnippetParseError } from "./parse.js";

/** How many places a color needs before it's suggested as a token. */
export const PATTERN_MIN_USES = 3;

export interface ColorUse {
  /** Places it's used: one per class or style that hardcodes it. */
  uses: number;
  files: number;
}

/** By lowercase hex (`#7c3aed`). */
export type ColorUses = Map<string, ColorUse>;

/** `bg-[#7C3AED]/50` → `#7c3aed`; `#abc` → `#aabbcc`. Null when the finding isn't about a hex color. */
export function hexOf(found: string): string | null {
  const m = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i.exec(found);
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? [...h].map((c) => c + c).join("") : h}`;
}

/** A color finding that pattern detection can turn into a token suggestion: a hex with no token that looks the same. */
const isCandidate = (f: Finding) => f.rule === "no-hardcoded-color" && (f.fix.edits?.length ?? 0) === 0 && hexOf(f.found) !== null;

/**
 * Pure: how often each off-system hex color is used across these files.
 * Counts places marked intentional too: they're still uses. Files that
 * can't be read are left out.
 */
export function countColorUses(files: readonly { path: string; code: string }[], model: SystemModel | CheckContext): ColorUses {
  const ctx = "tokens" in model ? checkContext(model) : model;
  const places = new Map<string, { uses: number; files: Set<string> }>();
  for (const file of files) {
    let found: Finding[];
    try {
      const r = checkFile(file, ctx, { rules: ["no-hardcoded-color"] });
      found = [...r.findings, ...r.ignored.map((i) => i.finding)];
    } catch (err) {
      if (err instanceof SnippetParseError) continue;
      throw err;
    }
    for (const f of found.filter(isCandidate)) {
      const hex = hexOf(f.found)!;
      const p = places.get(hex) ?? places.set(hex, { uses: 0, files: new Set() }).get(hex)!;
      p.uses++;
      p.files.add(file.path);
    }
  }
  return new Map([...places].map(([hex, p]) => [hex, { uses: p.uses, files: p.files.size }]));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What to do next, depending on where its token suggestion stands. */
const NEXT_STEP: Readonly<Record<"none" | "pending" | "accepted", string>> = {
  none: "If it belongs in the system, run `steward scan`: it'll suggest this color as a token, and `steward review` lets you accept or reject it. Then use its class here.",
  pending: "It's already suggested as a token and waiting for a decision in `steward review`. Accepted, it joins the system on the next scan; then use its class here.",
  accepted: "You accepted it as a token, so it joins the system on the next `steward scan`. Then use its class here.",
};

/** "As text on white it's 3.1:1 …", when the color is used for text and wouldn't be readable as a token. */
function contrastAdvice(found: string, hex: string): string {
  if (!/(?:^|:)text-\[/.test(found)) return "";
  const ratio = contrastRatio(hex, "#ffffff");
  if (ratio >= REQUIRED_RATIO.text) return "";
  const shade = nearestPassingShade(hex, "#ffffff", REQUIRED_RATIO.text);
  return (
    ` As text on white it's ${formatRatio(ratio)}, below the ${formatRatio(REQUIRED_RATIO.text)} text needs,` +
    (shade ? ` so consider \`${shade.hex}\` (${formatRatio(shade.ratio)}) instead, the nearest shade that passes.` : " so pick a darker shade for text.")
  );
}

/**
 * Pure: turns findings for colors used in `PATTERN_MIN_USES`+ places into
 * token suggestions. Returns the findings left as flags, and the suggestions.
 */
export function splitPatterns(
  findings: readonly Finding[],
  uses: ColorUses,
  decided: ReadonlyMap<string, "pending" | "accepted" | "rejected"> = new Map(),
): { flags: Finding[]; suggestions: Finding[] } {
  const flags: Finding[] = [];
  const suggestions: Finding[] = [];
  for (const f of findings) {
    const hex = isCandidate(f) ? hexOf(f.found)! : null;
    const use = hex ? uses.get(hex) : undefined;
    const status = hex ? decided.get(hex) : undefined;
    // Rejected as a token: a person decided it's not part of the system, so it's drift again.
    if (!hex || !use || use.uses < PATTERN_MIN_USES || status === "rejected") {
      flags.push(f);
      continue;
    }
    const nearest = /The nearest is `([^`]+)`/.exec(f.fix.description)?.[1];
    suggestions.push({
      ...f,
      message: `\`${hex}\` is used in ${plural(use.uses, "place")} across ${plural(use.files, "file")}, and none of your tokens look like it, so it may belong in your system. Add it as a color token?`,
      evidence: `${f.evidence}; used ${plural(use.uses, "time")} in ${plural(use.files, "file")}`,
      fix: {
        description:
          NEXT_STEP[status ?? "none"] +
          (nearest ? ` If it should have been \`${nearest}\`, use that instead.` : "") +
          contrastAdvice(f.found, hex),
      },
      pattern: { value: hex, uses: use.uses, files: use.files },
    });
  }
  return { flags, suggestions };
}

