---
bump: minor
---
### Added
- **Music questions can ask for 2–3 answers at once.** In a buzzer phase, a sound-only YouTube question can split its answer into named fields, such as 「歌名」 and 「歌手」. The bank editor shows 「+ 加答案欄位」 on those questions only. The buzzing team's phone shows one box per field; boxes may stay blank, but at least one needs text before 送出 (or the team just answers out loud).
- The host judges each field with ✓/✗ and then presses 送出判定. Each right field takes 1 HP off the boss, and the hit reward is paid in proportion to the fields right; the kill's 4d20 bonus is not scaled. Judge keyboard shortcuts are off on these questions, and 「↩ 重新逐欄判定」 reopens the per-field panel after a wrong call.
- The big screen marks each field ✓ or ✗ in the reveal and, on a partial answer, adds 「{隊名} 對 k/n：打掉 k 格血、獎勵拿 X%」.
- A boss phase can now have up to 60 HP. Above 20 the big screen draws an HP bar with the number instead of hearts. Raise a phase's HP when it holds multi-field questions.
- A bank with answer fields saves as bank format 7. Design: `docs/designs/multi-field.md`.

### Changed
- In a buzzer phase, what a team types goes to the host only; other teams' phones no longer receive it.
- The `minimatch` used by the TypeScript lint tooling is pinned to 11.0.1 or later.
