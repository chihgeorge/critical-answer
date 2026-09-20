# Critical Answer（致命答題）

D&D 風格的地城問答派對遊戲。名字是 *Critical Hit*（爆擊）的諧音梗。

主持人開一個網頁當共享大螢幕，玩家用手機加入並分隊。各隊輪流答題、闖過一間間怪物房，累積分數到門檻後挑戰地城首領，最後比總分決勝負。

> 目前處於**第一輪：機制驗證**階段。計分、輪替和首領戰已經用真人測試過，敘事、畫面和大螢幕活地圖屬於第二輪，還沒做。

## 玩法

1. 主持人在首頁按「建立房間」，取得 4 碼房間代碼，這個頁面就是大螢幕。
2. 每隊用手機輸入隊伍名稱和房間代碼加入，主持人按「開始遊戲」。
3. **全域回合制**：所有隊伍依固定順序（A → B → C → …）輪流答題，輪到某隊時，系統依該隊所在的房間出題。
4. 主持人唸題，隊伍口頭作答，由主持人按鈕判定：
   - **答對**：過關，拿到該怪物的分數（難度 1–5，與分數正相關）。
   - **答錯・重答**：留在同一間房再答一次。
   - **答錯・逃跑**：放棄這隻怪物，換一隻**難度較低**的新怪物。
5. 累積分數達 **15 分**的隊伍進入首領房。首領血量共用，各隊輪流攻擊。
6. **尾刀**：把首領血量打到 0 的那一次答對，該隊額外獲得 3 顆 D6 的隨機加分。其他隊伍沒有尾刀分，但一般怪物累積的分數仍有機會超車。
7. 總分 = 怪物累積分 + 尾刀分，最高分獲勝，同分並列第一。

等待中的隊伍可以在手機上看到目前輪到誰、各隊的房間進度和首領血量，減少乾等的無聊感。

## 技術棧

- [Next.js](https://nextjs.org/) 16 + React 19 + Tailwind CSS 4 + TypeScript
- [PartyKit](https://www.partykit.io/)：房間與 WebSocket 連線層（[party/index.ts](party/index.ts)）
- Vitest + happy-dom：單元測試

## 快速開始

需要 Node.js 20 以上。

```bash
npm install
npm run dev
```

`npm run dev` 會同時啟動 Next.js（`http://localhost:3000`）和 PartyKit（預設 `localhost:1999`）。

### 讓手機加入（區網）

手機連不到你電腦的 `localhost`，所以要指定電腦的區網 IP：

1. 建立 `.env.local`，內容是電腦的區網 IP 加上 PartyKit 的連接埠，例如：

   ```
   NEXT_PUBLIC_PARTYKIT_HOST=192.168.1.10:1999
   ```

2. 重啟 `npm run dev`。
3. 主持人和玩家都用 `http://<區網 IP>:3000` 開啟網頁，手機和電腦要在同一個 Wi-Fi。

### AI 旁白（選用）

沒有金鑰也能玩，旁白會用腳本句。要讓 Claude 即時寫旁白：

1. 在**專案根目錄**建立 `.env`（PartyKit 讀這個檔，不是 `.env.local`）：

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

2. 重啟 `npm run dev:party`。主持人開房間後，大廳會出現「AI 旁白」開關（沒有金鑰時是灰的）。

金鑰只在伺服器（PartyKit）讀取，不要加 `NEXT_PUBLIC_` 前綴，否則會進到瀏覽器。旁白用 `claude-haiku-4-5`，遊戲結束的後記用 `claude-sonnet-5`。每句旁白最多等 2 秒（後記 15 秒），逾時、出錯或內容不合格就改用腳本句；連續失敗 3 次或金鑰被拒絕（401/403）就整個房間改用腳本。`⚙ 更多` 裡有導演筆記、改寫目前旁白，和旁白紀錄下載（記錄每句的來源、延遲和備援原因）。

### 常用指令

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 同時啟動前端與 PartyKit |
| `npm run dev:next` / `npm run dev:party` | 分別啟動 |
| `npm test` | 執行測試（不含會呼叫 Claude 的測試） |
| `ANTHROPIC_API_KEY=... npm run test:live` | 用真的金鑰跑 LLM 旁白冒煙測試（會花幾分錢） |
| `npm run e2e` | Playwright 端對端測試 |
| `npm run check:bundle` | 建置後檢查題目與答案沒有進到瀏覽器 bundle |
| `npm run test:watch` | 監看模式測試 |
| `npm run lint` | ESLint |
| `npm run build` | 建置前端 |

## 題庫

第一輪沒有題庫編輯介面，app 只記錄狀態，**不知道題目內容**。房間與首領的題目 ID 定義在 [lib/fixtures.ts](lib/fixtures.ts)，主持人照著 [docs/question-bank-2026-taiwan.md](docs/question-bank-2026-taiwan.md)（2026 年台灣時事題庫），輪到哪個 ID 就唸哪一題。要換題庫的話，照同樣的 ID 格式另寫一份即可。

## 專案結構

```
app/                 Next.js 頁面（首頁、host 頁、player 頁）
lib/game-state.ts    遊戲狀態機：房間、怪物、首領、計分（純函式，有完整測試）
lib/protocol.ts      host / player / server 之間的訊息格式
lib/fixtures.ts      預設地城與題目 ID
party/index.ts       PartyKit 房間處理，把狀態機接到 WebSocket
docs/designs/        設計文件與決策紀錄
TODOS.md             已知問題與延後事項
```

## 已知限制

- **狀態只存在記憶體**：伺服器重啟，整場遊戲就會消失。玩家手機斷線後，重新連上同一個房間代碼即可恢復畫面。
- **尚未正式部署**：PartyKit CLI 目前有兩個相容性 bug 擋住部署，所以只能在本機或區網玩。詳見 [TODOS.md](TODOS.md)。
- 一次只支援單一場次的簡單使用情境，沒有多場並行的設計。

## 路線圖

第二輪的重點是讓玩家能判斷「好不好玩」，因為真人測試回饋是沒有敘事沉浸感和畫面就很難評價：

- AI DM 旁白（由結構化遊戲狀態生成）
- 主持人題庫編輯介面
- 共享大螢幕活地圖
- 完整版真人測試

完整設計、決策過程與任務清單見 [docs/designs/critical-answer-party-game.md](docs/designs/critical-answer-party-game.md)。
