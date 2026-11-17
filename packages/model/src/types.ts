/**
 * The Steward system model: the single source of truth stored at
 * `.steward/system.json`. Tokens follow the W3C Design Tokens Community
 * Group (DTCG) format. Everything else is Steward's own schema.
 */

export const SYSTEM_MODEL_VERSION = 1;

/** Key under `$extensions` where Steward keeps its own token data. */
export const STEWARD_EXTENSION = "dev.steward";

// ---------------------------------------------------------------------------
// Tokens (DTCG)
// ---------------------------------------------------------------------------

export type ColorSpace = "srgb" | "display-p3" | "oklch";

/** DTCG color value. `hex` is always filled in so the file stays easy to read and grep. */
export interface ColorValue {
  colorSpace: ColorSpace;
  components: [number, number, number];
  alpha?: number;
  hex: string;
}

export type DimensionUnit = "px" | "rem";

/** DTCG dimension value, e.g. `{ value: 16, unit: "px" }`. */
export interface DimensionValue {
  value: number;
  unit: DimensionUnit;
}

/** Steward's per-token data, stored under `$extensions["dev.steward"]`. */
export interface StewardTokenExtension {
  /** How many times the token's values appear in the scanned code. */
  uses?: number;
  /** Raw values merged into this token, e.g. `["#3a81f5", "#3b83f7"]`. Lets a merge be undone. */
  mergedFrom?: string[];
  /**
   * Ids of open contrast suggestions for this color. Steward never makes an
   * inaccessible value official: while this list is non-empty the token is a
   * proposal only, until a person resolves each suggestion.
   */
  contrastIssues?: string[];
}

export interface TokenExtensions {
  [STEWARD_EXTENSION]?: StewardTokenExtension;
  /** Other tools' extensions are kept untouched. */
  [key: string]: unknown;
}

interface TokenBase {
  $description?: string;
  $extensions?: TokenExtensions;
}

export interface ColorToken extends TokenBase {
  $type: "color";
  $value: ColorValue;
}

export interface DimensionToken extends TokenBase {
  $type: "dimension";
  $value: DimensionValue;
}

export type Token = ColorToken | DimensionToken;
export type TokenType = Token["$type"];

/** A nested group of tokens, e.g. `{ color: { gray: { "500": ColorToken } } }`. */
export interface TokenGroup {
  [name: string]: TokenNode;
}

export type TokenNode = Token | TokenGroup;

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export interface ComponentEntry {
  name: string;
  /** Path relative to the repo root, with forward slashes. */
  filePath: string;
  /** Line where the component is defined. */
  line?: number;
  variants: string[];
  /** Prop names, from the destructured parameter and the props type. */
  props?: string[];
  /** Props the type requires (no `?`), so examples include them. */
  requiredProps?: string[];
  /** Elements the component can render at its root, e.g. `["a", "button"]`. */
  rootElements?: string[];
}

// ---------------------------------------------------------------------------
// Merge suggestions and decisions
// ---------------------------------------------------------------------------

export type SuggestionKind = "color" | "spacing" | "component" | "contrast" | "token";

/** Every suggestion explains itself: a plain-English summary plus the numbers behind it. */
export interface SuggestionReason {
  /** e.g. "These 3 blues are nearly identical (ΔE under 2) and used 12 times." */
  summary: string;
  /** e.g. `{ maxDeltaE: 1.2, uses: 12 }` */
  evidence: Record<string, number | string>;
}

interface SuggestionBase {
  /** Stable id derived from kind and members. See `suggestionId`. */
  id: string;
  /** Raw values (`"#3a81f5"`, `"13px"`) or component names being merged. */
  members: string[];
  reason: SuggestionReason;
}

export interface ColorMergeSuggestion extends SuggestionBase {
  kind: "color";
  /** `path` is the dot-separated token path, e.g. `"color.blue.500"`. */
  proposed: { path: string; token: ColorToken };
}

/** Where a value is used, e.g. `{ file: "src/Card.tsx", line: 12, value: "mt-[7px]" }`. */
export interface UsageLocation {
  /** Path relative to the repo root, with forward slashes. */
  file: string;
  line: number;
  /** The class or declaration exactly as written. */
  value: string;
}

/**
 * Off-scale spacing values that would snap to one step of the scale.
 * `members` holds the off-scale values and the step itself, e.g. `["7px", "9px", "8px"]`.
 */
export interface SpacingMergeSuggestion extends SuggestionBase {
  kind: "spacing";
  proposed: { path: string; token: DimensionToken };
  /** Where the off-scale values are used, so a person can review each one. */
  locations?: UsageLocation[];
}

export interface ComponentMergeSuggestion extends SuggestionBase {
  kind: "component";
  /** The component to keep. */
  proposed: { name: string };
}

export type MergeSuggestion = ColorMergeSuggestion | SpacingMergeSuggestion | ComponentMergeSuggestion;

/**
 * A color that isn't in the system yet but keeps turning up (3+ places),
 * so it may belong there. Made by a re-scan instead of quietly adding the
 * color as a token: a person accepts or rejects it. `members` holds the
 * one color. Accepted, it becomes a token on the next scan; rejected, it
 * stays off-system and Review keeps flagging it.
 */
export interface TokenSuggestion extends SuggestionBase {
  kind: "token";
  proposed: { path: string; token: ColorToken };
  /** Where it's used, so a person can see what they're deciding on. */
  locations: UsageLocation[];
}

/**
 * What a color pair is used for, which sets the WCAG AA minimum:
 * `text` 4.5:1, `large-text` 3:1 (24px+, or 20px+ bold), `ui` 3:1
 * (form control borders and icons).
 */
export type ContrastUse = "text" | "large-text" | "ui";

/**
 * A color pair used together that fails WCAG AA, with the nearest passing
 * alternative. `members` holds the two colors; `pair` keeps which is which.
 */
export interface ContrastSuggestion extends SuggestionBase {
  kind: "contrast";
  pair: { foreground: string; background: string; use: ContrastUse };
  proposed: {
    /** Which side of the pair the fix changes. */
    replaces: "foreground" | "background";
    /** Token path of the replacement, e.g. `"color.gray.500"`. */
    path: string;
    token: ColorToken;
    /** Contrast ratio of the pair after the fix, e.g. 4.83. */
    ratio: number;
    /** True when the replacement is already a token in the system. */
    existing: boolean;
  };
}

export type Suggestion = MergeSuggestion | ContrastSuggestion | TokenSuggestion;

export type DecisionStatus = "accepted" | "rejected";

/**
 * A person's decision on a suggestion. Deliberately records no person:
 * Steward measures the UI, not the people. Undo by removing the decision.
 */
export interface MergeDecision {
  suggestionId: string;
  kind: SuggestionKind;
  /** Kept so a rejected merge is still recognised if ids ever change. */
  members: string[];
  status: DecisionStatus;
  /** ISO 8601 timestamp. */
  decidedAt: string;
  /**
   * Colors: a person arranged this group themselves (moved a swatch or
   * renamed the token). Scans keep exactly these colors together as one
   * token, even a single color. Only on accepted color decisions.
   */
  edited?: true;
  /** Colors: the token name a person chose, e.g. `color.gray.150`; new color tokens: the name it was accepted as. Scans use it. */
  path?: string;
  /** Components: the one to keep, when a person chose a different one from the suggestion. */
  keep?: string;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type RuleSeverity = "warn" | "error";

/**
 * Where a rule came from: `generated` by a scan (from accepted suggestions,
 * plus the accessibility basics), written by a `user`, or `learned` from
 * review history. Scans rebuild generated rules and never touch the others.
 */
export type RuleSource = "generated" | "user" | "learned";

export type RuleCategory = "color" | "spacing" | "component" | "accessibility";

/** What a rule is about. */
export type RuleTarget =
  /** One token, e.g. `{ kind: "token", path: "color.blue.500" }`. */
  | { kind: "token"; path: string }
  /** Every token under a group, e.g. `{ kind: "token-group", path: "spacing" }`. */
  | { kind: "token-group"; path: string }
  /** A component in the inventory, e.g. `{ kind: "component", name: "Button" }`. */
  | { kind: "component"; name: string }
  /** A raw HTML element, e.g. `{ kind: "element", name: "button" }`. */
  | { kind: "element"; name: string };

/**
 * A short, plain-English usage rule, e.g. "Icon-only buttons need an
 * aria-label". Read by people, by Steward Brief (for AI tools) and by
 * Steward Review.
 */
export interface Rule {
  /** Stable and readable, e.g. `use-component-button` or `a11y-img-alt`. */
  id: string;
  /** One or two sentences in Steward's voice. */
  text: string;
  category: RuleCategory;
  appliesTo: RuleTarget[];
  /** A short snippet of code that follows the rule, and one that doesn't. */
  examples: { right: string; wrong: string };
  source: RuleSource;
  /** Ids of the accepted suggestions behind a generated rule, so it can explain itself. */
  basedOn?: string[];
  severity: RuleSeverity;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

export interface SystemModel {
  version: typeof SYSTEM_MODEL_VERSION;
  tokens: TokenGroup;
  components: ComponentEntry[];
  suggestions: Suggestion[];
  decisions: MergeDecision[];
  rules: Rule[];
  /** Flags people marked intentional in the code. Optional in the file; always present once read. */
  exceptions: Exception[];
}

/**
 * A Review flag a person marked intentional with a comment in the code:
 * `// steward-ignore use-system-component: marketing hero needs a custom button`.
 * The comment is the source of truth; `steward scan` keeps this list in
 * step with it. Approved exceptions are healthy, never drift. No line
 * number (it changes with every edit) and no person.
 */
export interface Exception {
  /** The Review rule, e.g. `use-system-component`. */
  rule: string;
  /** Path relative to the repo root, with forward slashes. */
  file: string;
  /** What the rule found, e.g. `<button className="hero-cta">`. */
  found: string;
  /** Why, in the person's words. */
  reason: string;
  /** The day a scan first recorded it, `YYYY-MM-DD`. */
  firstSeen: string;
}
