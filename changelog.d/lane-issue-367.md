---
bump: minor
---
### Added
- The how-to-play intro grows from 4 to 7 pages: new pages teach the classes, the persuasion check (擲骰檢定) and the crit die, each with a small picture and a short owl line (#367).
- The bank can pin this game's boss: the bank editor's boss menu has 「🎲 每場隨機」 plus each boss, and works while room monsters are drawn. A new optional `randomBoss` field stores it; banks without it keep following `randomMonsters` (#367).

### Changed
- Player and big-screen text says 「擲骰檢定」 instead of 「DC」: the screen's chip reads 「🗣️ 說服擲骰檢定 12（+3）」, and the die's result line matches (#367).

### Fixed
- The boss room on the big screen's map strip draws this game's actual boss (drawn or the bank's), not a fixed slime king (#367).
