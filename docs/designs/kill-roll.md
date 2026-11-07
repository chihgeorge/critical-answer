# 首領擊殺 4d20：先播動畫再加分

TODO：「分數用到骰子時，一律先播擲骰動畫再加分」(P2)。

## 盤點：所有用到骰子的分數

| 骰子 | 在哪裡擲 | 現在 |
| --- | --- | --- |
| 戰士 d20 | `startRoll("warrior")`，`lib/room/dungeon-room.ts` | 先 2 秒動畫，`resolveRoll` 才判定 |
| 答對選擇題的暴擊骰 | `startRoll("crit")` | 先 2 秒動畫才判定 |
| 填空題說服檢定 | `startRoll("check")` | 先 2 秒動畫才顯示結果 |
| 首領最後一擊 4d20 | `answerQuestion` 裡的 `rollBossKillBonus`，`lib/game-state.ts` | **直接加分**，電視上只出現在旁白 |

只剩 4d20 要改。

## 決定

- UI（使用者，2026-11-06）：B，四顆一起滾，每 0.5 秒停一顆，總和跟著加，最後一列寫「a + b + c + d = 總和 分」，偷襲寫「總和 × 2 = 分」。預覽圖只存在本機。
- 判定順序跟暴擊骰一樣：「骰子停下之前什麼都不算分」。

## 做法

1. `lib/game-state.ts`：`answerQuestion` 和 `warriorRoll` 多一個參數 `killDice?: number[]`。有給就用它算 `killBonus`（總和 × sneak），沒給照舊用 rng 擲。outcome 帶 `killDice`（實際用的四顆）。（D1：不另寫 `wouldKillBoss`，room 用試算判斷。）
2. `lib/protocol.ts`：`PendingRoll.kind` 加 `"kill"`，多 `values?: number[]` 和 `sneak?: number`。
3. `lib/room/dungeon-room.ts`：`judgeNow` 在答對、且這次沒帶 `killDice` 時，先用同樣參數試算一次（rng 傳 `() => 0`，不能用 `this.rng`，否則會吃掉亂數序列）；試算結果是打死首領（`bossKilled`）就不判定，改成 `startRoll("kill")`：擲 4 顆（有 `fixedDie` 就四顆都用它）存進 `pendingRoll`，把原本的判定參數（correct、fleeChoice、roll）也存起來。`KILL_BEAT_MS = 4000` 後 `resolveRoll` 用存下的參數加 `killDice` 呼叫 `judgeNow`。遊戲在那之前還是 `playing`，所以手機和頒獎台不會先看到新分數。
   - 進入點全部經過 `judgeNow`：主持人答對、戰士骰、暴擊骰、說服檢定 20、`applyLostCrit`。
   - 重啟：`pendingRoll` 只在記憶體，跟暴擊骰一樣，重啟就丟掉這次擲骰。主持人要再按一次答對（暴擊骰路徑則是重新鎖定）。
   - beat 期間判定的擋法沿用 `roll_pending`。
4. `components/d20.tsx`：`RollOverlay` 加 `kind="kill"`，畫四顆 `D20`，第 i 顆在 `TUMBLE_MS + i×500` 停。
5. 電視、手機、主持人頁面：`kind === "kill"` 的文字（電視「💀 X隊 最後一擊！擲 4d20 擊殺獎勵」，手機 `app/room/[code]/play/page.tsx:86-87` 現在畫一顆 `roll.value`，kill 要改成不畫數字的「最後一擊！擲 4d20，看大螢幕 ▶」）。
6. 測試：`game-state` 的 `killDice`；既有打到 `finished` 的 room 測試和 `e2e/main-line.spec.ts:153` 改成等 kill beat（finding 2）；room 的 kill beat（判定延後、到時才加分並進 finished、beat 中再判定被擋、turn 移走就丟掉）；`d20` 元件四顆的停法。

## Eng review (2026-11-06)

Target: `docs/designs/kill-roll.md`（本檔）。

### Scope Challenge

- 已有的：`startRoll` / `resolveRoll` / `PendingRoll` / `RollOverlay` / `D20` / `fixedDie` 全部沿用，不新增模組。
- 規模：改 6 個檔（game-state、protocol、dungeon-room、d20、screen、play/host 頁）＋測試，0 個新 class。低於 8 檔，不用縮範圍。
- Scope Challenge：scope accepted as-is。

### Findings

1. [INFORMATIONAL] (confidence: 8/10) `lib/game-state.ts:680-681` — 計畫第 1 步的 `wouldKillBoss` 會把「`const newHp = Math.max(0, boss.hp - sneak - (crit ? 1 : 0)); const bossKilled = newHp === 0 && lastPhase;`」再寫一份。兩份要手動保持一致，以後改扣血規則只改到一份，就會漏播動畫或卡住。
2. [CRITICAL] (confidence: 8/10) `e2e/main-line.spec.ts:153` `test("game over: podium at once, ...")` 和 `lib/room/dungeon-room.test.ts`、`persistence.test.ts`、`bundled-bank-round.test.ts` 裡打到 `finished` 的測試 — 擊殺改成 4 秒後才算，這些測試會失敗或變慢。計畫第 6 步沒列。屬於既有行為的回歸保護，必做：用 fake timers 推進 `KILL_BEAT_MS`，e2e 改成等骰子停完。
3. [INFORMATIONAL] (confidence: 8/10) `lib/room/dungeon-room.ts:1817` `const value = this.fixedDie ?? rollD20(this.rng);` — e2e 靠 `fixedDie` 讓每顆 d20 固定。4d20 也要用 `fixedDie`（四顆都是它），不然 e2e 的分數不固定。事實修正，計畫第 3 步照做。
4. [INFORMATIONAL] (confidence: 7/10) Prior learning applied: split-deploy-new-state-field (confidence 9/10, from 2026-10-31)。Vercel 和 Worker 分開部署，幾分鐘內舊電視頁會收到 `kind: "kill"`，`app/room/[code]/screen/page.tsx:320` 會把它當戰士骰畫。只在部署那幾分鐘、而且要剛好打死首領才會發生，活動前不會有正式場次。接受，不改。

### 1. Architecture

沒有新模組或新邊界，不用比兩種形狀（design-twice 不適用）。資料流：

```
host 答對 / resolveRoll(warrior|crit) / resolveCheck(20) / applyLostCrit
        │
        ▼
   judgeNow(args) ──試算 answerQuestion|warriorRoll(rng 丟棄)──► bossKilled?
        │ 否                                   │ 是，且 args 沒帶 killDice
        ▼                                      ▼
   照舊判定、廣播                  startRoll("kill", values[4]) ─ KILL_BEAT_MS ─► resolveRoll
                                    (phase 仍是 playing，分數不動)                 │ turn 還在這隊？
                                                                       是 ◄────────┴────────► 否：丟掉，廣播
                                                                       ▼
                                                    judgeNow(args + killDice) → finished、加分、旁白
```

失敗情境：kill beat 中房間重啟，或這隊掉線讓 turn 移走 → 這次擊殺丟掉，主持人再按一次答對（暴擊路徑重新鎖定）。使用者看得到：電視骰子消失、回到題目，不是靜默錯誤。由 room 測試「turn 移走就丟掉」覆蓋。
No issues found（finding 1 已由 D1 處理）。

### 2. Code quality

No issues found。`startRoll` 的 kind 聯集、`PendingRoll.kind`、`RollOverlay` 的 kind 三處都要加 `"kill"`；TypeScript 的聯集型別會在漏改時報錯，不算手動同步清單。

### 3. Tests

```
CODE PATHS                                              USER FLOWS
[+] lib/game-state.ts                                   [+] 最後一擊
  ├── answerQuestion(killDice)                            ├── [GAP] 主持人答對 → 4 秒骰子 → 頒獎台
  │   ├── [GAP] 給 killDice：killBonus = 總和 × sneak     │         (e2e/main-line.spec.ts:153 改)
  │   └── [★★ TESTED] 沒給：rng 擲（既有 boss 測試）      └── [GAP] 骰子期間手機/頒獎台還是舊分數
  └── warriorRoll 轉傳 killDice  [GAP]                    
[+] lib/room/dungeon-room.ts                            
  ├── judgeNow 試算                                     
  │   ├── [GAP] 會打死 → pendingRoll kind kill，分數未加
  │   └── [★★ TESTED] 不會打死 → 照舊（既有測試）
  ├── resolveRoll(kill)
  │   ├── [GAP] 到時加分、phase finished、四顆跟 pendingRoll 一樣
  │   └── [GAP] turn 移走 → 丟掉
  ├── [GAP] beat 中主持人再判定 → roll_pending
  ├── [GAP] 暴擊骰 → kill 骰 連兩段
  └── [GAP] fixedDie → 四顆都是它
[+] components/d20.tsx RollOverlay kind kill
  └── [GAP] 四顆依序停，最後一列算式（含偷襲 ×2）
```

COVERAGE：2/12 有測試。要補的都列在下方 Implementation Tasks。既有打到 `finished` 的 room 測試（finding 2）用 fake timers 推進 `KILL_BEAT_MS`，屬回歸保護。

### 4. Performance

No issues found。試算是每次首領答對多一次純函式呼叫，資料量是一場遊戲的 state（幾十題、最多 8 隊）。

## Decision ledger

### R1: 怎麼判斷「這次答對會打死首領」
Finding: 1, INFORMATIONAL, 8/10, lib/game-state.ts:680-681, Claude
Plan baseline: 計畫第 1 步：新增 `wouldKillBoss`，自己算一次扣血（原始提案，未核准）
Runtime evidence: 扣血和擊殺只在 `answerQuestion` 裡算（lib/game-state.ts:680-681）；`answerQuestion` 和 `warriorRoll` 是純函式
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 擊殺判斷 | 計畫：`wouldKillBoss` 另寫一份算式 | 先用同樣參數試算一次 `answerQuestion`/`warriorRoll`（丟棄用的 rng），看 `outcome.bossKilled` | 照計畫：`wouldKillBoss` 另寫，加測試比對兩邊 |
| killDice 參數、4 秒 beat、UI B | 已定（使用者 2026-11-06 選 B） | 不變 | 不變 |
Question D1:
D1 — 怎麼判斷「這次答對會打死首領」
Project/branch/task: critical-answer main，首領最後一擊 4d20 先播動畫再加分。
ELI10: 要先播 4d20，房間得在算分之前就知道「這下會打死首領」。計畫原本另寫一個小函式自己算扣血。比較穩的做法是：把真正算分的函式先「試算」一次、結果丟掉，看它說會不會打死。這樣扣血規則只有一份。
Stakes if we pick wrong: 以後改扣血規則（例如偷襲、暴擊）只改到一份，最後一擊就會不播動畫，或播了動畫卻沒打死。
Recommendation: A because 規則只有一份，不用靠測試去抓兩份算式不一致。
Completeness: A=10/10, B=8/10
Pros / cons:
A) 試算一次真的函式 (recommended)
  ✅ 扣血、暴擊、偷襲、最後階段的規則只寫在 answerQuestion 一個地方
  ✅ 不新增 export，game-state.ts 的介面只多一個 killDice 參數
  ❌ 每次答對首領多跑一次純函式，成本是微秒級，但讀程式的人要看懂「試算」
B) 照計畫另寫 wouldKillBoss
  ✅ 意圖寫在函式名稱上，讀 dungeon-room.ts 的人一眼看懂
  ✅ 可以單獨測試這個判斷
  ❌ 同一條扣血公式有兩份，以後改規則容易只改一份
Net: 用一次多餘的純函式呼叫，換掉一份要手動同步的公式。
Header: 擊殺判斷
Options:
A) 試算一次真的函式 (recommended)
先用同樣參數試算 answerQuestion / warriorRoll（丟棄用的 rng），看 outcome.bossKilled。規則只有一份。(human: ~30min / CC: ~5min)
B) 照計畫另寫 wouldKillBoss
新增 export 的 wouldKillBoss，自己算 hp - sneak - crit，加測試比對。公式兩份。(human: ~30min / CC: ~5min)

State: approved
Actual answer: A) 試算一次真的函式（使用者 D1，2026-11-06）
Accepted scope: 不新增 `wouldKillBoss`。`judgeNow` 先用同樣參數和丟棄用的 rng 試算 `answerQuestion` / `warriorRoll`，`outcome.type === "correct-boss-hit" && outcome.bossKilled` 時改成 kill beat。測試改測 room 層的 kill beat 和 `killDice`。
History: none

### Outside voice（Codex，plan review）

1. Medium — 手機的擲骰畫面只會畫一顆 `pendingRoll.value`（`app/room/[code]/play/page.tsx:86-87`），kill 會顯示錯的數字或 undefined。驗證屬實。事實修正：計畫第 5 步改寫手機文字，屬同一個已核准的 UI 行為，不另問。
2. Medium — 試算如果拿 `this.rng`，`rollBossKillBonus` 會先吃掉四個亂數。D1 的「丟棄用的 rng」寫明為 `() => 0`。事實修正，不另問。

Codex 沒有其他 finding。兩邊都沒有反對 D1。

### NOT in scope

- 部署那幾分鐘舊頁面把 kill 畫成戰士骰（finding 4）：接受。
- 重啟後補回中斷的擊殺（像說服檢定的 `lostCrit`）：跟暴擊骰一樣丟掉，主持人重按。
- 其他非骰子的加分動畫（偷襲 ×2 本身、房間獎勵）：TODO 只要求骰子。

### What already exists

`startRoll`/`resolveRoll`/`PendingRoll`（room beat 機制）、`RollOverlay`/`D20`（電視骰子）、`fixedDie`（e2e 固定骰）、`roll_pending`（beat 中擋判定）全部沿用。

### Worktree parallelization

Sequential implementation, no parallelization opportunity（game-state → protocol → room → UI 一路相依）。

## Implementation Tasks

- [ ] **T1 (P1, human: ~1h / CC: ~10min)** — game-state — `answerQuestion`/`warriorRoll` 加 `killDice`，outcome 帶 `killDice`
  - Surfaced by: D1；Tests 圖 game-state GAP
  - Files: lib/game-state.ts, lib/game-state.test.ts
  - Verify: `npm run test -- game-state`
- [ ] **T2 (P1, human: ~3h / CC: ~20min)** — room — `judgeNow` 試算（`() => 0`）→ kill beat，`resolveRoll` 帶 `killDice` 重判，`fixedDie` 四顆，`KILL_BEAT_MS = 4000`
  - Surfaced by: D1、finding 3、Codex 2
  - Files: lib/room/dungeon-room.ts, lib/protocol.ts, lib/room/dungeon-room.test.ts
  - Verify: room 測試：分數延後、到時 finished、四顆一致、turn 移走丟掉、beat 中 roll_pending、暴擊接 kill
- [ ] **T3 (P1, human: ~2h / CC: ~15min)** — tests — 既有打到 finished 的 room 測試和 e2e main-line:153 改成等 kill beat
  - Surfaced by: finding 2
  - Files: lib/room/*.test.ts, e2e/main-line.spec.ts
  - Verify: `npm run test`；e2e 交給 CI
- [ ] **T4 (P1, human: ~2h / CC: ~15min)** — UI — `RollOverlay` kind kill（四顆依序停、算式、偷襲 ×2），手機和主持人文字
  - Surfaced by: UI 決定 B、Codex 1
  - Files: components/d20.tsx, app/room/[code]/screen/page.tsx, app/room/[code]/play/page.tsx, app/room/[code]/host/page.tsx
  - Verify: d20 元件測試；`npm run check:bundle`

Approval readiness: PASS（R1 → D1 答 A；UI B → 使用者 2026-11-06；finding 2、3、Codex 1、2 為已核准行為的必要實作與事實修正）

### Completion summary

- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7（premise 全有 file:line，0 unverified；already-done：main 上沒有 kill roll；pr-count：1）
- Architecture Review: 0 issues found（finding 1 由 D1 處理）
- Code Quality Review: 0 issues found
- Test Review: diagram produced, 10 gaps identified
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed（這個 PR 會關掉既有 TODO「分數用到骰子時，一律先播擲骰動畫再加分」）
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0
- Outside voice: codex, completed（2 Medium，都已併入）
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 1/1

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 1 | completed | 2 Medium, both folded in |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 10 issues (test gaps, mapped to T1-T4), 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | UI choice made by user from PNG preview |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review, completed, 2 Medium findings (phone single-die display, trial RNG), both resolved as factual corrections.
- **CROSS-MODEL:** Claude and Codex agree on the deferred-judgment approach; Codex added the two corrections above, no disagreement.
- **VERDICT:** ENG REVIEWED — test gaps are mapped to T1-T4, ready to implement.

NO UNRESOLVED DECISIONS
