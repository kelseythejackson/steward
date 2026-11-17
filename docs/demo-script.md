# Steward: 3-minute demo script

Four segments, about 3:00 in total. Times are cumulative. **Say** is the narration, word for word. **Show** is what's on screen. ⚠️ marks a moment where a fallback (a pre-recorded clip or screenshot) lowers the risk.

## Before you present (not timed)

Run these from the Steward folder about 10 minutes before. They set up a fresh copy of the sample app, so the live scan and the Setup screen show the same app, with every suggestion waiting.

```sh
pnpm install && pnpm build
rm -rf ~/steward-demo && mkdir -p ~/steward-demo
rsync -a --exclude .steward --exclude FIXTURE_NOTES.md fixtures/messy-app/ ~/steward-demo/messy-app/
mkdir -p ~/steward-demo/messy-app/.steward
cp apps/web/demo/history.jsonl ~/steward-demo/messy-app/.steward/   # the Report's data: real checks from test-repo pull requests
STEWARD_REPO=~/steward-demo/messy-app pnpm -F web dev               # leave running; http://127.0.0.1:3000
```

Then open, in this order:

1. **Terminal**, in the Steward folder, with this command typed but not run: `pnpm steward scan ~/steward-demo/messy-app`
2. **Browser tab: Setup**, http://127.0.0.1:3000/setup. Before the scan it says there's no system yet. That's expected; you'll reload it.
3. **Browser tab: Brief**, http://127.0.0.1:3000/brief, scrolled to "See the difference".
4. **Browser tab: pull request #3** in the test repo ("Add a dismissible digest banner to the Dashboard"), Files changed view. [TODO: add the test repo's URL; it's private, so log in to GitHub in this browser first.]
5. **Browser tab: Report**, http://127.0.0.1:3000/report?period=all

**Fallbacks to have ready:**

- `docs/images/steward-review-summary-comment.png` and `docs/images/steward-review-line-comment.png`, in case GitHub or the network is slow. The summary screenshot shows an older headline; the live PR's wording differs slightly.
- `eval/results/without/pricing-1.png` and `eval/results/with/pricing-1.png`, the two pricing cards.
- [TODO: a 20-second screen recording of segments 1 and 2, in case the dev server or the scan misbehaves.]

To run it again, repeat the setup commands. They give you a fresh copy with everything waiting again.

---

## [0:00–0:45] Scan the messy app

**Say:** "This is a small React and Tailwind app, built fast, the way small teams build. Nobody has time to maintain a design system for it."

**Show:** The terminal. Run `pnpm steward scan ~/steward-demo/messy-app`.

**Say:** "Steward Setup reads the code and finds the system that's already there. Twenty-four colors, but really seventeen once near-duplicates merge."

**Show:** Point at `Colors: 24 colors → 17 tokens (14 grays → 9, 4 blues → 2)`.

**Say:** "Sixteen spacing values fit a seven-step scale. It also finds five components that are likely duplicates."

**Show:** Point at the Spacing and Components lines.

**Say:** "And nine color pairs fail contrast. Each one comes with a passing alternative. Nothing in the code has changed. These are only suggestions."

**Show:** Point at `Accessibility: 9 of 16 color pairs fail contrast (fixes suggested)`.

**What the audience should notice:** a mess turned into a short, plain-English summary, with the accessibility problems counted alongside the consistency ones.

## [0:45–1:25] Review and accept

**Show:** Switch to the Setup tab and reload. It shows "Accept all 24 suggestions" and four cards: Colors, Spacing, Components and Contrast.

**Say:** "This is the Decide step. People make the decisions here, not Steward. Every suggestion says why."

**Show:** On the Colors card, point at one merge and read its reason aloud. On the Contrast card, point at "`red-600` on `red-50`: 4.4:1, needs 4.5:1" and its fix, `red-700`.

**Say:** "I can accept, change or keep things as they are. I'll accept all twenty-four."

**Show:** Click **Accept all 24 suggestions**. Wait for "Saving and re-scanning…" to finish. ⚠️ This saves and re-scans live. If it hangs, switch to the recording.

**Say:** "Now the system is set up. Eighteen color tokens, a spacing scale, and twenty-five rules. Every decision can be undone."

**Show:** The heading now reads "Your design system is set up." The Contrast card reads "All 9 pairs fixed."

**Resulting state:** `system.json` has the merged tokens, `red-700` as an accepted contrast fix, and 25 rules. The app's code is unchanged.

## [1:25–2:15] Connect the AI tool and show before/after

**Show:** Switch to the Brief tab and scroll to the top. Point at the Claude Code card.

**Say:** "Steward Brief hands the system to AI coding tools. Each tool needs one MCP server entry and a pointer to design.md."

**Show:** Click **Copy** on "Add Steward's MCP server" to show the `claude mcp add steward …` command. Don't run it live.

**Say:** "The server runs on this machine. No code leaves it. The AI tool can ask which component to use, and check its own output."

**Show:** Scroll to "See the difference". ⚠️ These are saved results from an earlier run, not a live AI call. Say so if asked, and keep the eval screenshots open as a fallback.

**Say:** "Same prompt, same app: add a Pro pricing card to the Billing page. On the left, the AI tool had no system. On the right, it had Steward."

**Show:** The two cards side by side. Point at the counts.

**Say:** "Without Steward: four problems in thirty-three lines. Hardcoded grays that copy our tokens, and a one-off margin. With Steward: zero problems in fifty-two lines."

**Say:** "Notice the two cards look almost the same. The difference is in the code. That's exactly the drift nobody sees until it piles up."

**Show:** Point at the findings listed under "Without your system": `text-[#374151]`, `text-[#111827]`, `mt-[22px]`.

## [2:15–2:50] Open a pull request and show the Steward Review comment

**Show:** Switch to the pull request #3 tab, Files changed view. ⚠️ This needs GitHub and the network. If it's slow, use the line-comment and summary screenshots.

**Say:** "Here an AI agent opened a pull request: a banner on the dashboard. Steward Review ran as a GitHub Action."

**Show:** Scroll to the line comments.

**Say:** "It comments right on the changed lines. A hardcoded color. A clickable div that keyboard users can't reach. A raw button instead of our Button."

**Show:** Point at the comment on the `<div onClick>` line, then at a suggested change.

**Say:** "Where a fix is safe, it's one click: Apply suggestion. It never fails the build unless the team turns that on."

**Show:** Switch to the Conversation tab. Point at the summary comment: "Steward Review found 1 off-system value, 1 component to swap and 1 accessibility issue · 1 can be fixed in one click."

## [2:50–3:00] Show the dashboard

**Show:** Switch to the Report tab.

**Say:** "Steward Report tracks health across pull requests. Sixty-seven out of a hundred, by rule and by source. Steward measures your UI, not your people."

**Show:** Point at the health score (67 / 100), then the line "Steward measures your UI, not your people." at the bottom of the page.
