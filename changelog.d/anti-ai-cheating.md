---
bump: minor
---
### Added
- 🚨 抓包與神諭 (catch and oracle), against players quietly asking an AI on their phones. Off by default; the host turns it on from 「⚙ 更多」, the big screen shows a red-and-black banner once and the owl reads the rules. Each team then gets 🔮 1 public oracle and 🚨 2 catches for the game; a late team let in while it is on gets them too.
- 🔮 公開問神諭: on its own turn, before sending or locking, a team may ask the oracle in public. A correct answer on that question pays half the base reward (like a persuasion natural 1 or a curse, never a quarter), and the question cannot be caught. The big screen and host page show 🔮 on the question; the oracle follows the question through 下輪再答.
- 🚨 抓包: a waiting team (one already in the boss room included) may report the answering team once per question per turn. Everything on that question is held and the countdown stops until the host rules on a ruling card (keys 7 / 8). 成立 (upheld): the question scores 0, the big screen shows its answer, the team is made to flee to a new question one difficulty lower, loses 10 (never below 0, not counted as a flee), and the reporter gains 15. 冤枉 (false alarm): the reporter loses 10 (never below 0) and the answering team gets a lucky potion, or 10 when it already holds one. Switching off, the game ending or sending the accused to the boss room cancels a catch and refunds it.
- The game log records each team's oracles and catches (filed, upheld, false alarms, cancelled) and how many times the switch went on. Rules in `docs/rules.md`, design in `docs/designs/anti-ai-cheating.md`.
