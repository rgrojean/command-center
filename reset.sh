#!/usr/bin/env bash
# Close migration PRs, delete migration/pis-v3 branches, wipe state/ + workspaces/.
# Does not touch the sibling working trees under cursor_sdk_project/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
exec ./node_modules/.bin/tsx src/reset.ts "$@"
