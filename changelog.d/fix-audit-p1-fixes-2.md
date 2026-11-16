---
bump: patch
---
### Fixed
- A connection that still looks open but is dead (the venue AP quietly dropped an idle link, or a laptop slept for a moment) is now noticed. After 15 seconds with no message from the room, the page sends a small ping. After 45 seconds with no answer, it reconnects by itself and shows 「連線中斷，重新連線中…」. The ping does not keep an idle room awake, and nothing runs while the page is hidden or resting.
- The big screen's 「畫面出錯了」 page now reloads by itself after 5 seconds, at most once a minute. A page that crashes on every load tries again about once a minute. Host and phone pages keep the 「重新載入」 button only. After the reload the big screen needs one tap for sound.
- The game-log download (`GET /api/game-logs`) takes `from` and `to` (inclusive dates or ISO time prefixes, UTC) and `before` (exclusive, for the next page). The owner can now get the 11/21 games even after more than 1000 newer games are stored. A value that is not a date gets 400.
