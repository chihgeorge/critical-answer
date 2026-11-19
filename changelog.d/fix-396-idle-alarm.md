---
bump: micro
---
### Fixed
- A room alarm that ran a few milliseconds before its own time set that same time again. The platform treats an unchanged alarm as handled and deletes it, so the room then never closed idle connections or expired. It now sets the next check 1 ms later (#396).
