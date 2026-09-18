# TODOs

## 斷線重連 / 狀態持久化完整方案

**What:** 設計真正的斷線重連與遊戲狀態持久化方案（目前決定：第一輪純 in-memory，伺服器重啟整場遊戲遺失）。

**Why:** 現在的決定只適合第一輪小規模真人測試（朋友聚會、幾十分鐘一場），正式上線後伺服器意外重啟會毀掉整場進行中的遊戲，不適合正式難度。

**Pros:** 提升正式上線後的可靠度；玩家手機斷線也能無縫恢復。

**Cons:** 需要選定持久化層（檔案/SQLite/其他），增加實作與測試複雜度。

**Context:** 見 [docs/designs/dungeon-master-party-game.md](docs/designs/dungeon-master-party-game.md) 的 Open Questions 與 Architecture Review（/plan-eng-review, 2026-09-17）。決策記錄在該次審查的問題 1B。

**Depends on / blocked by:** 需先完成第一輪範圍（狀態機 + 首領回合制 + 輕量真人測試），驗證玩法後再投入持久化工程。

---

## Host 自訂題庫文字進 LLM prompt 前的內容審核

**What:** 對 host 自訂的題庫文字（問題、答案）進行基本的輸入淨化與 prompt injection 防護，才餵進敘事狀態層生成 DM 旁白的 LLM prompt。

**Why:** 第二輪才會接 LLM API 與敘事狀態層，但 host 題庫編輯 UI 若在那之前就先做，容易忘記在資料流的哪一段加防護。

**Pros:** 避免惡意或不當的 host 輸入內容污染 LLM 輸出（例如注入指令改變旁白行為，或產生不當內容）。

**Cons:** 需要額外設計淨化規則，可能誤傷正常題目內容（過度過濾）。

**Context:** 見 [docs/designs/dungeon-master-party-game.md](docs/designs/dungeon-master-party-game.md) 的 Open Questions（「Host 自訂題庫的文字內容進入 LLM 旁白 prompt 前」）。

**Depends on / blocked by:** 第二輪的敘事狀態管理層 + LLM API 接入（Next Steps 第 5-6 步）。

---

## PartyKit 正式部署（卡在工具本身的兩個相容性 bug）

**What:** 把 PartyKit 後端（`party/index.ts`）部署到公開網址，讓不在同一個 Wi-Fi 的人也能玩。

**Why:** 2026-09-17 嘗試部署時，兩條路徑都撞到 PartyKit CLI（0.0.115，當時最新版）本身還沒修的相容性問題：
1. 預設管理平台（`partykit deploy`）：共用網域 `partykit.dev` 已超過 Cloudflare 10000 個 Workers custom domain 上限，官方 [issue #985](https://github.com/partykit/partykit/issues/985) 開著沒人修（2026-06-18 回報至今）。
2. Cloud-prem 模式（部署到自己的 Cloudflare 帳號，`CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` + `partykit deploy`）：卡在 Cloudflare 2026-07-09 起強制免費方案 Durable Objects 必須用 `new_sqlite_classes` migration，但 PartyKit CLI 產生部署設定時還沒跟進，報錯且無 CLI 參數可覆寫。

**Pros:** 能找不同地點的朋友一起測、也是正式上線的必要條件。

**Cons:** 需要等 PartyKit 修這兩個 bug，或改走重工程的替代方案（見下）。

**Context:** 見 [docs/designs/dungeon-master-party-game.md](docs/designs/dungeon-master-party-game.md)。Vercel（前端）跟 wrangler（Cloudflare 帳號）都已登入備妥，`.env.cloudflare.local`（已加密限存取、已加入 .gitignore）存有可用的 API token，卡點純粹是 PartyKit CLI 端。

**替代方案（若不想等 PartyKit 修復）：**
- 追蹤 PartyKit repo 更新，定期重試 `npx partykit deploy`（管理平台）或 cloud-prem 路徑
- 改走「繞過 partykit CLI，直接用 wrangler 部署成原生 Cloudflare Worker + Durable Object」——PartyKit 本來就是建在 Workers+DO 上，理論上可行，但需要把 `party/index.ts` 改寫成原生 Workers 專案格式，額外工程量較高

**Depends on / blocked by:** 無（獨立於遊戲玩法開發），但目前選擇不投入這個重工程替代方案，先用 localhost/局域網進行第一輪真人測試。
