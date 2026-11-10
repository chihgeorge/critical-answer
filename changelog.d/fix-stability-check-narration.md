### Fixed
- A natural 20 on a persuasion check that a restart cut off is no longer won by a team in the next game after 回到大廳. One whose win failed (`roll_failed`), whose turn moved on during the beat, or that the host ruled on first is marked `dropped`, so a later restart no longer wins it.
- A lost natural 20 now waits 4 seconds after the last sound cue, so it no longer replaces that cue in the same moment.
- A phone that JOINs with a team id holding a colon now sees 「加入失敗」 (`invalid_team_id`) instead of nothing.
- A 下一句這樣說 typed in the game that ended and sent late, after 回到大廳, is refused (`stale_game`, shown on the host page) instead of being said in the next game.
