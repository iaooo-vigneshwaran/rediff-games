#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
source_dir="$project_dir/upstream/everything/src"
output_dir="$project_dir/dist"

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("Node.js 22.12 or newer is required."); process.exit(1); }'

mkdir -p "$output_dir/assets"
cp "$project_dir/portal/index.html" "$output_dir/index.html"
cp "$project_dir/portal/assets/portal.css" "$output_dir/assets/portal.css"
cp "$project_dir/portal/assets/portal.js" "$output_dir/assets/portal.js"
cp "$project_dir/portal/dev-login.html" "$output_dir/dev-login.html"
cp "$project_dir/portal/dev-logout.html" "$output_dir/dev-logout.html"
cp "$project_dir/portal/assets/dev-login.js" "$output_dir/assets/dev-login.js"
cp "$project_dir/portal/assets/dev-logout.js" "$output_dir/assets/dev-logout.js"
cp "$project_dir/upstream/everything/LICENSE" "$output_dir/LICENSE.txt"

for game in chess checkers backgammon solitaire sudoku; do
  app_dir="$source_dir/$game"
  printf 'Building %s\n' "$game"
  (cd "$app_dir" && npm ci --no-audit --no-fund && npm run build)
  mkdir -p "$output_dir/$game"
  cp -R "$app_dir/dist/." "$output_dir/$game/"
  node "$project_dir/scripts/fix-metadata.mjs" "$game" "$output_dir/$game"
done

printf 'Site assembled in %s\n' "$output_dir"
