import { createHash } from "node:crypto";
import {
  STEWARD_EXTENSION,
  SYSTEM_MODEL_VERSION,
  type Suggestion,
  type SuggestionKind,
  type SystemModel,
  type Token,
  type TokenGroup,
  type TokenNode,
} from "./types.js";

/** Locale-independent string comparison, so output never depends on the machine. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const sortedStrings = (values: readonly string[]): string[] => [...values].sort(compareStrings);

export function isToken(node: TokenNode): node is Token {
  return Object.prototype.hasOwnProperty.call(node, "$value");
}

/**
 * Stable id for a suggestion: the same kind and members always give the same
 * id, whatever order the members are listed in. Looks like `color-3f2a9c1b04de`.
 */
export function suggestionId(kind: SuggestionKind, members: readonly string[]): string {
  const key = [kind, ...[...new Set(members)].sort(compareStrings)].join("\n");
  return `${kind}-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

export function emptySystemModel(): SystemModel {
  return {
    version: SYSTEM_MODEL_VERSION,
    tokens: {},
    components: [],
    suggestions: [],
    decisions: [],
    rules: [],
  };
}

function normalizeToken<T extends Token>(token: T): T {
  const ext = token.$extensions?.[STEWARD_EXTENSION];
  if (!ext?.mergedFrom && !ext?.contrastIssues) return token;
  const sorted = { ...ext };
  if (ext.mergedFrom) sorted.mergedFrom = sortedStrings(ext.mergedFrom);
  if (ext.contrastIssues) sorted.contrastIssues = sortedStrings(ext.contrastIssues);
  return { ...token, $extensions: { ...token.$extensions, [STEWARD_EXTENSION]: sorted } };
}

function normalizeTokens(group: TokenGroup): TokenGroup {
  const out: TokenGroup = {};
  for (const [name, node] of Object.entries(group)) {
    out[name] = isToken(node) ? normalizeToken(node) : normalizeTokens(node);
  }
  return out;
}

/**
 * Sorts every list in the model whose order carries no meaning. Lists whose
 * order does matter (a color's `components`) are left alone.
 */
export function normalizeSystemModel(model: SystemModel): SystemModel {
  return {
    ...model,
    tokens: normalizeTokens(model.tokens),
    components: model.components
      .map((c) => ({ ...c, variants: sortedStrings(c.variants) }))
      .sort((a, b) => compareStrings(a.name, b.name) || compareStrings(a.filePath, b.filePath)),
    suggestions: model.suggestions
      .map((s): Suggestion => {
        const members = sortedStrings(s.members);
        if (s.kind === "contrast") return { ...s, members, proposed: { ...s.proposed, token: normalizeToken(s.proposed.token) } };
        if (s.kind === "color") return { ...s, members, proposed: { ...s.proposed, token: normalizeToken(s.proposed.token) } };
        if (s.kind === "spacing") return { ...s, members, proposed: { ...s.proposed, token: normalizeToken(s.proposed.token) } };
        return { ...s, members };
      })
      .sort((a, b) => compareStrings(a.id, b.id)),
    decisions: model.decisions
      .map((d) => ({ ...d, members: sortedStrings(d.members) }))
      .sort((a, b) => compareStrings(a.suggestionId, b.suggestionId) || compareStrings(a.decidedAt, b.decidedAt)),
    rules: [...model.rules].sort((a, b) => compareStrings(a.id, b.id)),
  };
}

/**
 * Rebuilds plain objects with keys in sorted order, at every depth.
 * Note: JavaScript always emits integer-like keys ("50", "100") first in
 * numeric order, so token scales like gray.50…gray.900 come out naturally.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort(compareStrings)) {
      out[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Same model in, same bytes out. 2-space JSON with a trailing newline. */
export function serializeSystemModel(model: SystemModel): string {
  return `${JSON.stringify(sortKeysDeep(normalizeSystemModel(model)), null, 2)}\n`;
}
