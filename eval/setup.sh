#!/usr/bin/env bash
# Creates the two copies for the before/after test:
#   without/  the app on its own
#   with/     the app plus Steward Brief (design.md loaded via CLAUDE.md, and the MCP server)
# Usage: eval/setup.sh [destination]   (default ~/steward-eval)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$REPO/fixtures/messy-app"
DEST="${1:-$HOME/steward-eval}"
BIN="$REPO/packages/cli/dist/bin.js"

case "$DEST" in
  "$REPO"|"$REPO"/*)
    echo "Put the copies outside this repo, or Claude Code will also read Steward's own CLAUDE.md and MCP server." >&2
    exit 1 ;;
esac
if [ -e "$DEST" ]; then
  echo "$DEST already exists. Remove it first, or pass another folder." >&2
  exit 1
fi
if [ ! -f "$BIN" ]; then
  echo "The MCP server isn't built yet. Run 'pnpm build' first." >&2
  exit 1
fi
for f in design.md .steward/system.json; do
  [ -f "$FIXTURE/$f" ] || { echo "Missing $FIXTURE/$f. Run 'pnpm steward scan' and 'pnpm steward context --file' on the fixture first." >&2; exit 1; }
done

PROJECT_LINE="This is Acme Metrics, a React + Tailwind web app (TypeScript). Source is in src/."

make_copy() {
  local dir="$DEST/$1"
  mkdir -p "$dir"
  # Everything except dependencies, Steward's files and the notes that list the planted problems.
  (cd "$FIXTURE" && tar --exclude=node_modules --exclude=.steward --exclude=design.md --exclude=FIXTURE_NOTES.md -cf - .) | (cd "$dir" && tar -xf -)
  # The package name and description mention Steward and the planted problems.
  node -e '
    const fs = require("fs"); const p = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
    pkg.name = "acme-metrics"; pkg.description = "Acme Metrics web app";
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
  ' "$dir/package.json"
  printf 'node_modules/\n.steward/history.jsonl\n' > "$dir/.gitignore"
}

make_copy without
printf '# Acme Metrics\n\n%s\n' "$PROJECT_LINE" > "$DEST/without/CLAUDE.md"

make_copy with
cp "$FIXTURE/design.md" "$DEST/with/design.md"
mkdir -p "$DEST/with/.steward"
cp "$FIXTURE/.steward/system.json" "$DEST/with/.steward/system.json"
printf '# Acme Metrics\n\n%s\n\n@design.md\n' "$PROJECT_LINE" > "$DEST/with/CLAUDE.md"
node -e '
  const [bin, dir, out] = process.argv.slice(1);
  const cfg = { mcpServers: { steward: { type: "stdio", command: "node", args: [bin, "context", dir, "--serve"] } } };
  require("fs").writeFileSync(out, JSON.stringify(cfg, null, 2) + "\n");
' "$BIN" "$DEST/with" "$DEST/with/.mcp.json"

for c in without with; do
  (
    cd "$DEST/$c"
    git init -q
    git add -A
    git -c user.name=steward-eval -c user.email=eval@localhost commit -q -m "baseline"
    git tag baseline
  )
done

echo "Created $DEST/without and $DEST/with, each with a 'baseline' tag."
echo "In $DEST/with, approve the 'steward' MCP server when Claude Code asks."
echo "Next: follow eval/README.md for the prompts and the run order."
