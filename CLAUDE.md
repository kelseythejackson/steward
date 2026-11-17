# Steward

**The self-maintaining design system.**

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
- Rules are short plain-English usage rules (`id`, `text`, `category`, `appliesTo`, right/wrong `examples`, `source`: `generated` | `user` | `learned`). Each scan regenerates the `generated` ones (`packages/scanner/src/rules/generate.ts`): accessibility basics always, plus one rule per accepted color, component and contrast suggestion and one spacing rule. It never touches `user`/`learned` rules, keeps a person's `enabled`/`severity`, and drops a generated rule once its decision is undone
- Also stores `exceptions`: Review flags a person marked intentional in the code with `// steward-ignore <rule>: <reason>` (or `{/* … */}` in JSX; only real comments count, never JSX text; covers the next line, including the whole opening tag or statement that starts there but never a whole function or component, or its own line after code; a reason is required). The comments are the source of truth: `steward check` honors them at once, and `steward scan` syncs the list (rule, file, found, reason, firstSeen; no line, no person)
- New colors: the first scan makes every color in use a token. On a re-scan, a color that wasn't in the system (and isn't defined in the Tailwind config or a CSS variable) is held out of the tokens; one used in 3+ places becomes a `token` suggestion that a person accepts (it joins the system on the next scan) or rejects (it stays drift and is never suggested again) with `steward decide`. An accepted one keeps its (decided) suggestion, so an undo holds the color out again and it waits again (`knownColors`)
- Merges apply only once accepted (principle 4): until then each color stays its own token (a near-duplicate goes by its hex, e.g. `color.gray.e4e4e7`) and each spacing step stands for its own uses; the suggestion carries the merged token as a preview. Accepting folds them in on the re-scan, and undo splits them again. Contrast is checked against the preview, so a pair's suggestion doesn't change when a merge is accepted. Contrast fixes are always a token or a Tailwind palette step; an accepted palette fix joins the tokens
- Pattern detection (Review): a hex color with no matching token that's used in 3+ places across the repo is suggested as a token instead of flagged, pointing at `steward scan`/`steward review` (colors only; never fails error mode). Once its token suggestion is rejected, Review flags it again
- `.steward/history.jsonl` (append-only, one JSON line per `steward check` run; `packages/model/src/history.ts`): date, scope, PR number (null locally), source type, files, changed lines, problems by rule (every rule, accessibility included), token suggestions, exceptions, fixes accepted (committed one-click suggestions; null outside a PR) and component share (system uses ÷ elements the system has a component for). Records are built from a fixed field list and refused otherwise, so names, emails, usernames and per-person counts can't get in; source type comes only from PR labels (`ai-agent`/`human`, configurable under `source` in config.json) or a known AI bot account, which is read and dropped. In GitHub Actions the record is also uploaded as a `steward-history-*` artifact, since the runner is thrown away. Report shows totals over time and by source type only, never per PR or per author. `steward history import` remembers the artifact ids it brought in (numbers only) in `.steward/history-imported.json` (`packages/model/src/history-imported.ts`) and skips them next time; like history.jsonl it's local and belongs in .gitignore
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
pnpm steward decide fixtures/messy-app        # lists suggestions still waiting for a decision (`review` still works as an alias; "Review" is the PR checks)
pnpm steward decide fixtures/messy-app --accept-all   # accepts them all, then re-scans so the merges are in the tokens (like the Setup screen)
pnpm steward context fixtures/messy-app       # prints design.md (Steward Brief) built from system.json
pnpm steward context fixtures/messy-app --file   # writes fixtures/messy-app/design.md (only over a design.md Steward wrote)
pnpm build && node packages/cli/dist/bin.js context fixtures/messy-app --serve   # Steward Brief MCP server over stdio (get_tokens, find_component, get_rules, check_snippet)
pnpm steward check fixtures/messy-app         # Steward Review on lines changed since the base branch (git diff against the merge-base, plus untracked files)
pnpm steward check fixtures/messy-app --all   # every TSX/JSX file (stories and tests left out); add --json for the full result, --base <ref> to pick the branch
                                              # .steward/config.json: { "mode": "warn" | "error", "base": "main", "rules": { "<rule-id>": "off" } }; "error" exits 1 when anything is found
node packages/cli/dist/bin.js check <path> --github   # in GitHub Actions only: line comments with one-click suggestions + one summary comment (warn mode never fails)
                                              # action.yml (repo root) is the composite action; example workflow + throwaway-repo test steps: docs/github-action.md
pnpm -F cli test       # includes the end-to-end scan test (builds first, runs dist/bin.js on a temp copy of the fixture)
pnpm -F guard test     # Review rules engine (packages/guard: one module per rule in src/rules; checkFile + applyFixes, shared by check_snippet and, later, the Review action)
pnpm -F context test   # design.md snapshot: packages/context/src/__snapshots__/messy-app.design.md (update with `pnpm -F context test -u`)
pnpm steward history import <path>   # downloads the Action's steward-history artifacts (GitHub login: GITHUB_TOKEN, GH_TOKEN or gh auth) and appends new records to <path>/.steward/history.jsonl (artifacts already imported, listed in .steward/history-imported.json, aren't downloaded again); --repo owner/name overrides the origin remote
STEWARD_REPO=/path/to/app pnpm -F web dev   # web app (Setup, Brief, Review, Report) on http://127.0.0.1:3000, this computer only (it writes system.json); relative paths resolve from where you ran it. The committed fixture opens read-only (it has FIXTURE_NOTES.md): use `pnpm -F web demo` to try decisions
pnpm -F web demo       # scans a fresh temp copy of the fixture (everything waiting), adds the Report's history from real test-repo PRs (apps/web/demo/history.jsonl, see its README) and starts the app on it; the committed fixture never changes
# Brief's "See the difference" reads scored eval runs from eval/results/<with|without>/<label>.json (+ <label>.png screenshots); STEWARD_DEMO_DIR points elsewhere
pnpm -F web theme      # regenerates apps/web/app/steward-theme.css from the fixture's tokens (the app uses only the system's colors and spacing)
pnpm -F web test       # theme, repo loading, summaries, and the dogfood test: Steward Review must find nothing in the app's own TSX
eval/setup.sh [dest]                   # before/after test: creates ~/steward-eval/{without,with} copies of the fixture (see eval/README.md)
eval/reset.sh ~/steward-eval/with      # puts a copy back to its baseline between runs
pnpm eval:score ~/steward-eval/with --label pricing-1   # runs the guard checks on lines the AI tool added; saves eval/results/<copy>/<label>.json
pnpm eval:summary                      # compares conditions (add --json for every finding)
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
2. **Product, not people.** Never store or display names, emails, usernames or per-person metrics. History may record only the _source type_ of code (`human`, `ai-agent` or `unknown`) and only in aggregate. The Report dashboard says so on the page: "Steward measures your UI, not your people."
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

1. `steward scan` on `fixtures/messy-app` produces `system.json` with suggested color merges and a spacing scale (merged once accepted), flags token pairs that fail contrast with a passing alternative, and prints a readable report
2. `steward context` produces `design.md` (including accessibility rules) and starts an MCP server that AI tools can connect to
3. The Steward Review action comments on a pull request in a test repo, flagging hardcoded colors, arbitrary spacing, raw `<button>` elements and the accessibility rules above
4. The web app shows the review screen and dashboard using real output from steps 1–3, with an accessibility measure and no per-person data anywhere
