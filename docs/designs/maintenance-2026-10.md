# 2026-10 維護輪：不加新功能

**狀態：** 計畫，等 `/plan-eng-review`
**分支：** `maintenance-2026-10`（從 main v0.9.14.2 開出）
**原則：** 玩家看不到的改動。任何會改變畫面或遊戲行為的項目，都要在審查時單獨點頭。

每一項都標了「怎麼驗證」。驗證不過的項目不出貨，寫回 TODOS。

---

## A. 安全與依賴

### A1. 修補版升級
- **What：** `next` 16.3.6→16.3.8、`eslint-config-next` 16.3.6→16.3.8、`wrangler` 4.137→4.147、`vitest` 5.0.1→5.0.3、`@cloudflare/workers-types` 到最新。major 升級（ESLint 10、TypeScript 7）仍被上游卡住，不碰。
- **Why：** `npm audit` 有 8 個漏洞（6 high、2 moderate），全在開發工具鏈：`eslint-config-next` → `fast-glob` → `micromatch` → `braces`，以及 `wrangler` → `miniflare` → `undici`。正式環境依賴（`--omit=dev`）是 0 個。
- **How：** 用 `npx npm@10` 改 lockfile（本機 npm 11 會刪掉其他平台的 esbuild，見 learnings）。改完跑 `npm ci --dry-run`。
- **驗證：** `npm audit` 數字下降（目標 0，若上游還沒修就記錄剩下的）；tsc、eslint、vitest、check:bundle、完整 e2e 全過。

### A2. `/cso` 安全稽核
- **What：** 專案第一次跑 `/cso`。重點面：`OWNER_KEY` 保護的題庫 API、R2 圖片上傳（magic bytes、大小上限）、主持人 token、房間代碼可猜（4 碼）、旁白的 LLM prompt 注入面、CORS（`ALLOWED_ORIGINS` 有萬用字元 `critical-answer-*.vercel.app`）。
- **驗證：** 稽核報告；每個發現各自決定修、延後到 TODOS、或接受。修的項目要有測試。

### A3. LLM prompt 內容審核 TODO（P3）
- **現況：** 2026-09-22 已決定延後。題目文字與答案根本不進 prompt，所以題庫可編輯不會增加暴露面。
- **This round：** 由 A2 的稽核重新確認「題目／答案仍不進 prompt」。確認後，這條 TODO 改成「只有在旁白開始讀題目文字時才需要」，降為 P4。不寫新程式。

---

## B. 可靠性與 CI

### B1. 固定 CI 的 Ubuntu 版本（有期限）
- **What：** `.github/workflows/ci.yml` 的 `runs-on: ubuntu-latest` 改成 `ubuntu-24.04`。
- **Why：** GitHub 已在 CI 上警告，`ubuntu-latest` **從 2026-10-19 起改成 Ubuntu 26**。Playwright 的 `--with-deps` 會裝系統套件，換 OS 版本是最可能突然壞掉的地方。
- **Later：** 另開 TODO：之後在 Ubuntu 26 上試跑一次，通過再換。
- **驗證：** PR 的 CI 綠燈。

### B2. 固定 Node 版本
- **What：** 加 `.nvmrc`（`22`），`package.json` 加 `"engines": { "node": ">=22 <25" }`，CI 改讀 `node-version-file: .nvmrc`。
- **Why：** CI 用 Node 22，本機是 Node 26。`lib/bank-image-api.test.ts` 的「arrayBuffer() 自己丟錯」那個測試在 Node 26 會失敗（`Cannot read private member #headers`），因為它用 `Object.create` 複製了一個 `Request`。
- **另外：** 把那個測試改成不依賴 `Request` 內部私有欄位的寫法（例如自訂一個只有 `headers`、`method`、`arrayBuffer` 的物件，再轉型），讓它在 Node 22 和 26 都能過。
- **要審查決定：** `engines` 會讓本機 Node 26 跑 `npm install` 時出現警告（不擋）。可以接受，或改成只加 `.nvmrc` 不加 `engines`。
- **驗證：** 本機 Node 26 跑 `npm test`，599 個全過；CI 綠燈。

### B3. 已存在房間醒來時，不再打一通用不到的 BankStore 呼叫（TODO P3）
- **What：** `worker/index.ts` 的 `Room.onStart()` 每次都先抓題庫（`bankOrFallback(...)`），但如果房間有存檔，接著的 `restore()` 會用存檔裡的題庫蓋掉。改成：先看 storage 有沒有 snapshot，沒有才抓題庫。
- **Why：** 少一次 Durable Object 之間的呼叫，也讓「房間不依賴 BankStore 活著」這條設計決策名副其實（`docs/designs/question-bank-editor.md` 決策 7）。
- **風險：** 要動 `onStart()` 和 `DungeonRoom` 建構、`restore()` 的順序，是這一輪唯一會改到伺服器行為的項目。
- **驗證：**
  - 新增單元測試：有 snapshot 時不呼叫 bank loader，沒有時會呼叫。
  - e2e `restart.spec.ts`（伺服器重啟後遊戲還在）要過。

### B4. 後記用的模型（只做決定，預設不動）
- **現況：** 旁白用 `claude-haiku-4-5`，後記用 `claude-sonnet-5`，兩個都還是有效的 ID。
- **選項：** 後記換成同價的新一代 `claude-sonnet-5-5`。要把 `thinking: { type: "disabled" }`（在 5.5 會回 400）改成 `{ type: "between_tools" }`，並跑真 API 的 live test 確認品質。
- **要審查決定：** 換或不換。會影響旁白內容，算是玩家感受得到的改動，所以預設不動。

---

## C. 文件與 TODO 整理

### C1. `/document-release`
- **What：** README 的功能說明停在 9/22。9/29 加入的背景音樂、音效、營火大廳、斷線提示、主持人鍵盤、首領房旁白、新怪物，以及這輪的部署方式，都要確認寫進 README。
- **驗證：** `/document-release` 的稽核結果，README 與 CHANGELOG 一致。

### C2. TODOS.md 清理
- **What：**
  - 「localStorage 邏輯重複」改為完成（`lib/stored.ts`，v0.9.14.0）。
  - A3、B3 依結果更新。
  - B1 的「Ubuntu 26 試跑」新增為 TODO。
  - 重新驗證「ESLint 10 / TypeScript 7 被上游卡住」是否還成立，只更新說明，不升級。
- **驗證：** 每一條改動都有對應的 commit 或證據。

---

## D. 程式碼健康與測試

### D1. `/health` 儀表板
- **What：** 第一次跑，取得基準分數。
- **驗證：** 報告；分數本身不是目標，只把它指出的具體問題列入下一輪候選，這輪不修。

### D2. `use-room-socket.ts` 的單元測試
- **What：** 目前 0%，只被 e2e 間接跑到。用 mock 的 `partysocket/react` 測：`resume` 判斷（第一次連線 false、自動重連 true、按鈕重連 false）、休息 close code 會關掉連線並設定 `rested`、`roomEpoch` 改變時設定 `reset`、壞掉的 JSON 會被忽略。
- **要審查決定：** 測 React hook 要加 `@testing-library/react` 和 jsdom（新的開發依賴），或者把 hook 裡的純邏輯抽成可測的函式（會動到剛重構的檔案）。
- **驗證：** 新測試會在對應的 regression 出現時失敗（先故意弄壞一次確認）。

### D3. 量 e2e 的前端覆蓋率（可選）
- **What：** 開 production source map，用 Playwright 收 V8 coverage，算出 `app/` 和 `components/` 的覆蓋率。
- **代價：** 要加 `next.config.ts`（上一輪剛刪掉），也會讓 source map 一起部署到 Vercel，等於公開原始碼。可以只在 e2e 建置時打開，正式部署不開。
- **要審查決定：** 做或延後。

---

## 不在這輪

- 任何新功能（TODOS 裡的活地圖、觀眾反應、自動判題、逃跑換房、轉場動畫等）。
- ESLint 10 / TypeScript 7 major 升級（上游卡住）。
- 上一輪 ponytail 稽核留下、會動 UI 的 4 個小項目。
- 線上實測一局（等你有空）。

## 出貨方式

依風險拆成多個 PR，每個都走 `/review` → `/ship`，合併前問你：
1. **B1 + B2**（CI 與 Node 版本，有期限，先出）
2. **A1**（依賴升級）
3. **A2/A3 的修正**（依 `/cso` 結果）
4. **B3**（房間喚醒）
5. **D2**（加 D3 如果要做）
6. **C1 + C2**（最後做，才能把前面的結果寫進文件）

---

# /plan-eng-review（2026-10-02）

**審查對象：** `docs/designs/maintenance-2026-10.md`（本檔）。以上為原始計畫，未修改。

## Scope record

feature answers: D1 = B（D3 延後，寫成 TODO）；structure: D2 = A（Original arrangement，6 個 PR）；accepted scope: A1、A2、A3、B1、B2、B3、B4、C1、C2、D1、D2，D3 移出本輪；pending remedies: R1（B3 要不要做）、R2（D2 測試方式）、R3（B2 engines）、R4（B4 後記模型）。

## Decision ledger

### Scope Challenge findings

1. [P2] (confidence: 9/10) A1「目標 0」做不到（事實更正，不需決定）。`npm audit` 的 8 個裡，5 個是 `@next/eslint-plugin-next` → `fast-glob@3.3.1`（16.3.8 仍鎖這個版本，`npm view @next/eslint-plugin-next@16.3.8 dependencies` = `{ 'fast-glob': '3.3.1' }`）→ `micromatch` → `braces <=3.0.3`，而 `braces` 最新版就是 3.0.3，上游沒有修好的版本。npm 給的唯一「修法」是把 `eslint-config-next` 降到 14.2.35。另外 3 個（`undici`、`miniflare`、`wrangler`）升 wrangler 就修好。更正：A1 目標改成「修掉 3 個，剩下 5 個記錄為開發期 lint 工具、無修補版本」。
2. [P1] (confidence: 9/10) B3 會讓已存在房間在閒置重開新局時改用內建題庫。`lib/room/dungeon-room.ts:492` `this.bank = this.initialBank;`（`reset()` 內），而 `initialBank` 就是 `worker/index.ts:139` 喚醒時抓的題庫。→ R1。
3. [P2] (confidence: 9/10) B3 計畫的單元測試寫不出來：抓題庫的程式在 `worker/index.ts`，它 import `cloudflare:workers`，vitest 載入不了（`lib/image-cleanup.ts` 舊註解就是為此拆出去的）。併入 R1。
4. [P2] (confidence: 9/10) D2 需要新的開發依賴：`node_modules` 裡沒有 `jsdom`、`happy-dom`、`@testing-library`。→ R2。
5. [P2] (confidence: 8/10) B2 的 `engines: "<25"` 會讓你本機的 Node 26 每次 `npm install` 都出警告，而計畫同時又要讓測試在 Node 26 能過，兩者方向相反。→ R3。
6. [P3] (confidence: 8/10) C2 的前提部分過時（事實更正）：`eslint-config-next@16.3.8` 的 peer 是 `eslint >=9.0.0`，ESLint 10 可能已經解鎖；TypeScript 7 仍被 `typescript-eslint`（peer `typescript <6.1.0`）擋住。C2 照計畫只重新驗證、更新說明，不升級。
7. B4 後記模型需要決定 → R4。

### R1: B3 房間喚醒少一通呼叫，要不要做
Finding: #2、#3（P1，9/10，plan-eng-review）
Plan baseline: 原始計畫 B3：onStart 先看 storage 有沒有 snapshot，沒有才抓題庫。
Runtime evidence: `reset()` 用 `initialBank`（dungeon-room.ts:492）；`restore()` 用 snapshot 的 bank（dungeon-room.ts:323）；抓題庫在 worker/index.ts:139，vitest 無法 import。
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 B3 | 每次喚醒都抓題庫 | 改成懶載入：DungeonRoom 收一個 `loadBank`，只在沒有 snapshot、snapshot 壞掉、`reset()` 時呼叫；抓取邏輯在 lib，可單元測試 | 不做，維持現狀，TODO 補上「reset 會用 initialBank」這個限制 |
| R2 D2 | pending | pending | pending |
| R3 B2 engines | pending | pending | pending |
| R4 B4 | pending | pending | pending |
Question D3:
（見下方實際送出的問題）
Header: B3 喚醒
Options:
A) 做，改懶載入 — DungeonRoom 收 loadBank，只在無存檔/存檔壞/reset() 時抓；邏輯進 lib 並補單元測試
B) 不做 (recommended) — 維持現狀，TODO 補上 reset() 依賴醒來時抓的題庫這個限制
State: approved
Actual answer: B（D3，2026-10-02）
Accepted scope: B3 不實作。C2 更新「房間重啟時對 BankStore 發出用不到的 RPC」TODO：補上 reset() 會用醒來時抓的 initialBank，所以不能直接跳過抓取；修法是懶載入 loadBank。worker/index.ts onStart 的註解加 `gstack-shortcut(dec-f5965fd8)` 標記（隨 C1/C2 的 PR）。
History: —

### R2: D2 use-room-socket.ts 的測試方式
Finding: #4（P2，9/10，plan-eng-review）。e2e 已涵蓋休息與重連（rested.spec 5 個）、斷線（disconnect.spec）；「roomEpoch 改變 → 遊戲已重置」沒有任何測試（`grep -l 伺服器重新啟動 e2e/*.ts` 無結果）。
Plan baseline: 原始計畫 D2 用 mock partysocket 測整個 hook，工具待決。
Runtime evidence: node_modules 無 jsdom、happy-dom、@testing-library。
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R2 D2 | 0% 單元覆蓋 | 加 jsdom + @testing-library/react，整個 hook 單元測試 | 把「解析訊息＋roomEpoch 重置判斷」抽成同檔純函式並單元測試，不加依賴 | 不補，寫 TODO |
| R1 B3 | approved B（不做） | 同 | 同 | 同 |
| R3 B2 engines | pending | pending | pending | pending |
| R4 B4 | pending | pending | pending | pending |
Question D4: D2 怎麼替 use-room-socket.ts 補測試？（Recommendation: B）
Header: D2 測試
Options:
A) 裝工具測整個 hook — 加 jsdom + @testing-library/react，mock partysocket，四件事都寫單元測試
B) 抽純函式再測 (recommended) — 解析訊息＋重置判斷抽成純函式並單元測試，休息/重連繼續靠 e2e
C) 不補，寫 TODO — 不動程式碼，把重置提示沒測試記成 TODO
State: approved
Actual answer: B（D4，2026-10-02）
Accepted scope: 在 lib/use-room-socket.ts 抽出純函式（輸入原始訊息字串與上一次 roomEpoch，回傳解析後的訊息或 null、新的 epoch、是否重置），hook 改呼叫它；新增 lib/use-room-socket.test.ts，測：正常 LOBBY/STATE 記下 epoch、epoch 改變回報重置、第一次收到不算重置、沒有 roomEpoch 的訊息不影響、壞掉的 JSON 回傳 null。不加新依賴。
History: —

### R3: B2 Node 版本範圍
Finding: #5（P2，8/10，plan-eng-review）。計畫的 `engines: ">=22 <25"` 與使用者本機 Node 26（`node -v` = v26.10.0）衝突。
Plan baseline: `.nvmrc`=22、`engines ">=22 <25"`、CI 讀 `node-version-file`、修 Node 26 失敗的測試。
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 engines | 無 | `>=22`（無上限） | `>=22 <25` |
| .nvmrc / CI node-version-file / 修 Node 26 測試 | 原計畫共同工作 | 同 | 同 |
Question D5: B2 固定 Node 版本要怎麼設？（Recommendation: A）
Header: Node 版本
Options:
A) engines >=22 (recommended) — 加 .nvmrc=22、engines ">=22"、CI 讀 .nvmrc，修掉 Node 26 壞的測試
B) engines >=22 <25 — 照原計畫，加上限，Node 26 會跳警告
State: approved
Actual answer: B（/review D1，2026-10-03），取代 D5 的 A。
Accepted scope: `.nvmrc` 寫 `22`；**不加** `engines`；`.github/workflows/ci.yml` 的 setup-node 改用 `node-version-file: .nvmrc`；`lib/bank-image-api.test.ts` 的 arrayBuffer 拋錯測試改成不依賴 Request 私有欄位，Node 22 與 26 都要過。
History: D5（2026-10-02）選 A：engines ">=22"。實作第 ① 個 PR 時 /review 發現 engines 會被 Vercel 讀取並蓋過專案設定（目前 Node 24.x），沒有上限的範圍可能讓前端日後被自動升大版；重問後改為不加 engines（B）。另記：`.nvmrc` 會讓 Cloudflare Workers Builds 從 Node 24.18 改用 22，與 CI 一致，合併後確認部署。

### R4: B4 後記模型
Finding: 計畫中的待決項。`lib/narration/llm.ts:12` `export const EPILOGUE_MODEL = "claude-sonnet-5";`，請求帶 `thinking: { type: "disabled" }`（llm.ts:121）。依 claude-api 參考：`claude-sonnet-5` 與 `claude-haiku-4-5` 皆為有效 ID；Sonnet 5.5（`claude-sonnet-5-5`）同價，`thinking: {type: "disabled"}` 回 400，要關閉思考改送 `{type: "between_tools"}`（僅 effort high 以下，且不能帶其他欄位）。
Plan baseline: 預設不動，只做決定。
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 後記模型 | claude-sonnet-5 + thinking disabled | claude-sonnet-5-5 + thinking between_tools，跑 test:live | 不換，TODO 記下換法 |
Question D6: B4 後記的 AI 模型要不要換新一代？（Recommendation: B）
Header: 後記模型
Options:
A) 換成 sonnet-5-5 — 改模型 ID 與 thinking 參數，跑真 API 測試確認品質
B) 不換，寫 TODO (recommended) — 維持 claude-sonnet-5，TODO 記下換法
State: approved
Actual answer: A（D6，2026-10-02），使用者選擇與建議不同。
Accepted scope: `EPILOGUE_MODEL` 改 `claude-sonnet-5-5`；後記請求的 `thinking` 改 `{ type: "between_tools" }`；相關單元測試同步；用 `npm run test:live` 跑真 API 確認後記能產生且通過現有輸出驗證（會花少量 API 費用，使用者已同意）。因 R1 決定不做 B3，原排程第 ④ 個 PR（房間喚醒）改出 B4。
History: —

## Section 1: Architecture review

1. [P3] (confidence: 8/10) A1 升 wrangler 後，第一次用新版 wrangler 的正式部署發生在第 ② 個 PR 合併時（Workers Builds 用 lockfile 裡的 wrangler 跑 `npx wrangler deploy`）。PR 上的 e2e 已用新版 `wrangler dev` 跑過，風險低；合併後照慣例用 `wrangler deployments list` 確認部署成功（既有流程，不需決定）。
2. [P2] (confidence: 9/10) B4 換成 Sonnet 5.5 後是否加伺服器端 fallbacks → R5。
3. 安全面（OWNER_KEY、R2 上傳、host token、4 碼房間代碼、CORS 萬用字元 `critical-answer-*.vercel.app`、LLM prompt 注入面）交給 A2 的 `/cso` 稽核，本段不重複。

### R5: 後記請求是否加伺服器端 fallbacks
Finding: Section 1 #2（P2，9/10，plan-eng-review）。claude-api `shared/model-migration.md`「Safeguards and fallback」：Sonnet 5.5 的 `fallbacks: "default"`（beta `server-side-fallback-2026-07-01`，僅 Claude API）只重試 `cyber`、`frontier_llm`，不重試 `bio`、`reasoning_extraction`、`general_harms`；`between_tools` 請求退到 Sonnet 5 時以 `thinking: disabled` 執行。llm.ts:138 已在 refusal 時拋 `EmptyOrRefusalError`，runner 退回罐頭後記。
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 fallbacks | 無 | 加 beta header + `fallbacks: "default"` | 不加 |
| R4 後記模型 | approved A（sonnet-5-5 + between_tools） | 同 | 同 |
Question D8（重問 D7）: 後記要不要加伺服器端 fallbacks？（Recommendation: B）
Header: 拒絕備援
Options:
A) 仍然加 fallbacks — 後記請求加 beta header 與 fallbacks: "default"，保留罐頭備援
B) 不加 (recommended) — 只換模型與 thinking 參數，被拒時退回罐頭後記
State: approved
Actual answer: B（D8，2026-10-03）
Accepted scope: 不加 fallbacks。R4 照原範圍：只改模型 ID 與 thinking 參數。
History: D7（2026-10-02）問同一件事，選項 A「加上 fallbacks」，當時 ELI10 說「被拒時後記仍是 AI 寫的」。之後讀到 model-migration.md 的說明，fallbacks 只重試 cyber 與 frontier_llm，與該說法矛盾，因此重開。D7 的回答 A 被 D8 的 B 取代。

Dispositions: #1 已記錄（既有流程）；#2 → R5 rejected（D8 = B）；#3 交給 A2。

## Section 2: Code quality review

No issues found. 檢查過：D2 抽出的純函式放在 `lib/use-room-socket.ts` 同檔（hook 仍是唯一呼叫者，不另開檔）；B2 改寫的測試不再碰 `Request` 私有欄位；B3 不做，所以 `worker/index.ts` 只加 `gstack-shortcut(dec-f5965fd8)` 註解；`lib/bank-store.ts` 開頭的 ASCII 圖已在上一輪更新，與現況一致。

Dispositions: 無。

## Section 3: Test review

框架：CLAUDE.md `## Testing` — vitest（單元）、Playwright（e2e）、`check:bundle`、tsc 兩次、eslint。CI 以 `.github/workflows/ci.yml` 為準（learning: ship-must-run-full-ci-command-set）。

```
CODE PATHS                                              USER FLOWS
[+] B2 lib/bank-image-api.test.ts（改寫既有測試）          [+] 上傳中途斷線
  └── arrayBuffer() 拋錯 → 400                              └── [★★ TESTED → 改寫後仍 ★★] Node 22 + 26
[+] D2 lib/use-room-socket.ts 抽出的純函式                [+] 伺服器重啟
  ├── [GAP→新測] 第一次收到 roomEpoch：記下，不算重置      └── [GAP→新測] 顯示「遊戲已重置」（純函式層）
  ├── [GAP→新測] roomEpoch 改變：回報重置
  ├── [GAP→新測] 沒有 roomEpoch 的訊息：不影響
  └── [GAP→新測] 壞掉的 JSON：回傳 null（hook 忽略）
[+] hook 其餘路徑                                         [+] 休息 / 重連 / 斷線
  ├── [★★★ TESTED] 休息 close → 關連線、顯示提示 — e2e/rested.spec.ts（5）
  └── [★★  TESTED] 斷線提示 — e2e/disconnect.spec.ts（2）
[+] B4 lib/narration/llm.ts                               [+] 遊戲結束念後記
  ├── [★★ TESTED → 要更新] 後記用 EPILOGUE_MODEL、thinking 參數 — llm.test.ts:32-37（改成 between_tools）
  └── [GAP] [→EVAL] 新模型實際產出 — `npm run test:live`（R4 已同意花費）
[+] A1 依賴升級（next、wrangler、vitest、workers-types）  [+] 全站
  └── [★★★ 既有] tsc×2、eslint、vitest、check:bundle、e2e 全套（回歸覆蓋）

COVERAGE: 新增路徑 6 條，計畫補上 5 條單元 + 1 條 live eval；既有回歸套件不變
```

Value cards:
- D2 roomEpoch 改變 → 重置。Value: protects=伺服器重啟後玩家看到「遊戲已重置」; fails_when=epoch 比較被改掉或反轉; why_new=e2e 無任何測試觸發 roomEpoch 改變; seam=none（純函式是 hook 的實際實作，不是測試專用）
- D2 壞 JSON → null。Value: protects=非 JSON 訊息不讓頁面崩潰; fails_when=移除 try/catch; why_new=單元與 e2e 都沒送過壞 JSON; seam=none
- B2 改寫。Value: protects=上傳中途斷線回 400 不是 500; fails_when=bank-image-api 的 catch 被拿掉; why_new=既有測試只在 Node 22 能跑; seam=none
- B4 thinking 參數。Value: protects=後記請求格式符合 Sonnet 5.5（disabled 會 400）; fails_when=有人改回 disabled; why_new=既有斷言是 disabled; seam=none

Tests made obsolete: 無（B2 是改寫，不是刪除）。

REGRESSION RULE：A1 升級動到全站，回歸覆蓋就是現有完整 CI 套件（已存在），計畫已要求全部通過，不需另立測試。

Dispositions: 測試需求均屬已核准範圍（R2、R3、R4）的必要驗證，不另開決定。

## Section 4: Performance review

No issues found. B3（每次喚醒多一通 DO 呼叫，毫秒級）已決定不做（R1），其餘項目不碰執行期路徑；B4 換模型的延遲由既有 15 秒後記等待上限（`DEFAULT_EPILOGUE_HOLD_MS`）兜住，逾時退回罐頭後記。

Dispositions: 無。

## Outside voice

Codex 預檢為 ready，但執行時回報 `You’ve hit your usage limit ... try again at Oct 21st, 2026`，外部審查失敗。原生備援需要 TaskOutput／TaskStop 工具，本工作階段沒有，走 unavailable 路徑。外部覆蓋：**unavailable**（已記錄於 review log，不算通過）。沒有跨模型比對。

## TODOS 決定

- D3 延後 → 新增 TODO（D1 = B 已核准）。
- B1「之後在 Ubuntu 26 試跑」→ 新增 TODO（原計畫範圍）。
- B3 → 更新既有 TODO，補 reset() 限制與懶載入修法（R1 已核准）。
- 開發工具剩餘 5 個漏洞 → 新增 P4 TODO（D9 = A，2026-10-03）：漏洞鏈 `@next/eslint-plugin-next` → `fast-glob@3.3.1` → `micromatch` → `braces <=3.0.3`；只影響 lint 掃描本機檔案；上游修好的訊號是 `eslint-config-next` 不再鎖 `fast-glob@3.3.1` 或 `braces` 出修補版。
- A3 → 依 `/cso` 結果更新既有 TODO（原計畫範圍）。
- C2 → 「localStorage 邏輯重複」標完成；「ESLint 10 / TS 7」重新驗證並更新說明。

Approval readiness: PASS — R1（D3）、R2（D4）、R3（D5）、R4（D6）、R5（D8，取代 D7）、範圍 D1、結構 D2、TODO D9；其餘工作屬原計畫範圍。

## NOT in scope

- D3 量 e2e 前端覆蓋率：要加 next.config 且有 source map 外洩風險，只產生一個數字（D1）。
- B3 房間喚醒少一通呼叫：省毫秒級延遲，卻會讓閒置重開的新局改用內建題庫（R1）。
- 後記加伺服器端 fallbacks：只重試後記幾乎碰不到的 cyber／frontier_llm 拒絕（R5）。
- ESLint 10 / TypeScript 7 升級：只重新驗證狀態，不升級。
- 新功能、會動 UI 的 ponytail 小項目、線上實測一局。

## What already exists

- 依賴升級沿用上一輪的 lockfile 做法：`npx npm@10`，再用 `npm ci --dry-run` 驗證（learning npm11-lockfile-drops-platform-optionals）。
- 後記被拒絕或失敗時已有罐頭備援：`lib/narration/llm.ts:138` 拋 `EmptyOrRefusalError`，runner 退回 `lib/narration/scripted.ts`。所以 R5 不加 fallbacks。
- 休息、重連、斷線已有 e2e（`e2e/rested.spec.ts`、`e2e/disconnect.spec.ts`），D2 只補缺口，不重測。
- localStorage 安全讀寫已有 `lib/stored.ts`（v0.9.14.0），C2 據此關閉舊 TODO。

## Diagrams

PR 依序（D2 = A，原始 6 個 PR；R1 讓第 ④ 個改出 B4）：

```
① CI+Node ──▶ ② 依賴升級 ──▶ ③ /cso 修正 ──▶ ④ 後記模型 ──▶ ⑤ D2 測試 ──▶ ⑥ 文件+TODOS
  B1 B2          A1             A2 A3           B4             D2           D1(/health) C1 C2
  (10/19 前)     (合併後確認                                                 (最後做，收前面
                 Workers Builds 部署)                                         所有結果)
```

## Failure modes

| 路徑 | 實際可能的失敗 | 測試 / 處理 | 使用者看到 |
|---|---|---|---|
| B1 固定 ubuntu-24.04 | 標籤打錯，CI 起不來 | PR 的 CI | CI 紅燈（明顯） |
| B2 node-version-file | 路徑寫錯，setup-node 失敗 | PR 的 CI | CI 紅燈（明顯） |
| A1 wrangler 升級 | 新版部署行為改變，Workers Builds 部署失敗 | PR e2e 用新版 wrangler dev；合併後查 deployments | 線上留在舊版，不會壞（Cloudflare 部署失敗不替換） |
| B4 Sonnet 5.5 參數錯 | 每次後記 400，退回罐頭 | llm.test.ts 斷言 between_tools＋`npm run test:live` | 罐頭後記（安靜，但出貨前測得到） |
| D2 純函式改壞 | 重置提示不出現或誤出現 | 新單元測試 5 項 | 已有測試擋住 |

Critical gaps：0。

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|------|----------------|------------|
| ① CI+Node | .github/, 根目錄設定, lib/（一個測試） | — |
| ② 依賴升級 | package.json, package-lock.json | ①（同改 package.json） |
| ③ /cso 修正 | 依稽核結果，未知 | ② |
| ④ 後記模型 | lib/narration/ | — |
| ⑤ D2 測試 | lib/（use-room-socket） | — |
| ⑥ 文件+TODOS | README, TODOS.md, worker/（註解） | ①–⑤ |

Parallel lanes：Lane A：① → ② → ③（共用 package.json）；Lane B：④；Lane C：⑤。執行順序依 D2 = A 一次出一個 PR，但 B、C 可在 A 等 CI 時先寫好。⑥ 最後。Conflict flags：① 與 ② 都改 package.json，必須依序。

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~30min / CC: ~5min)** — CI — 把 runs-on 固定為 ubuntu-24.04
  - Surfaced by: 原計畫 B1（10/19 期限）
  - Files: .github/workflows/ci.yml
  - Verify: PR CI 綠燈
- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — Node — 加 .nvmrc=22、engines ">=22"、CI 讀 .nvmrc，改寫 Node 26 會壞的測試
  - Surfaced by: R3（D5 = A）
  - Files: .nvmrc, package.json, .github/workflows/ci.yml, lib/bank-image-api.test.ts
  - Verify: 本機 Node 26 `npm test` 全過；CI 綠燈
- [ ] **T3 (P2, human: ~2h / CC: ~20min)** — deps — 升 next、eslint-config-next、wrangler、vitest、workers-types 修補版
  - Surfaced by: A1、Scope finding #1
  - Files: package.json, package-lock.json
  - Verify: `npm ci --dry-run`；`npm audit` 剩 5 個（braces 鏈）；完整 CI 套件；合併後 `wrangler deployments list`
- [ ] **T4 (P2, human: ~半天 / CC: ~30min)** — security — 跑 /cso，逐項決定修、延後或接受
  - Surfaced by: A2、Section 1 #3
  - Files: 依稽核結果
  - Verify: 稽核報告；修的項目各有測試
- [ ] **T5 (P3, human: ~15min / CC: ~5min)** — narration — 確認題目／答案仍不進 prompt，更新內容審核 TODO
  - Surfaced by: A3
  - Files: TODOS.md
  - Verify: /cso 報告中的對應結論
- [ ] **T6 (P2, human: ~2h / CC: ~15min)** — narration — 後記改用 claude-sonnet-5-5 與 thinking between_tools
  - Surfaced by: R4（D6 = A）、R5（D8 = B，不加 fallbacks）
  - Files: lib/narration/llm.ts, lib/narration/llm.test.ts
  - Verify: `npm test`；`npm run test:live`（使用者已同意費用）
- [ ] **T7 (P2, human: ~1h / CC: ~10min)** — room socket — 抽出訊息解析與 roomEpoch 重置判斷的純函式並補 5 項單元測試
  - Surfaced by: R2（D4 = B）
  - Files: lib/use-room-socket.ts, lib/use-room-socket.test.ts
  - Verify: 新測試在故意弄壞 epoch 比較時失敗；e2e rested/disconnect 仍過
- [ ] **T8 (P3, human: ~1h / CC: ~10min)** — health — 跑 /health 取得基準，問題列入下一輪候選
  - Surfaced by: 原計畫 D1
  - Files: 無（報告）
  - Verify: /health 報告
- [ ] **T9 (P3, human: ~1h / CC: ~10min)** — docs — /document-release 補上 9/29 之後的功能與部署方式
  - Surfaced by: 原計畫 C1
  - Files: README.md, CHANGELOG.md
  - Verify: /document-release 結果
- [ ] **T10 (P3, human: ~30min / CC: ~10min)** — TODOS — 依「TODOS 決定」更新，worker/index.ts onStart 加 gstack-shortcut(dec-f5965fd8)
  - Surfaced by: R1、D1、D9、C2、Scope finding #6
  - Files: TODOS.md, worker/index.ts（註解）
  - Verify: 每一條改動都有對應證據

## Unresolved decisions

無。

## Completion summary

- Step 0: Scope Challenge — scope reduced per recommendation（D3 延後；B3 依 R1 不做）
- Architecture Review: 2 issues found（wrangler 首次部署驗證、後記 fallbacks）
- Code Quality Review: 0 issues found
- Test Review: diagram produced, 6 gaps identified（D2 5 項、B4 live eval 1 項）
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user（剩餘漏洞 TODO，accepted）；另 5 項屬已核准範圍
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex，unavailable（用量額度用完，至 2026-10-21；原生備援工具不可用）
- Parallelization: 3 lanes, 2 parallel / 4 sequential
- Lake Score: 0/2（有完整度分數的兩題：D3 選了 7/10 的 B、D4 選了 8/10 的 B，都不是 10/10）

## Suppressed findings

- (confidence: 4/10) B1 的 Playwright `--with-deps` 在 ubuntu-24.04 上的系統套件名稱可能與 Ubuntu 26 不同：只影響未來換版，不影響本輪。

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable | Codex 用量額度用完（至 2026-10-21），原生備援工具不可用 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (mapped to tasks) | 8 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable（usage limit）；無原生備援結果。
- **CROSS-MODEL:** 無（外部審查未完成）。
- **VERDICT:** Eng review 已完成並解決所有決定（9 題，0 未決）；狀態為 issues_open，因為審查發現已對應成 T1–T10 待實作，不是未解問題。可以開始實作，依 6 個 PR 依序出貨。

NO UNRESOLVED DECISIONS
