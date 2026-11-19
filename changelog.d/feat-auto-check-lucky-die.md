---
bump: minor
---
### Changed
- The persuasion check now rolls by itself: when a team's fill-in turn opens outside the boss room, the room rolls the d20 on the big screen with no button to press. The phone reads 「🎲 說服骰馬上自動擲・過了給第一個字」 until it lands. A pass still gives the first character, a 20 still lets the team skip the question (with a dish die), and a 1 still halves the points. The phone's 「🎲 擲骰說服」 button and the host's 「好像卡住了」 / 「替○○擲骰」 row are gone. An older phone that still sends the roll gets a harmless refusal.
- The lucky potion is now the 🍀 幸運骰 (lucky die), and it still has to be pressed (「🍀 用幸運骰」). It goes on the team's next class skill die (洞悉, 祈禱, 衝鋒, 偷襲). A chef, a team with no class, or a team with no skill uses left puts it on its next dish die. It never goes on the persuasion check. When that die does not roll, the team keeps the lucky die. The host's give, the fortune teller and the wrongful-catch compensation still hand it out. The podium title is now 「🍀 骰子成癮」 (most lucky dice used), and the fortune condition is 「用最多顆幸運骰的隊伍」.
- Every user-facing 幸運藥水／藥水 is renamed to 幸運骰 (host page, phone, big screen, map, narration, rules, hosting guide, README, DESIGN.md), with the 🍀 icon.
- How-to-play page 3 now says the persuasion die rolls by itself. Page 6 explains the lucky die (skill die, or the dish die when there is no skill to use).

### Fixed
- `scripts/balance-sim.ts` now spends a potion on the die it doubled. Before, it was drunk in an inline argument, so it was never consumed. The sim now models the new rules: the check rolls itself, and the lucky die goes on the skill die, or on the dish die when no skill uses are left.
