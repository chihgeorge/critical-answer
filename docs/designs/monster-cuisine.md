# 怪物變料理：打倒怪物後端上一道菜

狀態：eng review 完成（2026-10-31），已在 `feat/monster-cuisine` 實作（T1–T5）。來源：TODOS.md「地城料理風格 1：怪物變食材，打倒後端上一道菜」。

## 問題

打倒怪物時，大螢幕只顯示「正解：…」，故事上沒有下文。想讓地城像一個可以吃的生態系：每打倒一隻怪物，就把牠煮成一道菜；最後比的是哪一隊吃得最飽。

不用「迷宮飯」的角色、魔物設計、畫面或台詞（著作權），只借「魔物料理」這個主題。怪物沿用現有的史萊姆、幽靈、龍。

## 做法

### 1. 題庫：怪物可以帶一道菜

`BankMonster` 加一個可省略的 `dish`：

```ts
interface BankDish {
  part: string;    // 可食部位，例如「外膜」（最多 12 字）
  method: string;  // 料理方式，例如「曬乾後涼拌」（最多 16 字）
  name: string;    // 菜名，例如「史萊姆寒天涼拌」（最多 16 字）
  comment: string; // 一句評語，例如「口感像寒天，帶點青草香。」（最多 30 字）
}
interface BankMonster { name: string; sprite: SpriteKind; hue: number; dish?: BankDish }
```

- `parseMonster` 檢查：四個欄位都要是非空字串，而且不超過字數上限；`dish` 不是物件、或少欄位，題庫就讀不懂（和其他欄位一樣）。
- 預設題庫（`data/question-bank.json`）的 8 間房和首領，各寫一道菜。食材一定來自那隻怪物本身。
- 題庫編輯器：每間房、首領的怪物下面多 4 個輸入框（部位、做法、菜名、評語）。四格全空就是沒有菜；只填一部分時不能存，並提示缺哪格。

### 2. 答對時：大螢幕的「今晚的菜」卡

版面：A，菜卡是正解面板裡的淡紫色小卡，接在正解（和詳解）下面（PNG 預覽，使用者 2026-10-31 選 A）。

- `AnswerReveal` 多一個 `dish?: { name, part, method, comment, points }`。只有「答對、打倒這間房的怪物」，而且那隻怪物有 `dish` 時才帶。
- 大螢幕的正解區（`screen/page.tsx` 的 `answer-reveal`）在正解下面多一張卡：
  - 標題「今晚的菜：{菜名}」
  - 一行「{部位}・{做法}」
  - 評語
  - 「＋{points} 飽足感」
- 打倒首領時（boss-kill）也一樣，用首領的菜。打首領但還沒打倒（boss-hit）不出菜。
- 怪物沒有 `dish`：照舊只顯示正解。

### 3. 「獎勵分」改叫「飽足感」

只改畫面上的字，程式裡的 `reward` 不改名：

- 大螢幕排名的「{n} 分」→「{n} 飽足感」
- 主持人頁隊伍列的 title「獎勵分」→「飽足感」
- 手機「{n} 獎勵分」→「{n} 飽足感」；盜賊能力說明「獎勵分 ×2」→「飽足感 ×2」
- 題庫編輯器「獎勵」→「飽足感」，說明句一起改

### 4. 每隊吃了什麼

- `Team` 多一個 `dishes: string[]`（菜名，依吃的順序）。答對打倒房間怪物、或打倒首領時，把那道菜的名字加進去。
- 房間存檔（`RoomSnapshot`）一起存。舊存檔沒有這個欄位時當成空陣列。

### 5. 旁白

- `correct` 和 `boss-kill` 事件多一個 `dish?: string`（菜名）。
- AI 旁白：有菜名時，提示詞第一行的指示加一句「把這隻怪物煮成了『{菜名}』，順口提到」。
- 腳本旁白：有菜名時，從幾句固定句型裡挑一句，例如「{team}把{monster}煮成了{dish}！」。
- 後記：`epilogue` 的 `ranking` 每隊多帶 `dishes`。AI 後記的提示詞要描述每隊吃了什麼、誰吃最飽；腳本後記多一句「{winners}吃了{dishes}，最飽。」

## 不做

- 不改畫面配色、不加新怪物圖（那是「地城料理風格 2」）。
- 不把整個旁白語氣改成美食節目（那是「地城料理風格 3」）。
- 菜不影響分數或能力，飽足感就是原本的獎勵分。
- 菜名不由 AI 現場生成，全部寫在題庫裡。

## 待決定（review 時問）

- 題庫沒有任何菜的時候，畫面上還要叫「飽足感」，還是維持「分」？
- 打首領時每打一下（boss-hit）的分數，要不要也叫飽足感？（目前提案：叫，因為它也加進同一個總分。）

## 測試

- `lib/question-bank.test.ts`：`dish` 合法、缺欄位、超過字數、不是物件。
- `lib/game-state.test.ts`：打倒房間怪物、打倒首領時 `dishes` 會加；答錯、boss-hit 不加；舊存檔讀成空陣列。
- `lib/narration/*.test.ts`：有菜名時提示詞和腳本句有菜名；後記帶每隊的菜。
- e2e：答對一題後大螢幕出現「今晚的菜」和「飽足感」；題庫編輯器能編、能存一道菜。
- `npm run check:bundle`：菜的資料在題庫裡，一樣不能進前端 bundle。答對前，菜不能出現在任何廣播裡。

---

## Eng review 紀錄（/plan-eng-review，2026-10-31）

審查對象：`docs/designs/monster-cuisine.md`（本文件）。報告寫在本文件。

### Scope Challenge A

- 已有的：`AnswerReveal`（`lib/protocol.ts:66`）已經是「答對後在大螢幕顯示」的通道，菜卡接在它後面，不用新訊息。`Team`（`lib/game-state.ts:118`）沒有「吃過哪些房間」的紀錄；`roomIndex` 推不出來：進王房時 `roomIndex` 不前進（`lib/game-state.ts:753`），主持人送進王房（`sendToBoss`，`lib/game-state.ts:946`）也不前進，所以 `dishes` 要存。
- 舊存檔：`dungeon-room.ts:490` 已有「v5 存檔缺欄位就補預設值」的先例，`dishes` 照做，不用升 `SCHEMA_VERSION`。
- 複雜度：預計改 12 個檔（question-bank、game-state、dungeon-room、protocol、narration events/llm/scripted、screen、host、play、bank-editor 頁、題庫 JSON），0 個新 class/service。超過 8 個檔，觸發範圍問題。
- TODOS：本項就是「地城料理風格 1」；風格 2、3 不在範圍。
- Prior learning applied: split-deploy-new-state-field（confidence 9/10，2026-10-31）：前端和 Worker 分開部署，`reveal.dish`、`dishes` 前端要當成可能不存在。

### Scope Challenge B（範圍紀錄）

feature answers: D1=A（題庫編輯器一起做，2026-10-31）；structure: A Original arrangement（D2，2026-10-31）；accepted scope: 本文件「做法」1–5 全部，含題庫編輯器的菜欄位；pending remedies: R1。

### Scope Challenge C

1. [CRITICAL] (confidence: 9/10) `lib/narration/llm.ts:166` — `const usable = (line: string) => validLine(line, max) && !forbidden.some((a) => line.includes(a));`，`forbidden` 是整個題庫 3 字以上的答案（`lib/room/dungeon-room.ts:253`）。本文件「5. 旁白」要 AI 提到菜名；菜名含任何答案時，那句一定作廢、退回腳本台詞。大螢幕菜卡（「2.」）也會提前露出還沒出的題目答案。Reviewer: Claude。

## Decision ledger

### R1: 菜的文字含題庫答案時怎麼處理
Finding: 1, CRITICAL, 9/10, lib/narration/llm.ts:166, Claude
Plan baseline: 原提案沒處理。
Runtime evidence: llm.ts:166 會把含答案的整句作廢；菜卡沒有任何過濾。
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 處理方式 | 無 | 讀題庫時就拒絕：菜的 4 個欄位含任何 3 字以上答案，題庫讀不懂；編輯器存檔前提示是哪一格撞到哪個答案 | 執行時跳過：含答案的菜名不放進 AI 提示詞（像 hostLineVerbatim），菜卡照常顯示 | 不處理 |
Question D3:
D3 — 菜名撞到題庫答案時怎麼辦？（見對話中的完整題目）
Header: 撞答案
Options:
A) 讀題庫時就擋 (recommended)
菜的任何一格含 3 字以上的題庫答案，題庫就讀不懂，編輯器存檔前會說哪一格撞到哪個答案。旁白和菜卡都不會出事。約 15 分鐘。
B) 只跳過 AI 提示詞
含答案的菜名不給 AI，旁白不會整句作廢；但大螢幕菜卡照樣顯示，可能露出還沒出的答案。約 10 分鐘。
C) 不處理
撞到時那隻怪物的 AI 旁白每次都退回固定台詞，菜卡可能洩漏答案。

State: approved
Actual answer: B) 只跳過 AI 提示詞（D3，2026-10-31）
Accepted scope: dungeon-room 組旁白事件時，菜名含任何 3 字以上題庫答案（同 `bankAnswers`）就不放進事件的 `dish`，AI 提示詞和腳本旁白都不提這道菜；大螢幕菜卡照常顯示。題庫和編輯器不檢查。測試：含答案的菜名不進事件。
History: none

### R2: 題庫沒有任何菜時，畫面上的分數叫什麼
Finding: 2, INFORMATIONAL, 8/10, 本文件「待決定」第 1 點；`app/room/[code]/screen/page.tsx:356` 目前寫「{t.reward} 分」，Claude
Plan baseline: 原提案把「獎勵分」全部改叫「飽足感」，沒說沒有菜的題庫怎麼辦。
Runtime evidence: 你的主題題庫在 git-ignored 的 local-banks/，不一定是料理主題。
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 分數名稱 | 獎勵分 / 分 | 題庫只要有一隻怪物有菜就叫「飽足感」，一道菜都沒有就維持原本的「獎勵分 / 分」；房間把「有沒有菜」放進 STATE 給各頁 | 一律叫「飽足感」 |
Question D4: 見對話。
Header: 分數名稱
Options:
A) 有菜才叫飽足感 (recommended)
沒有菜的題庫照舊叫獎勵分。STATE 多一個布林值，各頁依它選字。約多 15 分鐘。
B) 一律叫飽足感
最簡單，但非料理主題的題庫也會顯示飽足感。

State: approved
Actual answer: A) 有菜才叫飽足感（D4，2026-10-31）
Accepted scope: 題庫裡至少一隻怪物（含首領）有 `dish` 時，STATE 帶 `cuisine: true`；大螢幕、主持人頁、手機依它顯示「飽足感」，沒有就照舊「獎勵分 / 分」（缺欄位當成沒有）。題庫編輯器依正在編輯的題庫有沒有菜選字。boss-hit 的分數加進同一個總分，用同一個名稱。測試：有菜／沒菜兩種題庫各一。
History: none

## Review Sections

### 1. Architecture

```
題庫 JSON ──parseMonster──▶ BankMonster.dish?
     │                         │
     │ dungeon-room 建遊戲      ▼
     ├──────────────▶ RoomTemplate.dish? / BossState.dish?（菜名，game-state）
     │                         │ answerQuestion：correct-room-advance、boss kill
     │                         ▼
     │                 Team.dishes += 菜名 ──▶ 存檔（缺欄位 = []）
     │
     ├─ 判定後 dungeon-room：reveal.dish = 那隻怪物的完整菜卡 ──STATE──▶ 大螢幕菜卡
     ├─ cuisine = 題庫有任何菜 ──STATE──▶ 各頁選「飽足感」或「獎勵分」
     └─ 旁白事件 dish = 菜名（含 3 字以上答案就不帶，R1）──▶ llm / scripted
          後記 ranking[].dishes = Team.dishes ──▶ llm / scripted 後記
```

- 沒有新模組或新邊界，design-twice 不適用。
- 會出錯的地方：Worker 先上線、前端還是舊版時，舊前端不認得 `reveal.dish`、`cuisine`，只是不顯示；新前端配舊 Worker 時欄位不存在，要當成沒有（Prior learning: split-deploy-new-state-field）。
- [INFORMATIONAL] (confidence: 8/10) `lib/game-state.ts:753` — `const nextRoomIndex = entersBoss ? team.roomIndex : Math.min(team.roomIndex + 1, game.rooms.length - 1);` 在最後一間房還沒達到王房門檻時，同一隊會再打一次最後一間，`dishes` 會出現同一道菜兩次。每次都是真的吃了一份，照記；後記照實說。不需要決定。

No other issues found. Dispositions: 上述 INFORMATIONAL 記錄，不改。

### 2. Code quality

- `dish` 的字數上限用 `Array.from(s).length` 算，避免罕用字（UTF-16 代理對）算成 2 個字。
- 編輯器：4 格全空 = 沒有菜；只填部分不能存，提示缺哪格。編輯器存檔時要把 `dish` 寫回去（D1 的理由）。
- R1 的答案檢查直接用 dungeon-room 已有的 `bankAnswers`，不另寫一份。

No issues found. Dispositions: none.

### 3. Tests

```
CODE PATHS                                          USER FLOWS
[+] lib/question-bank.ts parseMonster               [+] 答對打倒怪物
  ├── [GAP] dish 合法 / 沒有 dish                     ├── [GAP] [→E2E] 大螢幕出現「今晚的菜」與「＋N 飽足感」
  ├── [GAP] 缺欄位、空字串、超過字數、不是物件          └── [GAP] 怪物沒有菜：只顯示正解
  └── [GAP] 罕用字算 1 個字                         [+] 題庫編輯器
[+] lib/game-state.ts answerQuestion                  ├── [GAP] [→E2E] 填一道菜、存檔、重新載入還在
  ├── [GAP] 打倒房間怪物 / 首領 → dishes 加一筆        └── [GAP] 只填部分不能存
  ├── [GAP] 答錯、逃跑、boss-hit、sendToBoss 不加      [+] 分數名稱
  └── [GAP] 舊存檔沒有 dishes → []                     ├── [GAP] 有菜的題庫：各頁顯示飽足感
[+] dungeon-room 判定                                 └── [GAP] 沒菜的題庫：照舊獎勵分
  ├── [GAP] reveal.dish 只在答對打倒且有菜時帶
  ├── [GAP] cuisine 依題庫有沒有菜
  └── [GAP] 菜名含答案 → 事件不帶 dish（R1）
[+] narration
  ├── [GAP] llm 提示詞有菜名；scripted 有菜名句型
  └── [GAP] [→EVAL] 後記提示詞帶每隊的菜
```

COVERAGE: 0/17 paths（全部是新路徑）。計畫：unit 補在 `lib/question-bank.test.ts`、`lib/game-state.test.ts`、`lib/room/dungeon-room.test.ts`、`lib/narration/llm.test.ts`、`lib/narration/scripted.test.ts`；e2e 擴充現有 `e2e/bank-editor.spec.ts` 和一個答對流程的 spec。後記的 [→EVAL] 用現有的 `llm.live.test.ts` 手動跑一次，不新增 eval 套件。

Tests to retire: none.

### 4. Performance

`Team.dishes` 每答對一題最多加一筆，一局幾十筆以內，存檔大小可忽略。沒有迴圈內的查詢或 I/O。No issues found.

## Outside Voice（Codex，gpt-6-luna，2026-10-31）

- **High** — `lib/room/dungeon-room.ts:657`、`lib/narration/scripted.ts:217`：R1 只從 `correct`/`boss-kill` 事件拿掉含答案的菜名，但後記的 ranking 直接帶 `Team.dishes`，菜名會從另一條路進旁白。
  - Claude 查證：後記在遊戲結束後才出，已經沒有「還沒出的題目」，所以洩漏不是問題。真正的問題是 AI 後記：含 3 字以上答案的菜名會讓 `llm.ts:166` 把整段後記作廢，退回腳本後記。（confidence 8/10）

### R3: 後記裡含答案的菜名
Finding: 3, INFORMATIONAL, 8/10, lib/narration/llm.ts:166 + 後記 ranking，Codex（Claude 查證後降級）
Plan baseline: R1（D3=B）只過濾 correct/boss-kill 事件。
Runtime evidence: 後記走同一個 forbidden 過濾，含答案就整段作廢。
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 後記的菜名 | 原樣帶入 | 同 R1 的規則，含答案的菜名不進後記的 ranking（AI 和腳本都不提那道） | 不處理，撞到時退回腳本後記 |
Question D5: 見對話。
Header: 後記菜名
Options:
A) 後記也過濾 (recommended)
和 R1 同一個檢查，含答案的菜名不放進後記。約 5 分鐘。
B) 不處理
撞到時 AI 後記作廢，改用腳本後記。

State: approved
Actual answer: A) 後記也過濾（D5，2026-10-31）
Accepted scope: 後記事件的 ranking[].dishes 用和 R1 同一個檢查，含 3 字以上答案的菜名拿掉；AI 和腳本後記都不提那道菜。測試：含答案的菜名不進後記事件。
History: none

Approval readiness: PASS — R1（D3=B）、R2（D4=A）、R3（D5=A）各有自己的回答；範圍 D1=A、D2=A。

## TODOS.md

本項完成後把「地城料理風格 1」移到 Completed。沒有新的 TODO 提案（風格 2、3 已在 TODOS）。

## NOT in scope

- 暖色畫面、新怪物圖（風格 2）；美食節目口吻（風格 3）。
- 菜影響分數或能力；AI 現場生成菜名。
- 題庫或編輯器檢查菜名是否含答案（D3=B 選擇不做）。

## What already exists

- `AnswerReveal`（`lib/protocol.ts:66`）：菜卡的通道。
- `bankAnswers` + `forbidden`（`lib/room/dungeon-room.ts:253`、`lib/narration/llm.ts:163`）：R1、R3 的答案檢查直接用它。
- 舊存檔補預設值的先例（`lib/room/dungeon-room.ts:490`）。

## Failure modes

| 新路徑 | 會怎麼壞 | 有測試？ | 有處理？ | 使用者看得到？ |
|---|---|---|---|---|
| 菜卡 | 前後端分開部署時欄位不存在 | 計畫中 | 是（缺欄位當沒有） | 只是沒卡片 |
| 旁白帶菜名 | 菜名含答案 → AI 整句作廢 | 計畫中 | 是（R1、R3） | 否 |
| 舊存檔 | 沒有 `dishes` | 計畫中 | 是（當成 []） | 否 |
| 編輯器 | 只填部分菜欄位 | 計畫中 | 是（不能存） | 是，有提示 |

Critical gaps: 0。

## Worktree parallelization

一條線依序做：題庫格式 → game-state → dungeon-room / protocol → 旁白 → 三個遊戲頁 → 編輯器。後面都依賴題庫格式，不拆平行。

## Implementation Tasks

- [ ] **T1 (P1, human: ~3h / CC: ~10min)** — question-bank — `BankDish` 解析與字數檢查，預設題庫 9 道菜
  - Surfaced by: 做法 1；Section 2 字數用 `Array.from`
  - Files: lib/question-bank.ts, data/question-bank.json, lib/question-bank.test.ts
  - Verify: `npm run test -- question-bank`
- [ ] **T2 (P1, human: ~3h / CC: ~10min)** — game-state — RoomTemplate/BossState 帶菜名，答對打倒時 `Team.dishes` 累加；舊存檔補 []
  - Surfaced by: D2；Section 1 最後一間房重複吃
  - Files: lib/game-state.ts, lib/room/dungeon-room.ts, lib/game-state.test.ts
  - Verify: `npm run test -- game-state dungeon-room`
- [ ] **T3 (P1, human: ~4h / CC: ~15min)** — dungeon-room/protocol — `reveal.dish`、STATE `cuisine`、旁白事件 `dish`、後記 `dishes`，含答案的菜名不進旁白（R1、R3）
  - Surfaced by: D3、D4、D5
  - Files: lib/protocol.ts, lib/room/dungeon-room.ts, lib/narration/events.ts, lib/narration/llm.ts, lib/narration/scripted.ts, 對應測試
  - Verify: `npm run test`
- [ ] **T4 (P1, human: ~4h / CC: ~15min)** — 頁面 — 大螢幕菜卡；三頁依 `cuisine` 顯示飽足感 / 獎勵分（先給 PNG）
  - Surfaced by: 做法 2、3；D4
  - Files: app/room/[code]/screen/page.tsx, host/page.tsx, play/page.tsx, e2e
  - Verify: `npm run e2e`
- [ ] **T5 (P1, human: ~3h / CC: ~15min)** — bank-editor — 每隻怪物 4 格、部分填寫不能存、存檔保留菜
  - Surfaced by: D1
  - Files: app/bank-editor/page.tsx, e2e/bank-editor.spec.ts
  - Verify: `npm run e2e -- bank-editor`

REALITY: premise-table pass 3 個前提都有出處，unverified=0 lib/game-state.ts:753
REALITY: already-done pass origin/main 自 2026-10-30 起沒有菜相關改動 lib/question-bank.ts:41
REALITY: surface-check pass 沒有新指令或路由，只有既有 STATE 欄位 lib/protocol.ts:169
REALITY: binding-decisions pass 本分支沒有先前決定；D1–D5 已記錄 docs/designs/monster-cuisine.md:1
REALITY: numbers pass 檔案數 12 [estimated]，工時 [estimated] lib/protocol.ts:66
REALITY: deferred-asks pass TODO 的「結局是一頓大餐」由後記 dishes 涵蓋 TODOS.md:422
REALITY: pr-count pass 一個 PR，沒有 ship-policy pr_count docs/designs/monster-cuisine.md:1

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises
- Architecture Review: 1 issue found（INFORMATIONAL，不改）
- Code Quality Review: 0 issues found
- Test Review: diagram produced, 17 gaps identified（全是新路徑，已排進 T1–T5）
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex (gpt-6-luna), completed, 1 finding (D5)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 4/5（D1、D4、D5 選了 10/10，D3 選了 6/10；D2 不計分）

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex, `/plan-eng-review` outside voice | Independent 2nd opinion | 1 | completed | 1 finding, resolved (D5) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 18 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex (gpt-6-luna), plan-review phase, completed, 1 finding（後記的菜名），已由 D5 解決。
- **CROSS-MODEL:** Claude 和 Codex 都指出答案過濾的問題；Codex 多找到後記這條路，Claude 查證後改為 INFORMATIONAL（結束後不算洩漏，只會讓 AI 後記作廢）。
- **VERDICT:** ENG REVIEW 完成，issues_open 指的是 17 個要補的測試和 1 個不改的 INFORMATIONAL，都已排進實作任務 — ready to implement（菜卡先給 PNG）。

NO UNRESOLVED DECISIONS
