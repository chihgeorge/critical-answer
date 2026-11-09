---
bump: minor
---
### Added
- 岔路 (a fork): where a team used to draw an event room, it now comes to a fork. On its next turn the big screen shows two doors, ⚔️ 怪物房 and ❓ 神秘房, with a 15-second clock, and the team picks one with two big buttons on its phone that stay on screen. ⚔️ is the room's monster and question as usual; ❓ draws an event and applies it at once, giving up the room's reward and progress. No pick in 15 seconds takes ⚔️. Nothing on screen says what is behind either door, and the host cannot pick for the team. Every choice plays a 1.5-second door opening; a ❓ result shows only after it. Other phones read that the team is hesitating at the fork, the host page shows the seconds left, and the map marks a team waiting at a fork with 🚪. The game log records each door (timeouts too). Rules in `docs/rules.md`, design in `docs/designs/branch-fork.md`.

### Removed
- The event room's single phone button and the host's 「替{隊名}按」 button: ❓ opens the event in the same press.

### Changed
- The host's bank-size warning no longer counts room questions against teams × 9; it warns, and 開始遊戲 asks for one more confirmation, only when a room difficulty has fewer questions than teams.
- The narration and the podium title call event rooms 神秘房.

### Fixed
- A room whose last narration had more than three lines (a fork line, a potion, a buzzer reopening appended to it) no longer loses its save on restart; appended lines stop at 20, the most a save restores.
