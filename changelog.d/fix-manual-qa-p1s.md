---
bump: patch
---
### Changed
- Manual pacing (⏸ 手動) now stops only where the room would move on by itself. A step your own press starts plays out on its usual time: the beat after 公布答案, the 🎲 擲料理骰 die, and the persuasion die with its success card. A correct answer now takes 4 presses: 公布答案 → 擲料理骰 → 上菜 → 下一題. The warrior's charge die lands by itself too. Initiative, a fork, the oracle, the mage, cleric and thief dice, a boss miss, the boss phase card, the defeated boss and the kill dice, and the podium still wait for ▶ 下一步. The 「⚙ 更多」 label now says so.
- At a fork or the oracle in manual, picking for the team is its own 「⏰ 時間到（替隊伍選）」 button with no key. Pressing `1` out of habit no longer picks for the team.

### Fixed
- After a correct answer, the answering team's phone says 「答對了！」 through the reveal, the dish die and 上菜, instead of 「下一個是我們！」.
- A missed warrior charge now stays on screen before the next team, for example 「⚔️ 戰士隊衝鋒大失敗 −20（擲出 1）」. It shows on the big screen and the phones, and in manual it waits for ▶ 下一步. A phone that drops during it still takes the miss.
- The big screen no longer falls back to the buzz screen (「X隊 搶到了！」, full hearts) while the kill dice roll after a buzzed finishing blow. It stays on the defeated boss.
- The narrator no longer reads the turn's opening lines twice when a persuasion check passes, the game's opening lines included.
