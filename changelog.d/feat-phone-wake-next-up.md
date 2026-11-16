---
bump: minor
---
### Added
- Player phones keep the screen awake (Screen Wake Lock, asked again when the page comes back), so a team that waits several turns no longer locks its phone, drops offline and has its turn skipped. A browser without it, or one that refuses, sleeps as before.
- A team's phone vibrates once the moment its turn opens and it can answer (where the browser can vibrate; Safari on iPhone cannot).

### Fixed
- While the last answer, an event room's result, a fortune's effect card or a boss phase card still holds the room, the next team's phone says 「下一個是我們！」 (we are next!) instead of 「輪到我們了！」 (our turn!), since it cannot answer yet.
- The lucky potion's small print names the die it doubles: 「答對時的暴擊骰擲兩次取高」 on a multiple-choice or sort question (a warrior also reads 「戰士的答題骰不算」, the warrior's answer die does not count), 「說服檢定擲兩次取高」 on a fill-in question. The drunk line on the team card says the same.
