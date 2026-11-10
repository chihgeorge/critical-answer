繁體中文 | [English](deployment.en.md)

# 部署指南

> **還沒在全新的帳號上照著做過一遍。** 下面的「第一次部署」是從現在的設定檔整理出來的；照做卡住時請開 issue。驗證工作記在 [TODOS.md](../TODOS.md)。

前端（Next.js）放在 Vercel，房間伺服器（Cloudflare Worker + Durable Objects）放在 Cloudflare。兩邊各自從 `main` 自動部署。

## 這個 repo 的線上版

**線上版**：前端在 <https://critical-answer.vercel.app>，房間伺服器在 Cloudflare（`https://critical-answer.aiko-studio.workers.dev`），合併進 `main` 就自動部署（見下面的[自動部署](#自動部署)）。房間狀態已持久化，重新部署不會清掉進行中的遊戲，只會讓連線短暫重連。

## 自動部署

合併進 `main` 就會自動部署，兩邊都是平台自己的 Git 連動，GitHub 上不放任何部署用的 secret：Cloudflare Workers Builds 從 `main` 執行 `wrangler deploy`（房間伺服器），Vercel 從 `main` 部署前端。Workers Builds 在 Cloudflare dashboard 設定（Workers & Pages → `critical-answer` → Settings → Build → 連 GitHub repo，production branch 選 `main`）。它不等 GitHub Actions 的檢查跑完，也不保證比 Vercel 先完成；如果這次改動要求 Worker 先上線（例如前端會讀新的協定欄位），合併前先在本機 `wrangler deploy`。`OWNER_KEY`、`ANTHROPIC_API_KEY` 存在 Worker 上，部署不會動到。

## 第一次部署到自己的帳號

1. **Cloudflare 登入**：`npx wrangler login`。想換 Worker 名稱就改 [wrangler.jsonc](../wrangler.jsonc) 的 `name`。
2. **圖片用的 R2 bucket**：`npx wrangler r2 bucket create critical-answer-images`，再照下面的[圖片上傳（R2）](#圖片上傳r2)開公開讀取、填 `R2_PUBLIC_BASE_URL`。不用圖片題也要建，`wrangler deploy` 需要這個綁定。
3. **允許的前端網址**：把 `wrangler.jsonc` 的 `ALLOWED_ORIGINS` 換成你自己的 Vercel 網址（逗號分隔，建議寫完整的網址）。`*` 可以代替網址裡的一段名稱，例如 `https://你的專案-*.vercel.app` 涵蓋預覽網址；但別人在 Vercel 開一個名字一樣開頭的專案也會被允許，所以只在需要預覽網址時才用。
4. **部署 Worker**：`npx wrangler deploy`。第一次部署會套用 `wrangler.jsonc` 的兩個 migration，建立 `Room` 和 `BankStoreDO` 兩個 Durable Object。記下印出來的 `*.workers.dev` 網址。
5. **Worker 的 secret**：`npx wrangler secret put OWNER_KEY`（題庫編輯和站長金鑰用，≥32 bytes 的隨機值）。要用站長的 AI 旁白再加 `npx wrangler secret put ANTHROPIC_API_KEY`。
6. **Vercel**：匯入這個 repo，環境變數 `NEXT_PUBLIC_PARTYKIT_HOST` 設成第 4 步的 Worker 網址，不含 `https://`（例如 `critical-answer.<你的子網域>.workers.dev`）。沒設的話前端會去連 `localhost:1999`。
7. **自動部署（選用）**：照上面的[自動部署](#自動部署)把 Workers Builds 連到 GitHub。

## 設定一覽

| 名稱 | 放哪裡 | 必要 | 用途 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_PARTYKIT_HOST` | Vercel 環境變數 | 是 | Worker 的網址（不含協定）。`npm run dev` 自動設成 `localhost:8787` |
| `ALLOWED_ORIGINS` | `wrangler.jsonc` 的 `vars` | 是 | 允許連線的前端網址。本機開發用 `.dev.vars`（照 `.dev.vars.example`，內容是 `*`） |
| `R2_PUBLIC_BASE_URL` | `wrangler.jsonc` 的 `vars` | 圖片題要 | R2 bucket 的公開網址 |
| `OWNER_KEY` | Worker secret | 題庫編輯要 | 題庫編輯器和站長金鑰的密碼 |
| `ANTHROPIC_API_KEY` | Worker secret | 選用 | 站長的 AI 旁白金鑰 |
| `ROOM_IDLE_MS`、`ROOM_EXPIRE_MS` | Worker 變數 | 選用 | 房間多久沒動作就休息，以及從第一次開始遊戲起多久被清除（毫秒，預設 2 小時、6 小時，主持人可延長到 24 小時，見[主持指南](hosting.md#已知限制)） |

## AI 旁白的金鑰

主持人怎麼在大廳選 AI 旁白見[主持指南](hosting.md#ai-旁白)。

本機要測站長金鑰，在**專案根目錄**的 `.env` 放 `ANTHROPIC_API_KEY=sk-ant-...`（`wrangler dev` 讀這個檔，不是 `.env.local`），再重啟 `npm run dev:worker`。

主持人的 key 只存在房間的記憶體裡，不會寫進快照、不會記錄、也不會傳回任何畫面，主持人頁只顯示最後 4 碼（見 [SECURITY.md](../SECURITY.md)）。伺服器重啟後要再貼一次。站長金鑰只在伺服器（Worker）讀取，不要加 `NEXT_PUBLIC_` 前綴，否則會進到瀏覽器。旁白用 `claude-haiku-4-5`，遊戲結束的後記用 `claude-sonnet-5-5`。每句旁白最多等 3 秒（後記 15 秒），逾時、出錯或內容不合格就改用腳本句；連續失敗 3 次或金鑰被拒絕（401/403）就整個房間改用腳本。玩家輸入的隊伍名稱只會以資料的形式進提示詞，題目和答案完全不會進提示詞。

> **費用**：開房間不用登入，但 AI 旁白要主持人自己的 key 或站長金鑰才會開，每個房間有句數上限。站長的 `ANTHROPIC_API_KEY` 請在 Anthropic Console 設花費上限，程式沒有全站的總上限。

## 圖片上傳（R2）

圖片上傳需要先在 Cloudflare 建立一個名為 `critical-answer-images` 的 R2 bucket，並手動在 dashboard 開啟它的 r2.dev 公開讀取，再把 [wrangler.jsonc](../wrangler.jsonc) 裡的 `R2_PUBLIC_BASE_URL` 換成 Cloudflare 給的網址——這一步不是 `wrangler deploy` 的一部分，見 [docs/designs/image-question-type.md](designs/image-question-type.md)。

## 部署順序

Workers Builds 不等 CI，也不保證比 Vercel 先完成：前端要用新的房間協定時，合併前先在本機 `npx wrangler deploy`。Worker 不要回滾到 v0.31.3.0 以前（見[開發指南](development.md#存檔與回滾)），題庫的回滾底線見[題庫指南](question-bank.md#題庫卡住時怎麼救)。
