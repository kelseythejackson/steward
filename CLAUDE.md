# Steward

**The self-maintaining design system.** The design system team you don't have to hire.

Product name: Steward. CLI command: `steward` (short alias `stew`). The four parts are **Setup**, **Brief**, **Review** and **Report**: always use these names in UI copy and docs.

**Voice:** calm, specific, never scolding. Steward is a helpful colleague, not a police officer. Write "This button isn't in your system yet. Use `Button`, or add this one?" rather than "Error: unauthorized component."

## Problem statement

Small product teams at startups and SMBs need their UI to stay consistent as they ship quickly, increasingly with AI tools, but they don't have the people or time to maintain a design system. Today's tools assume a dedicated team and an enterprise budget. So adoption stalls, design and code drift apart, and AI-generated UI adds inconsistency faster than anyone can fix it.

**Design goal:** How might we give small teams a design system that maintains itself, keeping design, code and AI output in sync without needing someone to maintain it?

Steward takes over the upkeep, not the decisions. People still decide what the system is: they accept or reject merges, mark exceptions as intentional and approve new tokens. Ownership becomes a lightweight, part-time role instead of a full-time job. Tasteful exceptions are a feature, not a failure: show approved exceptions as healthy, never as drift.

## What we're building (MVP)

Three parts that share one **system model** (tokens, components, usage rules):

1. **Steward Setup (scanner):** scans a React + Tailwind repo, extracts the colors, spacing and components actually in use, merges near-duplicates and outputs a token file plus a report.
2. **Steward Brief:** turns the system model into a `design.md` context file and a small MCP server so AI coding tools build with the team's own components and tokens.
3. **Steward Review:** a rule-based checker that runs as a GitHub Action on pull requests and comments on off-system code with suggested fixes.

Plus **Steward Report**, a health dashboard, and a review screen (part of Setup) for accepting merge suggestions.

### In scope
- React + Tailwind (and shadcn/ui-style) codebases only
- TypeScript / TSX source files
- Colors, spacing and component duplicates
- Accessibility basics: contrast between color tokens (WCAG AA), plus static JSX checks for missing alt text, unlabeled inputs, icon-only buttons with no accessible name, click handlers on non-interactive elements and removed focus outlines
- Rule-based checks (no AI judgement yet)
- Running locally and in GitHub Actions

### Out of scope (roadmap, don't build)
- Figma sync, URL/live-site scanning
- Rendered accessibility testing (e.g. axe-core on live previews), keyboard-flow and screen reader testing
- AI-based intent checks ("this looks like a destructive action")
- Other frameworks (Vue, Svelte, plain CSS-in-JS)
- Accounts, auth, billing, multi-tenant hosting

If a task seems to need something out of scope, stop and ask before building it.

## Architecture

pnpm monorepo, TypeScript throughout.

```
/packages
  /model      Shared types + read/write of the system model (DTCG tokens JSON)
  /scanner    Steward Setup: extract → cluster → suggest → write tokens + report
  /context    design.md generator + MCP server
  /guard      Steward Review rules engine + GitHub Action wrapper
  /cli        `steward` command: scan, review, context, check
/apps
  /web        Next.js app: review screen + Report dashboard
/fixtures
  /messy-app  Deliberately inconsistent demo React + Tailwind app (test target)
```

### The system model (single source of truth)
- Stored at `.steward/system.json` in the target repo
- Tokens follow the W3C Design Tokens Community Group (DTCG) format (`$value`, `$type`)
- Also stores: component inventory (name, file path, variants), merge decisions (accepted/rejected, so we never re-suggest a rejected merge), and rules
- Every package reads and writes the model only through `packages/model`

## Tech choices

- Node 20+, pnpm workspaces, TypeScript strict mode
- Parsing TSX: `@babel/parser` + `@babel/traverse` (or `ts-morph` if type info is needed)
- Tailwind class parsing: parse `className` strings ourselves; handle arbitrary values like `p-[13px]` and `bg-[#3b82f6]`
- Color math: `culori` (convert to OKLCH, use ΔE for "near-duplicate")
- MCP server: `@modelcontextprotocol/sdk`
- Tests: `vitest`
- Web: Next.js (App Router) + Tailwind, built from the wireframes

Ask before adding any other dependency.

## Commands

```
pnpm install
pnpm test              # all packages (vitest projects)
pnpm -F scanner test   # one package
pnpm typecheck         # tsc -b across all packages via project references
pnpm build             # compile every package to dist/
pnpm steward           # run the CLI from source via tsx (help); no build needed
pnpm steward scan fixtures/messy-app          # writes fixtures/messy-app/.steward/system.json + prints the report
pnpm steward scan fixtures/messy-app --json   # full result as JSON (summary, model, details)
pnpm -F cli test       # includes the end-to-end scan test (builds first, runs dist/bin.js on a temp copy of the fixture)
pnpm -F web dev                        # planned (apps/web is empty)
```

Each package's `exports` has a `source` condition pointing at `src/index.ts`.
`pnpm steward` runs tsx with `--conditions=source`, and every vitest config
spreads `sourceResolution` from `vitest.shared.ts`, so the CLI and tests always
use current source, never a stale `dist/`. Plain `node` (and the published
`bin`) still use `dist/`, so run `pnpm build` before using `dist/bin.js` directly.

Package names are scoped (`@steward/model`, `@steward/cli`, ...). `pnpm -F scanner`
matches the unscoped part, so short filters work. New native build scripts must be
allowlisted under `allowBuilds` in `pnpm-workspace.yaml` (pnpm 12 blocks them otherwise).

Keep this section updated as commands are added.

## Conventions

- Small, pure functions; side effects (file I/O) at the edges
- Every extractor and rule has unit tests against `fixtures/messy-app`
- Output must be deterministic: same input → same output (sort keys and lists)
- Human-readable output first: every CLI command prints a short, plain-English summary (e.g. "Found 14 grays → suggest 6")
- No silent changes to the user's code. The scanner and guard suggest; they never edit files unless a command explicitly says `--fix`

## Responsible AI principles (non-negotiable)

Every feature must follow these. If a task conflicts with one, stop and ask.

1. **Local by default.** Scanning and checks run on the user's machine or in their own CI. No code is sent to any outside service. Any future AI feature is opt-in and states exactly what is sent.
2. **Product, not people.** Never store or display names, emails, usernames or per-person metrics. History may record only the *source type* of code (`human`, `ai-agent` or `unknown`) and only in aggregate. The Report dashboard says so on the page: "Steward measures your UI, not your people."
3. **Explain every suggestion.** Each suggestion or flag states its reason and evidence (e.g. "ΔE 1.2, used 41 times", "contrast 2.8:1, needs 4.5:1").
4. **Humans decide.** Suggestions never apply themselves. Review runs in warn-only mode by default, and every accepted change can be undone.
5. **Raise the floor.** Never make an inaccessible value official. If a suggested token fails contrast, suggest the nearest shade that passes. Accessibility rules are included in `design.md` so AI tools follow them too. Be honest that static checks catch only part of accessibility; never claim a product is "accessible" because checks pass.

## Working rules for Claude

- Read this file and the relevant package before changing anything
- For any task larger than one function, propose a short plan first and wait for approval
- Build one piece at a time; run the tests after each change and show the results
- When unsure about a product decision (thresholds, naming, UX copy), ask instead of guessing
- Don't build anything listed under "Out of scope"
- After finishing a task, summarize what changed, how to run it and what's left

## Definition of done for the MVP

1. `steward scan` on `fixtures/messy-app` produces `system.json` with merged colors and a spacing scale, flags token pairs that fail contrast with a passing alternative, and prints a readable report
2. `steward context` produces `design.md` (including accessibility rules) and starts an MCP server that AI tools can connect to
3. The Steward Review action comments on a pull request in a test repo, flagging hardcoded colors, arbitrary spacing, raw `<button>` elements and the accessibility rules above
4. The web app shows the review screen and dashboard using real output from steps 1–3, with an accessibility measure and no per-person data anywhere
