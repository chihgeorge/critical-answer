#!/bin/sh
# The local test runner gstack-pregate uses (.gstack/pregate.json "runner"): vitest only includes
# lib/**/*.test.ts, so selected e2e specs go to Playwright instead.
# shortcut: splits on spaces, fine while no test path has one; with both kinds in one call pregate reads only
# vitest's count, upgrade when a unit test is mapped in pregate.json.
set -ef # -f: paths like app/room/[code] must not glob
unit=""
e2e=""
for f in "$@"; do
  case "$f" in
    e2e/*) e2e="$e2e $f" ;;
    *) unit="$unit $f" ;;
  esac
done
if [ -n "$unit" ]; then npx vitest run $unit; fi
if [ -n "$e2e" ]; then npx playwright test $e2e; fi
