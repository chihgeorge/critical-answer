---
bump: minor
---
### Added
- 美食節目／生物學家口吻 (foodie narration): about three narrator lines in ten now judge a monster as an ingredient, with a straight face, for example 「輪到紅隊。史萊姆看起來很有嚼勁。」 and 「貓頭鷹已經在翻食譜了。」. Food talk comes only when a monster or the boss comes on, when a monster is beaten and when a dish is eaten; a wrong answer, a flee and a die roll keep the adventure tone. Scripted narration does not say two food lines in a row, except when a chest dish follows a food line. The AI prompt asks for the same share and limits, and is told the catalog's edible part of a beaten monster (for example 「外膜」) so it can comment on it; the dish is still named only once it is served. Guide in `docs/hosting.md`, design in `docs/designs/monster-cuisine.md`.

### Changed
- A beaten monster that will be cooked now draws its scripted line from 10 lines (13 with the edible part) instead of 3, so a scripted game repeats itself less.
