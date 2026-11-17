# Demo history

`history.jsonl` is the Report's data for `pnpm -F web demo`. Every record is a
real Steward Review check, made by the GitHub Action on pull requests to a
private test repo built from the fixture (the steps in
`docs/github-action.md`), then brought in with `steward history import`.
Nothing in it is made up or edited.

What the pull requests were (all opened 2026-11-17, each pushed twice):

| PR | Source label | Change | Second push |
| --- | --- | --- | --- |
| 1 | `human` | The docs' three off-system lines on Settings | Applied Steward's one-click suggestion |
| 2 | `ai-agent` | A Pro plan card on Billing | Applied Steward's one-click suggestion |
| 3 | `ai-agent` | A dismissible banner on the Dashboard | Named the icon-only dismiss button |
| 4 | `human` | A copy edit on Settings | Another copy edit |

All checks fall in one week, so the Report shows the score but not yet a trend.
The Report's default period is the last 30 days: after 2026-12-17, choose
**All time** to see these checks.

Like all Steward history, it holds no names, emails or usernames: only counts,
dates, PR numbers and the source type.

## Refreshing it

From the Steward folder, with the test repo cloned at `~/steward-action-test`:

```sh
pnpm steward history import ~/steward-action-test
cp ~/steward-action-test/.steward/history.jsonl apps/web/demo/history.jsonl
```
