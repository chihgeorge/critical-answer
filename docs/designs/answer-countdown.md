# Answer countdown (每題作答倒數)

Owner request, 2026-11-08: 「新增一功能是每題有倒數計時回答時間」. Decisions taken with the owner on 2026-11-07, one question at a time. Smallest version that works at the 2026-11-21 event.

## Decisions

- **D1 — At 0 it only nudges.** The room does not judge anything when the clock runs out. The big screen, the turn's phone and the host page show 「⏰ 時間到」; the host still judges (or uses the stuck row that already appears after 15 s). So no rule, class ability or boss rule changes, and no server timer has to fire.
- **D2 — 60 s by default, set per game in the lobby.** The host picks 關／30／45／60／90 秒 next to 「開始前播放玩法說明」. It is fixed for the game. No per-question time in the bank editor.
- **D3 — When it runs.** It starts when the turn's question is up, and stops once the team has answered: a lock waiting for 公布答案, a typed answer sent, a warrior's or crit die in its beat, a wrong answer waiting for 重答／逃跑, or the host's judgment. 重答 and 逃跑 start a fresh full count; so does every new turn (the boss's shared question too, per team). A mage hint and a thief's sneak do not stop it. A fill-in question is check first, question after (owner, 2026-11-09): the question is not up until its team's persuasion check is rolled, so there is no count during the check and it starts, at the full time, when the check's 2 s beat ends. (Before that date the count started with the turn and ran through the check; the round clock then covered the 「擲骰說服」 sign on the big screen.) It does not run during the intro, 擲先攻, the reveal, the boss phase card, or anything that is not a question (event cards: the room has no current question then; a team choosing at a fork has none either, and after ⚔️ the count starts once the 1.5 s door opening ends — branch-fork.md).
- **D4 — A video waits for its clip.** On a YouTube (or music) question the count starts only once the big screen reports that the clip has ended (`SCREEN_CLIP_ENDED`). Until then the host page shows 「▶ 影片播完後開始倒數」. A clip already played for that question (a 重答, or the next team on the same boss question) does not wait again. A clip that ends while the team's answer waits still counts, so the 重答 does not wait. If the host never plays it, or the video cannot play (venue Wi-Fi), there is no count: it is only a nudge.
- **D5 — Where it shows.** Big screen: a large round clock to the right of the monster (option B of the preview). When option or sort tiles fill the wall, that spot sits on the B/D tiles, so the clock becomes a 「⏱ 42」 pill under them, right-aligned with the tiles (pre-event design review, 2026-11-08). Turn team's phone and host page: a 「⏱ 42」 chip. The last 5 seconds turn red and the big screen ticks once a second; at 0 it plays a short buzz and shows 「⏰ 時間到」. Phones make no sound.
- **D6 — No pause or extend button.** Not asked for the event; add later if the host misses it.

## How it works

- **Server-authoritative**, like 擲先攻's countdown: the room holds `{ key, endsAt }`, where `key` is `teamId:questionId`. Every STATE carries `answerClock: { left }` (ms left when it was sent) or `{ left: null }` while a video's clip has not ended. Clients only count down from `left`.
- `nextAnswerClock(prev, want, now, ms)` (lib/answer-clock.ts) is the whole rule: no `want` clears the clock; the same `want` keeps the deadline; a new `want` starts a fresh one. Because the clock is cleared while an answer waits, a 重答 on the same question starts again from the full time.
- **Restart.** `answerSeconds`, the clock and the ended clip are in the snapshot. `endsAt` is a wall-clock time, so a restarted room keeps the remaining time (time spent down counts, as it does for the players watching).
- **Offline team.** Mostly nothing special: when the turn moves past an offline team the key changes and the next team gets a fresh count; a team that keeps the turn offline (a typed answer or a wrong answer waiting) has no running clock anyway. Known limit: a team whose phone drops while others are online is skipped, and gets a fresh count when the turn comes back to it. Accepted: it is a nudge, and the turn moved on meanwhile.

## Sibling lanes

- Event rooms (merged in v0.53.0.0): a team in an event room has no current question, so no clock; while the opened event's result is on show (`eventReveal`) the room is paused, so the next team's clock starts only after 下一題 (event-rooms.test.ts). Since branch-fork.md the event comes from a fork's ❓ door; the fork's own 15 s are not the answer countdown (branch-fork.test.ts).
- Boss music buzzer: not designed yet. If it adds a turn that is not "the turn's team answers the current question", it should return no `want` for that state.
