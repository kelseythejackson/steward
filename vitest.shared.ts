/**
 * Resolve `@steward/*` packages to their TypeScript source (the `source`
 * export condition), so tests always run against the current code instead
 * of whatever was last built into `dist/`. The other conditions are Vite's
 * defaults for Node, which setting `conditions` would otherwise replace.
 */
const conditions = ["source", "module", "node", "development|production"];

export const sourceResolution = {
  resolve: { conditions },
  ssr: { resolve: { conditions } },
};
