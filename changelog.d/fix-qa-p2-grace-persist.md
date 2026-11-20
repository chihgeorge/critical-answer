---
bump: patch
---
### Fixed
- The host can no longer judge the next team during the 5 seconds before its persuasion check rolls (after a 答錯): its question is not out yet. The room refuses it and the host page keeps the judge buttons dark until the check rolls.
- A room restart (a deploy) after a correct answer's reveal and before its dish die lands no longer replays the question: the reveal comes back, and a die already rolling lands on the same number.
- In the boss room, once the answer clock shows 「⏰ 時間到」, the team on turn can no longer pick or lock an answer; a lock made in time still reveals, and the host's 下輪換題 counts the turn as wrong.
