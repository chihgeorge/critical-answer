---
bump: minor
---
### Added
- 🔮 占卜師 (the fortune teller): a ❓ room can now bring the fortune teller. The big screen shows a crystal ball for about 3 seconds and names a condition (most natural 20s, most natural 1s, most flees, most potions, most wrong answers, most correct answers, most mystery rooms, most kinds of dish, most terrible dishes), then a fortune pizza with a 15-second clock. The drawing team picks an effect on its phone — ✨ blessing, 💀 curse, 🧪 potion, 🙇 tribute or 🎁 relief — for every team the condition fits, itself included; time-out picks at random. The picked slice lights for a second, then an effect card names the matching teams until the host presses 下一題. Who matches is sent to no screen before the card, the host page included. The host can press 「立即隨機」 2 seconds past the deadline if the clock never fired. Manual pacing, restarts and a disconnected drawer are handled. Rules in `docs/rules.md`, design in `docs/designs/fortune-teller.md`.
- Per-team counts of natural 1s, correct answers and wrong answers (a wrong answer counts only when the team answers again next round), kept in the game log with each team's fortunes.

### Changed
- ❓ draws one of three scenes, one third each: the chest (feast or terrible dish, half each), the 神秘雕像 statue (blessing or curse, half each), or the fortune teller. The spring, the fairy and the old 大吉/中吉/凶 lot are no longer drawn.
- 女神的寵兒 and 詛咒磁鐵 count a fortune's blessing or curse for every team it hit.
