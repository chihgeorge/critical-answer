---
bump: patch
---
### Fixed
- While an answer is revealed, the big screen and the phones no longer receive the next question's text early: STATE blanks it until 下一題, and the host page still previews it (#362).
- The answer countdown on a phone, the big screen or the host page stands still while that page is disconnected, and jumps to the room's figure on reconnect. The rules now say the time keeps running during a server restart (#406).
- After a boss-entry dish, the narrator says the entrance (and its 最後衝刺 line) before handing over to the next team, also after a restart; a failed beat restore is now logged (#394).
