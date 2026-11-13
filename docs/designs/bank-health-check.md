## Implementation plan
# 開場前題庫健檢

狀態：站長確認需求（2026-11-12，Captain 轉達），實作中。
活動：2026-11-21，功能截止 2026-11-18。

## 要做什麼

開場前，主持人在大廳按一顆「檢查題庫」，房間把這一場會用到的題庫整份檢查一次，主持人頁列出紅／黃／綠結果。壞掉的影片、找不到的上傳檔、題目不夠，在活動前就看得到，不是輪到那題才發現。

- 紅：現場一定會壞（影片被刪、不能嵌入、上傳檔 404、大螢幕的格子放不下）。
- 黃：可疑，要人看一眼（連不上沒辦法確認、HEVC 影片、題目比隊伍少）。
- 綠：沒問題，只顯示總數。

每一列寫出是哪一題（難度或首領階段、題目 id、題目開頭幾個字）和問題，主持人到 `/bank-editor` 找得到。

## 已經有的檢查（不重寫）

- `parseBank`（`lib/question-bank.ts`）在讀題庫時就擋掉空答案、選擇題沒設正解、欄位空白、排序題重複項目、壞的 UUID／YouTube id。房間拿到的題庫一定通過它（`loadBank` 讀不了就拒絕，`multi-bank.md`），所以健檢不再列這些：它們在這裡不可能出現。
- `assertSavable`：存檔才檢查的上限（選項超過 4 個大螢幕放不下、首領 HP、階段名稱和規則太長、題目 id 太長手機不能作答）。舊題庫可能還沒過它。它遇到第一個問題就丟錯，所以抽出 `savableProblems(bank): string[]` 回傳全部問題，`assertSavable` 改成丟第一個（存檔行為不變）。健檢把每一個變成一列紅。訊息沿用原本的英文（編輯器存檔時顯示的也是這些字）。
- 題目比隊伍少：大廳本來就用 `bankSizeWarning`（`lib/bank-size.ts`）照目前隊伍數即時顯示。那行 ⚠ 就在健檢按鈕正上方，隊伍加入就更新；健檢不重算一份（按下時的隊伍數一下就過時），清單也不重複列。

## 設計

### D1 按鈕在大廳，結果在大廳

主持人頁大廳「題庫：」選單下面一顆「🩺 檢查題庫」。只在大廳能按（遊戲開始後房間回 `game_already_started`）：健檢是開場前的事。換題庫或房間重設時，舊的結果清掉。

**按下就重新載入題庫再檢查。** 房間在選題庫時複製一份（`handleSetBank`），之後在 `/bank-editor` 存檔不會改到房間那份。所以健檢先用跟選題庫一樣的路徑重新載入目前選的題庫（同一個 id，`playedQuestionIds` 照舊保留），再檢查新載入的那份。主持人看到紅、去編輯器改、回來再按一次，看到的就是改過的版本，不用重開房間或重選題庫。自訂題庫要主持人證明過 `OWNER_KEY` 才能載入（`multi-bank.md` D4）；沒證明過就檢查房間現有那份，結果上寫「沒有重新載入」。

`/bank-editor` 不加（見「不做」）。

### D2 在房間（伺服器）檢查，只送結果

新訊息 `HOST_BANK_CHECK {}`（只收主持人，`requireHost`）。回 `HOST_BANK_HEALTH`，只送給按的那個連線，不廣播：

```ts
{ type: "HOST_BANK_HEALTH"; rows: HealthRow[]; questions: number; unchecked: number; reloaded: boolean }
// HealthRow = { level: "red" | "yellow"; questionId?: string; where: string; label?: string; problem: string }
```

- `rows` 不帶答案、網址、YouTube id、R2 key。`where` 是「難度 2」「首領第 1 階段」或「題庫」（整份題庫的問題），`label` 是題目開頭最多 16 個字（文字題的題目、媒材題的 `prompt`；都沒有就省略）。主持人頁本來就看得到這些（`HOST_ANSWER` 連答案都有），手機和大螢幕收不到。
- `questions`：檢查了幾題；`unchecked`：有幾題的媒材沒辦法自動檢查（Instagram 詳解）。主持人頁算「沒發現問題」＝`questions` 減去有列的不同題目。
- 一個房間同時只跑一個檢查（第二次按回 `invalid_action`／`check_running`）；題庫載入中回 `bank_loading`。
- 開始時記下 `bankGen`。檢查完如果 `bankGen` 變了（換題庫、房間重設），不送結果，改回 `invalid_action`／`check_stale`，主持人頁顯示「題庫換了，請再檢查一次」。同一個 id 重選、A→B→A、重設回同一份都會讓 `bankGen` 變，所以不會把舊結果當新的。遊戲開始了就什麼都不送（主持人頁收到 `STATE` 已經清掉結果，遊戲中不該跳「請再檢查」）。程式出錯回 `check_failed`。
- 重新載入失敗（題庫讀不到、自訂題庫被刪）：照現有規則回 `bank_unavailable`，再檢查房間現有那份（房間真正會用的那份），`reloaded: false`。
- 每批 RPC 最多等 40 秒，開始 40 秒後不再送新的一批（剩下的算黃），所以整個檢查約 80 秒內結束，在主持人頁 90 秒的等待之內；`bankChecking` 不會卡住。另一台主持人裝置換題庫（`HOST_BANKS` 的 `selected` 變了）時，這台的結果也清掉。
- 結果不寫進快照，用 `conn.send` 直接送，不經過會觸發存檔的 `sendTo`。

### D3 媒材在伺服器查（不是主持人的瀏覽器）

主持人的瀏覽器連 YouTube oEmbed 會碰到 CORS（實測回應沒有 `Access-Control-Allow-Origin`），用 IFrame API 一支一支試又會把主持人手機拖慢。伺服器端 `fetch` 沒有 CORS，不用 API key。

| 媒材 | 怎麼查 | 紅 | 黃 |
|---|---|---|---|
| YouTube（題目或詳解） | `GET https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<id>&format=json` | 401（YouTube 不給嵌入：私人影片或關掉嵌入，大螢幕放不出來）、404／400（找不到：刪除或 id 錯） | 其他狀態碼（例如 429 被擋）、逾時：「沒辦法確認」 |
| 上傳圖片、影片、聲音 | R2 binding `images.get(key, { range: { offset: 0, length: 65536 } })` | 物件不存在 | 影片前 64 KB 有 `hvc1`／`hev1`（HEVC，很多瀏覽器放不出來）；讀取失敗：「沒辦法確認」 |
| R2 公開網址 | 有上傳檔時，用 binding 確認存在的第一個檔案 `HEAD <R2_PUBLIC_BASE_URL>/<key>` 一次（不會因為某個檔案被刪就誤報整個 bucket；全部都不見就不查，算黃） | 非 2xx、或 `R2_PUBLIC_BASE_URL` 沒設／還是 `REPLACE-ME`：「大螢幕讀不到上傳的檔案」 | 逾時 |
| Instagram 詳解 | 不查（沒有不用登入的公開檢查），算進 `unchecked` | — | — |

- 同一支影片或檔案在好幾題用到只查一次，結果套到每一題。
- 一次最多 6 個請求同時跑（Workers 同時對外連線的上限），每個請求從真的送出才開始算 5 秒逾時；回應的 body 一律 `cancel()`，不讀整個檔案。
- 綠的意思是「自動檢查沒發現問題」，不是「現場一定放得出來」。看不出來的：地區限制、年齡限制、版權靜音（oEmbed 照樣回 200）、`moov` 在檔尾的 HEVC、場地 Wi-Fi 擋網址、大螢幕瀏覽器不支援的編碼。主持人頁和 `docs/hosting.md` 都寫這句，並建議活動前幾天先跑一次健檢，到場在大螢幕上實際播一輪。
- shortcut：HEVC 只看檔頭 64 KB，看不到就算綠。要更準再讀檔尾。

### D4 對外請求在題庫 Durable Object 裡發，每批 40 個

Cloudflare 免費方案一次 invocation 最多 50 個對外子請求（另有 1,000 個 Cloudflare 服務子請求）。房間的 Durable Object 不休眠（`hibernate: false`），WebSocket 訊息是不是各算一次 invocation，文件沒寫（codex 審查查過）。所以房間自己不發對外請求：`RoomIO` 加 `checkMedia(batch)`，Worker 接到 `BankStoreDO.checkMedia()`（RPC）。每次 RPC 是題庫 DO 的一個新請求，有自己的 50 個額度；一批最多 40 個 YouTube 加 1 個公開網址 HEAD，R2 binding 算 Cloudflare 服務、不吃對外額度。房間一批一批依序呼叫，全部回來後送一則 `HOST_BANK_HEALTH`。主持人頁只送一次訊息，不用分批接力。

放在 `BankStoreDO` 是因為它本來就是伺服器端唯一的共用 DO、已經有 R2 binding；邏輯本身在 `lib/bank-health.ts`（純函式，傳入 `fetch` 和讀 R2 的函式），DO 只接線。

shortcut：「每次 RPC 一份額度」沒在正式環境量過；萬一不是，`fetch` 丟錯，那支影片算黃（沒辦法確認），整個檢查不會失敗。

### D5 主持人頁

- 按下後按鈕變「檢查中…」並停用，直到收到 `HOST_BANK_HEALTH`、`ERROR`，或 90 秒沒回應（連線斷掉時）。
- 結果：一行總結「🔴 2 會壞 · 🟡 1 要看 · ✅ 48 題沒發現問題」，下面紅的在前、黃的在後，每列：圖示＋「紅」／「黃」字（不只靠顏色）、`where`＋`#id`、`label`、`problem`。沒有問題就一行「✅ 51 題自動檢查沒發現問題」。有 `unchecked` 時加一行「Instagram 詳解 N 題沒辦法自動檢查」。最後一行灰字：「自動檢查看不出地區限制、場地網路和大螢幕的播放能力，到場請在大螢幕實際播一輪。」
- 題目比隊伍少的大廳警告（已有的 ⚠ 那行）留在按鈕正上方，跟著隊伍數即時更新。
- 清單最多佔畫面 40%，超過就在框裡捲動，「開始遊戲」不會被擠出手機畫面。
- 結果放在大廳，不用彈窗；開始遊戲按鈕不因為紅而停用（站長可能就是要用這份題庫，只是知道哪題要跳過）。
- 換題庫或回到大廳時清掉舊結果。

## 測試

- `lib/bank-health.test.ts`：
  - 健康的題庫：沒有列。
  - `savableProblems`：5 個選項加太長的階段名稱 → 兩個問題；`assertSavable` 仍丟第一個。
  - YouTube oEmbed 401 → 紅、404 → 紅、400 → 紅、429／500 → 黃、fetch 丟錯 → 黃、逾時 → 黃（fake timers）。
  - 同時最多 6 個請求在跑；body 被 cancel。
  - R2 物件不存在 → 紅；影片前 64 KB 有 `hvc1` → 黃；同一個 key／id 兩題用只查一次、兩題都列。
  - `R2_PUBLIC_BASE_URL` 沒設或 `REPLACE-ME` → 一列紅；公開 HEAD 403 → 紅；沒有上傳檔就不查公開網址。
  - 41 支 YouTube → 兩批（40＋1）。
  - Instagram 詳解算進 `unchecked`。
  - 列裡沒有 YouTube id、R2 key、`answer`／`correctIndex`／`fields` 欄位。
- `lib/room/bank-health.test.ts`（房間）：不是主持人回 `not_host`；遊戲中回 `game_already_started`；載入中回 `bank_loading`；第二次按回 `check_running`；只送給發問的連線（手機、大螢幕收不到）；先重新載入題庫再檢查（`loadBank` 被叫、檢查的是新那份）；檢查途中換題庫 → `check_stale`、不送結果；遊戲開始 → 什麼都不送；重新載入失敗 → 檢查房間那份、`reloaded: false`；RPC 丟錯或 40 秒沒回 → 黃。
- `lib/protocol.test.ts`：`HOST_BANK_CHECK` 解析。
- e2e：CI 跑，不新增。

## 文件

- `docs/hosting.md`／`docs/hosting.en.md`：開場前按「檢查題庫」，紅黃各代表什麼，綠不保證現場放得出來，建議前幾天先跑。
- `changelog.d/<branch>.md`：`bump: minor`。
- `TODOS.md`：延後項（見「不做」）。

## 不做

- `/bank-editor` 的健檢按鈕：編輯器沒有房間；要另開一支帶 `OWNER_KEY` 的 API 查媒材。按鈕放在大廳，加上「按下就重新載入」，已經涵蓋改完再查。
- 站長本機的 CLI 健檢：主持人不一定是站長、手邊沒有終端機，題庫存在 bank store 不是本機檔案。
- 大螢幕實際載入每支媒材再回報（最能代表現場的檢查，但要動大螢幕和協定，11-18 前做不完；進 TODOS）。
- 地區限制、年齡限制、版權靜音、YouTube `start` 超過影片長度（oEmbed 看不到）。
- Instagram 詳解檢查。
- 檔尾 `moov` 的 HEVC 偵測。
- 把 `R2_PUBLIC_BASE_URL` 換成自訂網域（部署設定，`uploaded-media.md` 已列風險）。
- 只有選擇題、沒有填空題的難度（`textQuestionGaps`）：是出題選擇，不是會壞的東西。
- 健檢結果存檔、開始前強制健檢、`savableProblems` 訊息翻成中文。

## Review record

/autoplan 2026-11-12，背景 lane「bank-health」執行；沒有使用者可以問，所有決定照 6 個原則自動做。

自動做法：Claude 原生 CEO 審查和 ENG 審查兩個子代理（各自讀 snapshot），外部意見用 Codex（`codex exec`，read-only）一次看 CEO＋ENG 兩面。照審查結果改了計畫（D1 重新載入、D2 `bankGen`／`check_stale`／一次一個、D3 並行上限與 body cancel、D4 改成在題庫 DO 發對外請求、`savableProblems`、隊伍數改在主持人頁即時算），上面的 Implementation plan 是改過的版本。

### CEO

**模式：** SELECTIVE EXPANSION。

**前提**

| 前提 | 主張 | 結論 |
|---|---|---|
| P1 | 活動前發現壞媒材比現場發現便宜得多 | REALITY: 一場活動、無重來機會；接受 |
| P2 | `parseBank` 已擋掉資料錯誤，健檢不用重寫 | REALITY: `lib/question-bank.ts` parseTextQuestion／parseMultipleChoiceQuestion／parseFields 都 `fail`；房間的 `loadBank` 讀不了就拒絕；接受 |
| P3 | 伺服器端查得到 YouTube 能不能嵌入 | REALITY: oEmbed 實測 200（正常 id）、400（亂碼 id）、沒有 CORS 標頭；401＝私人或不給嵌入（iframe 一樣放不出來）；接受，但綠只代表「沒發現問題」 |
| P4 | 每則 WebSocket 訊息有新的 50 個子請求 | REALITY: Cloudflare 文件只說 CPU 時間每則訊息重算，子請求沒寫；房間 `hibernate: false`。推翻，改 D4 |
| P5 | 編輯器存檔後房間就會用新題庫 | REALITY: `handleSetBank` 複製一份，之後存檔不影響；推翻，改 D1 按下就重新載入 |

**替代方案**

| 方案 | 完整度 | 決定 |
|---|---|---|
| A 房間＋題庫 DO 在伺服器查（採用） | 媒材＋資料，主持人一顆鈕 | 採用 |
| B 主持人瀏覽器查（IFrame API） | 可測真實嵌入，但手機慢、oEmbed 有 CORS | 不採用 |
| C 站長本機 CLI | 沒有子請求上限，但主持人不一定是站長、題庫在 bank store | 不採用 |
| D 大螢幕實際載入回報 | 最貼近現場 | 延後到 TODOS（11-18 前做不完） |

**CEO DUAL VOICES — CONSENSUS TABLE**

```
  Dimension                           Claude  Codex  Consensus
  1. Premises valid?                   部分    部分   CONFIRMED（P4、P5 推翻）
  2. Right problem to solve?           是      是     CONFIRMED
  3. Scope calibration correct?        是      是     CONFIRMED（綠的字樣要收斂）
  4. Alternatives sufficiently explored?否     —      Claude only（CLI 補寫進「不做」）
  5. Competitive/market risks covered? N/A     N/A    自用工具
  6. 6-month trajectory sound?         擔心分批協定 擔心分批協定 CONFIRMED（D4 改掉分批協定）
```

**Error & Rescue Registry**

| 錯誤 | 誰接 | 主持人看到 |
|---|---|---|
| oEmbed 逾時／429／5xx | `lib/bank-health.ts` | 黃「沒辦法確認」 |
| 題庫 DO RPC 失敗（含子請求用完） | 房間 catch | 那批全部黃「沒辦法確認」 |
| R2 讀取丟錯 | `lib/bank-health.ts` | 黃 |
| 重新載入題庫失敗 | 房間 | 照現有 `bank_unavailable` 錯誤，按鈕恢復 |
| 檢查途中換題庫／重設／開始 | 房間 `bankGen` | `check_stale`「題庫換了，請再檢查一次」 |
| 連線斷掉，結果送不到 | 主持人頁 90 秒逾時 | 按鈕恢復 |

**Failure Modes Registry**

| 失敗 | 影響 | 處理 |
|---|---|---|
| YouTube 對機房 IP 一律 429 | 全部 YouTube 變黃 | 黃不是綠，不會誤導；記在 hosting 文件 |
| 綠被當成「現場沒問題」 | 現場仍壞 | 字樣「沒發現問題」＋灰字提醒到場實播 |
| 舊結果被當成新題庫的 | 漏修 | `bankGen` 比對、換題庫清結果 |
| 一直按鈕洗外部請求 | YouTube 擋 | 一個房間同時一個檢查 |

**NOT in scope：** 見 Implementation plan「不做」。

**What already exists：** `parseBank`、`assertSavable`（抽出 `savableProblems`）、`bankSizeWarning`／`bankSizeWarningText`、`imageKeysOf` 的走訪方式、`handleSetBank` 載入路徑與 `bankGen`、`requireHost`、`RoomIO.loadBank` 接線、`BankStoreDO` 的 R2 binding。

**Dream state delta：** 現在：壞媒材到輪到那題才發現 → 這份：開場前一鍵查出伺服器看得到的問題 → 12 個月後：大螢幕實際預載每支媒材回報、編輯器存檔時就查。

**Completion Summary：** 前提 5 條（推翻 2）、替代方案 4 個、擴充 0 個接受（大螢幕回報延後）、User Challenge 0、Taste 3（見最後）。

<!-- autoplan-accepted:ceo -->
- 大廳「🩺 檢查題庫」：按下先重新載入目前選的題庫（自訂題庫要 owner 證明，沒有就檢查現有那份並標示），再檢查；只在大廳、只給主持人、結果只送給發問連線。測試：lib/room/bank-health.test.ts。
- 紅：YouTube oEmbed 401／404／400、R2 物件不存在、R2 公開網址讀不到或沒設、`savableProblems` 每一條。黃：其他狀態碼、逾時、RPC 失敗、HEVC、題目比隊伍少（主持人頁即時算）。測試：lib/bank-health.test.ts。
- 綠字樣是「自動檢查沒發現問題」，加灰字提醒到場在大螢幕實播；Instagram 詳解列為沒辦法檢查。
- 列裡不帶答案、網址、YouTube id、R2 key。測試：lib/bank-health.test.ts。
- 文件：docs/hosting.md／hosting.en.md 一起改；TODOS 加「大螢幕實際載入每支媒材回報」。
<!-- /autoplan-accepted:ceo -->

### Design

uiRequired 判定為否（snapshot 的 scope 工具），沒有跑 Design 階段。介面只在大廳加一顆鈕和一個清單；mockup 放在 lane 報告（本機 PNG，不進 repo）。

### DX

snapshot 工具因為「API」出現 4 次判定要跑 DX，但這幾處都是「不另開 API」的意思，功能沒有開發者用的介面（不是 SDK、CLI、公開 API）。跳過，不算完成的審查。

### Eng

**架構**

```
 主持人頁 ──HOST_BANK_CHECK──▶ DungeonRoom.handleBankCheck
   ▲                              │ requireHost / 大廳 / 沒在載入 / 沒在跑
   │                              │ reload：handleSetBank 同一路徑（loadBank）
   │                              │ gen = bankGen；targets = healthTargets(bank)
   │                              ▼
   │                   RoomIO.checkMedia(batch ≤40 YouTube + files)  ×N（依序）
   │                              │  RPC
   │                              ▼
   │                   BankStoreDO.checkMedia ─▶ lib/bank-health.ts checkMediaBatch
   │                              │  fetch oEmbed（6 並行、5 秒）/ images.get(range) / 公開 HEAD
   │                              ▼
   │                   healthRows(bank, results, savableProblems)
   │   gen 變了或遊戲開始 → ERROR check_stale
   └──HOST_BANK_HEALTH（conn.send，只給發問的人）
```

**程式路徑 → 測試**

```
 savableProblems ─────────────▶ bank-health.test.ts「兩個問題」
 healthTargets（去重、instagram）▶ bank-health.test.ts「同一 key 查一次」「unchecked」
 checkYoutube（狀態碼、逾時、並行）▶ bank-health.test.ts 狀態碼表、fake timers、in-flight 計數
 checkFile（缺檔、HEVC）───────▶ bank-health.test.ts
 publicBase（沒設、403）────────▶ bank-health.test.ts
 batches（40＋1）──────────────▶ bank-health.test.ts
 handleBankCheck 各種拒絕 ─────▶ room/bank-health.test.ts
 reload 後才檢查、stale ────────▶ room/bank-health.test.ts
 主持人頁 UI ──────────────────▶ 手動／CI e2e 不新增（taste：見下）
```

**ENG DUAL VOICES — CONSENSUS TABLE**

```
  Dimension                    Claude  Codex  Consensus
  1. Architecture sound?        是(改)  是(改) CONFIRMED（D4 改法 Claude 自己的決定）
  2. Test coverage sufficient?  補測試  補測試 CONFIRMED
  3. Performance risks?         6 並行  6 並行 CONFIRMED
  4. Security threats?          洗請求  無洩漏 CONFIRMED（一次一個）
  5. Error paths handled?       補     補     CONFIRMED
  6. Deployment risk?           子請求  子請求 CONFIRMED（D4）
```

測試計畫另存本機 `~/.gstack/projects/critical-answer/`（不進 repo）。

<!-- autoplan-accepted:eng -->
- `HOST_BANK_CHECK` 處理：拒絕 not_host、game_already_started、bank_loading、check_running；`bankGen` 變了或遊戲開始送 check_stale；結果用 `conn.send` 不觸發存檔。測試：lib/room/bank-health.test.ts。
- 對外請求只在 `BankStoreDO.checkMedia`（RPC）發，每批 ≤40 YouTube＋1 公開 HEAD；R2 用 binding range 讀 64 KB；6 並行、每請求 5 秒、body cancel。測試：lib/bank-health.test.ts。
- `HealthRow` 型別放 `lib/protocol.ts`，主持人頁不 import `lib/bank-health.ts`；`npm run check:bundle` 要過。
- 主持人頁 90 秒逾時、ERROR 時按鈕恢復；換題庫／回大廳清結果。
<!-- /autoplan-accepted:eng -->

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | 按鈕只放大廳 | Taste | P5 | 開場前的事；編輯器沒有房間 | ⚙ 更多抽屜、/bank-editor |
| 2 | CEO | 按下先重新載入題庫 | Mechanical | P1 | 不然改完再查還是舊的（codex #3） | 另一顆「重新載入」鈕 |
| 3 | CEO | 綠字樣改「沒發現問題」＋實播提醒 | Mechanical | P1 | 兩邊都指出誤導 | 「都沒問題」 |
| 4 | CEO | 不做 CLI | Mechanical | P3 | 主持人不一定是站長 | CLI |
| 5 | CEO | 大螢幕回報延後 TODOS | Mechanical | P3 | 11-18 前做不完 | 這次做 |
| 6 | Eng | 對外請求移到 BankStoreDO RPC | Taste | P3 | 房間不休眠，訊息額度沒文件；RPC 一定是新請求 | 主持人頁分批接力 |
| 7 | Eng | `bankGen`＋check_stale | Mechanical | P1 | bankId 擋不住 A→B→A | bankId |
| 8 | Eng | 一個房間同時一個檢查 | Mechanical | P1 | 防洗外部請求 | 不限 |
| 9 | Eng | 抽出 `savableProblems` | Mechanical | P1 | 一次列完全部 | 只抓第一個 |
| 10 | Eng | 隊伍數警告沿用大廳已有那行 | Mechanical | P4 | 已有且即時，房間算會過時 | 房間算、清單重複列 |
| 11 | Eng | 主持人頁 UI 不加 e2e | Taste | P6 | e2e 只在 CI，房間測試已涵蓋協定 | 新 e2e |
| 12 | Eng | 401 維持紅 | Mechanical | P5 | 私人或不給嵌入，iframe 都放不出來（codex #5 只改字樣） | 黃 |

### /review 後的修改（2026-11-12）

/review（5 個專家子代理、對抗審查、`codex review`）沒有 CRITICAL；照 INFORMATIONAL 改了：遊戲開始時不送 `check_stale`、程式出錯改送 `check_failed`（state-machines、maintainability、對抗審查）；R2 公開網址改查一個確認存在的檔案（對抗審查）；重新載入失敗時照樣檢查房間那份（對抗審查）；每批 RPC 40 秒逾時、40 秒後不再送新批次（performance、對抗審查）；另一台主持人裝置換題庫時清掉結果（codex、對抗審查）；補了重新載入失敗、RPC 丟錯／逾時、遊戲開始的房間測試（testing）。沒做：每個房間的冷卻時間、oEmbed 結果快取（security，影響只限 owner 題庫裡的影片數；一個房間同時一個檢查已經限住）、BankStoreDO 的 R2 fallback 單元測試（平台接線）。Implementation plan 已同步；上面 accepted 區塊裡「遊戲開始送 check_stale」由這段取代。
