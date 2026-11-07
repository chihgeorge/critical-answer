# 開發指南

技術棧、指令、測試、版本，以及每個檔案在做什麼。

## 技術棧

- [Next.js](https://nextjs.org/) 16 + React 19 + Tailwind CSS 4 + TypeScript
- [Cloudflare Workers](https://workers.cloudflare.com/) + Durable Objects（[`partyserver`](https://github.com/cloudflare/partykit/tree/main/packages/partyserver)）：房間與 WebSocket 連線層，一個房間代碼一個 Durable Object（[worker/index.ts](../worker/index.ts)）。遊戲邏輯在 [lib/room/dungeon-room.ts](../lib/room/dungeon-room.ts)，不依賴任何平台
- 像素畫面全部用程式繪製，字型（俐方體11號、Press Start 2P，皆 SIL OFL）放在 `public/fonts/`，沒有網路也能玩。設計規則見 [DESIGN.md](../DESIGN.md)
- Anthropic Messages API（選用）：AI 旁白，只在伺服器端呼叫
- Vitest：單元測試；Playwright：端對端測試

## 本機執行

需要 Node.js 22.18 以上（`.nvmrc`；CI 與 Cloudflare 建置也用 22）。`node scripts/*.ts` 靠 Node 內建的型別剝除，22.18 起才預設開啟。

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

它自動抓區網 IP，用 3100（網頁）和 1998（房間伺服器）兩個埠，停止時會關掉占用這兩個埠的所有程式（不檢查是不是這個專案的），所以別的程式不要用這兩個埠。手機打不開時，看看 macOS 防火牆有沒有擋 node 的連入連線。（同樣的指令也有 `npm run playtest` / `npm run playtest:stop`。）

## 常用指令

| 指令 | 說明 |
| --- | --- |
| `npm run dev` | 同時啟動前端與房間伺服器（`wrangler dev`） |
| `npm run dev:next` / `npm run dev:worker` | 分別啟動 |
| `npm run playtest` / `npm run playtest:stop` | 建置正式版並在區網啟動／停止（見上面的[讓手機加入](#讓手機加入區網試玩)） |
| `npm test` | 執行單元測試（不含會呼叫 Claude 的測試） |
| `ANTHROPIC_API_KEY=... npm run test:live` | 用真的金鑰跑 LLM 旁白冒煙測試（會花幾分錢） |
| `npm run e2e` | Playwright 端對端測試（自己開伺服器，用 3101 和 1996 埠；平常交給 GitHub CI 跑，本機太吃資源。CI 把測試分成兩組平行跑） |
| `npm run check:bundle` | 建置後檢查題目與答案沒有進到瀏覽器 bundle |
| `npm run check:docs` | 檢查 README、SECURITY.md 和 `docs/` 指南的相對連結與錨點 |
| `npm run test:watch` | 監看模式測試 |
| `npm run lint` | ESLint |
| `npm run build` | 建置前端 |

## 測試

端對端測試（`npm run e2e`）只在 GitHub CI 跑：每個 PR 和每次 push 到 `main`，分兩組平行。本機太吃資源，不要在本機跑。`npm run check:bundle` 必跑，它會擋下答案漏進瀏覽器 bundle。`npm run check:docs` 檢查 README、SECURITY.md 和 `docs/` 第一層每份 `.md`（不含 `docs/designs/`）裡的相對連結和 `#` 錨點都還連得到。

> 專案根目錄有 `.env` 時，**測試伺服器預設會開 AI**。Playwright 端對端測試已經固定關掉它，不會呼叫真的 API。

## 存檔與回滾

**房間會存檔**：每次對外說話之前，房間先把自己存進 Durable Object 儲存空間（遊戲狀態、牌堆、主持人與隊伍金鑰、題庫、後記、主持人排好的下一句旁白；題庫另外存成一筆，只在題庫變動時才寫）。伺服器被殺掉、重新部署或回收之後會自動還原：分數、輪到誰、主持人身分都在，重啟後所有隊伍先視為離線，手機重新加入才恢復（沒有隊伍在線時沒有人輪到）。存檔格式不認得時（版本不符，或是首領階段上線前的舊存檔）會丟棄並顯示「遊戲已重置」。Worker 不要回滾到 v0.31.3.0 以前：舊版讀不懂新的存檔，進行中的房間都會重置。不存的：連線清單、換手機的配對碼、旁白紀錄（只是主持人的下載檔）。本機的 `wrangler dev` 也一樣，存在 `.wrangler/`。

## 版本與 Release

版本號有四段（例如 `0.16.1.0`），由 `/ship` 依改動決定，寫進 `VERSION` 和 `CHANGELOG.md`。合併進 `main` 的版本如果是 `X.Y.0.0`（第二段以上變了，也就是有新功能），[.github/workflows/release.yml](../.github/workflows/release.yml) 會自動打 tag `vX.Y.0.0`，並發一個 GitHub Release，內容是從上一個 release 到這一版的所有 CHANGELOG 段落（[scripts/release-notes.ts](../scripts/release-notes.ts) 整理）。後兩段的小修和熱修不自動發，會收進下一個 release；要單獨發的話，到 Actions → Release → Run workflow，就會把 `main` 現在的版本發出去。repo 裡還沒有任何 `v` tag 時 workflow 會直接失敗（不然說明會是整份 CHANGELOG），要先補發歷史版本。

## 專案結構

```
app/                     Next.js 頁面：首頁、/room/[code]/host、/play、/screen、/bank-editor（題庫編輯），以及出錯時的畫面（error.tsx、global-error.tsx）
components/              共用像素元件（pixel.tsx）、出錯畫面（error-screen.tsx）、大螢幕舞台（stage.tsx）、大螢幕活地圖（map-strip.tsx）、選擇題選項格（mc-option.tsx）、d20 與大螢幕擲骰畫面（戰士擲骰、選擇題的暴擊骰和填空題的說服檢定，d20.tsx）、填空題的第一個字提示（法師和說服檢定，mage-hint.tsx）、QR（qr.tsx），以及主持人頁拆出來的 AI 旁白設定（host-ai.tsx）、「⚙ 更多」抽屜（more-drawer.tsx）、「指定下一題」選題清單（question-picker.tsx）
data/question-bank.json  題庫的 bundle 備援（BankStore 連不上時新開的房間用這份；存著的題庫讀不懂時編輯器唯讀顯示這份）
lib/game-state.ts        遊戲狀態機：房間、題目牌堆、首領、計分（純函式，有完整測試）
lib/protocol.ts          host / player / server 之間的訊息格式與驗證
lib/question-bank.ts     題庫型別、驗證、公開題目（不含答案）
lib/bank-store.ts        BankStore：題庫的 Durable Object 儲存層，版本檢查（純函式邏輯）
lib/bank-api.ts          /api/bank 的 HTTP 處理（OWNER_KEY 驗證、CORS、409 衝突），平台無關
lib/narration/           旁白：事件、腳本句、LLM、斷路器、執行器、瀏覽器 TTS 播放決策（tts.ts）
lib/pixel-art.ts         程式繪製的像素角色與場景
lib/turn-info.ts         從公開狀態算出輪到誰、面對哪隻怪
lib/map-layout.ts        活地圖的版面計算：房間、棋子、迷霧、首領房的位置（純函式）
lib/use-room-socket.ts   三個房間頁面共用的連線 hook（訊息解析、伺服器重啟偵測、休息時停止重連、首次連線逾時）
lib/join-rejection.ts    加入被拒絕時手機顯示的原因句（純函式）
lib/stored.ts            不會丟錯的 localStorage 讀寫（無痕模式也不會壞）
lib/use-wake-lock.ts     主持人頁和大螢幕的螢幕不休眠 hook
lib/report-client-error.ts、client-error-api.ts  前端當掉的回報（sendBeacon）與 /api/client-error 的處理（來源檢查、4 KB 上限、寫一行 log）
lib/bank-image-api.ts    /api/bank/image 圖片上傳（檔案類型、大小檢查；題庫讀不懂時回 409、連不上時回 503）
worker/index.ts          Cloudflare Worker：Room 與 BankStoreDO 兩個 Durable Object、/api/bank 與 /api/client-error 路由、入口規則
lib/room/                房間邏輯（dungeon-room.ts）與它需要的兩個小介面（io.ts），不依賴平台
lib/gate.ts、origin.ts   Worker 入口規則
e2e/                     Playwright 端對端測試
scripts/                 playtest.sh（區網試玩）、check-bundle.sh、pregate-runner.sh（gstack pregate 的本機測試執行器，只跑單元測試；見 .gstack/pregate.json）、check-docs.ts（檢查 README 和 docs/ 指南的連結與錨點）
public/fonts/            內建字型
DESIGN.md                像素設計系統
docs/designs/            設計文件與決策紀錄（含 question-bank-editor.md）
docs/going-public.md     公開 repo 前的檢查清單
TODOS.md                 已知問題與延後事項
```
