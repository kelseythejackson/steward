# Before/after test: does Steward Brief help?

This test compares UI written by an AI coding tool in two copies of the demo app:

| Copy | What the AI tool gets |
|---|---|
| `without/` | The app and a one-line `CLAUDE.md` describing it |
| `with/` | The same, plus `design.md` (loaded through `@design.md` in `CLAUDE.md`), `.steward/system.json` and the Steward MCP server (`.mcp.json`) |

Both copies are scored against the same reference: `fixtures/messy-app/.steward/system.json` in this repo. Only lines the AI tool added are counted, so problems already in the app don't count against either copy.

## Setup

```sh
pnpm install
eval/setup.sh                    # builds Steward, then creates ~/steward-eval/without and ~/steward-eval/with
eval/setup.sh ../my-eval         # or pick another folder (relative paths are resolved from where you run it)
```

The `with` copy's MCP server runs from `packages/cli/dist`. `setup.sh` builds it,
but if you change Steward's code afterwards, run `pnpm build` again before the
next run, or the server keeps the old behavior.

The copies have to live outside this repo, and `setup.sh` refuses a folder inside it. Claude Code reads every `CLAUDE.md` in parent folders, and this repo's `CLAUDE.md` describes Steward. If you've registered a Steward MCP server for this folder in your Claude Code settings, that would apply too. Either way, a copy inside the repo would get help in both conditions.

The setup script also removes everything that would hint at the planted problems: `FIXTURE_NOTES.md`, and the Steward name and description in `package.json`. `node_modules` isn't copied, so neither copy can be typechecked. That limit applies to both equally.

## The prompts

Paste each one word for word. None of them mention design systems, tokens or accessibility.

| Label | Prompt |
|---|---|
| `pricing` | On the Billing page, add a pricing card for a Pro plan at $29/month with a small plan icon, three features, and a 'Start free trial' button. |
| `settings` | Add a Notifications section to the Settings page with a form: email address, how often to send emails (instant, daily, weekly), and a Save button. |
| `dialog` | Add a confirmation dialog for deleting a project. Open it from a 'Delete project' button on the Dashboard. It should say this can't be undone, and have Cancel and Delete buttons plus a close icon in the corner. |

## Protocol

Do 3 runs of each prompt in each copy: 18 runs in all. For every run:

1. Reset the copy: `eval/reset.sh ~/steward-eval/<copy>`. This puts every tracked file back to the `baseline` tag and removes everything else, ignored files included (`node_modules`, `.steward/history.jsonl`). It keeps `.claude/`, where Claude Code stores your approval of the `steward` MCP server.
2. Start a **fresh** Claude Code session in that copy, using the same model every time. In `with/`, approve the `steward` MCP server the first time it asks.
3. Paste the prompt. Accept every edit. Don't send follow-up messages or corrections.
4. When it finishes, score it from this repo:
   `pnpm eval:score ~/steward-eval/<copy> --label <prompt>-<run>`, e.g. `--label pricing-1`

Alternate which copy goes first for each prompt, so neither one always benefits from you settling into the routine. One order that works:

| Round | First | Second |
|---|---|---|
| pricing-1, settings-2, dialog-3 | without | with |
| pricing-2, settings-3, dialog-1 | with | without |
| pricing-3, settings-1, dialog-2 | without | with |

Then compare:

```sh
pnpm eval:summary          # the table
pnpm eval:summary --json   # every finding, for a closer look
```

Results are saved in `eval/results/<copy>/<label>.json`. Scoring the same label twice is refused unless you add `--force`.

## What gets counted

- Steward Review's rules: `no-hardcoded-color`, `no-arbitrary-spacing`, `use-system-component` (raw `<button>` elements, plus components the team merged away, such as `<Card>` when the system says `Panel`), and the accessibility rules `a11y-img-alt`, `a11y-accessible-name`, `a11y-label-inputs`, `a11y-interactive-element`, `a11y-focus-visible` and `a11y-text-contrast`.
- **Problems per 100 added lines**, so a run that writes more code isn't penalized for that alone.
- **Unreadable files**: files that couldn't be parsed as JSX, so nothing in them was checked.

## Limits

- These are static checks. They catch some accessibility problems, not all, and they say nothing about whether the UI works or looks right. CSS files aren't checked.
- If the AI tool rewrites an existing line, any old problem on that line counts as new.
- Three runs per prompt is a small sample. Look for gaps that show up consistently across prompts, not a single run.
