# Design: 叉路 (a fork: ⚔️ monster room or ❓ mystery room)

Planned with /autoplan on 2026-11-09 (CEO, design, eng and DX reviews; plan and reviews local-only under
`~/.gstack/projects/chihgeorge-critical-answer/captain/branch-fork-*`).
Status: APPROVED
Mode: Builder

## Problem Statement

Event rooms ([event-rooms.md](event-rooms.md)) gave a team one button and no choice. The owner wanted the old 「冒險出現叉路」
choice back on the phones (TODOS.md), and wanted it to matter. A fork replaces the event-room draw: the team picks
between two doors and lives with the result.

## Decisions

- **Trigger unchanged.** Where an event room used to be drawn (a correct answer into a new room, `EVENT_CHANCE` 25%,
  never into the boss room or the last room, never out of a mystery room), the team now comes to a fork. A room the team
  took ⚔️ into draws nothing when it walks out (`Team.fork = { phase: "monster" }`), so two forks are always a room apart.
- **When the team chooses.** The draw only marks the team (`{ phase: "waiting" }`, 🚪 on the map, 「🚪 在叉路口」 on the
  host page). Its next turn opens with the choice (`{ phase: "choosing", deadline }`), and only once the room is not paused
  (a reveal, an event result, a phase card, the intro), the same rule as the answer countdown. Other teams never wait.
- **Two unmarked doors, sides drawn by the room** (owner, 2026-11-09, replacing the first labelled doors). The big
  screen, the team's phone and the host page show only 左門 and 右門. When the door clock starts, the room draws which side
  hides ⚔️ with its own `rng` (`Fork.monsterSide`, saved with the game, so a restart keeps it) and sends it to no screen,
  the host's included; tests check that no message to any connection names it. The team presses a side
  (`TEAM_CHOOSE_FORK { side, eventId }`), and the room maps it to a door. A save with a choosing fork and no usable side
  loads as waiting and draws again. e2e pins the side with the worker var `E2E_MONSTER_SIDE`.
- **Layout B on the big screen** (owner, 2026-11-09). The fork's background bricks up the middle arch with the room's own
  wall and opens a doorway on each side (`drawScene(..., "fork")`, `FORK_ARCH`); each door sprite sits inside its doorway
  with a pixel to spare, the 左門 / 右門 nameplate above it.
- **What each door means** stays off screen. The trade-off (give up the room's reward, dish and progress for an event, and skip the room) is written in
  [docs/rules.md](../rules.md) for the host, never on screen.
- **Nothing to spoil.** The event is drawn when ❓ is pressed (`drawEvent`), not at the fork. While the team is at the
  fork, the room has no current question (`null` to every screen), and the narration gets a neutral line
  (`NEXT_FORK_VARIANTS`); the AI prompt is told not to guess what is behind the doors. When the door clock starts, the
  room opens a narration of its own with one neutral scripted line (`FORK_OPEN_VARIANTS`, no AI wait; owner,
  2026-11-09), so the doors never show under the last team's story; a late AI line for that turn is dropped as older
  (after a wrong answer, which has no reveal to wait under, the clock starts at once and that turn's line is never
  shown), lines held for it (a 🧪 give, the sprint line) move into the fork's narration before the opening line, and
  ⚔️'s line is appended to this narration.
- **The title reads 「🔀 叉路！」.** Cubic 11's 11-pixel 「岔」 squeezes 山 into one stroke and reads as a different
  character, so the big-screen title and the phone's fork header use the synonym 「叉路」, which the pixel font draws
  clearly. Every other text (rules, host page, narration) followed in manual-pacing.md: 「叉」 everywhere.
- **15 seconds, server clock** (`FORK_MS`). The deadline is an absolute time saved with the room; a restart re-arms it,
  and a deadline already past takes ⚔️ at once. A press at or after the deadline counts as a timeout. A team that drops
  while choosing keeps the turn (the `currentTurnTeamId` exception, like a pending wrong answer); a team already offline
  when its turn comes is skipped and its fork waits, unclocked.
- **Choose on the team's turn** (d2a), **no host hint** (d3a), **no switching doors** (d4a). The host cannot choose for the
  team; the host's 「替{隊名}按」 and its 15-second timer are gone with the event button.
- **⚔️**: the room's monster and question as usual. A scripted line introduces the monster (`FORK_MONSTER_VARIANTS`), or
  a funny one on a timeout (`FORK_TIMEOUT_VARIANTS`); no AI wait. A timeout opens the ⚔️ side. The answer countdown starts when the question is up,
  after the door opening; the fork's 15 seconds do not count.
- **❓**: one press draws the event and applies it (`enterEventRoom` + `openEvent`), with the effects, chef bonus and
  boss-room rule of [event-rooms.md](event-rooms.md). The result screen gains a 「❓ 神秘房」 chip.
- **Door opening, 1.5 s, for every choice** (`FORK_BEAT_MS`; ❓ added by the owner, d1b). The chosen door swings open
  and only it is revealed: its nameplate (and its phone button) turns from 左門 / 右門 into ⚔️ 怪物房 or ❓ 神秘房. The other
  dims and is never named. A timeout shows 「⏳ 時間到」 first, then the ⚔️ side opens. The opening counts as a pause (`paused()`): no lock, send, ability,
  potion or 下一題 until it ends.
- **❓ is decided at the press but shown after the opening** (d1b). The event is drawn and its effect applied to the game
  state at the press, and the feast dish rolled; the room keeps the state from before the press (`forkBeat.before`) and
  `snapshot()` projects that to every screen (`getSpectatorView(forkBeat.before ?? game)`, online flags from the live game)
  until the opening ends. Only then does it set `eventReveal`, play the outcome cue, and start the `event-room`
  narration. The public STATE carries only `forkBeat: { teamId, side, door, timeout? }` (the opened side and what was behind it); the scene, outcome and dish never leave
  the room early.
- **Pages check the opening first.** Screen, phone and host check `forkBeat`, then `eventReveal`, then the fork, so the
  door buttons never come back during an opening. The host's double-tap guard keys the opening as `fork-${eventId}`.
- **Phone doors stay in view.** The two door buttons (72 px tall) sit in a sticky bar, so a long page or media cannot
  push them off screen (TODOS.md note on the old branch panel).
- **Sent to the boss** clears the fork in any phase (`sendToBoss`), which also covers the buzzer phase pulling every team
  in. The ⚔️ mark survives a wrong answer, a retry, fleeing and a restart.
- **Game log** (#155): `Team.forks` records each fork as `{ side, door, timeout? }`: the side opened, the room behind it,
  and whether the clock chose; the ❓ outcome stays in `events`.
- **Old saves.** A save from before this change with a team in an unopened event room (`Team.event`) loads as
  `fork: { phase: "waiting" }`; the old event is dropped and ❓ draws again. No schema bump.

## Engineering

- `lib/game-state.ts`: `Fork`, `ForkDoor`, `ForkSide`, `ForkChoice` (a side or `timeout`), `ForkRecord`, `FORK_MS`, `atFork`, `enterFork`, `startForkChoice`, `chooseFork`.
  `atFork` guards `answerQuestion`, `assertCurrentQuestion`, `assertAbilityTurn` and `drinkPotion` (`InvalidActionError("fork")`).
- `lib/room/dungeon-room.ts`: `syncFork()` runs at the start of every broadcast and after a restore: it moves the team on
  turn from waiting to choosing when the room is live, and arms `forkTimer`. `TEAM_CHOOSE_FORK { side, eventId }` and the
  timer both go through `applyForkChoice`; one `endForkBeat` ends every opening. Both timers check that their state is still
  current (`deadline`, `this.forkBeat === beat`), and `clearAnswerTimers` (reset, end game, back to lobby, expiry) clears
  them with `forkBeat`. An opening holds 撤銷答錯 too (`undoHeld`).
- ⚔️ and the timeout do not bump `eventSeq`: their line is appended to the current narration, so no spinner waits for a
  narration that never comes. ❓ bumps it when the opening ends, right before its `event-room` narration (review
  2026-11-09): bumped at the press, a restart inside the opening left an eventId with no narration, and the screens
  spun until the next judgment. A second press during the opening is refused as paused (`reveal_pending`).
- `startForkChoice` pins `currentTurnIndex` on the fork team (as `answerQuestion` does), so a team that dropped on its
  own turn and comes back mid-fork cannot take the turn back or make ❓ fail as not its turn (review 2026-11-09).
- The host cannot send the team to the boss during its opening. `appendLine` stops at `NARRATION_MAX_LINES` (20), the
  limit `parseSnapshot` restores, so piled-up scripted lines drop a line, never the save. A saved fork in a shape the
  room cannot run loads as waiting. A game ended at a fork shows no 🚪 and no door clock.
- **One shared `this.rng`.** ⚔️ draws nothing, ❓ draws the event and the dish, so the choice changes every later roll's
  order. Accepted: nothing replays a game from its seed.
- **Restart during an opening** loses the opening (memory only, like `eventReveal`). A ❓ restart keeps the applied effect
  but shows no result screen and no `event-room` narration; the next turn simply starts. ⚔️ shows its question.
- Messages: `HOST_OPEN_EVENT` and `TEAM_OPEN_EVENT` are gone; `TEAM_CHOOSE_FORK` is new; STATE gains `forkLeft` and `forkBeat`.

## Bundled in the same PR

- `lib/bank-size.ts`: the host warning drops the total < teams × 9 rule and keeps only a thin room pool; the host's
  confirm uses the same condition.
- `CLAUDE.md`: architecture questions route to /autoplan.

## Success Criteria

- A fork never stops the room for more than about 17 seconds (15 to choose, 1.5 to open).
- Nothing behind ❓ reaches any screen before the opening ends (unit tests on the STATE keys).
- The rehearsal's game log shows how often teams take ❓, ⚔️ and time out; watch whether the room reacts at the doors.
- Unit tests cover the choice, the timeout, reconnects, restarts and the opening; e2e on CI covers both doors.

## Deferred (TODOS.md)

- Audience vote on the door (Approach C).
- Question-bank or editor-placed forks, and difficulty or category doors (Approach B; needs a bank format bump).
