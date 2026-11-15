/**
 * @steward/guard: Steward Review's rules engine. The same checks power the
 * `check_snippet` MCP tool now and the pull request checker later.
 */
export const PACKAGE_NAME = "@steward/guard" as const;
export { CHECKS, checkCode, describeCheck, STATIC_CHECKS_NOTE, type CheckResult } from "./check.js";
export { CHECK_RULES, checkContext, isCheckOn, type ButtonRef, type CheckContext, type ColorRef, type SpacingStep } from "./context.js";
export type { CheckId, Finding, Fix } from "./findings.js";
export { hasTextContent, readSnippet, SnippetParseError, type ClassUse, type ElementUse, type Position, type Snippet, type StyleUse } from "./jsx.js";
