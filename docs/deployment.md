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

主持人的 key 只存在房間的記憶體裡，不會寫進快照、不會記錄、也不會傳回任何畫面，主持人頁只顯示最後 4 碼（見 [SECURITY.md](../SECURITY.md)）。伺服器重啟後要再貼一次。站長金鑰只在伺服器（Worker）讀取，不要加 `NEXT_PUBLIC_` 前綴，否則會進到瀏覽器。旁白用 `claude-haiku-4-5`，遊戲結束的後記用 `claude-sonnet-5-5`。每句旁白最多等 3 秒（後記 15 秒），逾時、出錯或內容不合格就改用腳本句；連續失敗 3 次就整個房間改用腳本，之後每分鐘試一次 AI，成功就換回來；金鑰被拒絕（401/403）則一直用腳本，直到換上新的金鑰。玩家輸入的隊伍名稱只會以資料的形式進提示詞，題目和答案完全不會進提示詞。

> **費用**：開房間不用登入，但 AI 旁白要主持人自己的 key 或站長金鑰才會開，每個房間有句數上限。站長的 `ANTHROPIC_API_KEY` 請在 Anthropic Console 設花費上限，程式沒有全站的總上限。

## 圖片上傳（R2）

圖片上傳需要先在 Cloudflare 建立一個名為 `critical-answer-images` 的 R2 bucket，並手動在 dashboard 開啟它的 r2.dev 公開讀取，再把 [wrangler.jsonc](../wrangler.jsonc) 裡的 `R2_PUBLIC_BASE_URL` 換成 Cloudflare 給的網址——這一步不是 `wrangler deploy` 的一部分，見 [docs/designs/image-question-type.md](designs/image-question-type.md)。

同一個 bucket 也存題庫上傳的影片和聲音（每檔最多 25 MB，見 [docs/designs/uploaded-media.md](designs/uploaded-media.md)），不用新的綁定或設定。r2.dev 網址有流量限制，正式活動建議幫 bucket 接一個自訂網域，再把 `R2_PUBLIC_BASE_URL` 換成它。

## 部署順序

Workers Builds 不等 CI，也不保證比 Vercel 先完成：前端要用新的房間協定時，合併前先在本機 `npx wrangler deploy`。Worker 不要回滾到 v0.31.3.0 以前（見[開發指南](development.md#存檔與回滾)），題庫的回滾底線見[題庫指南](question-bank.md#題庫卡住時怎麼救)。

## 部署後檢查

部署完跑 `npm run canary:live`，在線上版真的玩一局：用四個互不共用儲存的無頭 Chromium 分別當主持人、大螢幕和兩支手機。主持人從首頁「主持遊戲」開房間（不用站長金鑰），大螢幕用主持人頁的大螢幕網址打開，兩隊 `CANARY-1`、`CANARY-2` 加入並選廚師，主持人開始遊戲、全部代擲；輪到的隊伍照主持人頁的答案答對，確認大螢幕和另一支手機都看到正解，主持人上菜、按下一題，確認大螢幕換成下一隊，最後從「⚙ 更多」按「結束冒險」。每一步印 `STEP r<輪> <步驟> ok|FAIL ms=<毫秒>`，每個頁面印 `PAGE r<輪> <頁面> status=<狀態碼> ms=<載入毫秒> errs=[...]`（errs 是這頁的 console 錯誤和頁面錯誤），最後一行是 `CANARY HEALTHY` 或 `CANARY BROKEN`，不健康時結束碼不是 0。一輪大約 25 秒。

- `--rounds N`：連玩 N 輪，每輪開新房間（預設 1）。
- `--turns N`：每輪玩 N 個回合（預設 1）。第 2 回合起的步驟名稱加上 `-t<回合>`，例如 `answer-correctly-t3`；每多一回合，這一輪的時間上限多 60 秒。
- `--boss`：開始遊戲後，主持人從「⚙ 更多」按「送王房」把 `CANARY-1` 送進首領房，之後它的回合都答首領題。
- `--base URL` 或環境變數 `CANARY_BASE_URL`：改測預覽網址或本機（例如 `http://localhost:3000`），預設是線上版。
- 環境變數 `CANARY_SHOTS=<資料夾>`：第一個失敗的步驟把四個頁面各截一張圖存進去。

房間不會被刪掉，主持人也沒有關房間的按鈕：遊戲結束後連線閒置 2 小時休息，從第一次開始遊戲起 6 小時被清除（見[主持指南](hosting.md#已知限制)）。它不打開題庫編輯器，也不碰任何金鑰。跑的時候不會發出聲音：Chromium 加了 `--mute-audio`，旁白改用靜音的 speechSynthesis，每句照樣在片刻後結束，旁白佇列照常前進。

每個回合都照當下畫面決定下一步，各種題型都過得去：

- 照答案答對：選擇題（手機點選項、鎖定，主持人公布答案）、排序題（手機用 ☰ 的方向鍵排成主持人頁的順序再鎖定）、填空題（先擲說服骰，主持人按「答對！」）、圖片和影片題、記憶題（主持人按「⏭ 直接出題」，不等影片播完）、搶答題（手機按「搶答！」，主持人判對）、多欄聽歌題（主持人每欄都標答對再送出）。聽歌搶答題主持人先按「播放」；大螢幕回報放不出來時，改按「🎤 現場放歌，開放搶答」，所以大螢幕的播放器壞了不會讓這一步失敗，但這一步會印 `note="answered: ..."` 註明大螢幕放不出來。叉路走左門，占卜師選第一個命運。
- 主持人跳過：卡點題沒辦法故意按準，主持人按「沒人答對，換下一題」；聽歌搶答題按「播放」10 秒後還沒開放搶答（沒有「播放」鍵時，從手機顯示「等音樂開始…」起算 10 秒），也一樣跳過。這一步印 `ok`，後面加 `note="skipped: ..."`，不算壞掉。
- 神秘房和占卜師的卡片沒有題目，印 `note="passed: ..."`。首領被打倒、遊戲結束時，剩下的回合和「結束冒險」都略過。
- 主持人頁出現答錯，或一題 60 秒內答不完，這一步就是 `FAIL`。

它不帶金鑰，只能玩網站的預設題庫：主持人要選別的題庫得先證明站長金鑰，所以沒有選題庫的選項。活動題庫設成預設題庫，線上的檢查才會碰到排序、記憶、聽歌和搶答題；首領的搶答階段永遠不是第一階段，而 `--boss` 只送進第一階段，所以搶答、卡點和多欄題要在本機試。每輪最多約 150 秒（加上多的回合），超過就跳過剩下的步驟，但還是會結束遊戲。

在本機用某一份題庫試，用 `playwright.config.ts` 裡測試用的 `E2E_OWNER_KEY`（不是線上的站長金鑰，線上金鑰不要拿來用）：

```bash
KEY=$(sed -n 's/.*E2E_OWNER_KEY = "\(.*\)";/\1/p' playwright.config.ts)
npx wrangler dev --port 1996 --persist-to .wrangler/canary --var 'ALLOWED_ORIGINS:*' --var ANTHROPIC_API_KEY: --var OWNER_KEY:$KEY
# 另一個終端機
NEXT_PUBLIC_PARTYKIT_HOST=localhost:1996 npx next dev -p 3000
# 再一個終端機：把題庫 JSON 放進本機的預設題庫（version 取自目前的版本）
V=$(curl -s -H "Authorization: Bearer $KEY" localhost:1996/api/bank | jq .version)
jq -n --slurpfile b local-banks/my-bank.json --argjson v "$V" '{bank: $b[0], version: $v}' \
  | curl -s -X PUT -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' --data @- localhost:1996/api/bank
npm run -s canary:live -- --base http://localhost:3000 --turns 10 --boss
```

題庫裡上傳的圖片和影音檔不在本機，大螢幕載不到會在 `errs` 留下錯誤；用 YouTube 或文字的題目試最準。
