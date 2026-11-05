# 換手機接手隊伍（主持人配對碼）

Status: reviewed by /plan-eng-review 2026-11-05. Approach A (host code) was chosen by the owner 2026-11-05, with a
local-only mockup (`takeover.png` in the session scratchpad).

## Problem
After HOST_START, a phone that lost its localStorage (dead battery, other browser, private tab) has a new
`teamId`/`teamKey`, so JOIN gets `game_already_started`. The team stays offline and is skipped for the rest of
the game. The host has no way to hand the team to the new phone (`lib/room/dungeon-room.ts` handleJoin).
TODOS.md: 「隊伍換手機或換瀏覽器後回不了遊戲」. Its partner TODO 「手機被拒絕加入時不顯示原因」 shipped in v0.24.1.0
(`lib/join-rejection.ts`), so this has no blocker.

## Approach (A), after review
1. **Host page.** During a game, every team row shows 「交給新手機」. On a row still marked online it first asks
   `confirm("這隊還在線上，確定要交給新手機？")` (D6). It sends `HOST_HANDOFF {teamId}`.
2. **Room.** Checks host, a game in progress, a known team. Makes a 4-digit code
   (`crypto.getRandomValues`, not equal to another live code), valid 5 minutes (`this.now()`), one use. One live
   code per team: a new request replaces the old one. Sends `HANDOFF_CODE {teamId, code}` to the requesting host
   connection only. The code lives in memory only (D1).
3. **Phone.** The `game_already_started` and `bad_token` rejection screens get (D8) a 4-digit input 「換了手機？輸入主持人給的配對碼」.
   It sends `TEAM_CLAIM {code}`.
4. **Room.** On a live matching code: burns it and replies `TEAM_CLAIMED {teamId, teamKey}` with the team's
   existing key (D2). The phone writes both to its stored team id/key, clears the rejection and sends a normal
   JOIN. The existing `claimTeam` path binds the connection and sets the team online. Reloads JOIN as that team.
5. **Wrong or expired code.** `ERROR bad_code`. The phone shows 「配對碼不對或過期了，請主持人再按一次」. The socket
   stays open. After 5 wrong claims in the room, every live code burns (D4); the host presses again.

## Decision ledger
All rows below are auto-decisions under the owner's standing rule (only ask what Claude truly cannot decide).

| ID | Choice | Decision | Why |
|----|--------|----------|-----|
| D1 | Code survives a room restart? | Memory only. | The room never hibernates (`worker/index.ts:99`), so memory lasts until a deploy or eviction. Then the phone gets `bad_code` and the host presses again. No snapshot field, no schema bump. |
| D2 | New phone gets a new key (re-key) or the team's existing key? | Existing key. | Re-keying needs a new key mapping, unbinding old connections and a new message for the old phone (it would get a misleading 「加入失敗，請換一個瀏覽器」). With the shared key, the claim reuses JOIN/`claimTeam` unchanged. Cost: the old phone, if it comes back, still plays for the team. That is harmless at a party. Changes the draft's step 4. |
| D3 | Lobby too? | Game only. | In the lobby a new phone just joins with a new name, and the host can remove the old row. |
| D4 | Rate limit | 5 wrong claims per room burn every live code. No per-connection cap; failed claims do not close the socket. | The room-wide count is the only bound that holds against many sockets: at most 5 guesses per 10,000 codes per code issued. A per-connection cap adds code and stops nothing. |
| D5 | Big screen notice? | None. The team row just turns online again. | No requirement for it; keeps the PR to room, host page and phone page. |
| D6 | Offline teams only? | No: every row, with a confirm on an online row. Changed after the outside voice. | The room has no heartbeat (no ping in `lib/room/dungeon-room.ts` or `lib/use-room-socket.ts`), so a phone that dies without closing its socket can stay "online" for minutes. With D2 a wrong handoff is harmless (both phones play for the same team); the confirm stops a casual misclick. |
| D8 | `bad_token` too? | Yes, the same input. Added after the outside voice. | A browser that kept the team id but lost the key gets `bad_token`, not `game_already_started`. Same screen, one more case in the condition. |
| D7 | Tests | Room unit tests + protocol parse tests + one e2e spec. | See Test review. |

Approval readiness: PASS (D1–D8, authorized auto-decisions under the owner's standing rule, 2026-11-05).

## Step 0: Scope challenge
- **What already exists:** `claimTeam` (bind a connection, set online), `setTeamOnline`, the `ERROR` →
  `rejected` path (a failed message is not activity), `lib/join-rejection.ts` (phone rejection text), the host
  team rows with `（離線）` (`app/room/[code]/host/page.tsx:610`), `storedOrCreate` in `lib/room-code.ts`,
  `RoomOptions.now` for tests.
- **Minimum change:** 2 client messages, 2 server messages, 1 error code, about 40 lines in the room, a button
  plus code display on the host page, an input on the phone's rejection screen, a setter in `lib/room-code.ts`.
- **Complexity:** 7 files, 0 new classes/services. Under the 8-file bar.
- **Reality rows:** premise-table below; already-done: `git log origin/main --since=2026-11-05` touches none of
  this; surface-check: no CLI or route; binding-decisions: none on this branch; numbers: 4 digits / 5 min / 5
  guesses are `[estimated]` policy, not measurements; deferred-asks: the TODO's alternative (team name + host
  approval) is not built; pr-count: one PR.

| Premise | Receipt | Verdict |
|---------|---------|---------|
| Unknown teamId in a game gets `game_already_started` | `lib/room/dungeon-room.ts:1002-1004` | verified |
| The room keeps connections in memory, no hibernation | `worker/index.ts:98-99` | verified |
| Team id/key are global localStorage keys | `lib/room-code.ts:10-11,51-61` | verified |
| A rejected message is not activity | `lib/room/dungeon-room.ts:418`, dispatch tail | verified |
| Host rows know online state | `app/room/[code]/host/page.tsx:610-612` | verified |

PLAN_REALITY: 7/7 applicable rows emitted, 0 unverified premises.

## 1. Architecture
```
host page                room (DungeonRoom)                        new phone
──────────               ──────────────────                        ─────────
交給新手機 ─HOST_HANDOFF─▶ host? game? team offline?
                          code = 4 digits, expires now+5m
          ◀─HANDOFF_CODE─ (requester only)
shows 「配對碼 1234」                                        JOIN ─▶ game_already_started
                                                          ◀─ ERROR   (screen shows code input)
                          match live code? ◀──TEAM_CLAIM {code}──
                          burn; reply ────TEAM_CLAIMED {teamId,teamKey}─▶ write storage
                          claimTeam() ◀──────JOIN (old id + key)──
                          broadcastState: team online ───STATE──▶ game screen
```
Findings:
1. The draft's re-key path left old connections bound to the team (`connTeam`) and gave the returning old phone
   a misleading message. Resolved by D2.
2. The code must never ride in STATE or LOBBY (spectators and every phone get those). It goes only via
   `sendTo(conn)` to the requesting host connection.

## 2. Code quality
1. The room's checks for HOST_HANDOFF reuse `requireHost`; the codes live in one `Map<teamId, {code, expiresAt}>`
   plus one wrong-guess counter, cleared wherever game state resets (back to lobby, a new game).
2. `lib/room-code.ts` needs `storeTeam(id, key)` that also updates `madeThisLoad`, so a private tab whose
   storage write fails still uses the claimed identity for this page load.

## 3. Tests
```
CODE PATHS                                          TEST
HOST_HANDOFF  not host -> not_host                  dungeon-room.test.ts
              lobby / unknown team                  dungeon-room.test.ts (game_already_started / unknown_team)
              ok -> HANDOFF_CODE to requester only  dungeon-room.test.ts (spectator gets nothing)
              second request replaces the first     dungeon-room.test.ts
TEAM_CLAIM    right code -> TEAM_CLAIMED, burned    dungeon-room.test.ts (second claim -> bad_code)
              expired (now + 5m + 1)                dungeon-room.test.ts (injected now)
              5 wrong -> live codes burn            dungeon-room.test.ts
              then JOIN with claimed id -> online   dungeon-room.test.ts
parse         new messages, bad code shape          protocol.test.ts
phone text    bad_code; code input on both errors   join-rejection.test.ts
full flow     host button -> phone input -> game    e2e/team-handoff.spec.ts (CI only)
```
Value cards ride with each test in the implementation (repo convention). Tests to retire: none.

## 4. Performance
One map lookup per message; the map holds at most `MAX_TEAMS` entries. No issues.

## NOT in scope
- Team name + host approval flow (the TODO's alternative): the code is enough for one event.
- Big screen toast (D5).
- Persisting codes across restarts (D1).

## Failure modes
| Path | Failure | Covered | User sees |
|------|---------|---------|-----------|
| Code issue | Room restarted after issue | test: unknown code → bad_code | phone: 「配對碼不對或過期了」 |
| Claim | Storage write fails (private tab) | `storeTeam` keeps it in memory | game works until reload |
| Claim | Two phones claim the same code | first wins, second `bad_code` | clear message |
| Old phone returns | Plays for the team too | accepted (D2) | team works on both |

Critical gaps: 0.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity (the protocol change gates both pages).

## Implementation Tasks
- [ ] **T1 (P1, human: ~3h / CC: ~20min)** — protocol + room — HOST_HANDOFF, TEAM_CLAIM, HANDOFF_CODE, TEAM_CLAIMED, `bad_code`
  - Surfaced by: Architecture 1–2, D1–D4, D6
  - Files: `lib/protocol.ts`, `lib/room/dungeon-room.ts`, `lib/protocol.test.ts`, `lib/room/dungeon-room.test.ts`
  - Verify: `npm run test`
- [ ] **T2 (P1, human: ~2h / CC: ~15min)** — host page — 交給新手機 button on offline rows, show the code
  - Files: `app/room/[code]/host/page.tsx`
- [ ] **T3 (P1, human: ~2h / CC: ~15min)** — phone — code input on the rejection screen, `storeTeam`, JOIN again
  - Surfaced by: Code quality 2
  - Files: `app/room/[code]/play/page.tsx`, `lib/room-code.ts`, `lib/join-rejection.ts` (+ tests)
- [ ] **T4 (P2, human: ~1h / CC: ~10min)** — e2e — one spec for the full flow
  - Files: `e2e/team-handoff.spec.ts`
- [ ] **T5 (P2)** — TODOS.md — mark 「隊伍換手機或換瀏覽器後回不了遊戲」 completed

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (re-key detail changed by D2)
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises
- Architecture Review: 2 issues found
- Code Quality Review: 2 issues found
- Test Review: diagram produced, 0 gaps identified
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (T5 closes an existing one)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex completed, 2 findings (Medium, Low), both accepted as D6 change and D8
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: N/A (no answers scored)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (plan-review, default-on) | Independent 2nd opinion | 1 | completed | 2 findings (Medium, Low), both accepted |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 4 issues, 0 critical gaps (all resolved in the plan) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review, completed: no heartbeat means a dead phone can stay "online" (D6 changed); `bad_token` gets the same recovery input (D8).
- **CROSS-MODEL:** Claude found the re-key unbinding gap (D2); Codex found the heartbeat and `bad_token` gaps. No overlap, no disagreement.
- **VERDICT:** Eng review done with every finding mapped to a task; ready to implement.

NO UNRESOLVED DECISIONS
