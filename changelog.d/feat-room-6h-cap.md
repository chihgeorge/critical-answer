---
bump: minor
---
### Changed
- A room now closes 6 hours after its first connection, even while a game is on (it used to be forgotten only after 24 hours with no action, and every action pushed that back). It closes the same way as before: close code 4002 and 「房間已過期」 on every screen. The 2-hour idle rest is unchanged. The creation time is saved with the room, so a server restart does not restart the clock; a save from before this dates the room from its last action.

### Added
- With 15 minutes left, the host page (only the host page) shows 「房間再 15 分鐘關閉」 and a 「延長 1 小時」 button. Each press moves the end 1 hour past the current one and the warning comes again before the new end; it can be pressed again and again up to 24 hours from creation, then shows 「已達上限」. The extension is saved with the room. Guide in `docs/hosting.md`.
