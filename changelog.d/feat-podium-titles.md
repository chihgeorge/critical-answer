---
bump: minor
---
### Added
- Every team is named at the podium. Before the places are called, the narrator hands out honor titles, one 2.5-second beat each, with a yellow card in the middle of the big screen showing the title, the heroes, the team names and the reason: 🗺️ 探險家, ✨ 女神的寵兒, 💀 詛咒磁鐵 (the fortune teller's 凶 counts), 🤢 腐肉品嚐家, 🏃 逃跑大師, 🍲 大胃王, ⚡ 閃電突擊 (fewest turns to reach the boss room by the team's own correct answer) and 🎲 大成功王 last. Each title goes to every team tied on the best value, in team order, never for a value of 0. A team with no title gets a 🌟 title the AI makes up from its own play (no score, no place, no other team's name; a line that hints at a place falls back), or 🛡️ 堅持到最後的冒險者 when the AI is off or fails. Each title beat opens on the 🎵 correct chime (🎲 on the crit chime), and emoji are not read aloud. Titles add no points and do not change the places. Under reduced motion the end screen lists each team's title icons in a still card instead. The game log records each team's data titles by id (`teams[].titles`), and teams now count their flees. `docs/rules.md` and `docs/designs/podium-titles.md` have the details.

### Removed
- The separate 本場大成功王 beat and its card on the right of the end screen: 🎲 大成功王 is now one of the titles.
