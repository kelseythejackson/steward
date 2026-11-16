/**
 * @steward/guard: Steward Review's rules engine. The same rules power the
 * `check_snippet` MCP tool now and the pull request checker later.
 */
export const PACKAGE_NAME = "@steward/guard" as const;
export { checkCode, describeCheck, STATIC_CHECKS_NOTE } from "./check.js";
export { applyFixes, checkFile, type CheckOptions, type CheckResult, type FixResult } from "./engine.js";
export { checkContext, importLine, type ButtonRef, type CheckContext, type ColorRef, type ComponentRef, type ReplacedComponent, type SpacingStep } from "./context.js";
export type { Finding, Fix, RuleId, Severity, TextEdit } from "./findings.js";
export { hasTextContent, parseFile, readSnippet, SnippetParseError, type ClassUse, type ElementUse, type ParsedFile, type Position, type Range, type Snippet, type StyleUse } from "./parse.js";
export type { Coverage, GuardRule, Hit } from "./rule.js";
export { a11yIconButtonLabel, a11yImgAlt, noArbitrarySpacing, noHardcodedColor, RULES, useSystemComponent } from "./rules/index.js";
