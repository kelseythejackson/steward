/**
 * @steward/context — Steward Brief: design.md generator and MCP server.
 */
export const PACKAGE_NAME = "@steward/context" as const;
export { contrastRatio, DESIGN_MD_MARKER, generateDesignMd, type DesignMdOptions } from "./design-md.js";
export { projectName } from "./project-name.js";
export { createBriefServer, serveOverStdio, SERVER_NAME, SERVER_VERSION, type ModelLoader } from "./mcp-server.js";
export {
  checkSnippet,
  findComponent,
  getRules,
  getTokens,
  type ColorTokenInfo,
  type ComponentMatch,
  type FindComponentData,
  type RuleInfo,
  type RulesData,
  type SpacingTokenInfo,
  type TokenType,
  type TokensData,
  type ToolResult,
} from "./tools.js";
export { SYNONYMS, type Synonym } from "./synonyms.js";
