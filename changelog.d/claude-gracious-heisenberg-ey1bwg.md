---
bump: minor
---
### Added
- Boss questions can each have their own difficulty (1–5). The bank editor shows a 難度 menu on every boss question; left alone it is 5, as before. A phase deals its questions easiest first (same difficulty keeps bank order; in a replay from the lobby, last game's questions go last within their difficulty), and the persuasion check's DC follows the question's difficulty. Questions in the ordinary banks have no menu, because their difficulty is the bank they sit in.

### Changed
- The bank format is now 9. A bank with a boss question marked with a difficulty is stored at 9, so a rollback to an older version makes the editor read-only and new rooms use the bundled default bank until the newer version is back, instead of dropping the difficulties; other banks keep their old format.
