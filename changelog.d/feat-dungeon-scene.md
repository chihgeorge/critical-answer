---
bump: minor
---
### Added
- The big screen's dungeon is lit by torches. Two torches stand beside the question panel (and beside the lobby's campfire), and their light falls on the wall in banded steps; the rest of the room sits in a darker ambient that is never darker than the old scene under 🌑. The boss room is the darkest room.
- The room is built, not flat: rough stone in four shades with cracks, a deep stone arch with a raised iron portcullis, chains (vines in the water rooms), cobwebs in the corners and two skull niches beside the arch.
- The dungeon goes deeper floor by floor: rooms 1–2 are 入口石牆, 3–4 are 苔蘚水道 with a water channel, 5 on are the new cold blue-grey 幽暗深淵. During a question the panel shows a chip such as 「地下 3 樓・苔蘚水道」 next to the difficulty (none in the boss room).
- The live map is a cross-section of black rock: each reached room is lit in its own floor's stone, and the way not reached yet is solid dark instead of clouds. It lifts one step once the boss door opens.

### Changed
- To bring back the old look: set `DUNGEON_ART = false` in `lib/pixel-art.ts` and deploy, or, without a deploy, open the big screen as `/room/CODE/screen?art=classic#s=…` (that screen only; phones and the host page keep the new stone).
