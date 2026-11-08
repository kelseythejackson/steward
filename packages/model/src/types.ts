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
  variants: string[];
}

// ---------------------------------------------------------------------------
// Merge suggestions and decisions
// ---------------------------------------------------------------------------

export type SuggestionKind = "color" | "spacing" | "component";

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

export interface SpacingMergeSuggestion extends SuggestionBase {
  kind: "spacing";
  proposed: { path: string; token: DimensionToken };
}

export interface ComponentMergeSuggestion extends SuggestionBase {
  kind: "component";
  /** The component to keep. */
  proposed: { name: string };
}

export type MergeSuggestion = ColorMergeSuggestion | SpacingMergeSuggestion | ComponentMergeSuggestion;

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
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type RuleSeverity = "warn" | "error";

/** Placeholder for Steward Review rules; fleshed out with the guard package. */
export interface Rule {
  id: string;
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
  suggestions: MergeSuggestion[];
  decisions: MergeDecision[];
  rules: Rule[];
}
