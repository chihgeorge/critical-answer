---
bump: minor
---
### Added
- **Boss music buzzer, part 2.** When every online team gets a song wrong, the same song opens again for everyone instead of moving on; only the host's 「沒人答對，換下一題」 changes it. The narrator says so (「都沒答對！同一首再搶一次！」).
- The team that buzzed can type its answer on the phone if it wants; the text shows on the host page next to 「搶到了」. Answering out loud still works, and the host still judges.
- The big screen's background music stays quiet from a buzz until the host judges, so the room hears the answer.
- When the big screen cannot play a YouTube clip, the host page shows a red warning and a 「🎤 現場放歌，開放搶答」 button: the host plays the song from their own phone or speaker and buzzing opens without the clip.
- Questions can carry an optional 「類別」 (category). In a buzzer phase the editor shows the field; after a right answer, the winning team's phone offers the categories that still have songs left, and the next song comes from the one it picks (it can change its mind until the host presses ▶). The big screen shows 「下一題：{類別}」. A bank with a category saves as bank format 6. Design: `docs/designs/boss-music-buzzer.md`.
