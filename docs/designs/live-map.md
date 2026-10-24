# Shared big-screen live map (TODOS E3)

Status: design review and eng review done (2026-10-23). Built on branch claude/live-map (T1 to T6). Pawn slot widened 26 → 28px after the 8-team render so two-character tags do not touch.

## Goal

The big screen (`/screen`) shows a dungeon map. Each team's piece moves from room to room. The boss room shows the boss HP bar. Waiting teams can see how far the other teams are. This eases the problem that, with one global turn order, each team answers only 1/N of the time.

## What already exists

- `getSpectatorView()` (`lib/game-state.ts:604`) sends, per team: `name`, `score`, `roomIndex`, `inBossPhase`, `online`. Also `currentTurnTeamId`, `bossHp`, `bossMaxHp`.
- Rooms: one linear list shared by every team (`game.rooms`, from the question bank, length 1 or more). A correct answer moves the team one room forward, capped at the last room (`lib/game-state.ts:454`). A team stays in the last room and keeps getting questions there.
- Boss entry: a team enters boss phase when `score >= 15` (`bossThreshold`). It does not depend on `roomIndex`.
- `/screen` is a fixed 960×540 stage (`components/stage.tsx`), scaled up by whole numbers. Today's layout (top to bottom): the turn ribbon and a row of team cards (name, score x/15, `ScoreMeter`), the question panel, the monster in an archway with a nameplate, and the owl DM dialogue box.
- Design system: `DESIGN.md`. Sprites: `lib/pixel-art.ts` (`TEAM_LOOKS`, 8 looks). Motion: two-frame `steps()` only. `prefers-reduced-motion` stops blinking, typing and hopping.
- Up to 8 teams per room (`MAX_TEAMS`).

## Approved layout (Step 0.5, decision D2 = A)

A map strip replaces the team-card row at the top of `/screen` (about 90px tall). It is always visible during play. The turn ribbon stays at the left of the strip. Rooms are drawn as plain squares in a row, joined by corridors (the room numbers were dropped after launch at the host's request; only the stub keeps its "…"). The boss room is at the right end, with the boss sprite and the HP bar. Each team is a pawn (its `TEAM_LOOKS` hat) in its room. (The first mockup put the score under each pawn. D6 later removed scores from the map.) The team whose turn it is has a yellow outline and a red arrow. The question panel, monster and dialogue box do not change.

Mockup: `~/.gstack/projects/critical-answer/designs/live-map-20261023/A.png` (an HTML wireframe, not final art).

## Design decisions (review 2026-10-23)

- **D4 (1A) Progress is the room.** A pawn stands in the room given by its `roomIndex`. When a team enters boss phase (`inBossPhase`, score ≥ 15), its pawn moves into the boss room, next to the HP bar, whatever its `roomIndex` is. The jump can skip rooms, so it gets its own "charge into the boss room" motion (see the motion decision).
- **D5 (2A) Each pawn has a one-character name tag.** The tag sits above the pawn. It shows the first character of the team name in Cubic 11, at 12px or more on the stage (24px on a 1080p TV), on `--k`. If two teams share that first character, both use the shortest prefix that is unique, up to 2 characters. If 2 characters are still not unique, use the first character plus the team's number (for example 大1, 大2). The tag does not rely on color, so color-blind players can tell teams apart.
- **D6 (3C) The map shows no scores.** The strip shows position only: name tag, pawn, room. Scores stay in the DM dialogue and on each team's phone (`/play`). Known cost: waiting teams cannot see from the big screen who is close to 15 points. The pawn jumping into the boss room (D4) is the only "boss is near" cue on the map.

- **D7 (4A) No "strength bar".** The boss room shows only the HP bar (`bossHp` / `bossMaxHp`). The 強度條 from the TODO is dropped: the boss has no strength value.

- **D8 (user's own answer) Fog of war, not every room.** The strip does not show every room. It shows the rooms from room 1 up to the room of the team that is furthest ahead (the leader). Between the leader's room and the boss room is a fog band. The fog has no room numbers and does not tell how many rooms are left. Goal: the map says "the boss is still some way off, we are on the road", not "3 rooms to go". Layout rule (proposed with D8, adjustable): the fog band is as wide as 2 room slots. If the leader is past room 7, only the last 7 visible rooms are drawn and an "entrance" stub replaces the earlier ones, so the strip never holds more than 7 rooms + fog + boss. No cap on the bank's room count is needed.

- **D9 (6A) Game rule change: the boss room opens for everyone.** The first team still enters boss phase at score ≥ 15. Once any team is in boss phase, every other team enters boss phase on its next correct answer: its pawn leaves its room, crosses the fog and joins the boss room. This changes `lib/game-state.ts`: boss phase becomes a stored per-team flag (`score >= bossThreshold` OR "another team was in boss phase when this team answered correctly"), not a value derived from score alone. `RoomSnapshot` needs a `SCHEMA_VERSION` bump. Narration's `entersBoss` should keep working because it compares the boss phase before and after the answer. Needs /plan-eng-review.
- **D10 (7A) Room width follows its pawn count.** Pawns in a room stand in one row, each with its tag visible. An empty room is 40px wide. Each pawn adds 26px, so 8 pawns make a room about 210px wide. The boss room uses the same rule (plus space for the boss sprite and HP bar), so it widens as teams charge in. The strip re-lays out when a pawn moves. The width change is part of the move motion.
- **D11 (8A) An offline team's pawn stays in place at 50% opacity with a "zz" mark.** This matches the team cards' `opacity-50` today. The pawn keeps its slot, so room widths (D10) do not change on disconnect. A new small "zz" sprite goes in `lib/pixel-art.ts`.
- **D12 (9A) The strip shows only while `phase === "playing"`.** The `Finished` (podium) screen and the lobby do not change. The strip lives inside the `Playing` component.
- **No protocol change needed for room count.** With fog (D8) the client never needs the total room count: it draws rooms 1 to `max(team.roomIndex)` and then fog. `SpectatorView` already has every field the strip needs (`roomIndex`, `inBossPhase`, `online`, `name`, `currentTurnTeamId`, `bossHp`, `bossMaxHp`). D9's stored boss flag reaches the client through the existing `inBossPhase` field.
- **D13 (10A) Move motion.** One room forward: the pawn hops into the new room in two `steps()` frames, and the new room's outline flashes `--turn2` once (about 0.6 s total). Into the boss room (D4/D9): the pawn vanishes into the fog for one frame, then appears in the boss room for one frame, and the boss room's outline flashes once. With `prefers-reduced-motion`, the pawn just changes place with no hop or vanish, but the one outline flash stays: it is a state cue, not decoration. DESIGN.md's Rules section gets this one exception written down. The strip changes on the same `STATE` as the ribbon, question and DM line. It has no timing of its own.
- **D14 (11A) The boss door opens.** At game start the boss room is a closed dark-red door (a new sprite in `lib/pixel-art.ts`). When the first team enters boss phase, the door opens and the fog band lightens, on the same `STATE` as the DM's boss-enter line (`BOSS_ENTER_VARIANTS`). The open door stays open for the rest of the game, so the map keeps saying "answer one more and you are in" (D9).
- **D15 (12A) The boss and its HP bar appear only when the door opens.** Before that, the boss room is only the closed door. When the door opens (D14), the boss sprite and the HP bar appear together.
- **D16 (13B) The fog is pixel cloud sprites.** A few cloud sprites overlap to fill the fog band. They are drawn in `lib/pixel-art.ts` like the other sprites, scaled by whole numbers only, with no gradient or blur. "The fog lightens" (D14) means fewer clouds. If the clouds drift, it is a two-frame `steps()` motion that stops under `prefers-reduced-motion`.
- **D17 (14A) Reuse existing parts.** A pawn is the team's existing `hero` sprite with its `TEAM_LOOKS` hat (the same one the team cards and `/play` show), scaled by a whole number. The name tag is `LabelChip`, with a cream-text variant if orange text is not right for names (cream on `--k` passes contrast). No new pawn sprite. New sprites are only: closed boss door (D14), clouds (D16), "zz" (D11).
- **D18 (15A) Branch choices are not shown on the map.** `branchChoices` (fight / negotiate) stays in the DM narration only. The strip shows position only, as D6 says.
- **Open (product, not decided here):** should the 15-point boss threshold be told to the players? The map does not show it either way (D6, D8).

### Information hierarchy (Pass 1)

The viewer reads in this order: (1) the question, (2) the monster, (3) the DM line, (4) the strip. The answering team needs 1 to 3. A waiting team glances at 4. Inside the strip, the pawns and their name tags carry the most weight. Rooms and corridors recede. The boss room is the only red area.

```
y=0   ┌──────────┬─────────────────────────────────────────┬──────────────┐
      │ ▶ 輪到：紅│ [1]──[2]──[3]──[4]──[5]                 │ 👑 BOSS  ███░ │  strip, 90px
      │  (ribbon) │      藍         紅   綠                  │  (HP bar)    │  pawns + tags
y=90  ├──────────┴─────────────────────────────────────────┴──────────────┤
      │                     question panel (unchanged)                    │
      │                     monster + nameplate (unchanged)               │
      │                     DM dialogue box (unchanged)                   │
y=540 └───────────────────────────────────────────────────────────────────┘
```

### Journey storyboard (Pass 3)

| Step | What happens | A waiting team feels | Supported by |
|------|--------------|----------------------|--------------|
| 1 | Game starts: all pawns in room 1, fog ahead, boss door closed | "We are all at the start; the boss is out there somewhere" | D8, D10, D14 |
| 2 | Another team answers right; its pawn hops forward | "They moved. We have to catch up" | D13 |
| 3 | Our turn passes; we glance up and find our tag | "We are here, two rooms behind 紅" | D5, D10 |
| 4 | The leader walks into new rooms; the fog moves back with it | "The road keeps going; nobody knows how far" | D8 |
| 5 | The first team reaches 15: its pawn charges through the fog, the door opens, the boss and HP bar appear, the DM announces it | "The boss is open! One more right answer and we are in" | D4, D9, D14, D15 |
| 6 | Trailing teams answer right and charge into the boss room one by one; the boss room widens | "Everyone is in for the finale" | D9, D10, D13 |
| 7 | The boss falls; the podium takes over | "Who won?" (podium, unchanged) | D12 |

Time horizons: 5 seconds (glance) = find our tag, see who is ahead. 5 minutes (a play session) = the race, then the door opening as the turning point. Long term = the door-opening moment is the one people remember.

## Open design questions

All the questions listed before the review now have decisions: strength bar (D7), room count (D8), 8 pawns in one room (D10), boss-phase position (D4), telling teams apart (D5), motion (D13), offline teams (D11), room count in `SpectatorView` (not needed, see D12's note), podium and lobby (D12). The product questions left about scoring (the 15-point threshold, `9 / 15` on phones after an early boss entry, winners by score while boss hits give none) are one TODO in TODOS.md (eng review D5) and do not block this work.

## NOT in scope

- Scores on the map (D6): they stay in the DM line and on `/play`.
- Branch-choice markers (D18).
- A frozen map on the podium screen (D12).
- A cap on the number of rooms in a bank: fog (D8) makes it unnecessary.
- Scoring display and rules: phones and `/host` keep `score / 15` unchanged in this PR. A team that enters the boss early shows `9 / 15` there until the scoring TODO lands (eng review D5).
- Final pixel art. The mockups are HTML wireframes. The gstack designer could not run because it has no OpenAI key.

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| `/screen` play view, layout | /Users/georgechih/.gstack/projects/critical-answer/designs/live-map-20261023/A.png | A: map strip replaces the team-card row | Picked over B (full-screen interlude) and C (left tower). Wireframe only. |
| `/screen` strip, after review | /Users/georgechih/.gstack/projects/critical-answer/designs/live-map-20261023/v2.png | A2: fog clouds, closed then open boss door, one-character tags, no scores | Wireframe only. Pawns must be the real `hero` + `TEAM_LOOKS` sprites (D17). The boss room must fit the boss sprite, the HP bar on top and a row of pawns below inside the 90px strip. |

## Implementation Tasks

Synthesized from this review's findings. Each task comes from one decision above. Run with Claude Code or Codex; check off as you ship. Effort assumes the feature ratio (human ÷ CC ≈ 30×) and the bug-fix-with-test ratio (≈ 20×) for the rule change.

- [x] **T1 (P1, human: ~4h / CC: ~20min)** — game-state — Store boss phase per team and open the boss room for everyone (D9)
  - Surfaced by: design Pass 2 — D9; eng review E1 (D1 = B), E2 (D2 = A), mechanics note
  - Files: `lib/game-state.ts` (team `inBoss` flag, `isInBossPhase` reads it, `createGame` init, `correct-room-advance` outcome gets `entersBoss`), `lib/game-state.test.ts`, `lib/room/snapshot.ts` (`SCHEMA_VERSION` 2 → 3), `lib/room/persistence.test.ts`, `lib/narration/events.ts` + `events.test.ts` (read `outcome.entersBoss`, drop the score math), `lib/room/dungeon-room.test.ts` helpers
  - Verify: `npm run test`. Cases in the test plan below.
- [x] **T2 (P1, human: ~1d / CC: ~40min)** — screen — Build the map strip in `Playing` (D4, D5, D8, D10, D11, D12, D17, D18)
  - Surfaced by: Pass 1, Pass 2, Pass 5
  - Surfaced by (eng): E6 (D6 = A) width budget; mechanics note on file split
  - Files: new `lib/map-layout.ts` + `lib/map-layout.test.ts` (pure, types only, takes a width budget), new `components/map-strip.tsx`, `app/room/[code]/screen/page.tsx` (swap the team-card row), `components/pixel.tsx` (`LabelChip` cream variant), `lib/pixel-art.ts`
  - Verify: `lib/map-layout.test.ts` (cases in the test plan below); `npm run e2e` screen test still passes; `npm run check:bundle`.
- [x] **T3 (P1, human: ~3h / CC: ~15min)** — sprites — Draw the closed boss door, cloud and "zz" sprites (D11, D14, D16)
  - Surfaced by: Pass 3, Pass 4
  - Files: `lib/pixel-art.ts`
  - Verify: render at 1× and 2× and check that pixels stay square.
- [x] **T4 (P2, human: ~3h / CC: ~15min)** — motion — Hop, room flash, charge through the fog, door opening (D13, D14, D15)
  - Surfaced by: Pass 3
  - Files: `app/globals.css`, the map strip component
  - Verify: with `prefers-reduced-motion`, no hop, vanish or cloud drift, but the one outline flash stays.
- [x] **T5 (P2, human: ~20min / CC: ~3min)** — docs — Write the reduced-motion flash exception and the new sprites into DESIGN.md (D13, D16, D17)
  - Surfaced by: Pass 5
  - Files: `DESIGN.md`
  - Verify: read-through.
- [x] **T6 (P2, human: ~1h / CC: ~10min)** — QA — Render an 8-team, 10-room game at 1920×1080 and check it from couch distance
  - Surfaced by: outside voice (Claude subagent): "render an 8-pawn, 10-room PNG at 1920×1080"
  - Files: none (manual QA / `/design-review` after build)
  - Verify: every tag readable, no overlap, boss room holds 8 pawns.

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md present; UI scope: /screen strip  |
  | Step 0               | 2/10, full review (all 7 passes)            |
  | Pass 1  (Info Arch)  | 3/10 → 8/10 after fixes                     |
  | Pass 2  (States)     | 2/10 → 8/10 after fixes                     |
  | Pass 3  (Journey)    | 3/10 → 9/10 after fixes                     |
  | Pass 4  (AI Slop)    | 6/10 → 9/10 after fixes                     |
  | Pass 5  (Design Sys) | 5/10 → 9/10 after fixes                     |
  | Pass 6  (Responsive) | 4/10 → 9/10 after fixes                     |
  | Pass 7  (Decisions)  | 1 resolved, 0 deferred                      |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (6 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 1 item proposed, 1 added                    |
  | Approved Mockups     | 3 generated (A/B/C) + 1 revised, A approved |
  | Decisions made       | 16 added to plan (D2, D4–D18)               |
  | Decisions deferred   | 0                                           |
  | Overall design score | 2/10 → 8/10                                 |
  +====================================================================+
```

Pass 6 note: `/screen` is a fixed 960×540 stage scaled by whole numbers, with no input. The a11y gaps were tag size and color-only identity (fixed by D5) and reduced motion (D13, D16). No other responsive work is needed.

Mockups note: the gstack designer failed with "No OpenAI API key found". The mockups are HTML wireframes rendered with Playwright, made in the project's fonts and palette.

### Unresolved Decisions

None from this review. The 15-point threshold question is a product decision, tracked in TODOS.md.

## Eng review (2026-10-23)

### Premise table (reality rows)

| premise | claim | receipt | verdict |
|---|---|---|---|
| Boss phase is derived from score | `isInBossPhase` = `score >= bossThreshold` | `lib/game-state.ts:302` | true |
| All boss checks go through one function | `answerQuestion`, `resetBossSelections`, selection check, room question id, spectator view | `lib/game-state.ts:313,380,545,612`, `lib/room/dungeon-room.ts:346` | true |
| Narration re-derives the threshold | `entersBoss` uses score math, not the game's state | `lib/narration/events.ts:51-55` | true, must change with D9 |
| Clients read `inBossPhase` from the view | `describeTurn` | `lib/turn-info.ts:28` | true |
| Phones and host already show the 15 | `score / BOSS_THRESHOLD` text and meter | `app/room/[code]/play/page.tsx:164`, `host/page.tsx:372`, `components/pixel.tsx:227` | true: the threshold is already public on phones |
| A snapshot field can be added without a bump | `lastActivityAt` was added with a null backfill | `lib/room/snapshot.ts:33,56` | true (precedent) |
| Nothing landed on main since the design review | `git log origin/main --since=2026-10-22` on the named files | empty | true |

unverified=0

### Decision ledger

- E1 (Architecture) — snapshot migration for the stored boss flag. State: decided (D1 = B, user). Bump `SCHEMA_VERSION` to 3; an old snapshot is discarded. The recommendation was A (backfill); the user chose the simpler bump and accepts that a game in progress at deploy time restarts.
- E2 (Code quality) — where `entersBoss` comes from. State: decided (D2 = A, user). `answerQuestion` puts `entersBoss: boolean` on the `correct-room-advance` outcome; `events.ts` reads it.
- E3 (Architecture) — phones and host show `9 / 15` for a team that entered the boss early. State: superseded. D3 = A (fix now) was replaced by D5 ("先不動分數 之後我們重新研究分數") and its confirmation D5b = A: no change to `/play` or `/host` in this PR; folded into the scoring TODO.
- E4 (Scope) — 11 files, one new component. State: decided (D4 = A, user). One PR.
- D5b (confirmation of D5) — State: decided (A, user): `/play` and `/host` keep `score / 15` in this PR; one scoring TODO covers the early-entry `9 / 15`, threshold disclosure and winners-by-score.
- E5 (Outside voice, High, codex) — D3's boss label would hide the score, but winners are still the top score (`lib/game-state.ts:345`) and boss hits give no points. State: deferred (D5, D5b = A, user). Scoring gets its own TODO.
- E6 (Outside voice, Medium, codex) — no whole-strip fit rule inside 960px (ribbon + up to 7 rooms + fog + growing boss room). State: decided (D6 = A, user). `lib/map-layout.ts` takes a width budget and drops the oldest drawn rooms into the entrance stub until it fits; unit-test the worst case.
- Mechanics (no question): `createGame` sets each team's flag to `score >= bossThreshold`, so the tests that start with `bossThreshold: 0` (`lib/game-state.test.ts:232-295`) still start in the boss phase. The `lib/room/dungeon-room.test.ts` helpers that pick the question with `t.score >= bossThreshold` (lines 329, 854, 920, 1129, 1326) switch to `isInBossPhase`.
- Mechanics (no question): the strip is `components/map-strip.tsx`; its pure layout lives in `lib/map-layout.ts` and imports only types, so `check:bundle` stays clean.

Approval readiness: PASS. E1 ← D1 = B; E2 ← D2 = A; E3 superseded by D5 + D5b = A; E4 ← D4 = A; E5 deferred by D5 + D5b = A (TODO added); E6 ← D6 = A; scoring TODO ← D5b = A. Mechanics notes need no approval (they keep current behavior).

### Architecture: boss entry after D9

```
answerQuestion(correct, not in boss)
   │
   ├─ score + points >= 15 ──────────────┐
   │                                     ├─► team.inBoss = true, outcome.entersBoss = true
   └─ any team already inBoss (door open)┘        │
                                                  ├─► events.ts: entersBoss narration (once per team)
   otherwise: room advance as today               └─► view.teams[i].inBossPhase → strip: pawn charges into boss room;
                                                      first entry opens the door (D14), shows boss + HP (D15)
isInBossPhase(game, id) = team.inBoss   (all 5 callers unchanged)
createGame: inBoss = score >= threshold (0 → true for tests)
snapshot: SCHEMA_VERSION 3, a v2 save is discarded (D1)
```

### Test coverage (plan → tests)

```
lib/game-state.ts
  correct-room-advance
    ├─ first team reaches 15 → inBoss, entersBoss          [T1 new]
    ├─ door open, 2nd team correct at 9 → inBoss, entersBoss [T1 new]
    ├─ door open, 2nd team wrong (retry) → not in boss      [T1 new]
    ├─ door open, 2nd team flees → not in boss              [T1 new]
    └─ team already in boss never gets entersBoss again     [T1 new]
  createGame threshold 0 → everyone starts in boss          [existing tests, keep green]
  boss hit / kill / flee with a team that entered below 15  [T1 new: kill bonus + winners by score]
lib/narration/events.ts
  entersBoss read from outcome (score math deleted)         [events.test.ts update]
lib/room/snapshot.ts
  v2 save → null (discarded), v3 round-trips inBoss         [snapshot/persistence tests update]
lib/map-layout.ts (pure)
  ├─ room width 0..8 pawns (40 + 26/pawn)                  [T2 new]
  ├─ rooms drawn 1..leader, fog after, entrance stub       [T2 new]
  ├─ width budget: 8 teams in 7 rooms + long ribbon fits   [T2 new, E6]
  ├─ boss room with 8 pawns fits                           [T2 new]
  ├─ door closed until first inBoss, open after            [T2 new]
  └─ tags: unique prefix, clash → char + number            [T2 new]
components/map-strip.tsx
  renders on /screen in phase playing only                 [e2e screen test still passes]
bundle
  map-layout / map-strip import no BANK                    [npm run check:bundle]
```

Gaps found: 1 (the `bossThreshold: 0` tests and the `dungeon-room.test.ts` question helpers depend on the derived rule; covered by the mechanics note).

Test plan artifact: `~/.gstack/projects/critical-answer/main-eng-review-test-plan-20261023.md`.

### Performance

No findings. The strip is computed from `SpectatorView` (at most 8 teams, ≤ 7 drawn rooms) once per STATE message [estimated]. No new storage reads, network calls or timers beyond CSS animation.

### Failure modes

| Path | Realistic failure | Test / handling | User sees |
|---|---|---|---|
| Stored boss flag | flag not set on the 2nd team's correct answer | T1 unit case | narration and strip both wrong; caught by test |
| Snapshot bump | deploy during a game discards the room (D1 = B, accepted) | persistence test asserts v2 → discarded | phones show the existing "game reset" notice |
| `entersBoss` from outcome | narration fires twice for one team | T1 "never again" case | duplicate DM line; caught by test |
| Width budget | long ribbon + crowded rooms overflow 960px | `map-layout.test.ts` worst case | boss room cut off; caught by test |
| Bundle | strip imports `lib/question-bank-data.ts` | `npm run check:bundle` in CI | answers leak; blocked by CI |
| Early entry score | phone shows `9 / 15` while fighting the boss | none (deferred, D5) | visible, not silent; tracked in TODOS.md |

Critical gaps: 0.

### Worktree parallelization

| Step | Modules touched | Depends on |
|---|---|---|
| T1 rule | `lib/` (game-state, room, narration) | — |
| T2 + T3 + T4 strip | `lib/` (map-layout, pixel-art), `components/`, `app/`, `app/globals.css` | T1 (reads `inBossPhase` semantics) |
| T5 docs | `DESIGN.md` | T3, T4 |

Lane A: T1 → T2 → T3 → T4 → T5. Sequential implementation, no parallelization opportunity: both lanes share `lib/`, and the strip's door state depends on T1.

### Eng review completion summary

- Step 0: Scope Challenge — scope accepted as-is (D4 = A, one PR)
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises
- Architecture Review: 2 issues found (E1 snapshot, E3 early-entry score display)
- Code Quality Review: 1 issue found (E2 entersBoss source)
- Test Review: diagram produced, 1 gap identified (derived-rule fixtures)
- Performance Review: 0 issues found
- NOT in scope: written (scoring display added)
- What already exists: written (design review section, unchanged)
- TODOS.md updates: 1 item proposed to user (scoring redesign, D5b), replaces the 15-point TODO
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex (gpt-6-luna), completed, 2 findings (1 High deferred to TODO, 1 Medium accepted)
- Parallelization: 1 lane, 0 parallel / 5 sequential
- Lake Score: 4/5 (D1 picked the 7/10 option)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run for this plan |
| Outside Review | `codex exec` (eng plan review) | Independent 2nd opinion | 2 | completed | design: Codex + Claude subagent, all decided; eng: 1 High (deferred to TODO), 1 Medium (accepted) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 4 issues, 0 critical gaps (all decided; open = mapped to T1/T2) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 2/10 → 8/10, 16 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** design phase: Codex completed with findings, Claude subagent completed with findings. Eng phase: Codex (provider openai, model gpt-6-luna) completed, 2 findings.
- **CROSS-MODEL:** the eng review and Codex did not overlap. The review found the snapshot, narration and fixture issues; Codex found winners-by-score and the whole-strip width.
- **VERDICT:** DESIGN CLEARED. Eng review ran with every decision made; status ISSUES OPEN means the findings are mapped to T1 and T2, not that a choice is pending. Ready to implement.

NO UNRESOLVED DECISIONS
