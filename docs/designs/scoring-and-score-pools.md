# Design: Progress points vs reward points, an 8-room map, and question pools by score

Generated in a scoping discussion with the user on 2026-10-25
Branch: main
Repo: chihgeorge/critical-answer
Status: APPROVED (rules and open questions answered 2026-10-25)
Replaces TODOS: 「重新設計計分」 (P2), 「題庫改成依分數分類，房間依需要的難度抽題」 (P2)

## Problem Statement

One number does two jobs today. `Team.score` decides when a team enters the boss room (15 points) and who wins (`finishGame`, highest score). That causes four problems:

1. Rooms 1–5 are worth 1 + 2 + 2 + 3 + 4 = 12, so a team that clears the map still sits in room 5 answering more questions to reach 15.
2. Once one team is in the boss room, every other team gets in with its next correct answer (live-map rule D9). After that, "15" means nothing, but the phone and host still show `9 / 15`.
3. A boss hit is worth 0 points. Only the final blow earns a random 3d6 (3–18), so the winner is often whoever lands the last hit with a good roll.
4. Questions belong to rooms. A room has 8 questions, and 8 teams in one room leave `deal()` no free question, so a team that flees is dealt a question another team holds (v0.12.0.0 review). The fleeing team also gets "easier" points, but not an easier question.

## Rules (agreed with the user, 2026-10-25)

| # | Decision | Answer |
|---|---|---|
| S1 | Boss-room entry | Keep the 15 threshold, counted in **progress points**. A team that clears room 5 below 15 moves on to rooms 6, 7, 8… until it reaches 15. |
| S2 | Later teams | Keep the hitch-hike rule: once one team is in the boss room, any other team enters with its next correct answer. |
| S3 | Two kinds of points | **Progress points** (hidden from players) decide boss entry. **Reward points** decide the winner. They are separate. |
| S4 | Progress points | A correct answer earns the question's difficulty (1–5). A flee lowers the team's current difficulty by 1 (minimum 1), as today. |
| S5 | Reward points | A correct answer defeats the room's monster and earns that monster's reward. Each monster has its own reward and its own difficulty, set in the bank. |
| S6 | Boss rewards | Each boss hit earns the boss's hit reward. The final blow also earns the kill reward, rolled from dice. |
| S7 | Winner | Highest total reward points; ties share the win. Killing the boss ends the game but does not make that team the winner by itself. |
| S8 | Default numbers | Monster rewards 10 / 20 / 20 / 30 / 40 for rooms 1–5. Boss hit 10. Final blow **4d20** (4–80). |
| S9 | Rooms after 5 | The bank defines its rooms; the default bank has **8**. A team past the last room stays in the last room and keeps fighting it. |
| S10 | Who sees progress | The big screen and phones show reward points only. The host page shows progress (for example `9/15`). |
| S11 | Question pools | Questions are grouped by difficulty 1–5 instead of by room. A room draws from the pool of its own difficulty; after a flee, from the pool of the team's lowered difficulty (earlier D8=A, D9=A). |

## Model

```
answer correct in a room
  progress += team.currentDifficulty          (hidden; boss entry at 15)
  reward   += room.reward                      (shown; decides the winner)
  move to room i+1 (or stay on the last room), currentDifficulty = next room's difficulty
  next question dealt from pool[currentDifficulty]

flee in a room
  currentDifficulty = max(1, currentDifficulty - 1)
  new question dealt from pool[currentDifficulty]       (room and its reward unchanged)

boss hit
  reward += boss.hitReward
  final blow: reward += roll(boss.killDice)    (default 4d20)
```

Notes:

- Reward follows the monster, not the question. A team that fled in room 4 still earns room 4's reward when it answers its easier question.
- The boss keeps its own question list (shared ring, `nextBossQuestionId`), not a pool, as today.
- Defaults for rooms 6–8 are a proposal to confirm: difficulty 4 / 5 / 5, reward 40 / 50 / 50. A team that never flees reaches 16 progress in room 6.

## Dealing invariant

`deal()` must never hand a team a question another team holds (live-map rule D4 says so, but the code falls back to a held one when nothing is free). With pools:

- Every pool has at least `MAX_TEAMS + 4` = 12 questions. At most 8 questions are held at once, so a free question always exists and the fallback is never reached.
- If a smaller custom bank still runs out, deal the team's own fled question back instead of another team's.
- A test plays 8 teams into one pool and flees repeatedly, checking no two teams ever hold the same id.

## Bank format (one change, version 2)

```jsonc
{
  "pools": { "1": [/* questions */], "2": [], "3": [], "4": [], "5": [] },
  "rooms": [{ "monster": {/* as today */}, "difficulty": 1, "reward": 10 }, /* … 8 rooms */],
  "boss": { "monster": {}, "maxHp": 5, "hitReward": 10, "killDice": "4d20", "questions": [] }
}
```

- `parseBank` reads version 1 (rooms with `questions` and `baseDifficulty`) and converts it: each room's questions go to the pool of its `baseDifficulty`, and its reward defaults to difficulty × 10. That keeps production's stored BankStore bank working with no manual step.
- `scripts/check-bundle.sh`, the bank editor (pools tab, room difficulty and reward fields, boss hit reward and kill dice) and `lib/question-bank.test.ts` move to the new shape.
- Default bank sizes: pools 1–5 at 12 or more each, boss 8. Today's 52 questions give pool 1 = 12, pool 2 = 16, pool 3 = 8, pool 4 = 8, and no pool 5, so the default bank needs about **20 new questions** (4 for pool 3, 4 for pool 4, 12 for pool 5) and **3 new monsters** for rooms 6–8. Claude drafts them and the user reviews, as in PR 2.

## Screens

- **Big screen:** each team's reward points next to its pawn or in a scoreboard. No progress number, no `/15`. The map draws up to 7 rooms; earlier ones fold into the … stub (live-map D8).
- **Phone (`/play`):** reward points only, in place of `score / 15`.
- **Host:** progress `9/15` plus reward points per team.
- **Reveal and narration:** a correct answer shows `+20` (the reward), not the difficulty. A boss hit shows `+10`; the final blow shows the dice roll.
- **End screen:** the winner(s) by reward total, and who landed the final blow, as separate lines.
- Every UI change gets a PNG comparison before it is built (`/plan-design-review`).

## Also in scope (deferred into this work on 2026-10-25)

- **Per-game option shuffle (D11=A):** at deal time the server shuffles each multiple-choice question's options and remaps `correctIndex`. The snapshot, `restore()` and the reveal shapes carry the shuffled order.
- **Guessable patterns (D11=A):** when drafting the new questions, rework year ladders where the answer is the second-earliest (r3-q5, r3-q6, r3-q7, r3-q8, r4-q4, r4-q8, boss-q6) and distractors built from the answer (r3-q1, r2-q7, boss-q7).
- **Later boss joiners' narration:** the user's step 4 (「加入戰局」 lines, team order in the AI prompt) touches the same boss-entry event, so it rides along.

## Decided after the draft (2026-10-25)

| # | Question | Answer |
|---|---|---|
| S12 | Rooms 6–8 defaults | Difficulty 4 / 5 / 5, reward 40 / 50 / 50 (difficulty × 10). Three new monsters. |
| S13 | Host override | Yes: the host page gets a "send to boss" button per team. It takes the team into the boss room as if it had reached 15. |
| S14 | Flee cost | No reward penalty. A flee only lowers the difficulty (and so the progress). |
| S15 | PR split | Two PRs. **PR A:** two scores, rooms past 5 supported (the default bank keeps 5 rooms, so a team past room 5 repeats it), per-room rewards, boss hit / kill rewards, host override, screens, v1 bank auto-converted. **PR B:** score pools, rooms 6–8 with 3 new monsters, ~20 new questions, option shuffle, guessable-pattern fixes. |

## Screen decisions (PNG mockups, 2026-10-25)

Mockups: `~/.gstack/projects/critical-answer/designs/scoring-20261025/score-all.png`.

| # | Screen | Answer |
|---|---|---|
| S16 | Phone team card | Reward points only (`120 獎勵分`). The `x / 15` line and the progress meter go. No rank. |
| S17 | Big screen in play | No scores during play, as today. Reward totals appear on the end screen only. |
| S18 | Host | Each team row shows `progress/15` and reward points. The "送王房" buttons live in the 更多 drawer, one per team not yet in the boss room. |

## PR A as built (2026-10-25)

- `Team.score` stays the progress points (renaming it would touch every screen for no gain); `Team.reward` is new. `finishGame` ranks by `reward`.
- The bank gains optional `rooms[].reward` and `boss.hitReward`. `parseBank` fills them in when missing (difficulty × 10, and 10), which is exactly S8 for today's 1/2/2/3/4 rooms, so neither the bundled JSON nor production's stored bank needs a change. The bank editor does not edit them yet (PR B).
- The kill roll is fixed at 4d20 in code (`rollBossKillBonus`), not a bank field.
- `HOST_SEND_TO_BOSS { teamId }` calls `sendToBoss`: refused for a team already in the boss room, with a wrong lock waiting, or with a lock still in its 2 s beat. It does not narrate; step 4 (later joiners' lines) can hook in here.
- `SpectatorView.bossKilledBy` feeds the end screen's 「最後一擊」 line. Snapshot schema 4: a room saved by the old code is discarded on restart.

## PR B as built (2026-10-26)

- Bank format v2 as drafted above (`pools` keyed "1"–"5", rooms with `difficulty` and `reward`). `parseBank` still reads v1 and converts it, so production's stored bank needs no manual step (D1=B: the pooled format, not pools derived from rooms).
- `parseBank` refuses a room whose pool is empty. An empty pool a flee needs falls back to the nearest pool below, then above (`poolIndexFor`).
- `deal()` takes a difficulty. When every question in the pool is held, it deals the fleeing team's own question back, never another team's.
- `GameState.optionOrder` is the per-game shuffle (`shuffledOptionOrders`, Fisher-Yates counted down so the tests' `() => 0` rng keeps bank order). Every option index in the room, the protocol and the clients is a shown index; `inShownOrder` maps a bank question into it. Snapshot schema 5.
- The question's monster comes from the team's room, not the question, since one pool serves several rooms.
- Default bank: 8 rooms (3 new monsters: 暴躁幽靈, 熔岩史萊姆王, 冰霜愛哭鬼), 20 new questions (p3-q1..4, p4-q1..4, p5-q1..12), the guessable year ladders and answer-built distractors reworked, and two pool-2 option clashes (端午 / 中秋) fixed.
- Bank editor (D2=B): tabs 房間 / 難度 1–5 / 首領. The 房間 tab edits each room's difficulty and reward and the boss's hit reward; monster names stay read-only.

## Next Steps

1. `/plan-eng-review`.
2. Build PR A, `/review`, `/ship`, ask before merge.
3. Then PR B the same way.
