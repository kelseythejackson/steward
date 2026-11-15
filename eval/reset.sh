#!/usr/bin/env bash
# Puts a copy back to its baseline before the next run. Only touches the copy you name.
# Usage: eval/reset.sh ~/steward-eval/with
set -euo pipefail
DIR="${1:?Usage: eval/reset.sh <copy folder>}"
cd "$DIR"
git rev-parse --verify --quiet 'baseline^{commit}' >/dev/null || { echo "$DIR has no baseline tag. Is this an eval copy?" >&2; exit 1; }
git reset -q --hard baseline
git clean -q -fd
echo "Reset $DIR to its baseline."
