# Critical Answer（致命答題）

D&D 風格的地城問答派對遊戲。名字是 *Critical Hit*（爆擊）的諧音梗。

主持人開一個網頁當共享大螢幕，玩家用手機加入並分隊。各隊輪流答題、闖過一間間怪物房，累積進度分到門檻後挑戰地城首領，最後比獎勵分決勝負。

> 目前處於**第二輪**：像素地城的畫面、題庫、旁白（腳本與 AI）、大螢幕語音旁白都已經做完，等第二次真人測試驗證「有氣氛之後是不是比較好玩」。音效、背景音樂與大螢幕活地圖也已上線。

## 玩法

1. 主持人在首頁按「主持遊戲」，進到主持人頁（`/room/<代碼>/host`）。從主持人頁 `⚙ 更多` 拿到大螢幕網址，在電視或投影機開（`/room/<代碼>/screen`）。
2. 每隊用手機輸入隊伍名稱和 4 碼房間代碼加入，或掃大廳的 QR。等待時，手機上看得到所有已加入的隊伍。主持人按「開始遊戲」。
3. **全域回合制**：所有隊伍依固定順序（A → B → C → …）輪流答題。輪到某隊時，大螢幕顯示題目、難度和牠面對的怪物；題目依難度 1–5 分成五個題庫，每個房間從自己難度的題庫抽題，所有隊伍共用牌堆，同一時間不會有兩隊拿到同一題。選擇題的選項順序每場開局都會重新打亂。
4. 主持人唸題（題目在大螢幕上，答案只在主持人手機上），隊伍口頭作答，由主持人按鈕判定（用筆電主持時也可以按鍵盤 `1` 答對、`2` 答錯重答、`3` 答錯逃跑，答案公布後按 `1` 或 Enter 進下一題）：
   - **答對**：打倒這間房的怪物，拿到牠的**獎勵分**（預設第 1～8 房 10／20／20／30／40／40／50／50），進到下一間房。
   - **答錯・重答**：留在同一間房，同一題再答一次。
   - **答錯・逃跑**：留在同一間房、面對同一隻怪物，但從低一級的題庫換一題新的，難度 −1（獎勵分照這隻怪物算，不扣分）。

   **選擇題**不用主持人判定：輪到的隊伍在手機上點選一個選項，再按「鎖定答案」。大螢幕先停 2 秒，再揭曉對錯。答錯時大螢幕只把選錯的那一格標紅，正確答案不公布，隊伍在手機上選「重答」（選錯的選項會變灰、不能再選）或「逃跑」。答對後約 8–15 秒（看旁白長短）自動進下一題，主持人按「下一題」可以立刻跳過。隊伍 15 秒沒鎖定（或答錯後 15 秒沒選重答／逃跑）時，主持人頁會出現「替{隊名}選・重答／逃跑」，鍵盤 `2`、`3` 對應這兩顆；選擇題按 `1` 沒有作用。首領房例外：答錯不用選重答或逃跑，紅格停 2 秒後首領自動換一題、輪到下一隊（手機顯示「首領要換題了 ▶」），所以下一隊不會拿到已經刪掉選項的題目；主持人頁的卡住列只剩「重答」，鍵盤 `3` 沒有作用。設計見 [docs/designs/phone-answering.md](docs/designs/phone-answering.md)（首領房規則見「首領房規則（v0.15）」）。
5. 每次答對另外累積**進度分**（等於當下題目的難度 1–5，逃跑會讓難度 −1）。進度分達 **15** 的隊伍進入首領房；過了最後一房還不到 15 分的隊伍留在最後一房繼續打。只要有一隊已經在首領房，其他隊伍下一次答對就直接進首領房。進度分只有主持人看得到（主持人頁每隊顯示「進度/15」），手機和大螢幕只顯示獎勵分。主持人也可以從「⚙ 更多」把卡住的隊伍直接送進王房。首領血量共用，各隊輪流攻擊。
6. 打中首領一下得 **10** 獎勵分；**尾刀**（把血量打到 0 的那一下）再加 4 顆 D20（4–80 分）。
7. 獎勵分總和最高的隊伍獲勝，同分並列第一。打倒首領只是結束遊戲，不一定是冠軍；結束畫面會另外寫出誰打出最後一擊。設計見 [docs/designs/scoring-and-score-pools.md](docs/designs/scoring-and-score-pools.md)。

**分支選擇（背景，不擋回合）**：隊伍過關進到新房間後，手機上會多出一組固定的兩個按鈕（例如「武力」／「討價」），可以隨時選、選了就定案，不影響輪到誰答題、不影響分數，也不會擋住遊戲繼續進行。

**大廳**：等人時大螢幕中間是營火，每隊加入時角色會跑進來圍著營火；房間代碼與加入 QR 也在這裡。

**活地圖**：遊戲進行時，大螢幕上方是一條地城地圖（取代原本的隊伍卡）。每隊是一個標著隊名首字的小棋子，答對就走進下一間房；最前面那隊之後是迷霧，看不出還剩幾間。首領房一開始是關著的門，第一隊進去後門才打開，顯示首領和血條。輪到的隊伍棋子上方有 ▼，離線的隊伍顯示「zz」。地圖不顯示分數。設計見 [docs/designs/live-map.md](docs/designs/live-map.md)。

**地城主（旁白）**：每次判分後，貓頭鷹魔法師會先說結果，再點名下一隊；隊伍進首領房時也會特別宣告。輪不到的隊伍在手機上看到輪到誰、面對哪隻怪物、自己的獎勵分和同一句旁白。遊戲結束時大螢幕立刻出現頒獎台，接著是一段後記。旁白預設是腳本句，有 API 金鑰時可以改用 Claude 即時寫（見下方）。大螢幕右下角有一個語音開關（用瀏覽器內建的 Web Speech API 把旁白念出來），預設關閉，開關狀態記在該裝置上；沒有語音 API 的瀏覽器不會顯示這顆按鈕。旁邊還有「🎵 音樂」開關，打開後大螢幕會播程式合成的背景音樂，判分時也會有音效（旁白念出來時音樂會自動壓低）；同樣預設關閉、記在該裝置上。

**斷線提示**：手機或大螢幕斷線時會顯示「連線中斷，重新連線中…」；手機重新連上後，會告訴這隊離線期間是否被跳過、或期間判了幾題。

## 技術棧

- [Next.js](https://nextjs.org/) 16 + React 19 + Tailwind CSS 4 + TypeScript
- [Cloudflare Workers](https://workers.cloudflare.com/) + Durable Objects（[`partyserver`](https://github.com/cloudflare/partykit/tree/main/packages/partyserver)）：房間與 WebSocket 連線層，一個房間代碼一個 Durable Object（[worker/index.ts](worker/index.ts)）。遊戲邏輯在 [lib/room/dungeon-room.ts](lib/room/dungeon-room.ts)，不依賴任何平台
- 像素畫面全部用程式繪製，字型（俐方體11號、Press Start 2P，皆 SIL OFL）放在 `public/fonts/`，沒有網路也能玩。設計規則見 [DESIGN.md](DESIGN.md)
- Anthropic Messages API（選用）：AI 旁白，只在伺服器端呼叫
- Vitest：單元測試；Playwright：端對端測試

## 快速開始

需要 Node.js 22（`.nvmrc`；CI 與 Cloudflare 建置也用 22）。

```bash
npm install
npm run dev
```

`npm run dev` 會同時啟動 Next.js（`http://localhost:3000`）和房間伺服器（`wrangler dev`，`localhost:8787`，和 Cloudflare 上跑的是同一份程式）。本機只綁 localhost，手機要加入請用下面的區網試玩。

### 讓手機加入（區網試玩）

手機連不到你電腦的 `localhost`，所以要用區網 IP。一個指令搞定，手機和電腦要在同一個 Wi-Fi：

```bash
sh scripts/playtest.sh start    # 建置正式版、啟動，最後印出網址
sh scripts/playtest.sh status
sh scripts/playtest.sh stop
```

它自動抓區網 IP，用 3100（網頁）和 1998（房間伺服器）兩個埠，停止時也只依這兩個埠關閉，不會動到其他專案。手機打不開時，看看 macOS 防火牆有沒有擋 node 的連入連線。（同樣的指令也有 `npm run playtest` / `npm run playtest:stop`。）

### AI 旁白（選用）

沒有金鑰也能玩，旁白會用腳本句。要讓 Claude 即時寫旁白：

1. 在**專案根目錄**建立 `.env`（`wrangler dev` 讀這個檔，不是 `.env.local`）：

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

2. 重啟 `npm run dev:worker`（或 `sh scripts/playtest.sh start`）。主持人開房間後，大廳會出現「AI 旁白」開關（沒有金鑰時是灰的）。

金鑰只在伺服器（Worker）讀取，不要加 `NEXT_PUBLIC_` 前綴，否則會進到瀏覽器。旁白用 `claude-haiku-4-5`，遊戲結束的後記用 `claude-sonnet-5-5`。每句旁白最多等 3 秒（後記 15 秒），逾時、出錯或內容不合格就改用腳本句；連續失敗 3 次或金鑰被拒絕（401/403）就整個房間改用腳本。玩家輸入的隊伍名稱只會以資料的形式進提示詞，題目和答案完全不會進提示詞。

> **費用**：開房間不用登入，AI 旁白在有金鑰時預設開啟，程式沒有限制旁白的呼叫次數。正式環境請在 Anthropic 後台替這把金鑰設花費上限；程式內的上限是待辦事項（見 [TODOS.md](TODOS.md)）。

主持人頁 `⚙ 更多` 裡有導演筆記（例如「用武俠口吻」）、改寫目前旁白，和旁白紀錄下載（每句的事件、當時分數、來源、延遲和備援原因；伺服器重啟後會消失）。

> 專案根目錄有 `.env` 時，**測試伺服器預設會開 AI**。Playwright 端對端測試已經固定關掉它，不會呼叫真的 API。

### 常用指令

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 同時啟動前端與房間伺服器（`wrangler dev`） |
| `npm run dev:next` / `npm run dev:worker` | 分別啟動 |
| `npm run playtest` / `npm run playtest:stop` | 建置正式版並在區網啟動／停止（見上） |
| `npm test` | 執行單元測試（不含會呼叫 Claude 的測試） |
| `ANTHROPIC_API_KEY=... npm run test:live` | 用真的金鑰跑 LLM 旁白冒煙測試（會花幾分錢） |
| `npm run e2e` | Playwright 端對端測試（自己開伺服器，用 3101 和 1996 埠） |
| `npm run check:bundle` | 建置後檢查題目與答案沒有進到瀏覽器 bundle |
| `npm run test:watch` | 監看模式測試 |
| `npm run lint` | ESLint |
| `npm run build` | 建置前端 |

### 部署

合併進 `main` 就會自動部署，兩邊都是平台自己的 Git 連動，GitHub 上不放任何部署用的 secret：Cloudflare Workers Builds 從 `main` 執行 `wrangler deploy`（房間伺服器），Vercel 從 `main` 部署前端。Workers Builds 在 Cloudflare dashboard 設定（Workers & Pages → `critical-answer` → Settings → Build → 連 GitHub repo，production branch 選 `main`）。它不等 GitHub Actions 的檢查跑完，也不保證比 Vercel 先完成；如果這次改動要求 Worker 先上線（例如前端會讀新的協定欄位），合併前先在本機 `wrangler deploy`。`OWNER_KEY`、`ANTHROPIC_API_KEY` 存在 Worker 上，部署不會動到。

## 題庫

題庫在 [data/question-bank.json](data/question-bank.json)：8 個房間各一隻怪物（難度 1／2／2／3／4／4／5／5），題目放在難度 1–5 五個題庫（難度 2 有 16 題，其他各 12 題），加上首領的 20 題，共 84 題，全部是四選一選擇題（玩家在手機上作答、遊戲自動判定）。題庫編輯器存過題庫的環境會繼續用存檔的那份，這個檔只在還沒存過題庫時使用（見下方「題庫編輯」）。伺服器啟動時會載入並驗證（缺 id、重複 id、空題目或答案、難度不在 1–5 都會直接報錯），**只有伺服器會讀這個檔**，瀏覽器只收得到題目文字，收不到答案。`npm run check:bundle` 會檢查這一點。

新增題目時：難度 1–5 每個題庫至少 12 題（最多 8 隊同時各拿著一題，多留 4 題讓逃跑換題時一定有沒人拿著的題）；首領題庫建議至少「首領血量 + 10」題（每次打中和每次答錯都會用掉一題，用完後會重出已經公布過答案的題）；題目文字不能含自己或題庫裡任何一題的答案（大螢幕是共用的）；任兩題的題目和答案都不能重複（`lib/question-bank.test.ts` 會檢查）。

> 預設的 84 題是 AI 起草的，其中 52 題使用者 2026-10-25 看過，v0.14.0.0 新增的 20 題還沒看過，v0.15.0.0 新增的 12 題首領題也沒有使用者看過的紀錄；裡面有 2026 年的時事題，**開局前請主持人覆核答案**。

### 題庫編輯

`/bank-editor` 是主持人專用的題庫編輯頁，首頁下方有連結，也可以直接打網址進入；不在遊戲的實際玩法流程裡。上方分頁切換「房間」、「難度 1–5」題庫和「首領」。「房間」頁設定每間房的難度（決定從哪個題庫抽題）和獎勵分，以及首領每打中一下的獎勵分；題庫頁可以新增、修改、刪除**問答題和選擇題**，頁首會寫哪幾間房從這個題庫抽題；「首領」頁的題目少於首領血量 + 10 題時，頁首會建議補到這個數。存過的題庫保留自己的首領題，不會自動拿到預設題庫新增的首領題。舊格式（題目放在各房間底下）的題庫載入時會自動轉成依難度分的題庫。每題的題目可以是文字、上傳的圖片或 YouTube 影片，另外可以加一段同樣可選媒材的詳解，答對後跟答案一起顯示。選擇題最多 4 個選項（大螢幕只有 4 格），由玩家在 `/play` 上點選並鎖定，伺服器依正確選項自動判定，不經 host 按鈕（見上方「玩法」、[docs/designs/multiple-choice-questions.md](docs/designs/multiple-choice-questions.md) 與 [docs/designs/phone-answering.md](docs/designs/phone-answering.md)）。舊題庫裡超過 4 個選項的題目仍可載入、照常遊玩，但要先刪到 4 個才能存檔。圖片會上傳到 Cloudflare R2，`/play` 和 `/screen` 都會顯示；換圖、刪題，或上傳後沒存檔的圖片，都會在等過一段寬限期（確保還在進行的局不會突然少圖）之後自動清掉。題庫實際存在 Cloudflare Durable Object（`BankStore`），編輯即時生效；`BankStore` 連不上時自動退回 bundle 裡的 `data/question-bank.json` 唯讀。存檔會做版本檢查，別人同時改過會擋下（409），避免互相覆蓋。存著的題庫這一版讀不懂時（例如回滾到比題庫格式舊的版本），編輯器載入的是 bundle 裡的預設題庫，存檔會被拒絕（400），圖片也暫停清理，存著的題庫保持原樣，等部署回讀得懂的版本再編輯。

> 圖片上傳需要先在 Cloudflare 建立一個名為 `critical-answer-images` 的 R2 bucket，並手動在 dashboard 開啟它的 r2.dev 公開讀取，再把 [wrangler.jsonc](wrangler.jsonc) 裡的 `R2_PUBLIC_BASE_URL` 換成 Cloudflare 給的網址——這一步不是 `wrangler deploy` 的一部分，見 [docs/designs/image-question-type.md](docs/designs/image-question-type.md)。

頁面要輸入 `OWNER_KEY` 才能讀寫題庫，伺服器端沒設這把密鑰時一律回 403（本機開發要在 `.dev.vars` 加一行 `OWNER_KEY=...` 才能測，`.dev.vars.example` 沒有內建）；正式部署要用 `wrangler secret put OWNER_KEY` 設一組 ≥32 bytes 的隨機值，太短會在 Worker log 留警告。

## 專案結構

```
app/                     Next.js 頁面：首頁、/room/[code]/host、/play、/screen、/bank-editor（題庫編輯）
components/              共用像素元件（pixel.tsx）、大螢幕舞台（stage.tsx）、大螢幕活地圖（map-strip.tsx）、選擇題選項格（mc-option.tsx）、QR（qr.tsx）
data/question-bank.json  題庫的 bundle 備援（BankStore 連不上時用這份唯讀）
lib/game-state.ts        遊戲狀態機：房間、題目牌堆、首領、計分（純函式，有完整測試）
lib/protocol.ts          host / player / server 之間的訊息格式與驗證
lib/question-bank.ts     題庫型別、驗證、公開題目（不含答案）
lib/bank-store.ts        BankStore：題庫的 Durable Object 儲存層，版本檢查（純函式邏輯）
lib/bank-api.ts          /api/bank 的 HTTP 處理（OWNER_KEY 驗證、CORS、409 衝突），平台無關
lib/narration/           旁白：事件、腳本句、LLM、斷路器、執行器、瀏覽器 TTS 播放決策（tts.ts）
lib/pixel-art.ts         程式繪製的像素角色與場景
lib/turn-info.ts         從公開狀態算出輪到誰、面對哪隻怪
lib/map-layout.ts        活地圖的版面計算：房間、棋子、迷霧、首領房的位置（純函式）
lib/use-room-socket.ts   三個房間頁面共用的連線 hook（訊息解析、伺服器重啟偵測、休息時停止重連）
lib/stored.ts            不會丟錯的 localStorage 讀寫（無痕模式也不會壞）
lib/bank-image-api.ts    /api/bank/image 圖片上傳（檔案類型、大小檢查）
worker/index.ts          Cloudflare Worker：Room 與 BankStoreDO 兩個 Durable Object、/api/bank 路由、入口規則
lib/room/                房間邏輯（dungeon-room.ts）與它需要的兩個小介面（io.ts），不依賴平台
lib/gate.ts、origin.ts   Worker 入口規則
e2e/                     Playwright 端對端測試
scripts/                 playtest.sh（區網試玩）、check-bundle.sh、pregate-runner.sh（gstack pregate 的本機測試執行器，見 .gstack/pregate.json）
public/fonts/            內建字型
DESIGN.md                像素設計系統
docs/designs/            設計文件與決策紀錄（含 question-bank-editor.md）
TODOS.md                 已知問題與延後事項
```

## 已知限制

- **沒人用的房間會休息、再被忘記**：房間 2 小時沒有任何會改變狀態的動作（加入、開始、判定、備註等；下載旁白紀錄不算），就用關閉碼 4001 關掉所有連線，遊戲進度保留；三個畫面顯示「房間休息中」並**不再自動重連**，點「重新連線」就接回原局。這是為了避免電視忘了關、整晚被計費（Cloudflare 免費方案每天 13,000 GB-s，一個房間開滿 24 小時約用掉 83%）。連 24 小時都沒有動作，房間會被整個清除、代碼釋放，還連著的畫面會收到關閉碼 4002 並顯示「房間已過期」，重新連線會進到全新的空大廳。自動重連不算動作，所以電視沒關也不會讓房間永遠不休息。時間可用環境變數 `ROOM_IDLE_MS`、`ROOM_EXPIRE_MS`（毫秒）調整。首頁「主持遊戲」建立的房間若剛好撞到別人還在的代碼，主持人頁會自動換一組新代碼；直接打開既有房間的連結則永遠不會換。
- **房間會存檔**：每次對外說話之前，房間先把自己存進 Durable Object 儲存空間（遊戲狀態、牌堆、主持人與隊伍金鑰、題庫、後記）。伺服器被殺掉、重新部署或回收之後會自動還原：分數、輪到誰、主持人身分都在，重啟後所有隊伍先視為離線，手機重新加入才恢復（沒有隊伍在線時沒有人輪到）。存檔格式不認得時（版本不符）會丟棄並顯示「遊戲已重置」。不存的：連線清單、旁白紀錄（只是主持人的下載檔）。本機的 `wrangler dev` 也一樣，存在 `.wrangler/`。
- **主持人身分靠金鑰**：建立房間時瀏覽器產生一把金鑰，放在網址的 `#k=`，第一個用它認領的裝置成為主持人，之後同一把金鑰可以從別的裝置接手。保護只有這把金鑰加 4 個字母的房間代碼，**不要把主持人網址給玩家**。
- **隊伍身分**：隊伍 ID 是公開的（每次狀態廣播都帶著），所以每隊另外有一把只存在自己瀏覽器裡的密鑰，重連時要出示。別人拿到隊伍 ID 也冒用不了。但**房間沒有密碼**：任何知道 4 碼代碼的人都能加入（最多 8 隊、每個房間最多 60 條連線）。
- **線上版**：前端在 <https://critical-answer.vercel.app>，房間伺服器在 Cloudflare（`https://critical-answer.aiko-studio.workers.dev`），合併進 `main` 就自動部署（見上方「部署」）。房間狀態已持久化，重新部署不會清掉進行中的遊戲，只會讓連線短暫重連。
- 怪物美術：前兩房是史萊姆、幽靈，第 3–5 房各有自己的怪物（迷路史萊姆、愛哭幽靈、守門史萊姆王），第 6–8 房沿用前面的圖、換個顏色（暴躁幽靈、熔岩史萊姆王、冰霜愛哭鬼），首領是小黑龍。
- 最多 8 隊；隊伍多、房間多時，大螢幕的活地圖會把較早的房間收進最左邊的入口格，讓地圖塞得進畫面，還沒有真人實測過。
- 一次只支援單一場次的簡單使用情境，沒有多場並行的設計。

## 路線圖

已完成：大螢幕（題目、怪物、頒獎台）、題庫進 app、腳本與 AI 旁白、主持人導演介面、主持人題庫編輯介面（`/bank-editor`，見上方「題庫編輯」）、大螢幕語音旁白（瀏覽器 TTS）、音效與背景音樂、營火大廳、斷線提示、主持人鍵盤操作、共享大螢幕活地圖、正式部署（Vercel + Cloudflare）。接下來的重點是**第二次真人測試**：驗證有氣氛之後是不是比第一輪好玩。

延後事項與原因見 [TODOS.md](TODOS.md)。完整設計、決策過程與任務清單見 [docs/designs/critical-answer-iteration-2.md](docs/designs/critical-answer-iteration-2.md)（第二輪）和 [docs/designs/critical-answer-party-game.md](docs/designs/critical-answer-party-game.md)（第一輪）。
