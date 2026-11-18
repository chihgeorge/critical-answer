---
bump: patch
---
### Changed
- `scripts/balance-sim.ts` (tooling only, no game change) now models 抓包與神諭 (oracle use, a cheating team, catches upheld or dismissed, with the `CATCH_PAY` values as knobs), rates boss questions the way the game does (unset = difficulty 3, plus `BOSSD` / `BUZZD` for a bank's ratings), takes the room layout as `ROOMS`, and prints a 95% interval next to each win share.
