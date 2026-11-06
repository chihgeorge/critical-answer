# Design: the host announces every answer

Status: draft for /plan-eng-review (2026-11-05). TODO: 「每一題都由主持人宣布答案，選擇題和填空題節奏一樣」 (P2).

## Problem

A fill-in question waits for the host: the team types, the host reads the answer and presses 答對 or 答錯. A multiple-choice question does not wait. When the team locks an option, the room holds a 2-second beat (`BEAT_MS`) and judges it on its own (`resolveLock` in `lib/room/dungeon-room.ts`). After a correct answer, the next question comes on its own after 8 to 15 seconds (`rearmAdvance`).

So the two kinds feel different at the party. The host cannot build up the moment before a multiple-choice answer ("A隊鎖定了 B……答案是……"). The owner asked on 2026-10-30 for the same rhythm for every question.

## Proposal (to review)

1. **Lock waits for the host.** A team's lock (`TEAM_LOCK_OPTION`) sets `pendingLock` as today, but starts no timer. Every screen shows 🔒 and the locked letter as today.
2. **The host reveals it.** The host page shows a 公布答案 button while a lock is pending (key: the same key as 答對). A new client message, `HOST_REVEAL { teamId, questionId }`, runs today's `resolveLock`: a correct lock is judged correct, a wrong one becomes `pendingWrong` as today. The 2-second beat moves to the moment after the host's press, so phones and the TV still show the result together.
3. ~~The host page shows the correct option~~: already there (`host-answer`, `app/room/[code]/host/page.tsx:586`). Dropped from the plan.
4. **Nothing else changes in judging.** Wrong-answer choices (重答 / 逃跑), the boss room's automatic miss, the cleric's prayer and the mage's elimination stay as they are. They start after the reveal instead of after the beat.

## Open decisions (for the review)

- **D1. Auto-advance after a correct reveal.** Keep today's 8 to 15 seconds for multiple choice, or wait for the host's 下一題 like a fill-in question? "Same rhythm" suggests waiting.
- **D2. The warrior's d20.** A roll stands in for the answer and resolves after a beat (`pendingRoll`, `resolveRoll`). Should the host reveal it too, or does the die animation already play that role?
- **D3. A host page that is offline.** With no timer, a lock waits forever if the host page is closed or offline. Options: a long fallback timer (for example 60 s), or the existing stuck-row control.
- **D4. Changing the pick after the lock.** Today a lock is final once sent. With a longer wait, can the team unlock before the host reveals? (Proposal: no, the lock stays final.)
- **D5. The boss room's wrong answer.** It resolves on its own after a beat (`armBossMiss`). Keep that after the host's reveal.

## Code that changes

- `lib/protocol.ts`: `HOST_REVEAL` and its parser.
- `lib/room/dungeon-room.ts`: `handleTeamLockOption` stops starting `lockTimer`; a new `handleHostReveal` checks the host, the pending lock, the team and the question, then starts the beat and `resolveLock`. Restart and `HOST_NEXT` handling for a pending lock.
- `app/room/[code]/host/page.tsx`: the 公布答案 button and key (the correct option is already shown).
- No change to `app/room/[code]/screen/page.tsx` or `app/room/[code]/play/page.tsx`: their lock lines already wait for the reveal (「X隊鎖定了 B……」 at screen/page.tsx:199 and host/page.tsx:653, 「已鎖定！看大螢幕揭曉 ▶」 at play/page.tsx:235). Review D1.
- Tests: `lib/protocol.test.ts`; room unit tests in `lib/room/dungeon-room.test.ts` for the wait and `HOST_REVEAL`; the e2e code that locks and expects a judgment: `e2e/answer.ts` (`answerCorrectly`), `e2e/multiple-choice.spec.ts`, `e2e/class-abilities.spec.ts`, `e2e/lifecycle.spec.ts`, `e2e/restart.spec.ts`.

## Not in scope

- Fill-in questions: they already wait for the host.
- The default question bank.

## Review record (/plan-eng-review, 2026-11-05)

Scope: feature answers: D1 = A (keep the existing lock lines, no new waiting line; proposal item 3 is already built); structure: D2 = A (a new `HOST_REVEAL` message, not a second meaning for `HOST_JUDGE`); accepted scope: protocol, room, host page and the tests listed above (10 files, no new class); pending remedies: R1 to R5 below.

## Decision ledger

### R1: auto-advance after a correct reveal (doc D1)
Finding: a correct lock calls `judge(..., autoAdvance=true)` and `rearmAdvance` closes the reveal after 8 to 15 s (`lib/room/dungeon-room.ts:1514`); a fill-in waits for 下一題.
Plan baseline: open question in the draft.
Runtime evidence: `resolveLock` at dungeon-room.ts:1569 passes `true`; `handleHostNext` closes a reveal (dungeon-room.ts:1159).
State: approved
Actual answer: D3 = A (2026-11-05): wait for the host's 下一題.
Accepted scope: `resolveLock` judges a correct lock with `autoAdvance=false`, so its reveal stays until 下一題, like a fill-in. The warrior's roll on a multiple-choice question also stops auto-advancing (`resolveRoll` passes `false`), since its reveal is the same correct-answer reveal. Unit test: a correct reveal sets no advance timer and closes on `HOST_NEXT`.

### R2: the warrior's d20 (doc D2)
Finding: a roll resolves on its own after `BEAT_MS` (`handleTeamUseAbility`, `resolveRoll`, dungeon-room.ts:1646 and :1666).
Plan baseline: open question in the draft.
Runtime evidence: the die shows for the 2 s beat, then `judge` runs with the roll value.
State: approved
Actual answer: D4 = A (2026-11-05): the die is the reveal.
Accepted scope: the roll keeps its 2 s beat and judges itself; `HOST_REVEAL` does not touch `pendingRoll`. Only R1's change applies (its correct reveal waits for 下一題).

### R3: a host page that is offline while a lock waits (doc D3)
Finding: with no timer, a lock waits until `HOST_REVEAL`. `HOST_JUDGE` and `HOST_SEND_TO_BOSS` refuse while a lock is pending (dungeon-room.ts:1388, :1435), so the stuck-row keys cannot clear it either.
Plan baseline: open question in the draft (60 s fallback, or the stuck row).
Runtime evidence: a fill-in already waits for the host with no fallback (`handleHostJudge`). `pendingLock` is room-wide: while it waits, no other team can lock (`answer_pending`, dungeon-room.ts:1547).
Required with any answer (proof of the approved reveal): the host page shows 公布答案 for any pending lock, even when its team is no longer on turn, and `HOST_REVEAL` on such a lock drops it (the E9 branch of `resolveLock`). Unit test for that case.
State: approved
Actual answer: D5 = A (2026-11-05): no fallback timer; the lock waits for the host, like a fill-in.
Accepted scope: `handleTeamLockOption` starts no timer. No fallback. The host page's 公布答案 shows for any pending lock (named by the lock's team, not the turn's), and the stale-lock case gets its unit test.

### R4: changing the pick after the lock (doc D4)
Plan baseline: approved earlier. A locked pick is final until the turn resolves (phone-answering.md premise 2, enforced at dungeon-room.ts:1752).
State: approved (prior approval; no new question)
Actual answer: carried forward from phone-answering.md premise 2. A longer wait is no new risk: the team could not change it in the 2 s beat either.
Accepted scope: no change. `TEAM_SELECT_OPTION` keeps refusing a locked team.

### R5: the boss room's wrong answer (doc D5)
Plan baseline: approved earlier. A wrong boss lock shows the red tile for a beat, then resolves as a retry on its own (boss redesign D2=B, `armBossMiss`, dungeon-room.ts:1587).
State: approved (prior approval; no new question)
Actual answer: carried forward. The beat now starts after the host's reveal, because `armBossMiss` runs inside `resolveLock`.
Accepted scope: no change to `armBossMiss`.

## Review findings (Sections 1 to 4 and the outside voice)

Each one is the needed work for an approved decision (no new question), or a note.

1. **[P1, confidence 9/10] The correct-answer highlight depends on `autoAdvance`** (`judge`, dungeon-room.ts:1502, Codex). The choice (`reveal.choice`: options, correct index, points) is set only when `autoAdvance` is true. If R1 just passed `false`, a correct lock or a warrior's success would lose the green tile and the points on the TV and the phones. Work: build `choice` for every correct multiple-choice reveal, whatever the advance. After R1 nothing calls the auto-advance any more, so delete the `autoAdvance` parameter, `rearmAdvance`, `advanceTimer` and `ADVANCE_MS` (narration re-arm included). Test: a correct reveal has its `choice` and no advance timer.
2. **[P1, 9/10] A double press would start two beats** (Codex). `HOST_REVEAL` must be refused (`reveal_pending`) once the beat for that lock has started. Test: two presses give one `resolveLock`.
3. **[P2, 9/10] The host panel text is wrong after the change** (host/page.tsx:660, found by both reviewers). While the lock waits it must say 「按公布答案揭曉」, after the press 「大螢幕停頓 2 秒後揭曉」. The idle line 「選擇題由隊伍手機作答，系統自動判定」 becomes 「選擇題由隊伍手機作答，主持人公布」. The lock line names the lock's team, not `turn.team` (R3).
4. **[P2, 9/10] Key 1 does nothing on a multiple-choice turn** (`hostKeyAction`, lib/host-keys.ts:52, Codex). The design gives 公布答案 the key of 答對, so `hostKeyAction` returns `"reveal"` for 1 while a lock waits. Adds `lib/host-keys.ts` and its tests to the scope (12 files).
5. **[P3, 7/10, note] A delayed press can reveal a later lock of the same team and question** (Codex). After a wrong reveal and 重答, the team locks again. A press that left the host page before that, and arrives seconds late, would reveal the new lock. Finding 2's guard covers the double tap; a press seconds late is not credible on a party Wi-Fi. No attempt id.
6. **[P3, 6/10, note] A wrong reveal does not bump `eventSeq`** (dungeon-room.ts:1574, Codex). A stuck-row `HOST_JUDGE` sent before the lock could land after it. This is already true with today's 2 s beat, and the stuck row only shows for a team that has not answered. Not changed here.
7. **[P3, 7/10, note] A room restart drops a waiting lock** (`pendingLock` is memory only, dungeon-room.ts:190). The team sees its options again and locks again. The wait can now be longer, but nothing is lost.

Architecture: one new client message, owned by the room; the host page only sends it. The second shape (reuse `HOST_JUDGE`) was compared and rejected in D2. Red flags: none new. `HOST_REVEAL` joins the existing message union and parser (one list, parsed at the boundary).

Code quality: findings 1 and 2. The deletion in finding 1 leaves one advance rule for every question: the host's 下一題.

Tests (needed for the approved behavior):
- `lib/protocol.test.ts`: `HOST_REVEAL` with and without `teamId`/`questionId`.
- `lib/room/dungeon-room.test.ts`: a lock sets no timer (60 s later it still waits); `HOST_REVEAL` from a phone gets `not_host`; with no lock, or with the wrong team or question, `invalid_action`; correct gives a reveal with `choice` and no advance, and `HOST_NEXT` closes it; wrong gives `pendingWrong`; a boss wrong lock still resolves one beat after the reveal; a lock whose turn moved on is dropped; a second press during the beat is refused; the warrior's roll still judges itself and its correct reveal waits for 下一題. About 39 existing tests advance `BEAT_MS` after a lock; they get a `reveal()` helper first.
- `lib/host-keys.test.ts`: 1 reveals while a lock waits; 1 still does nothing with no lock.
- e2e (CI only): `answerCorrectly` presses 公布答案 after the lock; `multiple-choice.spec.ts` checks that nothing is judged until the press; `class-abilities.spec.ts` (thief, cleric) and the raw-socket specs `lifecycle.spec.ts` and `restart.spec.ts` send `HOST_REVEAL`. No new spec file: the e2e job already hit its 15-minute limit once.

Performance: no issues. One timer fewer per correct answer.

UI: the 公布答案 button is a green `ok` PixelButton like 下一題, key 1; greyed during the beat. PNG preview approved (D6 = A, 2026-11-05; mockup kept local only).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture and tests (required) | 1 | CLEAR | 7 findings: 4 folded in as needed work, 3 notes; 5 decisions (D1 to D5) answered, R4 and R5 carried from earlier approvals |
| Outside Voice | Codex `exec -s read-only` | Independent plan challenge | 1 | issues_found | 6 findings: 4 accepted, 2 kept as notes |

- **Scope:** scope reduced per recommendation (D1: no new waiting line; proposal item 3 already built). 12 files, no new class.
- **Not in scope:** fill-in questions, the default bank, the screen and phone pages, an attempt id for `HOST_REVEAL`.
- **What already exists:** the host page already shows the answer (`host-answer`); the TV and the phone already show the lock as a cliffhanger.
- **Failure modes:** a host page that is offline stops a multiple-choice question as it stops a fill-in (D5 = A, accepted).

NO UNRESOLVED DECISIONS
