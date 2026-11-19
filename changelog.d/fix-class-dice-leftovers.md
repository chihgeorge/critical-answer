---
bump: patch
---
### Fixed
- A thief whose last 偷襲 never rolled its sneak die (the room restarted in the beat) can press 偷襲 again on that question. It still costs no second use.
- A caught 偷襲 (sneak die 1) now writes its deduction to the transcript, next to the 修正 lines, because no judgment records it.
- A game saved before the class-dice rework keeps its chef and thief 改判 rows: after a restart, 改成答對 on one of them rolls the dish die. Older rows still pay the plain reward they were judged with.
- The potion's "two bad dice" and "saved" lines no longer fire on a dish die of 2–6, which pays ×1 like 7–19.
- The host's cleric waiting row uses as many columns as it has buttons, so a cleric with no prayers left gets no empty column.
- `scripts/balance-sim.ts` plays the reworked dice through lib (a dish die on every correct turn-based answer and on a warrior's hit, and the real sneak die). The `REWORK`, `DISHALL`, `DISHM`, `SNEAK1*`, `SNEAKLOSE`, `CHEF*`, `HIDECRIT`, `HIDEDIE`, `CHEFFIX` and `NODIE` what-ifs are removed. Tooling only.
