### Fixed
- If the team on turn has not rolled its fill-in persuasion check after 15 seconds, the host page shows the stuck row with 「🎲 替{隊名}擲骰」, and the room rolls the check for that team.
- A fill-in that ends before its question is shown (a natural 20, or the host judging early) now shows the question next to 「正解：…」 on the screen and on the phones, so players learn what they answered.
- The thief's 偷襲 on a fill-in waits until the question is up: the phone hides the button before the check, and the room refuses a crafted press with check_needed.
- A cleric's prayer retry now gets its own narration line (聖光降臨, answer again now) instead of the 「下一輪再答」 line. The LLM narrator is told the same.
