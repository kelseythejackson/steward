# Steward

The self-maintaining design system.

Small product teams want their UI to stay consistent while they ship quickly,
more and more with AI tools, but they rarely have the people or time to maintain
a design system. Steward takes over the upkeep. It finds the colors, spacing and
components a React + Tailwind app already uses, turns them into a system, gives
that system to AI coding tools, and checks pull requests against it. People still
make the decisions: they accept or reject suggestions, mark exceptions as
intentional and approve new tokens.

Steward has four parts, all sharing one system model (`.steward/system.json` in
your repo, with tokens in the W3C Design Tokens format):

- **Setup** scans the repo, merges near-duplicate colors, builds a spacing scale
  and flags color pairs that fail contrast. Its **Decide** step is where you
  accept or reject the suggestions (`steward decide`, or the Setup screen).
- **Brief** writes a `design.md` context file and runs an MCP server, so AI
  coding tools build with your own components and tokens.
- **Review** checks pull requests (as a GitHub Action, or locally) and suggests
  fixes for off-system colors, spacing and components, plus basic accessibility
  problems.
- **Report** is a dashboard showing the system's health over time.

Steward currently supports React + Tailwind (including shadcn/ui-style) apps
written in TypeScript.

## Requirements

- Node 20 or later
- pnpm 12

## Quick start

The repo includes a deliberately inconsistent demo app, `fixtures/messy-app`,
to try Steward on.

```sh
pnpm install
pnpm steward scan fixtures/messy-app             # Setup: writes .steward/system.json and prints a report
pnpm steward decide fixtures/messy-app           # lists the suggestions waiting for a decision
pnpm steward decide fixtures/messy-app --accept-all   # accepts them all
pnpm steward context fixtures/messy-app          # Brief: prints design.md (add --file to write it)
pnpm steward check fixtures/messy-app --all      # Review: checks every TSX and JSX file
```

`pnpm steward` runs the CLI from source, with no build needed. Run
`pnpm steward --help` for every command and option. To start the Brief MCP
server, build first and run
`node packages/cli/dist/bin.js context fixtures/messy-app --serve`.

## The web app

```sh
pnpm -F web demo
```

This scans a fresh temporary copy of the fixture, so every suggestion is waiting
for a decision, and opens Setup, Brief, Review and Report at
http://127.0.0.1:3000. The Report uses real pull request history from
`apps/web/demo/`. The committed fixture never changes.

## More

- [Steward Review on GitHub pull requests](docs/github-action.md): the action and an example workflow
- [Before/after test](eval/README.md): does Brief help AI coding tools?
- [Demo history](apps/web/demo/README.md): where the Report's demo data comes from
- [The demo app's planted problems](fixtures/messy-app/FIXTURE_NOTES.md)

## Principles

- **Local by default.** Scans and checks run on your machine or in your own CI.
  No code is sent to an outside service.
- **Product, not people.** Steward never stores or shows names, emails,
  usernames or per-person metrics. Steward measures your UI, not your people.
- **Explain every suggestion.** Each suggestion or flag says why, with evidence,
  such as "contrast 2.8:1, needs 4.5:1".
- **Humans decide.** Suggestions never apply themselves, Review warns by default
  instead of failing the build, and accepted changes can be undone.
- **Raise the floor.** Steward never makes an inaccessible value official, and
  `design.md` includes accessibility rules for AI tools. Static checks catch only
  part of accessibility: passing them doesn't mean a product is accessible.
