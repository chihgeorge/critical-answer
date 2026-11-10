# Design: 占卜師 (the fortune teller: a condition and an effect) and the 3-scene event deck

Planned with /office-hours and /autoplan on 2026-11-10 (plan, reviews and sketches local-only under
`~/.gstack/projects/chihgeorge-critical-answer/`). This file is the one consolidated spec: each rule has one version.
Where the plan had several, the owner's final gate decisions (G1–G10) won over the eng review's R1–R17, which won over
E1–E16, which won over the CEO review bullets, which won over the plan body.
Status: APPROVED
Mode: Builder

## Problem Statement

The fortune teller was one of six events and drew 大吉 / 中吉 / 凶, effects the chest, the spring and the idol already
had. The owner wanted a 大富翁 4 style fortune teller: the team that meets her decides the fate of a group of teams nobody
names, and may land it on itself.

## The event deck (G3)

The ❓ door of a fork ([branch-fork.md](branch-fork.md)) draws one of three scenes, 1/3 each:

| Scene | Outcome |
|---|---|
| 寶箱 chest | 美味料理 feast +20 or 黑暗料理 rotten −10, 1/2 each |
| 神秘雕像 statue (`idol`) | ✨ blessing or 💀 curse (the boons of [event-rooms.md](event-rooms.md)), 1/2 each |
| 占卜師 fortune teller | this design |

- The spring is gone from the draw, and the fairy's blessing now comes from the statue. `spring`, `fairy`, `great`,
  `good` and `bad` stay in the types and in `openEvent`, so a room saved mid-event before this change still loads.
- With the spring gone, a class ability use comes back only from the sources the rules list; no event gives one.
- `drawEvent(game, teamId, rng)` draws the scene, then the outcome. For the fortune teller it builds the condition
  pool (below); when the pool is empty there is no fortune this time (G2): it draws chest or statue 1/2 each, then
  that scene's outcome.
- Balance for this deck was simulated before the build (`analysis/s3a-fortune-sim`, `DECK=3`): class win rates 25.0–28.2%,
  inside the 24.2–30.2 target. A change to any number here needs that run again.

## Conditions

Nine conditions; every team tied on the highest value matches.

| Condition | Value per team |
|---|---|
| 擲出最多次 20 | `natural20s` |
| 擲出最多次 1 | `natural1s` (new) |
| 逃跑最多次 | `flees` |
| 喝最多瓶藥水 | `potionsDrunk` |
| 答錯最多題 | `wrongAnswers` (new) |
| 答對最多題 | `correctAnswers` (new) |
| 開最多次神秘房 | `events.length`, the drawing team's counted +1 for this one |
| 吃過最多種料理 | distinct `dishes` |
| 吃到最多次黑暗料理 | `"rotten"` in `events` |

- **Pool (G2).** A condition enters the pool when its highest value is above 0 and either at least two teams are above
  0 or the highest value is at least 2. 開最多次神秘房 never enters on the game's first mystery room (every team's
  `events` empty before this one); after that the drawing team is counted +1. The room's `rng` picks one condition from
  the pool, uniformly.
- Every team counts, offline teams and teams in the boss room too. The condition, its value and the matching team ids
  are fixed at the draw and saved (`game.fortune`); a value that changes during the countdown changes nothing.
- **Counters** (optional numbers on `Team`, absent reads as 0, so older saves load):
  - `natural1s`: every die that counts a natural 20 counts a natural 1 the same way: a correct answer's crit die, a
    persuasion check, each of the kill's 4d20. The warrior's d20 counts its 1 in `warriorRoll`, whether or not the
    question makes it the crit die (E7). Class dice will count theirs in their own PR.
  - `correctAnswers`: +1 for each correct judgment (room, boss turn, boss buzz; a music question counts once).
  - `wrongAnswers`: +1 for each wrong judgment the team retries (`fleeChoice === "retry"`), a cleric's prayed one
    included; a flee or a switch counts in `flees` only (E10, G7). A wrong buzz counts (it is always a retry).
  - The host's 改判答對 restores the whole game from before the 答錯, counters included.

## Effects (G6)

The drawing team picks one of six on its phone within 15 seconds; no pick picks one at random. The big screen shows a
pizza, one word per slice; the phone shows each effect's line.

| Slice | Phone line | Rule |
|---|---|---|
| ✨ 祝福 | 下一題答對多拿獎勵 | boon `blessing`, replacing any boon |
| 💀 詛咒 | 下一題答對獎勵變少 | boon `curse`, replacing any boon |
| 🧪 藥水 | 送一瓶，已有就沒效 | `item: "luckyPotion"`; a team holding one is unchanged |
| 💫 暈眩 | 跳過下一回合，搶答時停一首 | `stunned` (below) |
| 🙇 進貢 | 其他隊各給他們 10 | each team that does not match pays 10 (all it has, if less); the sum is split evenly between the matching teams, rounded down, and the remainder is not paid out (E11). Nothing moves when every team matches |
| 🎁 救濟 | 給飽足感最少的隊伍 | the receivers are the teams with the lowest 飽足感 at the moment of the pick (every team). Each matching team that is not a receiver pays 20 (all it has, if less), split evenly between the receivers, rounded down; the remainder stays with the payer (E11). A matching team that is itself a receiver pays nothing |

- Both remainder rules sit next to the amounts in `lib/game-state.ts` (`FORTUNE_PAY`).
- **The chef's bonus applies to no fortune effect,** and the fortune teller gives the drawing team nothing herself.
  Tribute and relief move 飽足感 between teams; a 15% on top would make some out of nothing.
- Every effect lands on the matching teams (`matchIds`), offline teams too. The drawing team may be one of them.

## Flow

1. **Crystal ball, about 3 s.** The ball shows the condition. Nobody can pick.
2. **Pizza, 15 s.** Six slices, the 15-second clock top right, the condition under the ball. The drawing team picks on
   its phone.
3. **The slice lights, about 1 s** (`FORTUNE_BEAT_MS`) in `--turn` yellow; a timeout shows 「⏳ 時間到」 first.
   An existing cue from `lib/sfx.ts` plays.
4. **Effect card.** The condition with its value, the effect with its line, and the hero and name of every matching
   team; no other team is drawn. When the drawing team matches: 「選的人自己也中了！」. It stays until the host's
   下一題, like any event result.

- **The ❓ door first.** ❓ still plays the fork's door opening (`forkBeat`, `FORK_BEAT_MS`). When the event is the
  fortune teller, `chooseFork` only puts the event on the team (`enterEventRoom`) and creates
  `game.fortune = { teamId, condition, value, matchIds }`; it does not open the event. `endForkBeat` then starts step 1
  instead of an event reveal and its event-room narration (R3).
- **Room steps** (E2): `game.fortune` without `effect` is steps 1–2 (step 1 while `now < deadline − FORK_MS`);
  the in-memory `fortuneBeat { effect, timeout, before }` is step 3; `effect` set and no `fortuneBeat` is step 4.
- **The pick resolves at once** (E3, G8, R2). `resolveFortune(game, effect, timeout, rng)` is one atomic change: it
  checks the turn while `effect` is unset, applies the effect to `matchIds`, runs `openEvent("fortune")` (the event is
  recorded in `events`, the turn counts, the team walks into the next room with a fresh deal, the turn passes), and writes
  `game.fortune.effect`, `timeout` and the drawing team's `fortunes[]` record. `openEvent` gives nothing for `"fortune"`
  itself, and its boss-door rule stands: with the boss door open the team walks into the boss room.
- `currentTurnTeamId` keeps the turn on the drawing team while `game.fortune` has no `effect`, offline too.
- **Host 下一題 at step 4** clears `game.fortune`, starts the next team's fork clock if it is at a fork (`syncFork`), and
  narrates the next team. 下一題 is ignored at steps 1–3.

## Clock and pacing

- The deadline is set when step 1 starts (`endForkBeat`): now + 3 s + `FORK_MS` (E13). It is saved with the game. A
  restart keeps it; one already past picks at random at once. A restart inside the door opening (no deadline yet) starts
  step 1 on restore. A restart inside step 3 goes straight to step 4.
- STATE sends `fortuneLeft`, ms left on the room's clock (like `forkLeft`), never the absolute deadline (R8), and
  `fortuneIntro` while step 1 runs.
- Manual pacing follows the fork: no clock runs, the phones wait for the team, and the host's ▶ 下一步 counts as time
  running out (offered once step 1 is over). Manual → auto: at step 2 the deadline becomes now + `FORK_MS` (the ball does
  not play again); at step 1 now + 3 s + `FORK_MS`; at step 3 the beat runs as any step does (R8).
- **Host escape** (`HOST_FORTUNE_RANDOM`): 2 s past the deadline with no effect, the host page offers 「立即隨機」. The
  room checks deadline + 2 s itself; the host can never pick the effect.
- Steps 1–4 are `paused()`: no lock, typed answer, ability, potion, 下一題 (except at step 4), late join, 送王房 or
  🧪 給藥水. 改判答對 is refused while a fortune runs (`undoHeld`). One `fortuneActive()` helper is read wherever the room
  reads `forkBeat`; `clearAnswerTimers` drops `fortuneBeat`. 結束冒險, the boss kill and every other end clear
  `game.fortune` (R11).

## Validation (E12, R8)

`TEAM_CHOOSE_FORTUNE { effect, eventId }`: the protocol checks `effect` is one of the six. The room checks the sender is
`game.fortune.teamId`, `eventId === eventSeq`, `effect` is not set yet (a second phone or a double tap is refused), and
step 1 is over (`fortune_intro`). A press at or after the deadline (auto) is the clock's: a random effect.

## What the screens see (G4, G5, R12)

- At steps 1–3 every STATE, the host's included, carries `game.fortune` as `{ teamId, condition }` only: no `value`, no
  `matchIds`, and the effect only from step 3 (the lit slice). Step 4 adds `value`, `matchIds` and `effect`. STATE during
  the door opening carries no fortune at all.
- The host sees the matching teams only after the reveal, with everyone else.
- The drawing team's phone does not show its own count.
- **This is suspense, not security.** The counters behind the conditions are public game facts, and a determined player
  could work a match out. The tests only guarantee that `value`, `matchIds` and the effect stay out of STATE before
  their step.

## 💫 暈眩 (G1, G10, R4, R5, R14)

- **Turns.** The flag lands at the pick. A stunned team loses the next turn that comes to it: when the drawing team
  stuns itself that is its next turn; when another team is stunned it is skipped the next time the turn reaches it,
  the very next team included (`resolveFortune`'s turn change skips it). A skip counts as that team's turn for the round
  (`round`, `lastTurnIndex`), adds no `turns` and writes no `bossAt`. The flag clears with the skip.
- Several stunned teams in a row are each skipped once. When every online team is stunned, every flag clears and the
  turn lands on the next online team without a skip. With no other online team, the flag clears and nothing is skipped.
- A stunned team at a fork loses the turn and its fork stays `waiting`; its 15 seconds start on its next turn.
- **Phones going on and offline** (R4). `setTeamOnline` skips a stunned team only when no team holds the turn
  (a wrong answer waiting, a typed answer, a door being chosen, a fortune): when the turn team drops and the next online
  team is stunned, or when a stunned team reconnects into the turn. Either way the turn index is pinned on the team that
  really plays, so nobody is skipped twice.
- **Buzzer phase** (R5). `advanceTurn` never skips during a buzzer phase or while a boss phase card is pending. The
  first buzz question after the flag landed counts: `buzzIn` refuses a stunned team (`stunned`), a wrong buzz counts it
  as out, and the flag clears when the question ends (a correct answer, 換下一題, a phase ending). Reopening the same
  question is not an end. When every online team in the boss room is stunned, every flag clears and buzzing goes on.
  Whichever comes first uses the flag: the team's next turn or the next buzz question.
- **Narration.** A skip is written to `game.stunSkipped` and said once as a scripted line appended to the current
  narration (keyed by `eventSeq`, so a reconnect cannot eat it). A skip made by the fortune's own turn change waits for
  the host's 下一題 at step 4, and is said before the next team's line.

## Narration

All scripted, no AI wait: step 1 says the condition and 「{隊名}，替他們挑一片吧」 under one `eventId`; step 4 says the pick
and the result, with its own mocking lines when the drawing team matched; 下一題 adds the next team's line. The AI only
ever sees the outcome (`"fortune"` in a team's events for podium titles).

The statue (R7): `EVENT_SCENE_TEXT.idol` is 神秘雕像, a statue that may bless or curse; the blessing's title, scene,
scripted lines and the AI's description all speak of the statue, not a fairy.

## Records, podium, game log

- `EventOutcome` gains `"fortune"`: the drawing team's `events` gets one, so 開最多次神秘房 counts it.
- The drawing team's `fortunes?: FortuneRecord[]` keeps each fortune: condition, value, effect, matching ids, whether the
  clock picked, whether the team matched itself. Being hit is read from these records (no list on the hit teams).
- Podium (E9, R9): a title's value reads `(team, teams)`. 女神的寵兒 and 詛咒磁鐵 also count the times the team was in
  another (or its own) fortune's `matchIds` with a blessing or a curse. 詛咒磁鐵 still counts the old 凶. A save without
  `fortunes` reads as none.
- The game log keeps each team's `fortunes`.
- Deferred to after the event (TODOS.md): the podium title 「命運之子」.

## Saves and rollback

- `parseSnapshot` keeps a team's `event` when `game.fortune.teamId` names it and the event is the fortune's (E1). It
  checks the fortune's shape: a known condition, a known effect if any, a finite deadline if any, `matchIds` naming real
  teams, and at steps 1–2 a drawing team holding the fortune event. A bad shape drops the fortune and puts that team back
  at a waiting fork. Both saved shapes restore (R10): steps 1–2 and step 4.
- A late team is refused while a fortune runs (`late_closed`).
- **Rollback risk** (E6, R16): an older server opening a saved `outcome: "fortune"` would give a curse. Roll back only
  when no fortune is running. Older screens and phones ignore the new STATE fields.

## If time runs out

Cut in this order: the stun animation (static), the host page's fortune details (only 「占卜中」), the sound.
💫 暈眩 is the last commit of the PR, so it can be reverted alone.
