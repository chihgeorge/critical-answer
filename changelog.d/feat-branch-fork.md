---
bump: minor
---
### Added
- 岔路 (a fork): where a team used to draw an event room, it now comes to a fork. On its next turn the big screen walls up the middle arch and shows a door in a doorway on each side, marked only 左門 and 右門, with a 15-second clock, and the team picks one with two big buttons on its phone that stay on screen. Which side hides ⚔️ 怪物房 and which ❓ 神秘房 is drawn by the server at every fork and sent to no screen, the host page included. ⚔️ is the room's monster and question as usual; ❓ draws an event and applies it at once, giving up the room's reward and progress. No pick in 15 seconds opens the ⚔️ door. The host cannot pick for the team. Every choice plays a 1.5-second door opening that names only the opened door's room; the other door dims unnamed, and a ❓ result shows only after the opening. Other phones read that the team is hesitating at the fork, the host page shows the seconds left, and the map marks a team waiting at a fork with 🚪. The game log records each fork's side, the room behind it, and whether time ran out. Rules in `docs/rules.md`, design in `docs/designs/branch-fork.md`.

### Removed
- The event room's single phone button and the host's 「替{隊名}按」 button: ❓ opens the event in the same press.

### Changed
- The host's bank-size warning no longer counts room questions against teams × 9; it warns, and 開始遊戲 asks for one more confirmation, only when a room difficulty has fewer questions than teams.
- The narration and the podium title call event rooms 神秘房.
- CLAUDE.md routes architecture questions to /autoplan.

### Fixed
- A room whose last narration had more than three lines (a fork line, a potion, a buzzer reopening appended to it) no longer loses its save on restart; appended lines stop at 20, the most a save restores.
