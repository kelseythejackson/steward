/**
 * @steward/scanner: Steward Setup. Extracts what a repo actually uses,
 * clusters near-duplicates and suggests a system.
 */
export * from "./colors/index.js";
export * from "./contrast/index.js";
export * from "./spacing/index.js";
export * from "./components/index.js";
export { buildSystemModel, scanFiles, scanRepo, summarizeScan, type ScanOptions, type ScanResult, type ScanSummary } from "./scan.js";
export { cssVariableDeclarations, resolveCssColor, tailwindSetup, tailwindVersion, type TailwindSetup, type TailwindVersion } from "./tailwind.js";
