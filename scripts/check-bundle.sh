#!/bin/sh
# Fails if any question or answer text from the bank ships in the browser bundle (.next/static).
# Run after `next build`. Only server-only code may import the bank (see CLAUDE.md).
# Scope: the bundled data/question-bank.json. Questions saved in the bank editor live in
# BankStore at runtime and never enter the build, so they cannot leak through the bundle.
set -e
[ -d .next/static ] || { echo "run next build first"; exit 2; }
python3 - <<'PY'
import json, pathlib, sys
bank = json.load(open("data/question-bank.json"))
qs = [q for r in bank["rooms"] for q in r["questions"]] + bank["boss"]["questions"]
blob = "".join(p.read_text(errors="ignore") for p in pathlib.Path(".next/static").rglob("*.js"))
leaks = [q["id"] for q in qs if q["answer"] in blob or q["text"] in blob]
if leaks:
    print("LEAK in client bundle:", leaks[:5]); sys.exit(1)
print(f"ok: {len(qs)} questions and answers absent from the client bundle")
PY
