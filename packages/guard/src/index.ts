/**
 * @steward/guard: Steward Review's rules engine. The same rules power the
 * `check_snippet` MCP tool now and the pull request checker later.
 */
export const PACKAGE_NAME = "@steward/guard" as const;
export { checkCode, describeCheck, STATIC_CHECKS_NOTE } from "./check.js";
export { applyFixes, checkFile, coverage, type CheckOptions, type CheckResult, type FixResult } from "./engine.js";
export { checkContext, importLine, type ButtonRef, type CheckContext, type ColorRef, type ComponentRef, type ContrastFix, type ReplacedComponent, type SpacingStep } from "./context.js";
export { allLines, parseAddedLines, type AddedLines } from "./diff.js";
export { fingerprintOf, lineComments, markdown, RULE_LABELS, SUMMARY_MARKER, summaryComment, summaryHeadline, type LineComment, type SummaryOptions } from "./github.js";
export { formatReview, isReviewable, reviewFiles, rulesOff, unknownRules, type ReviewOptions, type ReviewResult, type ReviewScope, type SourceFile } from "./review.js";
export type { Finding, Fix, IgnoredFinding, Note, RuleId, Severity, TextEdit } from "./findings.js";
export { parseIgnores, type IgnoreComment } from "./ignore.js";
export { countColorUses, hexOf, PATTERN_MIN_USES, splitPatterns, type ColorUse, type ColorUses } from "./patterns.js";
export { hasTextContent, parseFile, readSnippet, SnippetParseError, type ClassUse, type ElementUse, type ParsedFile, type Position, type Range, type Snippet, type StyleUse } from "./parse.js";
export type { Coverage, GuardRule, Hit } from "./rule.js";
export {
  a11yAccessibleName,
  a11yFocusVisible,
  a11yImgAlt,
  a11yInteractiveElement,
  a11yLabelInputs,
  a11yTextContrast,
  noArbitrarySpacing,
  noHardcodedColor,
  RULES,
  useSystemComponent,
} from "./rules/index.js";
