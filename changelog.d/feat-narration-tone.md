---
bump: minor
---
### Changed
- **The narrator talks less on ordinary turns.** A plain correct answer, wrong answer or flee is now two lines: what happened, then whose turn it is. The atmosphere line is kept for the opening, boss hits, a new boss phase, the boss kill, event rooms, a natural 20 or 1, and the game's last line. A turn with a host-queued 「下一句這樣說」 line still has three lines, with the host's line second. The AI is also asked for shorter lines (22 characters, down from 28).
- **Scripted lines repeat less.** Each kind of event now has 10 atmosphere lines instead of 4, and a room monster has 10 handoff lines instead of 5. Every line of a set plays once before any repeats, and the same line never plays twice in a row. A few lines that said one thing twice are gone.

### Fixed
- When the AI writes more lines than a turn needs, its last line is used as the handoff, so the next team is still called.
