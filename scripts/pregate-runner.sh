#!/bin/sh
# The local test runner gstack-pregate uses (.gstack/pregate.json "runner"). Unit tests only:
# Playwright e2e runs in GitHub CI, never here (it overloads the dev machine).
set -ef # -f: paths like app/room/[code] must not glob
# A change that touches only e2e specs hands this runner nothing but e2e files; vitest finds no test in them and
# exits 1. Drop them here: CI runs them.
for f in "$@"; do
  shift
  case "$f" in e2e/*) ;; *) set -- "$@" "$f" ;; esac
done
[ $# -gt 0 ] || { echo "pregate-runner: only e2e specs selected; they run in GitHub CI"; exit 0; }
exec npx vitest run "$@"
