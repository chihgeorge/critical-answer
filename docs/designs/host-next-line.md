# 「下一句這樣說」：主持人指定下一句旁白

狀態：草稿（2026-10-31），等 `/plan-eng-review`。來源：TODOS.md 的同名 P2 項目。

## 問題

第二次玩測（2026-09-21）時，主持人在導演筆記裡寫了「下一句是 不怕死的冒險者不知道珍珠是什麼意思？能吃嗎?」，旁白卻沒說出來。導演筆記只管語氣和風格，不是逐字台詞。「改寫目前旁白」只能換掉已經出現的那一句，沒辦法預先排好下一句。

主持人頁的導演筆記說明已經寫了「只影響語氣與風格，不是逐字台詞」，TODO 裡「順手做」的那一項已經完成。

## 做法（D1=B 收緊版，見 D8、D9）

主持人預先排好一句話（最多 40 字）。下一次一般旁白（不含後記）的**第二段**一定會有這句，說出來就清掉。

- **AI 旁白：** 有排句子時，提示詞的第二行指示換成：「第二行要包含主持人指定的這句話，字要一樣（標點可以改），前後可以加幾個字自然銜接，整行最多 50 字」（D8）。
- **只看第二段（D9）：** 第二段去掉空白與標點、做 NFKC 後包含這句（同樣處理過）才算說到。沒說到（逾時、失敗、輸出無效、AI 改了字、或寫在別行），就用原句**覆蓋第二段**。第一段「發生什麼事」和第三段「輪到誰」永遠不會被擠掉，第二段的改寫版也會被蓋掉，不會重複。
- **含題庫答案（D9）：** 這句包含 3 字以上的題庫答案時，不放進提示詞（否則 `llm.ts` 的 `forbidden` 會讓整次 AI 輸出作廢），直接逐字。
- **沒開 AI（腳本旁白）：** 逐字覆蓋第二段。

### 資料流

```
主持人頁 ──HOST_NEXT_LINE{line}──▶ DungeonRoom.nextLine = {text, gen}（存檔）
                                        │  每次 narrate(非後記)
                                        ▼
         event = { ...event, hostLine: text }；記住 eventId → gen
         （text 含題庫答案時另加 hostLineVerbatim: true，提示詞不放）
                                        │
               ┌────────────────────────┴───────────────────────┐
               ▼                                                ▼
   llm.ts buildPrompt：第二行要包含 hostLine         scripted：不看 hostLine
               │                                                │
               └──────────────▶ runner.run 組好各段 ◀────────────┘
                                        │ 第二段沒包含 hostLine？
                                        │   是 → 第二段 = hostLine，sources[1]="host"
                                        ▼
                         room emit（過時的旁白照舊丟掉，不消耗）
                                        │ 沒被丟掉，且 nextLine.gen 還是這個事件記住的 gen
                                        ▼
         先清 nextLine，再廣播 NARRATION（同一次存檔），通知所有主持人連線
```

1. 主持人頁 `⚙ 更多` 新增一區「下一句這樣說（最多 40 字）」：輸入框、「排進下一句」按鈕；已排入時顯示「已排入：…」和「取消」（D3）。這一區只在收到過 `HOST_NEXT_LINE_STATE` 之後、且遊戲還沒結束時顯示（D5、D10）。
2. 用戶端訊息 `HOST_NEXT_LINE { line }`，原本就是空字串代表取消。伺服器用 `sanitizeText(raw, MAX_EDIT_LINE)` 清理；非空的輸入清理後變空白，回 `ERROR invalid_action empty_line`（D11）。只有主持人能送（`requireHost`）；遊戲結束後回 `ERROR invalid_action game_over`（D10）。
3. `DungeonRoom.nextLine: { text, gen } | null`。每次排入或取消 `gen` 加一（D7）。設定、清掉、主持人連上（送 `HOST_OK` 的地方）時，送 `HOST_NEXT_LINE_STATE { line }` 給 `hostConns` 裡每一條連線。
4. `NarrationEvent` 的 `WithNext` 加選填 `hostLine?: string` 和 `hostLineVerbatim?: true`（後記沒有）。旁白紀錄因此也記得這次有排句子。
5. `buildPrompt` 看到 `hostLine`（且不是 `hostLineVerbatim`）時換掉第二行指示；句子用「」包住當資料，跟導演筆記同一層信任（主持人自己寫的）。
6. `runner.run` 組好各段後只檢查第二段；沒說到就覆蓋第二段，`sources[1] = "host"`。
7. 房間的 emit：過時的旁白照舊丟掉（不消耗）；沒被丟掉、且 `nextLine.gen` 等於這個事件記住的 `gen` 時，先清 `nextLine` 再廣播 NARRATION，然後通知主持人頁。
8. 遊戲結束（`phase === "finished"`）時清掉 `nextLine` 並通知（D10）。
9. 旁白紀錄：排入時加一筆 `DirectorEntry`，`kind: "next"`。
10. 存檔（D2）：`RoomSnapshot` 加選填 `nextLine?: { text: string; gen: number }`（讀不到當 `null`），不升 `SCHEMA_VERSION`，比照 `joinPassword`。`reset()` 清掉。

### 已知限制

- 兩個事件的旁白同時在跑（3 秒內連續判定兩次）時，兩次的提示詞都會帶這句；先出現的那次用掉它，後一次的第二段可能還是說了一次。很少見，接受。
- AI 沒聽話、把句子寫在第一或第三行時，覆蓋第二段後會出現兩次。很少見，接受。
- AI 那次寫的第二段沒用到時照樣付費。
- 主持人的「改寫目前旁白」只能改第一段，改不到這句；用掉的句子不會因為改寫而回來。

### 不做

- 不排多句（一次只有一句，再排會蓋掉）。
- 後記不用這句。

## 測試

- `runner.test.ts`：AI 第二段包含它（標點、全半形不同也算）→ 不動；第二段是改寫版 → 被覆蓋、不重複；只寫在第一或第三段 → 第二段被覆蓋、第一和第三段不動；腳本旁白 → 第二段換成它；沒有 `hostLine` → 跟現在一樣。
- `llm.test.ts`：`buildPrompt` 有 `hostLine` 時第二行指示換掉、包含這句；`hostLineVerbatim` 時不放；沒有時不變。
- `llm.live.test.ts`（D6，沒金鑰時跳過）：帶 `hostLine` 的事件，第二行包含這句。
- `dungeon-room.test.ts`：只有主持人能送；排入後下一次旁白有這句，再下一次沒有；空字串取消；清理後變空白回 `empty_line`；遊戲結束後清掉並回 `game_over`；含題庫答案時事件帶 `hostLineVerbatim`；過時的旁白不會用掉它；旁白途中換句子、或取消又重排同一句，新的那次留著；`reset()` 清掉；存檔還原後還在；主持人連上會收到 `HOST_NEXT_LINE_STATE`，排入時每條主持人連線都收到。
- `protocol.test.ts`：`HOST_NEXT_LINE` 的解析（字串、長度上限）。
- e2e（`e2e/host-drawer.spec.ts`，D4）：主持人排一句，答對後大螢幕出現這句；主持人頁的「已排入」消失。

## Decision ledger

Review target: this file (`/plan-eng-review`, 2026-10-31, branch `feat/next-line`).
Scope record: feature answers D1=B, D2=A, D3=A; structure: A (D4); accepted scope: plan as rewritten under 做法; pending remedies: none.
Scope Challenge result: scope accepted as-is.
Scope Challenge: 9 proposed changed files (5 source: `lib/protocol.ts`, `lib/narration/runner.ts`,
`lib/room/dungeon-room.ts`, `lib/room/snapshot.ts`, `app/room/[code]/host/page.tsx`; 4 tests), 0 new
classes/services. The complexity gate (8+ files) trips.

### S1: How the queued line is delivered (plan 待決定 1)
Plan baseline: the line replaces segment 2 word for word, for AI and scripted narration alike.
Runtime evidence: every non-epilogue event has at least 2 segments (`lib/narration/runner.ts:20` `return event.next ? 3 : 2;`).
Question D1: 主持人排的句子要逐字取代第二段，還是交給 AI 自然融入？
Options: A) 逐字取代第二段 (recommended) / B) 交給 AI 融入，沒開 AI 時逐字
State: approved
Actual answer: B) 交給 AI 融入，沒開 AI 時逐字 (user, 2026-10-31 AskUserQuestion D1)
Accepted scope: prompt asks the AI to include hostLine; runner falls back to segment 2 verbatim when no segment contains it; scripted narration uses it verbatim

### S2: Keep the queued line across a server restart (plan 待決定 3)
Plan baseline: optional `nextLine?: string` in `RoomSnapshot`, read as "" when missing, like `joinPassword` (`lib/room/snapshot.ts:78`).
Question D2: 伺服器重啟後，排好的句子要不要還在？
Options: A) 要，存進存檔 (recommended) / B) 不要，只放記憶體
State: approved
Actual answer: A) 要，存進存檔 (user, D2)
Accepted scope: optional nextLine in RoomSnapshot, "" when missing, no SCHEMA_VERSION bump

### S3: Host page shows the queued line and can cancel it (plan 待決定 2)
Plan baseline: the host page shows 「已排入：…」 and a 取消 button, kept in sync by a server message sent on change and on host connect.
Question D3: 主持人頁要不要顯示「已排入」並能取消？
Options: A) 要 (recommended) / B) 不要，送出就好
State: approved
Actual answer: A) 要 (user, D3)
Accepted scope: 已排入 + 取消 on the host page; HOST_NEXT_LINE_STATE sent on change and on host connect

### S4: File arrangement (complexity gate, question_id plan-eng-review-structure)
Original arrangement: new `e2e/host-next-line.spec.ts` (9 files). Smaller arrangement: extend `e2e/host-drawer.spec.ts`, which already covers the host's narration controls (8 files).
Question D4: e2e 要開新檔，還是加進現有的 host-drawer.spec.ts？
Options: A) Smaller arrangement (recommended) / B) Original arrangement
State: approved
Actual answer: A) Smaller arrangement (user, D4)
Accepted scope: e2e goes into e2e/host-drawer.spec.ts; 8 files

Note: D1=B adds `lib/narration/llm.ts`, `lib/narration/events.ts` and `lib/narration/llm.test.ts`: 12 files in all.

### A1: New host page talking to an old Worker (Architecture)
Finding: [INFORMATIONAL] (confidence: 8/10) lib/room/dungeon-room.ts:799 — `if (!msg) { this.sendTo(sender, { type: "ERROR", error: "invalid_action", detail: "bad_message" });` and the host page shows any other error as text (app/room/[code]/host/page.tsx:549 `setError(...)`). Vercel and the Worker deploy separately, so for a few minutes a new host page can send HOST_NEXT_LINE to an old Worker and see `invalid_action: bad_message`. Prior learning applied: split-deploy-new-state-field (9/10, 2026-10-31).
Plan baseline: section always shown.
Question D5: 主持人頁要不要等房間回報支援，才顯示「下一句這樣說」？
Options: A) 等房間送過 HOST_NEXT_LINE_STATE 才顯示 (recommended) / B) 一直顯示
State: approved
Actual answer: A) 等房間回報才顯示 (user, D5)
Accepted scope: host page renders the 下一句這樣說 section only after it has received HOST_NEXT_LINE_STATE

### T1: Live API case for the new prompt (Test review, LLM/eval scope)
Finding: [INFORMATIONAL] (confidence: 7/10) lib/narration/llm.ts:38 — the prompt gains a new instruction; unit tests only check the request text, not that Haiku follows it.
Plan baseline: no live case.
Question D6: 要不要在 llm.live.test.ts 加一個「AI 有沒有說出主持人的句子」的真 API 案例？
Options: A) 加，沒金鑰時自動跳過 (recommended) / B) 不加
State: approved
Actual answer: A) 加，沒金鑰時跳過 (user, D6)
Accepted scope: one case in lib/narration/llm.live.test.ts: an event with hostLine, output must contain it after normalization

### X1: Re-queuing the same text gets cleared by an older event (Outside voice, Codex; marker check failed)
Finding: [INFORMATIONAL] (confidence: 8/10) plan step 7 — clear condition `nextLine === event.hostLine`: the host cancels and re-queues the same text while an older narration is in flight; that older event then clears the new queue.
Plan baseline: compare text.
Question D7: 判斷「是不是同一次排入」要改用排入編號嗎？
Options: A) Apply: each queue gets a number, the event remembers it, emit clears only that number (recommended) / B) Keep text comparison / C) Investigate first / D) Defer
State: approved
Actual answer: A) 改用排入編號 (user, D7)
Accepted scope: nextLine carries a generation number; narrate records it per event; emit clears only that generation; test: cancel and re-queue the same text mid-narration

### X2: 29–40 character lines vs the 28-character second-line instruction (Outside voice, Codex; marker check failed)
Finding: [INFORMATIONAL] (confidence: 8/10) lib/narration/llm.ts:34 — `第二行：補充一點戰鬥氣氛…最多 28 個字`; the host line may be 40 characters, so the AI cannot obey both, and long lines would almost always fall back to verbatim.
Plan baseline: prompt asks for the line "somewhere in the three lines"; no length change.
Question D8: 有排句子時，提示詞要改成「第二行包含這句，前後可加幾個字，整行最多 50 字」嗎？
Options: A) Apply (recommended) / B) Keep / C) Investigate first / D) Defer
State: approved
Actual answer: A) 改提示詞 (user, D8)
Accepted scope: with hostLine, the second-line instruction becomes: contains this sentence, same characters, may add a few words around it, at most 50 characters

Outside voice: Codex (gpt-6-luna) answered with X1 and X2 but failed the marker check (unavailable). Native fallback (Claude Plan subagent) completed within the 5-minute timer.

### X3: Reopen D1 with the native reviewer's failure modes (Outside voice, Claude subagent)
Findings: [High] (confidence: 8/10) lib/narration/runner.ts:96 `if (event.type === "epilogue" || i === 0) return opts.fallback.line(event);` — the per-slot guarantee holds only on the fallback path; a "said it anywhere" check lets the AI replace line 1 or 3. [High] (8/10) lib/narration/llm.ts:98 `fitToLimit` can cut a multi-sentence host line, so a partial copy stays and the verbatim fallback adds the full line again. [Medium] (8/10) lib/narration/llm.ts:161 `!forbidden.some((a) => line.includes(a))` — a host line containing a bank answer makes the AI's whole output invalid.
Plan baseline: D1=B (AI 融入, verbatim otherwise), D8=A (line 2 only in the prompt).
Question D9: 這些問題之後，D1 要維持「AI 融入」還是改回「逐字」？
Options: A) Keep B, hardened: only segment 2 counts as said; compare after NFKC + removing whitespace/punctuation; fallback replaces segment 2 (so a paraphrase there is overwritten, not duplicated); a host line containing a 3+ character bank answer skips the AI instruction and goes verbatim (recommended) / B) Switch to verbatim (old D1 A) / C) Keep B as planned
State: approved
Actual answer: A) 維持 AI 融入，收緊 (user, D9)
Accepted scope: only segment 2 counts; NFKC + strip whitespace/punctuation before comparing; fallback overwrites segment 2; a host line containing a 3+ character bank answer is not sent to the AI and goes verbatim

### X4: A line queued after the game ends is never used (Outside voice, Claude subagent)
Finding: [Medium] (confidence: 9/10) lib/room/dungeon-room.ts:699 — `reset()` runs only on room expiry; the plan's "下一場 reset() 清掉" is wrong. 「已排入」 would stay on the host page until the room expires.
Question D10: 遊戲結束後要怎麼處理排好的句子？
Options: A) When the game finishes, clear it and refuse new ones (host section hidden) (recommended) / B) Leave it
State: approved
Actual answer: A) 結束就清掉 (user, D10)
Accepted scope: when the game finishes, nextLine is cleared and host pages notified; HOST_NEXT_LINE after that gets ERROR invalid_action game_over; the host section is hidden once the game is finished

### X5: Input that sanitizes to nothing silently cancels (Outside voice, Claude subagent)
Finding: [Low] (confidence: 8/10) lib/protocol.ts:260 `sanitizeText` strips `<>&"'`; a raw "<>" becomes "", which the plan reads as cancel.
Question D11: 送出的字清理後變空白時，要回錯誤而不是當成取消嗎？
Options: A) Reply ERROR empty_line like handleEditNarration; only a raw "" cancels (recommended) / B) Keep: treat as cancel
State: approved
Actual answer: A) 回錯誤 (user, D11)
Accepted scope: raw non-empty input that sanitizes to "" gets ERROR invalid_action empty_line; only a raw "" cancels

Corrections carried into the plan without a question (they implement already-approved behavior):
- HOST_NEXT_LINE_STATE goes to every connection in `hostConns`, like HOST_OK at lib/room/dungeon-room.ts:835 (D3: every host page shows the state).
- emit clears `nextLine` before broadcasting NARRATION, so one save covers both and a restart cannot replay the line (D2: survive restarts without saying it twice).
- 已知限制 gains: the host cannot edit segment 2 (改寫 only edits segment 1), and a corrected line 1 does not bring the used line back.

Approval readiness: PASS — S1 (D1, reopened as X3/D9), S2 (D2), S3 (D3), S4 (D4), A1 (D5), T1 (D6), X1 (D7), X2 (D8), X3 (D9), X4 (D10), X5 (D11); all answered by the user on 2026-10-31.

## Review notes

**Reality rows**
REALITY: premise-table pass 4 claims, unverified=0: ≥2 segments (lib/narration/runner.ts:20), notes label already says 不是逐字台詞 (app/room/[code]/host/page.tsx:101), one narration per eventId (lib/room/dungeon-room.ts:1004,1110,1229), optional snapshot field pattern (lib/room/snapshot.ts:78)
REALITY: already-done pass no commit on origin/main mentions next line or 下一句 since 2026-10-30; base is 8bde522
REALITY: surface-check pass no new CLI or route; HOST_NEXT_LINE is a new message type (lib/protocol.ts:96 pattern)
REALITY: binding-decisions pass no branch decisions recorded; TODO says 下一個階段再做, user chose it today TODOS.md:379
REALITY: numbers pass 40 = MAX_EDIT_LINE (lib/protocol.ts:276), 50 = MAX_LINE (lib/narration/runner.ts:10), 28 = prompt limit (lib/narration/llm.ts:34) [measured: source]
REALITY: deferred-asks pass TODO asks covered: the feature, AI-vs-scripted handling (D1/D9), notes label already done TODOS.md:379 app/room/[code]/host/page.tsx:101
REALITY: pr-count pass one PR (no ship-policy.json, default one PR per wave) docs/designs/host-next-line.md:1

**NOT in scope:** several queued lines (one at a time is enough for the playtest case); using the line in the epilogue (different, longer call); letting 改寫 edit segment 2 (existing limitation, multi-segment-narration.md Open Questions).

**What already exists:** `sanitizeText`/`MAX_EDIT_LINE` (lib/protocol.ts) reused for input; `requireHost` for auth; `hostConns` loop from HOST_SET_PASSWORD (lib/room/dungeon-room.ts:835) reused for the state message; the optional `joinPassword` snapshot pattern reused; `targetSegmentCount`/per-slot fallback in the runner reused as the place the line lands; `forbidden` answer list reused for the verbatim decision.

**Failure modes:** AI times out or fails → segment 2 overwritten verbatim (tested in runner). Old Worker during deploy → section hidden (D5, no test: deploy-only). Restart between NARRATION and clear → one save covers both (dungeon-room test). Game ends with a line queued → cleared (D10, tested). Critical gaps: 0.

**Parallelization:** Sequential implementation, no parallelization opportunity (one module chain: protocol → narration → room → host page).

**Architecture:** no new module or boundary, so design-twice does not apply.

## Implementation Tasks

- [ ] **T1 (P1, human: ~2h / CC: ~10min)** — narration — `hostLine` on events, prompt line-2 instruction, runner segment-2 check with NFKC
  - Surfaced by: S1/X2/X3 (D1, D8, D9)
  - Files: lib/narration/events.ts, lib/narration/llm.ts, lib/narration/runner.ts, tests, llm.live.test.ts
  - Verify: npm run test
- [ ] **T2 (P1, human: ~3h / CC: ~15min)** — room — HOST_NEXT_LINE handling, gen numbers, emit clear before broadcast, game-over clear, snapshot
  - Surfaced by: S2, X1, X4, X5 (D2, D7, D10, D11)
  - Files: lib/protocol.ts, lib/room/dungeon-room.ts, lib/room/snapshot.ts, tests
  - Verify: npm run test
- [ ] **T3 (P1, human: ~2h / CC: ~10min)** — host page — 下一句這樣說 section, 已排入/取消, shown only after state arrives and before game over; PNG preview first
  - Surfaced by: S3, A1 (D3, D5)
  - Files: app/room/[code]/host/page.tsx, e2e/host-drawer.spec.ts
  - Verify: npm run e2e

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises
- Architecture Review: 1 issue found (A1)
- Code Quality Review: 0 issues found
- Test Review: diagram produced (see 測試), 1 gap identified (T1 live case)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (the 下一句這樣說 TODO is removed when this ships)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Codex completed with 2 findings but failed the marker check (unavailable); Claude subagent fallback completed (8 findings, all resolved)
- Parallelization: 1 lane, 0 parallel / 3 sequential
- Lake Score: 10/11 (D1's first answer picked the non-recommended option; it was reopened as D9)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | Codex plan review (auto), Claude subagent fallback | Independent 2nd opinion | 1 | unavailable (Codex markers), fallback completed | Codex 2, subagent 8; all resolved |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 2 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** Codex (plan-review) answered but failed the marker check, so it is recorded as unavailable. The Claude Plan subagent fallback completed within the 5-minute timer. No outside coverage credit.
- **VERDICT:** Eng review done with all 11 decisions answered and applied to the plan; status issues_open because 2 findings were mapped into work (A1, T1). Ready to implement.

NO UNRESOLVED DECISIONS
