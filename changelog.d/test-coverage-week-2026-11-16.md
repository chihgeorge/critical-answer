---
bump: patch
---
### Fixed
- The e2e test 「screen TTS: LOBBY (room reset) cancels in-progress speech」 no longer fails now and then on CI. Pages that earlier tests opened stayed open for the whole shard, still connected and busy, and the extra load could hold up the second phone's roster for more than 5 seconds. `narration-tts.spec.ts` now closes them before each test.
- `scripts/eslint-config.test.ts` gets 30 seconds per test, because loading the ESLint config can take longer than 5 seconds on a busy machine.
- The unit tests for the team-id fallback on insecure (http) pages now really reach that fallback. Before, an id kept by an earlier test answered for them, so they passed without running it.

### Added
- e2e checks for this week's features: the big screen's 「⏸ 遊戲暫停中，等隊伍連回」 line, the 「主持人重新連線中」 banner on the big screen and a phone (and that it goes away when the host page is back), 🌑 螢幕變暗 dimming the big screen and turning off again, 「下一個是我們！」 while an answer is on show, the lobby's 進王門檻 menu (10/12/15) reaching the game, and 取消 on the 🧪 給藥水 confirm giving nothing.
- Unit tests for the ❓ room result line and for the join password kept in sessionStorage.
