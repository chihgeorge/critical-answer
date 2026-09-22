# Multiple-choice questions

Resolves the "題庫編輯器：multipleChoice 題型" TODO from `TODOS.md`, deferred by
`docs/designs/question-bank-editor.md`'s NOT-in-scope section (no game-engine
consumer existed for it at the time). This doc locks that consumer's shape.

## Problem

The question-bank editor (shipped v0.4.0.0) only supports `text` questions.
The design doc that shipped it explicitly deferred `multipleChoice` because
nothing in the game engine could present or judge one. This round adds that
consumer: a second question kind, playable end to end, still host-judged (not
auto-graded — that's a separate, much larger, already-deferred TODO item,
"手機答題模式（選擇題 + 自動判定）", out of scope here).

## Scope this round

**In:** `BankQuestion`/`PublicQuestion` support a `multipleChoice` kind
alongside `text`; teams see and pick an option on `/play`; the host sees the
pick on `/host` before judging; the bank editor can author MC questions.

**Out:** server-side auto-grading (separate TODO), the `image` kind (separate
TODO, needs R2), import/export, multi-bank.

## Locked architecture decisions

1. **`kind` is a required field on every `BankQuestion`, not optional.**
   Every existing bundled question gets `kind: "text"` added (one-time
   migration of `data/question-bank.json`'s 48 questions). Outside voice
   flagged that this breaks two live persisted stores that predate the field
   (`BankStore`'s saved bank, any resting room's own snapshot — `parseBank`
   throws, `restore()` discards the whole room on a parse failure) — accepted
   anyway because nothing is actually being played on the deployed game right
   now. **This is a point-in-time call, not a policy**: a future schema
   change after real users exist needs an actual backfill step, not a repeat
   of this reasoning.
2. **MC data shape:** `{ kind: "multipleChoice", id, text, options: string[],
   correctIndex: number }` — no `answer` field. `options.length >= 2`,
   `0 <= correctIndex < options.length`, validated in `parseBank`.
3. **`answerText(question)` helper** in `lib/question-bank.ts` returns the
   correct answer's display text for either kind (`text`: `.answer`; `MC`:
   `.options[.correctIndex]`). The two existing `.answer` read sites
   (`HOST_ANSWER`, `dungeon-room.ts`'s `allAnswers()` narration-leak list)
   call this instead — no kind-branching at either call site.
4. **`PublicQuestion` gains `options?: string[]`** (no `correctIndex`, ever).
   Built via `publicQuestion()`'s existing explicit-field-picking style
   (never `...spread`) — the same discipline that already keeps `correctIndex`
   (and the text kind's `answer`) off every client. Broadcast to everyone
   (team on turn, spectator screen) same as question text already is.
5. **New client message `TEAM_SELECT_OPTION { questionId, optionIndex }`** —
   the team's own phone sends it, server derives the team from the existing
   `connTeam` binding (same trust model as the shipped `TEAM_BRANCH_CHOICE`:
   no `teamId` in the payload). `optionIndex` is bounds-checked against the
   actual current question's `options.length` server-side (not just parsed as
   a number) — outside voice flagged that an out-of-range value would corrupt
   host UI (`options[currentSelection]` undefined) with nothing to catch it,
   the same class of guard `parseClientMessage` already applies to
   `HOST_JUDGE`'s `fleeChoice` enum. A stale `questionId` (team's phone
   lagging behind the room's actual current question) is rejected the same
   way `answerQuestion()` already validates `expectedQuestionId`.
6. **Re-selectable until host judgment** — unlike `TEAM_BRANCH_CHOICE`'s
   once-only model, a later `TEAM_SELECT_OPTION` for the same question
   overwrites the earlier pick. Picking an MC option is a "change your mind"
   interaction, not a one-time narrative fork.
7. **Non-blocking** — matches `TEAM_BRANCH_CHOICE`'s precedent; doesn't hold
   up turn order.
8. **`Team.currentSelection: number | null`**, broadcast via `SpectatorView`
   so the host page shows the pick without asking verbally. Reset to `null`
   on every new-question-deal, corrected from the original (wrong) outcome
   list: outside voice pointed out `AnswerOutcome` has no `flee-switch-room`
   (a different, still-unimplemented TODO) and no discrete "entering boss
   room" event (boss phase is inferred continuously via `isInBossPhase`, not
   a transition). **Correct rule: reset whenever `deal()` actually runs for
   that team — every outcome except `incorrect-retry`.**
9. **`Team.currentSelection` backfill in `restore()`**: pre-existing
   persisted `Team` objects from before this field existed get
   `t.currentSelection ?? null`, same pattern as the existing
   `branchChoices ?? {}` backfill. Doesn't throw either way, but silently
   showing `undefined` instead of `null` is a real (if minor) bug outside
   voice caught — fixed alongside decision 1's accepted risk, not exempted by
   it.
10. **Judging stays host-mediated** — the host still presses 答對/答錯 after
    seeing the pick (if any). No server-side correctness check on
    `TEAM_SELECT_OPTION` itself.
11. **Editor: kind switcher per question**, splitting the existing
    single-shape question row into `TextQuestionRow` / `MultipleChoiceQuestionRow`
    components (DRY — the alternative is an increasingly-branchy single
    component every time a third kind arrives). MC row: dynamic add/remove
    options (minimum 2), radio button marking the correct one.
12. **Deleting the marked-correct option clears `correctIndex`** (not
    auto-shift to another option) and the editor must require re-marking
    before that question can save — `parseBank` already rejects an
    unmarked/out-of-range `correctIndex`, this just makes the UI force the
    fix instead of silently landing on the wrong answer after an index shift.
13. **Kind-switch in the editor clears the other kind's fields** — no
    auto-conversion (`answer` → `options[0]`, or vice versa). Simplest, never
    produces a bogus converted value the user has to notice and fix.

## NOT in scope (this round)

- Server-side auto-grading — separate, larger, already-deferred TODO
  ("手機答題模式（選擇題 + 自動判定）"), explicitly changes the validated
  core judging flow; this round's MC questions stay host-judged.
- `image` question kind — separate TODO, needs Cloudflare R2.
- A real migration step for already-live production data — accepted risk
  this round (decision 1), not a permanent policy.
- Revisiting `MAX_BANK_BODY_BYTES` (200,000, sized for text-only questions)
  for MC's larger per-question payload — noted by outside voice, not urgent
  at 48 questions; revisit if the bank grows substantially.

## What already exists (reused / not reused)

- `TEAM_BRANCH_CHOICE`'s `connTeam`-derived trust model — reused for
  `TEAM_SELECT_OPTION`'s sender-identity derivation, NOT reused for its
  once-only submission policy (decision 6 above).
- `answerQuestion()`'s `expectedQuestionId` stale-submission guard — reused
  for `TEAM_SELECT_OPTION`'s stale-question rejection.
- `restore()`'s `branchChoices ?? {}` backfill pattern — reused for
  `currentSelection ?? null`.
- `publicQuestion()`'s explicit-field-picking discipline (never spreads
  `...q`) — reused for building the new `options` field, the same discipline
  that already keeps every host-only field off the client.
- `parseClientMessage`'s bounds/enum-checking style (e.g. `HOST_JUDGE`'s
  `fleeChoice`) — reused for `optionIndex` bounds validation.

## Failure modes

| Codepath | Failure | Error handling | Silent? |
|---|---|---|---|
| Deploy with pre-existing BankStore bank / resting room snapshot missing `kind` | `parseBank` throws | BankStore falls back to bundled bank (existing behavior); room `restore()` discards the room | **Accepted this round (decision 1) — not silent, but destructive.** |
| `TEAM_SELECT_OPTION` with stale `questionId` | Team's phone lagging | Rejected, same as `answerQuestion()`'s existing guard | No |
| `TEAM_SELECT_OPTION` with out-of-range `optionIndex` | Buggy/malicious client | Rejected at message-parse time (bounds-checked against the actual current question) | No |
| Editor: delete the marked-correct option | User error | `correctIndex` cleared, save blocked until re-marked | No |
| Old persisted `Team` missing `currentSelection` | Field didn't exist before this round | Backfilled to `null` in `restore()` | No |

## Test coverage diagram

```
CODE PATHS                                              USER FLOWS
[+] lib/question-bank.ts                                [+] Team picks & changes an MC option
  ├── parseQuestions() kind="text"/"multipleChoice"        ├── [→E2E] Pick option A, then B before host judges
  │   ├── [GAP] valid MC (>=2 options, correctIndex ok)     ├── [→E2E] Host sees the pick without asking
  │   ├── [GAP] <2 options rejected                         └── [→E2E] Stale question's late pick ignored
  │   ├── [GAP] correctIndex out of range rejected        [+] Bank editor: author an MC question
  │   └── [GAP] missing kind rejected (now required)        ├── [→E2E] Add/remove options (>=2 enforced)
  ├── answerText() text vs MC                               ├── [→E2E] Mark correct answer (radio)
  │   └── [GAP] both kinds return the right string           ├── [→E2E] Delete the marked-correct option →
  ├── publicQuestion()                                              correctIndex cleared, save blocked
  │   └── [GAP] MC pub has options, never correctIndex       └── [→E2E] Switch kind clears the other fields
[+] lib/protocol.ts                                      [+] Error states
  └── parseClientMessage TEAM_SELECT_OPTION                  ├── [GAP] Out-of-range optionIndex rejected
      ├── [GAP] valid message accepted                       └── [GAP] Non-numeric optionIndex rejected
      ├── [GAP] out-of-bounds optionIndex rejected
      └── [GAP] spoofed teamId field ignored (connTeam-derived)
[+] lib/game-state.ts
  ├── recordOptionSelection() (new, re-selectable)
  │   ├── [GAP] first pick recorded
  │   ├── [GAP] later pick overwrites the earlier one
  │   └── [GAP] stale questionId rejected
  └── currentSelection reset on every deal() except incorrect-retry
      └── [GAP] each outcome type resets (or doesn't) correctly
[+] lib/room/dungeon-room.ts
  ├── handleTeamSelectOption() — bounds-checks against the live question
  │   └── [GAP] rejects out-of-range index even if protocol layer missed it
  └── restore() — currentSelection backfill
      └── [GAP] old Team object without the field backfills to null
[+] app/bank-editor/page.tsx
  └── [→E2E] all editor flows above

COVERAGE: 0/22 paths tested (0%, not yet implemented) | Code paths: 0/16 | User flows: 0/6
GAPS: 22 (7 E2E)
```

## Worktree parallelization strategy

Sequential implementation. `lib/protocol.ts` (message type), `lib/game-state.ts`
(`Team.currentSelection` + recording logic), and `lib/room/dungeon-room.ts`
(handler) are the same tightly-coupled data flow as the DM-branching feature's
`TEAM_BRANCH_CHOICE` was — one lane, no parallelization opportunity. The bank
editor UI work (`app/bank-editor/page.tsx`) touches the same `BankQuestion`
type as the schema work, so it stays in the same lane too.

## Implementation Tasks

- [x] **T1 (P1)** — schema — `lib/question-bank.ts`: `kind` required on
  every `BankQuestion`, MC variant + validation, `answerText()` helper,
  migrate `data/question-bank.json`'s 48 questions to `kind: "text"`
  - Files: `lib/question-bank.ts`, `lib/question-bank.test.ts`,
    `data/question-bank.json`
  - Verify: unit tests — valid/invalid MC (options count, correctIndex
    bounds), missing kind rejected, `answerText()` both kinds
- [x] **T2 (P1)** — protocol — `TEAM_SELECT_OPTION` message type +
  bounds-checked parse
  - Files: `lib/protocol.ts`, `lib/protocol.test.ts`
  - Verify: unit tests — valid message, out-of-bounds/non-numeric
    optionIndex rejected, spoofed teamId field ignored
- [x] **T3 (P1)** — game-state — `Team.currentSelection`, re-selectable
  recording logic, reset-on-every-deal-except-retry, `SpectatorView` exposure
  - Files: `lib/game-state.ts`, `lib/game-state.test.ts`, `lib/turn-info.test.ts`
    (fixture update)
  - Verify: unit tests — first pick, overwrite, stale rejection, reset per
    outcome type
- [x] **T4 (P1)** — dungeon-room — `handleTeamSelectOption()` (bounds-check
  against the live question), `restore()` backfill for `currentSelection`
  - Files: `lib/room/dungeon-room.ts`, `lib/room/dungeon-room.test.ts`,
    `lib/room/persistence.test.ts`
  - Verify: unit tests — handler + a restore() round-trip test
- [x] **T5 (P1)** — publicQuestion — `PublicQuestion.options`, explicit
  field-picking (never spread), extend the existing
  "publicQuestion never contains the answer" test to assert no `correctIndex`
  - Files: `lib/question-bank.ts`, `lib/question-bank.test.ts`
  - Verify: unit test extension
- [x] **T6 (P2)** — frontend (play) — render options, send
  `TEAM_SELECT_OPTION` on tap, allow re-picking before judgment
  - Files: `app/room/[code]/play/page.tsx`
  - Verify: e2e
- [x] **T7 (P2)** — frontend (host) — show the team's current pick before
  judging
  - Files: `app/room/[code]/host/page.tsx`
  - Verify: e2e
- [x] **T8 (P2)** — frontend (bank editor) — kind switcher,
  `TextQuestionRow`/`MultipleChoiceQuestionRow` split, dynamic option
  add/remove, correct-answer radio, delete-correct-option clears+blocks,
  kind-switch clears the other kind's fields
  - Files: `app/bank-editor/page.tsx`
  - Verify: e2e covering the editor flows in the coverage diagram

## Completion summary

- Step 0: Scope Challenge — complexity check triggered (8+ files), user
  chose not to split
- Architecture Review: 2 issues found (stale-questionId handling,
  reset-trigger timing), both resolved
- Code Quality Review: 1 issue found (editor component DRY), resolved
- Test Review: diagram produced, 22 gaps identified (planning stage)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- Outside voice: ran (Claude subagent, Codex unusable — `gpt-6-astra`
  unsupported on this account). 10 findings: 1 P0 (kind-field backward
  compatibility with live persisted state — user accepted the risk
  point-in-time, nothing is actually deployed-and-played right now), 1
  P0-adjacent (currentSelection backfill, fixed), 2 P1 (test fixture scope,
  optionIndex bounds validation, both folded into implementation tasks), 1
  P1 (answer-leak discipline, folded into T5), 3 P2 (reset-trigger
  correction, reselection semantics, delete-correct-option handling, all
  resolved via user decisions), 1 P2 (kind-flip UX, resolved), 1 P3 (bank
  size constant note, deferred, no action needed at current scale)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Unresolved decisions: 0
