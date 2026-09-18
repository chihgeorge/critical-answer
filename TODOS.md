# TODOs

## 斷線重連 / 狀態持久化完整方案

**What:** 設計真正的斷線重連與遊戲狀態持久化方案（目前決定：第一輪純 in-memory，伺服器重啟整場遊戲遺失）。

**Why:** 現在的決定只適合第一輪小規模真人測試（朋友聚會、幾十分鐘一場），正式上線後伺服器意外重啟會毀掉整場進行中的遊戲，不適合正式難度。

**Pros:** 提升正式上線後的可靠度；玩家手機斷線也能無縫恢復。

**Cons:** 需要選定持久化層（檔案/SQLite/其他），增加實作與測試複雜度。

**Context:** 見 [docs/designs/critical-answer-party-game.md](docs/designs/critical-answer-party-game.md) 的 Open Questions 與 Architecture Review（/plan-eng-review, 2026-09-17）。決策記錄在該次審查的問題 1B。

**Depends on / blocked by:** 需先完成第一輪範圍（狀態機 + 首領回合制 + 輕量真人測試），驗證玩法後再投入持久化工程。

---

## Host 自訂題庫文字進 LLM prompt 前的內容審核

**What:** 對 host 自訂的題庫文字（問題、答案）進行基本的輸入淨化與 prompt injection 防護，才餵進敘事狀態層生成 DM 旁白的 LLM prompt。

**Why:** 第二輪才會接 LLM API 與敘事狀態層，但 host 題庫編輯 UI 若在那之前就先做，容易忘記在資料流的哪一段加防護。

**Pros:** 避免惡意或不當的 host 輸入內容污染 LLM 輸出（例如注入指令改變旁白行為，或產生不當內容）。

**Cons:** 需要額外設計淨化規則，可能誤傷正常題目內容（過度過濾）。

**Context:** 見 [docs/designs/critical-answer-party-game.md](docs/designs/critical-answer-party-game.md) 的 Open Questions（「Host 自訂題庫的文字內容進入 LLM 旁白 prompt 前」）。

**Depends on / blocked by:** 第二輪的敘事狀態管理層 + LLM API 接入（Next Steps 第 5-6 步）。

**更新（2026-09-18 /plan-ceo-review）：** 第二輪 LLM 旁白已進入範圍，此項不再被擋住。第二輪只處理「隊伍名稱進 prompt」（資料引號化、答案與答錯時的題目文字不進 prompt、輸出驗證，見 CEO plan D8/D19）；host 自訂題庫文字仍待題庫編輯 UI 出現時再處理。

---

## PartyKit 正式部署（卡在工具本身的兩個相容性 bug）

**What:** 把 PartyKit 後端（`party/index.ts`）部署到公開網址，讓不在同一個 Wi-Fi 的人也能玩。

**Why:** 2026-09-17 嘗試部署時，兩條路徑都撞到 PartyKit CLI（0.0.115，當時最新版）本身還沒修的相容性問題：
1. 預設管理平台（`partykit deploy`）：共用網域 `partykit.dev` 已超過 Cloudflare 10000 個 Workers custom domain 上限，官方 [issue #985](https://github.com/partykit/partykit/issues/985) 開著沒人修（2026-06-18 回報至今）。
2. Cloud-prem 模式（部署到自己的 Cloudflare 帳號，`CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` + `partykit deploy`）：卡在 Cloudflare 2026-07-09 起強制免費方案 Durable Objects 必須用 `new_sqlite_classes` migration，但 PartyKit CLI 產生部署設定時還沒跟進，報錯且無 CLI 參數可覆寫。

**Pros:** 能找不同地點的朋友一起測、也是正式上線的必要條件。

**Cons:** 需要等 PartyKit 修這兩個 bug，或改走重工程的替代方案（見下）。

**Context:** 見 [docs/designs/critical-answer-party-game.md](docs/designs/critical-answer-party-game.md)。Vercel（前端）跟 wrangler（Cloudflare 帳號）都已登入備妥，`.env.cloudflare.local`（已加密限存取、已加入 .gitignore）存有可用的 API token，卡點純粹是 PartyKit CLI 端。

**替代方案（若不想等 PartyKit 修復）：**
- 追蹤 PartyKit repo 更新，定期重試 `npx partykit deploy`（管理平台）或 cloud-prem 路徑
- 改走「繞過 partykit CLI，直接用 wrangler 部署成原生 Cloudflare Worker + Durable Object」——PartyKit 本來就是建在 Workers+DO 上，理論上可行，但需要把 `party/index.ts` 改寫成原生 Workers 專案格式，額外工程量較高

**Depends on / blocked by:** 無（獨立於遊戲玩法開發），但目前選擇不投入這個重工程替代方案，先用 localhost/局域網進行第一輪真人測試。

---

## DM 語音旁白（瀏覽器 TTS）

**What:** 大螢幕用瀏覽器內建 Web Speech API（zh-TW 聲音）把旁白念出來，並提供關閉開關。

**Why:** 旁白從「要看的文字」變成「大家一起聽的場景」，首領倒下時客廳裡有個聲音在說話，是氛圍最直接的來源。2026-09-18 第二輪範圍審查（/plan-ceo-review，E1）評估過，因為第二輪先只驗證「看得到的氛圍」而延後。

**Pros:** 不需要額外費用；接在 `NarrationEvent` 事件流下游，成本很低。

**Cons:** 不同瀏覽器的中文聲音品質差異很大；瀏覽器會擋自動播放，需要 host 按一下「開始」解鎖。

**Context:** 見 `~/.gstack/projects/critical-answer/ceo-plans/2026-09-18-iteration-2-atmosphere.md`。事件流由 `lib/narration/` 提供，TTS 只是多一個事件消費者，不需要動房間邏輯。

**Effort:** S（人工約 0.5 天 / CC 約 20 分鐘）　**Priority:** P2

**Depends on / blocked by:** 第二輪的 `NarrationEvent` 接縫完成。

---

## 共享大螢幕活地圖

**What:** 大螢幕顯示地城地圖，各隊棋子從房間移到房間，首領房有血條與強度條。

**Why:** 讓等待中的隊伍看到對手進度，緩解全域回合制每隊只有 1/N 時間在答題的問題。設計文件 Next Steps 第 8 步原本就列了這項；2026-09-18 審查（E3）選擇先不做，先測氛圍是否為賣點。

**Pros:** `getSpectatorView()` 已回傳各隊房間、分數、首領血量，只剩 UI 工作。

**Cons:** 美術與版面成本高，隊伍數與房間數要能自適應；視覺方向須先由 /plan-design-review 決定。

**Context:** 見同上 CEO plan。房間規則已改成以房間為單位、走完仍不夠 15 分會追加額外怪物房（D15），地圖要能顯示動態增加的房間。

**Effort:** M（人工約 2 天 / CC 約 1 小時）　**Priority:** P2

**Depends on / blocked by:** 視覺方向定案（/plan-design-review）。

---

## 音效與背景氛圍音樂

**What:** 答對、答錯、逃跑、首領死亡各有音效，加上地城背景音。

**Why:** 音效是讓按鈕點擊變成「我真的在地城裡」的最低成本方式（審查 E4）。

**Pros:** 接在 `NarrationEvent` 下游；host 既有的「開始遊戲」按鈕可拿來解鎖瀏覽器自動播放限制。

**Cons:** 素材授權要弄清楚（CC0 或自行生成），這比寫程式更花時間。

**Context:** 見同上 CEO plan。

**Effort:** S（人工約 1 天 / CC 約 30 分鐘）　**Priority:** P3

**Depends on / blocked by:** 第二輪的 `NarrationEvent` 接縫完成、素材授權來源確定。

---

## 等待隊伍的觀眾反應（表情 / 加油 / 噓聲）

**What:** 等待中的隊伍在手機上點表情，大螢幕浮現，DM 旁白可提到。

**Why:** 全域回合制每隊只有 1/N 時間在答題，其餘時間手機只是被動畫面（審查 E5）。若第二次測試後「等待太無聊」仍是主要抱怨，這是首選解法。

**Pros:** 手機從只看狀態變成有事可做；可餵給 DM 旁白。

**Cons:** 新增玩家輸入面，需要限頻、防洗版與不當內容處理。

**Context:** 見同上 CEO plan。新增 `REACT` 訊息，伺服器限頻後廣播。

**Effort:** M（人工約 2 天 / CC 約 1 小時）　**Priority:** P2

**Depends on / blocked by:** 第二次真人測試結果。

---

## 手機答題模式（選擇題 + 自動判定）

**What:** 題目改成選擇題，玩家在手機選答案，系統自動判定，host 不再手動按對錯。

**Why:** 手機在遊戲中幾乎閒置，host 也被綁在判定工作上（審查 E6）。

**Pros:** 手機變主角；host 可以下場玩。

**Cons:** 改變第一輪已驗證的核心玩法；題庫要全部重寫並加迷惑選項；重答與逃跑規則要重新設計手機 UI。

**Context:** 見同上 CEO plan。風險最高，應在氛圍假設驗證後再評估。

**Effort:** L（人工約 1 週 / CC 約半天）　**Priority:** P3

**Depends on / blocked by:** 第二次真人測試結果，題庫格式定案。
