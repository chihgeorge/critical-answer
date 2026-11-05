#!/bin/sh
# The local test runner gstack-pregate uses (.gstack/pregate.json "runner"). Unit tests only:
# Playwright e2e runs in GitHub CI, never here (it overloads the dev machine).
set -ef # -f: paths like app/room/[code] must not glob
exec npx vitest run "$@"
