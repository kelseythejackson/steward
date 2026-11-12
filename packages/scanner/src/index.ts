/**
 * @steward/scanner: Steward Setup. Extracts what a repo actually uses,
 * clusters near-duplicates and suggests a system.
 */
export * from "./colors/index.js";
export * from "./contrast/index.js";
export * from "./spacing/index.js";
export * from "./components/index.js";
export { buildSystemModel, isStoryOrTest, scanFiles, scanRepo, summarizeRules, summarizeScan, type RuleSummary, type ScanOptions, type ScanResult, type ScanSummary } from "./scan.js";
export { cssVariableDeclarations, DEFAULT_ROOT_PX, resolveCssColor, rootFontSize, rootPxOf, tailwindSetup, tailwindVersion, type TailwindSetup, type TailwindVersion } from "./tailwind.js";
export { parseCss, resolveNested, type CssDeclaration, type CssRule } from "./css.js";
export { describeRules, describeScan } from "./report.js";
export { generateRules, mergeRules, ruleInputsFromModel, rulesForModel, type RuleInputs } from "./rules/generate.js";
