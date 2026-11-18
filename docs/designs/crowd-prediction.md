# Design: 🎯 群眾預測 (waiting teams predict 會答對 / 會答錯)

Planned with /autoplan on 2026-11-18 (lean run: one in-host reviewer, CEO and eng lenses, auto-decided; no outside
voice). Issue #283.
Status: IMPLEMENTED (feat/283-prediction; see "Implementation notes" at the end for where the code differs)
Mode: Builder

## Problem Statement

Turns are global and one team answers at a time, so most teams spend most of the game waiting. Audience reactions
([audience-reactions.md](audience-reactions.md)) gave them something to tap; the leftover idea from TODOS.md (「燈籠預測」)
was to let them bet on the answering team. The owner chose decision A on issue #283 (2026-11-18): **prediction only,
no score.** While another team answers its room question, each waiting team may lock 「會答對」 or 「會答錯」 on its
phone. When the answer is judged, the big screen lists the teams that guessed right. At the end, the podium gives
🎯 神預言 to the team with the most right predictions. No points, no boss effect.

## Decisions

- **Room questions only.** A round opens for the team on turn when its question is on screen (`questionOnScreen()`:
  no reveal, card, door, fortune, check or pick hold in front of it) and that team is not in the boss room
  (`!team.inBoss`) and it is not a buzzer phase. Boss turns are left out: they already carry phase cards, the kill
  dice and a second judgment pass (`pendingKill`), and in a boss phase the waiting teams may be fighting the same
  boss. Every room question kind counts: fill-in (host-judged), multipleChoice and sort (auto-judged after the host's
  reveal), memory and timing questions. A persuasion check runs before the question is shown, so the round opens
  only after it; a check's natural 20 wins the question unseen, so that turn never opens a round.
- **Who may predict.** A connection bound to a team in `game.teams` (not a waiting late team, not the host page or
  the big screen), not the team on turn, while the game is playing and past `opening()`. The same gate as
  `handleReact`. A late team, once admitted, may lock in a round that is still open. A waiting team that goes offline
  keeps its lock; its phone simply cannot send.
- **A lock is final.** One `PREDICT` per team per round; anything after the first is dropped before any work. The
  owner said 「鎖」, and a final lock keeps the round honest (no switching the moment the answering team frowns).
  Because a team changes state at most once per round, no rate-limit timer is needed.
- **When locking closes.** At the moment the answering team's answer starts: an option locked (`pendingLock`), a
  sort locked, a fill-in submitted (`typedAnswer`), a timing question's song starting (`media` playing for that
  question), a die rolling for the answer (`pendingRoll`), a wrong answer waiting on 重答／逃跑 (`pendingWrong`), or
  any judgment (the host can judge a spoken answer with nothing submitted). It is a derived predicate
  (`predictOpen()`), not a flag, so no handler has to remember to close it. A selected but unlocked option does not
  close it: a waiting team may read the big screen's highlight; that is part of the guess.
- **Hidden until the judgment, count only.** Locks are never broadcast with their side. Everyone sees how many
  teams locked: STATE and `PREDICTIONS` carry `locked: teamId[]` (who, not what).
- **Resolved with the ledger.** A round resolves exactly where `recordJudgment` appends to the 改判 ledger in
  `judgeNow`, so it follows every applied judgment and nothing else. The ledger entry keeps the round's locks
  (`Judgment.predictions: Record<teamId, boolean>`, true = 會答對), and every team whose lock matches the entry's
  `correct` gets `Team.predictionsRight += 1` in the same new game state. Teams removed meanwhile are skipped.
  The round then clears.
  - **A wrong answer the team retries** resolves the round as 答錯 and opens a fresh round for the retry (the same
    question is on screen again). Each attempt is one ledger entry, so each is one round.
  - **A wrong answer the team flees from** (`incorrect-flee`) was judged wrong and is in the ledger: it resolves as
    答錯.
  - **No judgment, no resolution.** A skipped turn (`HOST_SKIP_TURN`, an offline team), a flee or switch without an
    answer, a 🚨 catch upheld (`upholdCatch`, never in the ledger), the game ending, or a restart drops the round
    silently.
  - A cleric's successful prayer, a warrior's roll and a music question's partial fields all resolve by the ledger
    entry's `correct`, whatever came before it.
- **改判 and undo.** `HOST_REJUDGE` (`hostRejudge` in game-state.ts) flips the entry; every team in its
  `predictions` moves by one (+1 if its lock now matches, −1 if it no longer does), so any flip cycle nets 0. Not
  re-announced on any screen. `HOST_UNDO_WRONG` restores the game from before the 答錯 (the tally with it); before
  it re-judges, the room puts the undone entry's `predictions` back as the current round (closed), so the
  re-judgment resolves it as 答對 and the tally ends as if judged right the first time. The multi-field undo (back to
  judging field by field) restores the round the same way.
- **Memory only for the open round, saved once resolved.** The open round lives on the room
  (`predict: { teamId, questionId, locks: Map } | null`); `PREDICT` skips `markActivity()` and `persist()` and goes
  straight to the sockets as `PREDICTIONS { locked }` via `room.broadcast`, like `REACTION` and `FORK_VOTES`. A
  round whose `teamId`/`questionId` no longer match the turn is stale and treated as empty. The resolved counts are
  part of the judgment's own new game state, so they are saved by the persist that judgment already does.
- **Wrong timing dropped silently.** No ERROR for a closed window, the team on turn, a repeat, a stale `eventId`, a
  buzzer phase or the boss room: the phone only shows the buttons when a lock can land.
- **Not narrated.** The narrator says nothing about predictions: no prompt or scripted-line change, and a line about
  who bet on what could read as a hint before the reveal. The host page is unchanged.

## Screens

- **Waiting phone.** While a round is open: two buttons 「🎯 會答對」「🎯 會答錯」 in a row above the reaction row,
  with the small line 「偷偷猜{隊名}答不答得對，揭曉時公布」. After a lock both turn the D5 grey (drawn, not
  `:disabled`) and the line reads 「已鎖定：會答對・N 隊已預測」; the side comes from page state, so after a reload it
  reads 「已鎖定預測」. When the round closes unlocked, the row disappears. At the result: 「🎯 猜中了！」 or
  「🎯 沒猜中」 for `PREDICT_SHOW_MS` (6 s), only for a team that locked.
- **Answering phone.** One small line under its header while a round has locks: 「🎯 N 隊在猜你答不答得對」.
- **Big screen.** During the round a small chip 「🎯 N 隊已預測」 beside the countdown (nothing at 0). At the
  judgment: one strip 「🎯 猜中：藍莓、檸檬」, or 「🎯 沒人猜中」 when teams locked and none was right; nothing when no
  team locked. It sits on the answer reveal card while one is up (until 下一題); a judgment without a card (a retry)
  shows it for `PREDICT_SHOW_MS` in the same place. Appears and disappears with no motion (DESIGN.md).
- The phone layout needs a PNG preview for the owner before the PR merges (owner rule for UI choices).

```
waiting phone                         big screen (reveal)
+-----------------------------+       +------------------------------------+
| 檸檬的回合・面對 史萊姆       |       |  正解：火山                         |
| 偷偷猜檸檬答不答得對          |       |  🎯 猜中：藍莓、葡萄                |
| [🎯 會答對]  [🎯 會答錯]      |       +------------------------------------+
| [👏] [😱] [😂] [👎]           |
+-----------------------------+
```

## Protocol, state and saves

- Client (`lib/protocol.ts` `ClientMessage` + `parseClientMessage`): `{ type: "PREDICT"; eventId: number; correct:
  boolean }`. `eventId` must equal the room's `eventSeq`, as `TEAM_SUBMIT_TEXT` does, so a slow press from the last
  attempt never lands in the retry's round.
- Server: `{ type: "PREDICTIONS"; locked: string[] }`. STATE gains `predictions?: { locked: string[] }` (while the
  turn's round has locks) and `predicted?: { eventId: number; correct: boolean; right: string[]; wrong: string[] }`
  (the last resolution, memory only, cleared when the next round opens or the next judgment lands). Neither ever
  carries a side before the judgment.
- `PREDICT_SHOW_MS = 6000` in `lib/protocol.ts` (front-end importable, no bank data). shortcut: the 6 s runs from
  when a client first sees that `predicted.eventId`, so a reload inside it shows it again; fine for a 6 s strip.
- Game state (`lib/game-state.ts`): `Team.predictionsRight?: number`, `Judgment.predictions?: Record<string,
  boolean>`. Both optional, missing reads as 0 / none, like `potionsDrunk`. **No `SCHEMA_VERSION` bump** in
  `lib/room/snapshot.ts`: no field changes meaning, and an older save simply has no predictions.
- Game log (`lib/game-log.ts`): `predictionsRight: number` per team row (`?? 0`).

## Podium title

- `lib/podium.ts`: `TitleTeam.predictionsRight?: number` and one TITLES row,
  `{ id: "prophet", icon: "🎯", title: "神預言", value: (t) => t.predictionsRight || null, reason: (n) => \`猜中 ${n} 次\` }`.
  Same tie rule as every data title: each team tied on the best value gets it, in team order; a count of 0 gives
  none. It never adds points or changes places. Icon 🎯, not 🔮: 🔮 is 命運之子 in PR #388.
- **Order:** directly before 🎲 大成功王 (🎲 stays last). It joins the host-stepped podium (#381) as one more title
  beat with no other change (`revealBeats` already walks `awardTitles`).
- **Merge order with PR #388** (feat/287-child-of-fate, adds 🔮 命運之子 after 💀): whichever PR merges second
  rebases and keeps both rows (🔮 after 💀, 🎯 before 🎲), and keeps both names in the rules.md / rules.en.md title
  lists. Neither PR may drop the other's row.
- **Merge order with PR #391** (feat/fork-audience-vote): both add a direct-broadcast message, a STATE field and a
  waiting-phone row in the same files; the second to merge resolves the conflicts. They never show at once: a fork
  vote needs a door being chosen, a prediction needs a question on screen.

## Tests (vitest; e2e only by note)

- `lib/room/predictions.test.ts` (next to dungeon-room.ts, following `reactions.test.ts`): a waiting team locks and
  `PREDICTIONS` lists it; the team on turn, the host connection and a waiting late team are dropped; a second lock is
  dropped; a stale `eventId` is dropped; lobby, intro, initiative, buzzer phase and boss room are dropped; locking
  closes on an option lock, a text submit, a timing song start and a judgment; `PREDICT` writes no storage; no
  message before the judgment names a side; a correct judgment gives +1 to 會答對 teams and STATE `predicted` lists
  right/wrong; a wrong retry resolves 答錯 and opens a new round; a wrong flee resolves 答錯; a skipped turn and a 🚨
  catch drop the round; `HOST_UNDO_WRONG` leaves the tally as if judged right; `HOST_REJUDGE` flips it and back nets
  0; a removed team is skipped; a restart keeps the counts and drops an open round.
- `lib/game-state.test.ts`: `hostRejudge` moves `predictionsRight` by the entry's `predictions`.
- `lib/podium.test.ts`: 🎯 神預言 to the most right, ties share, 0 gives none, order before 🎲.
- `lib/protocol.test.ts`: `PREDICT` parses only with a boolean `correct` and a numeric `eventId`.
- `lib/game-log.test.ts`: `predictionsRight` in the team row, 0 for an older game.
- e2e (CI only, never run locally): one spec could lock a prediction on a waiting phone and see the strip on the
  big screen; listed for the implementer, not required by this plan.

## Files to touch

- `lib/protocol.ts`, `lib/game-state.ts`, `lib/room/dungeon-room.ts`, `lib/podium.ts`, `lib/game-log.ts`
- `app/room/[code]/play/page.tsx`, `app/room/[code]/screen/page.tsx`
- tests listed above
- `docs/rules.md` + `docs/rules.en.md`: new section `## 群眾預測` / `## Crowd predictions` after 觀眾反應 /
  Audience reactions, and 🎯 神預言 in the title list of 勝負與再玩一場 / Winning and playing again.
- `docs/hosting.md` + `docs/hosting.en.md`: one sentence in the Dungeon master paragraph next to the reactions
  (no new heading, so the twins keep identical headings).
- `docs/designs/podium-titles.md`: add 🎯 to its title list; `docs/designs/audience-reactions.md`: the 不在範圍 line
  about the lantern points here.
- `TODOS.md`: remove the #283 index line and its 「觀眾反應的後續：燈籠預測」 section; the PR closes #283.
- `changelog.d/feat-283-prediction.md` with `bump: minor`, `### Added`.

## Not in scope

- Any score, lantern or boss effect from predictions (options B and C on #283; revisit after event feedback).
- Predictions on boss turns or in buzzer phases.
- Changing a lock, showing sides before the judgment, the host page showing predictions, narration about them.
- Re-announcing a 改判's new prediction result on screens.

## Review record

- **CEO lens (scope).** Premise holds: the owner already chose A, and it reuses two shipped patterns (reactions'
  gate, fork votes' direct broadcast + STATE tally). The one expansion accepted is resolving through the 改判 ledger
  instead of a bare counter, because a counter alone gets 改判 and undo wrong; it costs one optional field on
  `Judgment` and three lines in `hostRejudge`.
- **Eng lens.** Single resolution point (the `recordJudgment` call in `judgeNow`) covers host-judged, auto-judged,
  warrior, cleric and timing paths without touching each. The open round is derived against the current turn, so a
  skip, switch, event or restart needs no cleanup code. Main risks below.
- **Outside voice:** not run (lean run).

## Risks

- `judgeNow` runs twice for a chef's or armed thief's fill-in (first pass returns early to roll the answer die) and
  for a killing blow; resolution must sit only on the applied path next to `recordJudgment`, never before the early
  returns, or teams get counted twice.
- PR #388 and PR #391 touch the same TITLES list, rules docs, STATE and phone page: merge conflicts are certain for
  whichever lands second.
- A retry reopens the round at once; the 6 s strip and a new open round overlap on the waiting phone. The phone shows
  the result line above the fresh buttons; check it in the PNG preview.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Room questions only, all kinds; no boss, no buzzer | Mechanical | P5 | Boss turns judge twice and waiting teams may be in the fight | Boss rooms too |
| 2 | CEO | Lock is final | Mechanical | P5 | Owner said lock; no rate limiter needed | Switchable like fork vote |
| 3 | Eng | Close when the answer starts (derived predicate) | Taste | P5 | Fair cut-off for every kind, nothing to forget to reset | Close at the judgment |
| 4 | CEO | Before the judgment show only who locked | Mechanical | P1 | Sides would let teams copy | Live tally of sides |
| 5 | Eng | Resolve at the ledger; keep locks on `Judgment` | Taste | P1 | 改判 and undo stay exact | Plain counter only |
| 6 | Eng | Each attempt is a round; flee after a wrong answer counts as 答錯 | Taste | P3 | Matches the ledger one-to-one | One round per question |
| 7 | Eng | No SCHEMA_VERSION bump | Mechanical | P4 | Optional fields, like potionsDrunk | Bump |
| 8 | Design | 🎯 icon, before 🎲 | Mechanical | P5 | 🔮 is 命運之子 | 🔮 |
| 9 | Eng | No narration | Mechanical | P3 | No hint risk, no prompt change | Crowd-style line |
| 10 | Eng | Own side from page state, no private message | Taste | P3 | One fewer message; reload shows 已鎖定預測 | Per-team PREDICTED message |

## Implementation notes

Where the code follows its own patterns instead of the plan above:

- **The round is keyed by team and question, not `eventId`.** The beats before a judgment (`writeScripted` for
  `crit-intro`) move `eventSeq` on, so an `eventId` key lost every right multipleChoice lock. `PREDICT` still must
  carry the current `eventId`. A turn that ends without a judgment (skip, dropped phone, event) leaves the round
  stale, and `predictionsView()` drops it at the next STATE, so the team's next turn on the same question starts
  empty (tested: skip, two misses, back to the same team and question).
- **Resolution sits next to `recordJudgment`** in `judgeNow`, after both early returns (answer die, kill roll), and
  passes the locks into `recordJudgment(…, predictions)`, which stores them on the entry and adds the
  `predictionsRight`. `hostRejudge` keeps `predictions` on the rebuilt entry and moves the tally. A chef's fill-in is
  tested to count once over its two `judgeNow` passes.
- **STATE `predictions` is `{ open, locked }`.** The phone needs `open` to know when to show the buttons; the open
  predicate (`predictOpen()`) is the server's. Present while open or while the round has locks.
- **`predicted` is replaced at the next judgment** (null when no team locked) and cleared on reset and 回到大廳; it is
  not cleared when the next round opens. Clients show it only while its `eventId` is STATE's, on the reveal card, or
  for `PREDICT_SHOW_MS` from first sight (`components/predictions.tsx`).
- **No timing-question rule.** Timing questions are allowed only in buzzer phases (`noTiming` in
  `lib/question-bank.ts`), so they never open a round; the "song starting" cut-off is moot and not coded.
- **Big screen chip** sits in the question card's chip row (with 🧪 and 🔮), not beside the countdown.
- **Tests:** the `PREDICT` parse test is in `lib/room/predictions.test.ts`, next to the room tests (as
  `reactions.test.ts` does for `REACT`), not `lib/protocol.test.ts`. "A removed team is skipped" is tested on
  `recordJudgment` in `lib/game-state.test.ts`: in-game teams cannot be removed (only lobby and waiting teams).
- **Merge with PR #388** (🔮 命運之子, unmerged): it also edits `TITLES` in `lib/podium.ts` and the title list in
  rules.md / rules.en.md. Whichever PR merges second keeps both rows (🔮 after 💀, 🎯 before 🎲) and both names.
- **Not verified:** the phone and big-screen layouts were not rendered; the PNG preview for the owner is still due
  before merge.
