繁體中文 | [English](development.en.md)

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
| `npm run e2e` | Playwright 端對端測試（自己開伺服器，用 3101 和 1996 埠；平常交給 GitHub CI 跑，本機太吃資源。CI 把測試分成三組平行跑） |
| `npm run check:bundle` | 建置後檢查題目與答案沒有進到瀏覽器 bundle |
| `npm run check:docs` | 檢查 README、SECURITY.md 和 `docs/` 指南的相對連結與錨點，以及中英文版有沒有配對 |
| `npm run test:watch` | 監看模式測試 |
| `npm run lint` | ESLint |
| `npm run build` | 建置前端 |

## 測試

端對端測試（`npm run e2e`）只在 GitHub CI 跑：每個 PR 和每次 push 到 `main`，分三組平行。本機太吃資源，不要在本機跑。`npm run check:bundle` 必跑，它會擋下答案漏進瀏覽器 bundle。`npm run check:docs` 檢查 README、SECURITY.md 和 `docs/` 第一層每份 `.md`（不含 `docs/designs/`）裡的相對連結和 `#` 錨點都還連得到。

**雙語文件**：README、SECURITY.md 和 `docs/` 的指南（`going-public.md` 除外）都有英文版 `X.en.md`。改了一種語言，同一個 PR 就要改另一種。兩版第一行都是語言切換行，標題的數量和層級要一樣，英文版連到英文版。`npm run check:docs` 會擋下缺英文版、沒有中文版可配對的英文文件、切換行不對或標題層級不一致的文件，但不會檢查翻譯是不是最新的，也不會檢查英文版連的是不是英文版（`rules.en.md`，不是 `rules.md`）。

> 專案根目錄有 `.env` 時，**測試伺服器預設會開 AI**。Playwright 端對端測試已經固定關掉它，不會呼叫真的 API。

## 存檔與回滾

**房間會存檔**：每次對外說話之前，房間先把自己存進 Durable Object 儲存空間（遊戲狀態、牌堆、主持人與隊伍金鑰、題庫、後記與翻到第幾頁、名次揭曉的開始時間和台詞、主持人排好的下一句旁白、第一次開始遊戲的時間和主持人延長的時數；題庫另外存成一筆，只在題庫變動時才寫）。伺服器被殺掉、重新部署或回收之後會自動還原：分數、輪到誰、主持人身分都在，重啟後所有隊伍先視為離線，手機重新加入才恢復（沒有隊伍在線時沒有人輪到）。存檔格式不認得時（版本不符，或是首領階段上線前的舊存檔）會丟棄並顯示「遊戲已重置」。Worker 不要回滾到 v0.31.3.0 以前：舊版讀不懂新的存檔，進行中的房間都會重置。不存的：連線清單、換手機的配對碼、旁白紀錄（只是主持人的下載檔）。本機的 `wrangler dev` 也一樣，存在 `.wrangler/`。

## 版本與 Release

版本號有四段（例如 `0.16.1.0`），依序是 MAJOR.MINOR.PATCH.MICRO。PR 不改 `VERSION` 和 `CHANGELOG.md`，只在 [changelog.d/](../changelog.d/README.md) 加一個小檔，寫這次的改動，檔頭一定要用 `bump:` 寫這次升哪一段：`major` 是重大里程碑或不相容的改變（例如 1.0 正式版，或舊存檔、舊題庫再也讀不了）；`minor` 是新功能，玩家或主持人看得到的新東西；`patch` 是沒有新功能的修正或改進，改動 50 行以上；`micro` 是 50 行以下的小修、文案、文件或設定。所以兩個開著的 PR 不會在版本號上衝突，CI 全綠（必過檢查 `check`）就能由 GitHub 自動合併。合併進 `main` 後，[.github/workflows/stamp.yml](../.github/workflows/stamp.yml) 會自動跑 [scripts/stamp-release.ts](../scripts/stamp-release.ts)：把小檔照檔名順序整理成一段新的 CHANGELOG，依小檔裡最大的 `bump` 只升那一段、加 1，它右邊的段歸零（`0.58.3.2` 只會變成 `1.0.0.0`、`0.59.0.0`、`0.58.4.0` 或 `0.58.3.3`），改 `VERSION`、`package.json` 和 `package-lock.json` 的版本號，刪掉小檔，再把這個 commit 推回 `main`。這一步用一個專用的 GitHub App 推上 `main`，不用 GitHub Actions 本身的權限，這樣別的 workflow（包括 PR 自己加的）都推不上 `main`。只要設定一次：(1) 到 GitHub 的 Settings → Developer settings → GitHub Apps 建一個 App，權限只給 Repository contents 的 Read and write，不用 webhook；(2) 把它裝到這個 repo；(3) 在 repo 的 Settings → Environments 建一個叫 `stamp` 的 environment，Deployment branches 只允許 `main`，在裡面加變數 `STAMP_APP_ID`（App ID）和 secret `STAMP_APP_PRIVATE_KEY`（App 的私鑰）；(4) 在 Settings → Rules → `main` 的規則裡，只把這個 App 加進 bypass 名單。金鑰放在只有 `main` 能用的 environment，PR 的 workflow 讀不到。App 推上去的 commit 會照常跑 CI。規則在 [.gstack/ship-policy.json](../.gstack/ship-policy.json)。CI 會在每個 PR 檢查：`static` 跑 [scripts/check-fragment.ts](../scripts/check-fragment.ts)，跟 `origin/<base>` 的分岔點比，只要改了 `VERSION`、`CHANGELOG.md`、`package.json` 或 `package-lock.json` 的版本號，或沒有新增 `changelog.d/*.md`（`README.md` 不算）、小檔是空的、小檔裡有 `## [` 版本標題、檔頭沒有合法的 `bump:`，或刪掉、改了別的 PR 還沒發版的小檔，就會失敗；Dependabot 的 PR 不用加小檔。升到 `X.Y.0.0`（第二段以上變了，也就是有新功能）時，[.github/workflows/release.yml](../.github/workflows/release.yml) 會因為 `VERSION` 改了而自動打 tag `vX.Y.0.0`，並發一個 GitHub Release，內容是從上一個 release 到這一版的所有 CHANGELOG 段落（[scripts/release-notes.ts](../scripts/release-notes.ts) 整理）。後兩段的小修和熱修不自動發，會收進下一個 release；要單獨發的話，到 Actions → Release → Run workflow，就會把 `main` 現在的版本發出去。某次 `X.Y.0.0` 沒發成功時，要重跑那一次的 Release run（它記得那個 commit），不要用 Run workflow，因為 `main` 可能已經往前升版了。repo 裡還沒有任何 `v` tag 時 workflow 會直接失敗（不然說明會是整份 CHANGELOG），要先補發歷史版本。v0.57.0.0 以前，版本號只在有人手動開發版 PR（`gstack-release-stamp open`）時才會升，所以小檔一直累積；現在不再有發版 PR。

## 專案結構

```
app/                     Next.js 頁面：首頁、/room/[code]/host、/play、/screen、/bank-editor（題庫編輯），出錯時的畫面（error.tsx、global-error.tsx），以及加到主畫面用的 manifest（全站 manifest.ts、每個房間的 /room/[code]/manifest.webmanifest，內容在 lib/web-manifest.ts）
components/              共用像素元件（pixel.tsx）、出錯畫面（error-screen.tsx）、大螢幕舞台（stage.tsx）、大螢幕活地圖（map-strip.tsx）、選擇題選項格（mc-option.tsx）、d20 與大螢幕擲骰畫面（戰士擲骰、選擇題的暴擊骰、填空題的說服檢定和首領尾刀的 4d20，d20.tsx）、填空題的第一個字提示（法師和說服檢定，mage-hint.tsx）、QR（qr.tsx），以及主持人頁拆出來的 AI 旁白設定（host-ai.tsx）、判題鈕上方的「地城主旁白」面板（narration-panel.tsx）、「⚙ 更多」抽屜（more-drawer.tsx）、「指定下一題」選題清單（question-picker.tsx）、多欄位聽歌題的逐欄判定（field-judge.tsx）、等待中途加入的隊伍列（late-teams.tsx）
data/question-bank.json  題庫的 bundle 備援（BankStore 連不上時新開的房間用這份；存著的題庫讀不懂時編輯器唯讀顯示這份）
lib/game-state.ts        遊戲狀態機：房間、題目牌堆、首領、計分（純函式，有完整測試）
lib/protocol.ts          host / player / server 之間的訊息格式與驗證
lib/question-bank.ts     題庫型別、驗證、公開題目（不含答案）
lib/bank-store.ts        BankStore：題庫的 Durable Object 儲存層，版本檢查（純函式邏輯）
lib/bank-api.ts          /api/bank 與 /api/game-logs 的 HTTP 處理（OWNER_KEY 驗證、CORS、409 衝突），平台無關
lib/game-log.ts          對局紀錄：遊戲結束時從遊戲狀態整理出一筆紀錄，存進 BankStoreDO，下載只拿最新的 1000 場
lib/narration/           旁白：事件、腳本句、LLM、斷路器、執行器、觀眾反應計數（crowd.ts）、瀏覽器 TTS 播放決策（tts.ts）
lib/pixel-art.ts         程式繪製的像素角色與場景
lib/turn-info.ts         從公開狀態算出輪到誰、面對哪隻怪
lib/map-layout.ts        活地圖的版面計算：房間、棋子、迷霧、首領房的位置（純函式）
lib/use-room-socket.ts   三個房間頁面共用的連線 hook（訊息解析、伺服器重啟偵測、休息時停止重連、首次連線逾時）
lib/join-rejection.ts    加入被拒絕時手機顯示的原因句（純函式）
lib/stored.ts            不會丟錯的 localStorage 讀寫（無痕模式也不會壞）
lib/use-wake-lock.ts     主持人頁和大螢幕的螢幕不休眠 hook
lib/report-client-error.ts、client-error-api.ts  前端當掉的回報（sendBeacon）與 /api/client-error 的處理（來源檢查、4 KB 上限、寫一行 log）
lib/bank-image-api.ts    /api/bank/image 圖片上傳（檔案類型、大小檢查；題庫讀不懂時回 409、連不上時回 503）
worker/index.ts          Cloudflare Worker：Room 與 BankStoreDO 兩個 Durable Object、/api/bank、/api/game-logs 與 /api/client-error 路由、入口規則
lib/room/                房間邏輯（dungeon-room.ts）與它需要的兩個小介面（io.ts），不依賴平台
lib/gate.ts、origin.ts   Worker 入口規則
e2e/                     Playwright 端對端測試
scripts/                 playtest.sh（區網試玩）、check-bundle.sh、pregate-runner.sh（gstack pregate 的本機測試執行器，只跑單元測試；見 .gstack/pregate.json）、check-docs.ts（檢查 README 和 docs/ 指南的連結與錨點，以及中英文版配對）、balance-sim.ts（職業平衡模擬：`node scripts/balance-sim.ts [場數]`，印出每個職業的平均分數和勝率）
public/fonts/            內建字型
public/icon-192.png、icon-512.png  主畫面圖示（史萊姆）
DESIGN.md                像素設計系統
docs/designs/            設計文件與決策紀錄（含 question-bank-editor.md）
docs/going-public.md     公開 repo 前的檢查清單
TODOS.md                 已知問題與延後事項
```
