---
bump: minor
---
### Added
- 🍲 The team now eats its dish on the big screen. A second after the dish is served, the eating team's hero hard-cuts in beside it and takes three bites, 0.4 s apart: 「啊嗚！」, then 「嚼嚼」 while it chews. At 3.8 s only an empty plate is left, with two hearts and a 「嗝～」 and one short rising sound (only with 🎵 on). Each bite is cut out of the dish's own pixels (`biteCells`) and never touches the plate or the steam. Reduced motion, and a screen opened or refreshed after the serve, show the empty plate at once. The boss's final dish is not eaten, and the podium timing is unchanged. See `docs/designs/eat-dish.md`.

### Changed
- After 🍲 上菜, 下一題 now unlocks after 4.8 s instead of 2.6 s (`SERVE_HOLD_MS`), so the meal finishes before the next question.
