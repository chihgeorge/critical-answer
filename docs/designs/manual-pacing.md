# Manual pacing: the host steps through the pauses

Status: approved by the owner, 2026-11-09. Layout A of the mockup (`~/.gstack/projects/chihgeorge-critical-answer/captain/manual-mode-layout.png`, local only).

## Problem

The room moves the game on by itself after several short pauses: the 擲先攻 result, a lock's reveal, the dice, a
door opening, the podium. At a live event the host is often still talking when the pause ends, and the next event or
animation starts early. The host needs a way to say "wait for me".

## What it does

- The host page header has a two-part switch, 「自動｜⏸ 手動」, between the room code and 「⚙ 更多」. One tap, any
  time, lobby included. The default is 自動, which behaves exactly as before.
- In 手動, every pause in the table below stops and waits. The host page shows a dashed panel
  「⏸ 停在這裡：<what comes next>」 with 「手動模式，按「下一步」才會繼續」, and the big button becomes 「▶ 下一步」
  (keyboard `1` or Enter, `HOST_KEYS.next`).
- The answer clock (`ANSWER_SECONDS`) is never held: it is a nudge for the players, not a step of the game.
- The mode is saved with the room and survives a restart.

## Which timer is which

Held in 手動 (the room would otherwise move the game on by itself):

| Pause | Timer / length | ▶ 下一步 does |
| --- | --- | --- |
| 擲先攻, waiting for rolls | `armInitiative(INITIATIVE_MS)` | rolls for the teams left (as 全部代擲) |
| 擲先攻, the order on show | `armInitiative(n × INITIATIVE_TIE_MS + INITIATIVE_ORDER_MS)` | start cue, narration, first question |
| Boss phase card after a miss | the read-out time of the retry line, `BEAT_MS` .. `ADVANCE_CAP_MS` | opens the card (下一題 did this already) |
| 公布答案's beat | `BEAT_MS` → `resolveLock` | shows right (crit die) or wrong |
| Dice: warrior, crit, check | `BEAT_MS` → `resolveRoll` | judges with the dice shown |
| Kill 4d20 | `KILL_BEAT_MS` → `resolveRoll` | scores the kill, ends the game |
| Boss miss's red tile | `BEAT_MS` → `armBossMiss` | the retry: the boss's next question |
| 叉路 door clock | `FORK_MS` → `applyForkChoice(id, "timeout")` | the same timeout: the ⚔️ door opens |
| 叉路 door opening | `FORK_BEAT_MS` → `endForkBeat` | the room behind the door |
| Podium start | `revealFrom`: `FINISH_PODIUM_MS`, `EPILOGUE_DELAY_MS`, `END_READ_CAP_MS` (and `READ_GAP_MS`, which only shortens the cap) | the reveal's first beat starts now |

At a fork in 手動 there is no countdown on any screen (`forkLeft` is not sent) and a late press is not a timeout: the
team may pick whenever it likes. 擲先攻 shows no countdown either (`initiative.untimed`).

Not held:

| Timer | Why |
| --- | --- |
| Answer clock (`ANSWER_SECONDS`) | owner's decision: the only clock that keeps running |
| `SERVE_HOLD_MS` | guards 下一題 against a double press while the dish cooks; the host presses it anyway |
| Narration `holdMs` / `epilogueHoldMs` | how long the room waits for the AI before the scripted line; no game step |
| Podium beats (`beatMs`), `COOK_MS`, `EAT_MS`, door and banner animations | one animation on the screens' own clock, inside a step the host already started |
| Epilogue pages, how-to-play pages, 下一題 | the host's own presses already |
| `HANDOFF_MS`, `JOIN_PASSWORD_WINDOW_MS`, `KEY_CHECK_MS`, `KEY_CHECK_WINDOW_MS`, `REACT_GAP_MS`, `IDLE_MS`, `EXPIRE_MS` | expiry, rate limits and the room's life, not the game's pace |
| Host page `STUCK_MS` and the half-second button arm | page-only guards |

The podium is one step: once the host starts it, its places, tie rolls and titles play as one reveal. Stepping
through each place would need the screens' clock to stop too, and is left out.

## How

All in `lib/room/dungeon-room.ts`. The five timer fields became one map, `steps`, with one slot per old field
(`initiative`, `phaseCard`, `lock`, `fork`, `forkBeat`), and every timer goes through one helper:

```ts
pace(slot, kind, ms, label, run)
```

- 自動: `setTimeout(run, ms)`, as before.
- 手動: the step is kept with no timer. `label()` says what comes next, and returns null once the step is stale (the
  host judged a boss miss inside its beat, the team picked a door), so a stale step is never shown or run.

Each step has an id from a counter. STATE carries `pacing: "manual"` and `hold: { id, kind, label }` for the first
live step. The host sends `HOST_STEP { eventId, step }` with the ids its STATE showed; the room runs the step only when
both still match. `eventId` is the guard every host button uses; `step` is there because some steps follow each other
with no new event (a lock's beat, then its crit die), and a double press must not run both.

`HOST_PACING { mode }`:

- to 手動: running timers are cleared and their steps wait. A finished game whose reveal has not started is held.
- to 自動: each waiting step runs its whole length again from now; a fork gets a fresh `FORK_MS` deadline; a held
  podium starts after `EPILOGUE_DELAY_MS`.

The podium has no timer on the room (the screens play it from `podium.at`), so its hold is a saved flag: while it
is set, STATE sends `podium.beats: null` (名次揭曉中…), and the step sets `podium.at` to now.

### Restart

The snapshot gains `pacing?: "manual"` and `revealHeld?: true`. Both are optional, and a missing or unknown value is
自動, so `SCHEMA_VERSION` stays 5 and an older save restores as before. The steps themselves are not saved: `restore()`
arms again what the saved room still waits on (擲先攻, a boss miss, a fork, the podium flag), and `pace` turns each
into a waiting step because the mode is restored first. A lock's beat, the dice and a door opening were memory only
before this and still are: a restart drops them as it always did.

### What never leaves the room

`hold.label` is the only new text. A fork's label names the team and nothing else; `Team.fork.monsterSide` goes to no
screen, as before (covered by a test).

## Wording: 「叉」, not 「岔」

Same PR: every text a player or host can read (narration, phones, host page, rules) now says 叉路 / 叉路口. The pixel
font draws 「岔」 badly, and the big-screen title already used 「叉路」 (branch-fork.md). Identifiers and file names
(`fork`, `branch-fork`) stay.

## Tests

`lib/room/manual-pacing.test.ts`: auto unchanged; each pause in the table waits and takes one step; a fork's step is
the timeout; both switches; a restart; stale `eventId` and a double press; `monsterSide` in no message.
`e2e/manual-pacing.spec.ts`: switch, hold, 下一步 (CI only).
