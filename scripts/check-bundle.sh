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
# A bank from before boss phases keeps one question list on the boss itself.
phases = bank["boss"].get("phases") or [{"questions": bank["boss"]["questions"]}]
qs = [q for p in bank["pools"].values() for q in p] + [q for ph in phases for q in ph["questions"]]
# A later phase's name and rule are secret until its card opens (docs/designs/boss-phases.md).
secrets = [s for ph in phases[1:] for s in (ph.get("name"), ph.get("rule")) if s]
blob = "".join(p.read_text(errors="ignore") for p in pathlib.Path(".next/static").rglob("*.js"))
answer = lambda q: q["options"][q["correctIndex"]] if q["kind"] == "multipleChoice" else q["answer"]
leaks = [q["id"] for q in qs if answer(q) in blob or q["text"] in blob]
leaks += [s for s in secrets if s in blob]
if leaks:
    print("LEAK in client bundle:", leaks[:5]); sys.exit(1)
print(f"ok: {len(qs)} questions and answers absent from the client bundle")
PY
