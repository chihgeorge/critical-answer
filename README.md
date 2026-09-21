# Critical Answer（致命答題）

D&D 風格的地城問答派對遊戲。名字是 *Critical Hit*（爆擊）的諧音梗。

主持人開一個網頁當共享大螢幕，玩家用手機加入並分隊。各隊輪流答題、闖過一間間怪物房，累積分數到門檻後挑戰地城首領，最後比總分決勝負。

> 目前處於**第二輪**：像素地城的畫面、題庫、旁白（腳本與 AI）都已經做完，等第二次真人測試驗證「有氣氛之後是不是比較好玩」。活地圖、語音、音效還沒做，見 [TODOS.md](TODOS.md)。

## 玩法

1. 主持人在首頁按「主持遊戲」，進到主持人頁（`/room/<代碼>/host`）。從主持人頁 `⚙ 更多` 拿到大螢幕網址，在電視或投影機開（`/room/<代碼>/screen`）。
2. 每隊用手機輸入隊伍名稱和 4 碼房間代碼加入，或掃大廳的 QR。等待時，手機上看得到所有已加入的隊伍。主持人按「開始遊戲」。
3. **全域回合制**：所有隊伍依固定順序（A → B → C → …）輪流答題。輪到某隊時，大螢幕顯示題目、難度和牠面對的怪物；每個房間有自己的一副題目牌堆，同一房間的隊伍不會拿到同一題。
4. 主持人唸題（題目在大螢幕上，答案只在主持人手機上），隊伍口頭作答，由主持人按鈕判定：
   - **答對**：過關，拿到該房間的分數（難度 1–5，與分數正相關），進到下一間房。
   - **答錯・重答**：留在同一間房，同一題再答一次。
   - **答錯・逃跑**：留在同一間房、面對同一隻怪物，但換一題新的，難度 −1。
5. 累積分數達 **15 分**的隊伍進入首領房。首領血量共用，各隊輪流攻擊。
6. **尾刀**：把首領血量打到 0 的那一次答對，該隊額外獲得 3 顆 D6 的隨機加分。其他隊伍沒有尾刀分，但一般怪物累積的分數仍有機會超車。
7. 總分 = 怪物累積分 + 尾刀分，最高分獲勝，同分並列第一。

**地城主（旁白）**：每次判分後，貓頭鷹魔法師會先說結果，再點名下一隊。輪不到的隊伍在手機上看到輪到誰、面對哪隻怪物、自己的分數（x/15）和同一句旁白。遊戲結束時大螢幕立刻出現頒獎台，接著是一段後記。旁白預設是腳本句，有 API 金鑰時可以改用 Claude 即時寫（見下方）。

## 技術棧

- [Next.js](https://nextjs.org/) 16 + React 19 + Tailwind CSS 4 + TypeScript
- [PartyKit](https://www.partykit.io/)：房間與 WebSocket 連線層（[party/index.ts](party/index.ts)）
- 像素畫面全部用程式繪製，字型（俐方體11號、Press Start 2P，皆 SIL OFL）放在 `public/fonts/`，沒有網路也能玩。設計規則見 [DESIGN.md](DESIGN.md)
- Anthropic Messages API（選用）：AI 旁白，只在伺服器端呼叫
- Vitest + happy-dom：單元測試；Playwright：端對端測試

## 快速開始

需要 Node.js 20 以上。

```bash
npm install
npm run dev
```

`npm run dev` 會同時啟動 Next.js（`http://localhost:3000`）和 PartyKit（預設 `localhost:1999`）。如果 1999 埠被別的專案占用，PartyKit 會跑到隨機埠，前端就連不上：改用 `npx partykit dev --port 1998`，並讓 `NEXT_PUBLIC_PARTYKIT_HOST` 指向同一個埠。

### 讓手機加入（區網）

手機連不到你電腦的 `localhost`，所以要指定電腦的區網 IP：

1. 建立 `.env.local`，內容是電腦的區網 IP 加上 PartyKit 的連接埠，例如：

   ```
   NEXT_PUBLIC_PARTYKIT_HOST=192.168.1.10:1999
   ```

2. 重啟 `npm run dev`。
3. 主持人和玩家都用 `http://<區網 IP>:3000` 開啟網頁，手機和電腦要在同一個 Wi-Fi。

### 一個指令的區網試玩

要拿去給朋友玩，不想手動設定的話：

```bash
sh scripts/playtest.sh start    # 建置正式版、啟動，最後印出網址
sh scripts/playtest.sh status
sh scripts/playtest.sh stop
```

它自動抓區網 IP，用 3100（網頁）和 1998（PartyKit）兩個埠，停止時也只依這兩個埠關閉，不會動到其他專案。手機打不開時，看看 macOS 防火牆有沒有擋 node 的連入連線。（同樣的指令也有 `npm run playtest` / `npm run playtest:stop`。）

### AI 旁白（選用）

沒有金鑰也能玩，旁白會用腳本句。要讓 Claude 即時寫旁白：

1. 在**專案根目錄**建立 `.env`（PartyKit 讀這個檔，不是 `.env.local`）：

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

2. 重啟 `npm run dev:party`（或 `sh scripts/playtest.sh start`）。主持人開房間後，大廳會出現「AI 旁白」開關（沒有金鑰時是灰的）。

金鑰只在伺服器（PartyKit）讀取，不要加 `NEXT_PUBLIC_` 前綴，否則會進到瀏覽器。旁白用 `claude-haiku-4-5`，遊戲結束的後記用 `claude-sonnet-5`。每句旁白最多等 3 秒（後記 15 秒），逾時、出錯或內容不合格就改用腳本句；連續失敗 3 次或金鑰被拒絕（401/403）就整個房間改用腳本。玩家輸入的隊伍名稱只會以資料的形式進提示詞，題目和答案完全不會進提示詞。

主持人頁 `⚙ 更多` 裡有導演筆記（例如「用武俠口吻」）、改寫目前旁白，和旁白紀錄下載（每句的事件、當時分數、來源、延遲和備援原因；伺服器重啟後會消失）。

> 專案根目錄有 `.env` 時，**測試伺服器預設會開 AI**。Playwright 端對端測試已經固定關掉它，不會呼叫真的 API。

### 常用指令

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 同時啟動前端與 PartyKit |
| `npm run dev:next` / `npm run dev:party` | 分別啟動 |
| `npm run playtest` / `npm run playtest:stop` | 建置正式版並在區網啟動／停止（見上） |
| `npm test` | 執行單元測試（不含會呼叫 Claude 的測試） |
| `ANTHROPIC_API_KEY=... npm run test:live` | 用真的金鑰跑 LLM 旁白冒煙測試（會花幾分錢） |
| `npm run e2e` | Playwright 端對端測試（自己開伺服器，用 3101 和 1996 埠） |
| `npm run check:bundle` | 建置後檢查題目與答案沒有進到瀏覽器 bundle |
| `npm run test:watch` | 監看模式測試 |
| `npm run lint` | ESLint |
| `npm run build` | 建置前端 |

## 題庫

題庫在 [data/question-bank.json](data/question-bank.json)：5 個房間，每房 8 題、一隻怪物，加上首領的 8 題。伺服器啟動時會載入並驗證（缺 id、重複 id、空題目或答案、難度不在 1–5 都會直接報錯），**只有伺服器會讀這個檔**，瀏覽器只收得到題目文字，收不到答案。`npm run check:bundle` 會檢查這一點。

新增題目時：每房至少 8 題（最多 8 隊）、題目文字不能含答案。說明見 [docs/question-bank-2026-taiwan.md](docs/question-bank-2026-taiwan.md)。

> 每房最後 5 題和首領最後 3 題是 AI 起草的台灣常識題，**開局前請主持人覆核答案**。

## 專案結構

```
app/                     Next.js 頁面：首頁、/room/[code]/host、/play、/screen
components/              共用像素元件（pixel.tsx）、大螢幕舞台（stage.tsx）、QR（qr.tsx）
data/question-bank.json  題庫（只在伺服器端載入）
lib/game-state.ts        遊戲狀態機：房間、題目牌堆、首領、計分（純函式，有完整測試）
lib/protocol.ts          host / player / server 之間的訊息格式與驗證
lib/question-bank.ts     題庫載入、驗證、公開題目（不含答案）
lib/narration/           旁白：事件、腳本句、LLM、斷路器、執行器
lib/pixel-art.ts         程式繪製的像素角色與場景
lib/turn-info.ts         從公開狀態算出輪到誰、面對哪隻怪
party/index.ts           PartyKit 房間處理，把狀態機接到 WebSocket
e2e/                     Playwright 端對端測試
scripts/                 playtest.sh（區網試玩）、check-bundle.sh
public/fonts/            內建字型
DESIGN.md                像素設計系統
docs/designs/            設計文件與決策紀錄
TODOS.md                 已知問題與延後事項
```

## 已知限制

- **狀態只存在記憶體**：伺服器重啟，整場遊戲和旁白紀錄就會消失，三個畫面都會顯示「伺服器重新啟動，遊戲已重置」。玩家手機斷線或重新整理後，會用同一組隊伍身分自動回到原本那隊，不會被跳過。
- **主持人身分靠金鑰**：建立房間時瀏覽器產生一把金鑰，放在網址的 `#k=`，第一個用它認領的裝置成為主持人，之後同一把金鑰可以從別的裝置接手。保護只有這把金鑰加 4 個字母的房間代碼，**不要把主持人網址給玩家**。
- **隊伍身分**：隊伍 ID 是公開的（每次狀態廣播都帶著），所以每隊另外有一把只存在自己瀏覽器裡的密鑰，重連時要出示。別人拿到隊伍 ID 也冒用不了。但**房間沒有密碼**：任何知道 4 碼代碼的人都能加入（最多 8 隊、每個房間最多 60 條連線）。
- **尚未正式部署**：PartyKit CLI 目前有兩個相容性 bug 擋住部署，所以只能在本機或區網玩。詳見 [TODOS.md](TODOS.md)。
- 怪物只有三張圖（史萊姆、幽靈、小黑龍），第 3–5 房是換色。
- 最多 8 隊；8 隊同時在線時，大螢幕上方的隊伍卡會變得很窄，還沒有實測過。
- 玩家手機與大螢幕沒有斷線提示，只有主持人頁有。
- 一次只支援單一場次的簡單使用情境，沒有多場並行的設計。

## 路線圖

已完成：大螢幕（題目、怪物、頒獎台）、題庫進 app、腳本與 AI 旁白、主持人導演介面。接下來的重點是**第二次真人測試**：驗證有氣氛之後是不是比第一輪好玩。之後再看：

- 主持人題庫編輯介面
- 共享大螢幕活地圖
- 語音旁白、音效
- 正式部署

延後事項與原因見 [TODOS.md](TODOS.md)。完整設計、決策過程與任務清單見 [docs/designs/critical-answer-iteration-2.md](docs/designs/critical-answer-iteration-2.md)（第二輪）和 [docs/designs/critical-answer-party-game.md](docs/designs/critical-answer-party-game.md)（第一輪）。
