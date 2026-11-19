---
bump: patch
---
### Fixed
- During the boss's 「首領被擊敗了！」 beat, before the four kill dice roll, the host page and the phones stay held as they are during the dice: their judge and ability buttons no longer reopen for two seconds. The big screen still shows the defeated boss first (#394).
- 🚨 成立 sends the one 逃跑 value the room now uses; the accused team still flees and keeps its monster. The anti-cheating design note no longer mentions 逃跑・同房.
- The idle-close e2e test (`e2e/lifecycle.spec.ts`) checks the close codes separately and waits for the second idle close until the room's end instead of a fixed 15 s. It also keeps the test worker's log in `test-results/` so the next CI failure can be read (#396).
