#!/usr/bin/env bash
# Puts a copy back to its baseline before the next run. Only touches the copy you name.
# Usage: eval/reset.sh ~/steward-eval/with
set -euo pipefail
DIR="${1:?Usage: eval/reset.sh <copy folder>}"
cd "$DIR"
git rev-parse --verify --quiet 'baseline^{commit}' >/dev/null 2>&1 || { echo "$DIR has no baseline tag. Is this an eval copy?" >&2; exit 1; }
git reset -q --hard baseline
# -x also removes ignored files (node_modules, .steward/history.jsonl), so every run starts from the same state.
# .claude/ stays: it holds your approval of the copy's MCP server.
git clean -q -fdx -e .claude
echo "Reset $DIR to its baseline."
