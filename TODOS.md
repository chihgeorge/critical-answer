# TODOs






## 題目比隊伍少時，兩隊可能一直拿同一題

**What:** 自訂題庫的題目比隊伍數少時，開局就會有兩隊拿同一題（沒辦法避免）。之後有題目空出來（某隊進王房、被主持人送進王房、或答對換題），只有正在出題的那一隊會換題，共用同一題的兩隊要等其中一隊下次出題才會分開。做法：有題目空出來時，從共用同一題的隊伍裡挑一隊（沒有選錯紀錄的）立刻換到空出來的題目。

**Why:** 共用同一題時，一隊答對公布答案，另一隊就看到自己的答案。

**Pros:** 邏輯集中在 `game-state.ts`，`/ship` 的模擬腳本已經能重現（scratchpad `sim.ts` 的 R1release）。

**Cons:** 會換掉一隊正在等的題目，大螢幕和手機要能接受「沒輪到也換題」；要先決定換哪一隊。預設題庫每池 12～16 題、最多 8 隊，遇不到。

**Context:** 2026-10-26 `/ship`（score-pools，v0.14.0.0）Claude 對抗審查的隨機模擬提出（5 萬場、只在很小的自訂題庫出現）。

**Effort:** S　**Priority:** P3

**Depends on / blocked by:** 無。

---

## 題庫讀不懂時的後續：格式版本號、編輯器唯讀提示、救援步驟

**What:** v0.13.1.0 讓 `BankStore` 在存著的題庫讀不懂時拒絕儲存、不刪圖片。還沒做的有四件：(1) ~~題庫存一個格式版本號，讀到比自己新的版本就當作讀不懂~~（v0.15.0.2 做完：`lib/bank-store.ts` 的 `BANK_FORMAT`，改題庫格式時加 1）；(2) GET `/api/bank` 帶出「讀不懂」狀態，編輯器載入時就顯示唯讀提示並停用儲存，不要等到存檔才回 400；(3) 這個狀態下擋掉圖片上傳；(4) 在 README 寫「題庫卡住時怎麼救」（往前部署到讀得懂的版本，或修好存著的題庫），並寫明**不要回滾到 v0.13.1.0 以前**：更舊的版本沒有這個保護，存一次就會蓋掉題庫。另外幾個小問題一起看：讀不懂的期間每次上傳都會把清理 alarm 拉回現在、白跑一次；待刪佇列在這段期間不會縮小，上傳很多次可能撐爆單一儲存值；`version` 不是數字時被當成 1；延後清理時沒有自己的 log；還有一個既有的競態：清理在等 R2 刪除時，一個把圖放回題庫的儲存可能剛好插進來，圖還是被刪。

**Why:** (1) 以後的新格式如果只是「加欄位」，舊版讀得懂但會把新欄位丟掉，回滾後存一次就永久遺失，現在的保護攔不到。(2) 主持人看到的是預設題目，可能以為自訂題庫不見了，還白編一場。(3) 上傳的圖永遠存不進題庫。(4) 下次出事時不用臨時想辦法改 Durable Object 儲存。

**Pros:** (1) 在下一次改題庫格式之前做最便宜；(2)(3) 讀取時已經有 `unreadable` 旗標，接到 API 就好。

**Cons:** (2) 是 UI 改動，要先做 PNG 比較；(1) 要決定版本號放哪裡、舊題庫怎麼補。

**Context:** 2026-10-25 `/review`（bank-guard，v0.13.1.0）的 Claude 與 Codex 對抗審查提出。使用者選擇先出小 PR 擋回滾風險，這四件記在這裡。v0.14.0.0 的難度題庫格式在 v0.13.1.0 會直接讀不懂，所以這次回滾已經擋住。

**Effort:** M　**Priority:** P2

**Depends on / blocked by:** 無。

---

## 背景音樂播放器：連點🎵的競態、背景分頁時音符擠成一團

**What:** `lib/bgm-player.ts` 兩個問題：(1) `start()` 在 `await ctx.resume()` 之前才檢查 `timer`，連點 🎵 會開兩個 interval，`stop()` 只清掉一個，`resume()` 還沒好就 `stop()` 會讓 `ctx.currentTime` 拋 TypeError；(2) 大螢幕分頁在背景時瀏覽器把 timer 降到約每秒一次，排程落後，回來時已過時間的音符一次全部響。

**Why:** (1) 主持人連點音樂鍵可能讓音樂和音效卡在關閉狀態；(2) 大螢幕被切到背景再切回來時會聽到一團雜音。

**Pros:** 根因都已找到：(1) 在 await 前設「啟動中」旗標或保存 pending promise，await 後重新檢查 `ctx`；(2) 跳過 `at` 已經過去的音符，或落後時重設 `loopStart`。

**Cons:** 都要在真的瀏覽器裡手動試（連點、切分頁），單元測試很難涵蓋。

**Context:** 2026-10-07 `/ship`（v0.9.15.1，fix-bgm-bass-order）的對抗審查發現，都是既有程式碼，不是那個 PR 造成的。同一份審查也提到空曲目會讓 `schedule()` 每次 tick 都拋錯，但現在的曲子是固定常數、不會是空的，所以沒記。

**Effort:** S　**Priority:** P2

**Depends on / blocked by:** 無。

---

## 用真的 API 驗證後記改用 Sonnet 5.5 之後還正常

**What:** 在專案目錄跑 `ANTHROPIC_API_KEY=<金鑰> npm run test:live`，確認旁白（`claude-haiku-4-5`）和後記（`claude-sonnet-5-5`）都打得通、輸出通過我們的驗證。

**Why:** v0.9.14.6 把後記從 Sonnet 5 換成 Sonnet 5.5，關閉思考的參數也從 `disabled` 改成 `between_tools`。單元測試只確認請求長得對，沒有真的打 API；出貨時本機沒有金鑰，這一步跳過了。萬一 Sonnet 5.5 不接受這個請求，線上每場遊戲的後記都會安靜地退回罐頭文字，不會報錯。

**Pros:** 一行指令、幾美分，就能確認新模型真的能用，不用等線上有人玩完一場。

**Cons:** 需要有金鑰的人手動跑；金鑰不該貼進對話或寫進檔案。

**Context:** 測試在 `lib/narration/llm.live.test.ts`，不在 `npm test` 裡，沒有金鑰時會自動跳過。如果失敗，先看錯誤訊息是不是 400 `thinking`（參數問題）或 `refusal`（內容被拒）；設定在 `lib/narration/llm.ts` 的 `EPILOGUE_MODEL` 和後記請求的 `thinking`。也可以看線上大螢幕的後記是不是罐頭版，或主持人「下載旁白紀錄」裡後記那筆的 `fallbackReason`。

**Effort:** S　**Priority:** P2

**Depends on / blocked by:** 有 `ANTHROPIC_API_KEY` 的人。

---

## AI 旁白沒有花費上限：任何人都能開房間觸發付費 LLM 呼叫

**What:** 每局（或每個房間）設一個 AI 旁白次數上限，超過就改用罐頭旁白；必要時再加一個全站每日上限，記在一個 Durable Object 裡。

**Why:** `/cso` 稽核（2026-10-03，發現 `7b53ff168118d30889fe2e95aa9ee99d`）：開房間不用登入、第一個 HOST_CLAIM 就是主持人，AI 旁白在有 `ANTHROPIC_API_KEY` 時預設開啟（正式環境有設），每次判題都打一次 Claude API，結束再打一次。沒有任何次數限制，breaker 只在失敗時跳開。一個腳本開很多房間、一直送「答錯重答」就能持續花費。

**Pros:** 程式內就擋住，額度被打爆時不會連帶讓真的在玩的房間失去 AI 旁白。

**Cons:** 單局上限擋不住「開很多房間」；全站上限要多一個 DO 和計數邏輯。

**Context:** 這次決定（dec-db628e32）只在 Anthropic 後台設花費上限，程式不改；`lib/room/dungeon-room.ts` 的 `handleHostStart` 有 `gstack-shortcut(dec-db628e32)` 標記。升級的觸發點：花費上限被打到，或用量出現異常。從 `narrate()` 計次開始做。

**Effort:** M　**Priority:** P3

**Depends on / blocked by:** 無。

---

## Host 自訂題庫文字進 LLM prompt 前的內容審核

**Priority:** P4

**更新（2026-10-03，`/cso` 稽核）：** 重新確認：`lib/narration/llm.ts` 的 `buildPrompt` 只放隊伍名、怪物名、分數與主持人導演筆記，題目文字與答案都不進 prompt；名稱以「」包起來並移除引號字元。這條只有在旁白開始讀題目文字時才需要，降為 P4。

**What:** 對 host 自訂的題庫文字（問題、答案）進行基本的輸入淨化與 prompt injection 防護，才餵進敘事狀態層生成 DM 旁白的 LLM prompt。

**Why:** 第二輪才會接 LLM API 與敘事狀態層，但 host 題庫編輯 UI 若在那之前就先做，容易忘記在資料流的哪一段加防護。

**Pros:** 避免惡意或不當的 host 輸入內容污染 LLM 輸出（例如注入指令改變旁白行為，或產生不當內容）。

**Cons:** 需要額外設計淨化規則，可能誤傷正常題目內容（過度過濾）。

**Context:** 見 [docs/designs/critical-answer-party-game.md](docs/designs/critical-answer-party-game.md) 的 Open Questions（「Host 自訂題庫的文字內容進入 LLM 旁白 prompt 前」）。

**Depends on / blocked by:** 第二輪的敘事狀態管理層 + LLM API 接入（Next Steps 第 5-6 步）。

**更新（2026-09-20，第二輪實作完成）：** 隊伍名稱進 prompt 的部分已完成並驗證：名稱以「」引起來當資料（並拿掉引號字元）、系統提示明講裡面的指示一律忽略、題目文字與答案完全不進 prompt、輸出驗證（長度、標記、不含題庫答案）。真的 API 測試也確認藏在隊伍名稱裡的指令不會被照做。**仍待處理：** host 自訂題庫文字，等題庫編輯介面出現時再做。

**更新（2026-09-18 /plan-ceo-review）：** 第二輪 LLM 旁白已進入範圍，此項不再被擋住。第二輪只處理「隊伍名稱進 prompt」（資料引號化、答案與答錯時的題目文字不進 prompt、輸出驗證，見 CEO plan D8/D19）；host 自訂題庫文字仍待題庫編輯 UI 出現時再處理。

**更新（2026-09-22，`/plan-eng-review` question-bank-editor）：** 這條 TODO 等的「題庫編輯介面」這輪要做了，但範圍不變——題目文字/答案本來就不進 prompt（見上，已有防護），所以題庫變成可編輯並不會新增暴露面。真正要處理的情境是：如果未來旁白 prompt 改成會讀題目文字（例如題目本身要融入敘事），才需要回頭做這條 TODO 描述的淨化。用戶決定繼續延後，本次只更新現狀說明。見 [docs/designs/question-bank-editor.md](docs/designs/question-bank-editor.md)。

---




## 量 e2e 對前端（app/、components/）的實際覆蓋率

**What:** 讓 Next.js 在 e2e 建置時產生 source map，用 Playwright 收集 V8 coverage，算出 `app/` 與 `components/`（約 2,400 行）被 e2e 跑到多少。

**Why:** 單元測試只覆蓋 `lib/`；前端完全靠 e2e，但沒有數字知道哪些頁面流程沒被碰過。

**Pros:** 補測試有依據，能找出完全沒被 e2e 走過的頁面流程。

**Cons:** 要加回 `next.config.ts`，而且只能在 e2e 建置開 source map；正式部署帶上 source map 等於公開原始碼。

**Context:** 維護輪（`docs/designs/maintenance-2026-10.md` D3）審查時決定延後。從 `playwright.config.ts` 的 webServer 建置指令開始。

**Effort:** M　**Priority:** P4

**Depends on / blocked by:** 無。

---

## 開發工具鏈剩 5 個 npm audit 漏洞（上游沒有修補版）

**What:** `npm audit` 剩 5 個 high，全是同一條：`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob@3.3.1`（鎖死版本）→ `micromatch` → `braces <=3.0.3`。`braces` 最新版就是 3.0.3，上游沒有修好的版本。

**Why:** 記下結論，之後看到 audit 報 high 不用重查一遍；上游修好時知道要回來升。

**Pros:** 省下重複調查的時間。

**Cons:** 無。

**Context:** 只在跑 lint 時掃專案自己的檔案路徑，不會進到線上程式。v0.9.14.4 升級修掉另外 3 個（`undici` 等）。用 npm overrides 強制 `fast-glob@3.3.3` 沒用，因為 `braces` 仍有漏洞。上游修好的訊號：`@next/eslint-plugin-next` 不再鎖 `fast-glob@3.3.1`，或 `braces` 出修補版。

**Effort:** S　**Priority:** P4

**Depends on / blocked by:** 上游 `braces` 或 `@next/eslint-plugin-next`。

---

## /health 補上死碼與 shell 腳本檢查

**What:** 加 `knip`（死碼偵測）當開發依賴、裝 `shellcheck` 檢查 `scripts/*.sh`，再把兩者寫進 CLAUDE.md 的 `## Health Stack`。

**Why:** 第一次 `/health`（2026-10-03）是 10.0/10，但只有 3/6 類別有檢查（型別、lint、測試）；死碼與 shell 腳本沒有工具，分數不完整。

**Pros:** 分數更完整，能抓到沒人用的 export 和腳本錯誤。

**Cons:** knip 第一次跑可能報出一堆要逐一判斷的結果。

**Context:** 歷史紀錄在 `~/.gstack/projects/critical-answer/health-history.jsonl`。加工具後覆蓋類別改變，分數會跟第一次不可比。

**Effort:** S　**Priority:** P4

**Depends on / blocked by:** 無。

---

## 後進王房的隊伍，旁白還在說「推開最後一道門」

**What:** 第二隊以後進王房時，旁白改用「加入戰局」的台詞，AI 旁白的 prompt 也告訴它這隊是第幾個進來的。現在每隊進王房都用同一組 `BOSS_ENTER_VARIANTS`（`lib/narration/`），聽起來像第一次開門。

**Why:** 活地圖的 D9 規則讓每隊都會「進王房」，但大螢幕上門早就開了，旁白跟畫面對不上。

**Pros:** 旁白跟大螢幕一致；後進隊伍有自己的進場台詞。

**Cons:** 要寫新台詞、改 `buildPrompt`，旁白測試要跟著改。

**Context:** 2026-10-23 /ship 紅隊審查第 5 點，使用者選 D6=B（記 TODO），跟計分重設計一起處理。`NarrationEvent` 的 `entersBoss` 目前不分第一隊或後進。

**Effort:** S（人工約半天 / CC 約 15 分鐘）　**Priority:** P3

**Depends on / blocked by:** 跟「重新設計計分」一起做。

---



## ESLint 10 / TypeScript 7 升級被上游卡住

**What:** `npm outdated` 列出的兩個 major 版本升級目前做不了：ESLint 9→10（`eslint-config-next@16.3.6` 內建的 `eslint-plugin-react` 用了 ESLint 10 移除的 API，直接噴 `contextOrFilename.getFilename is not a function`）、TypeScript 5→7（`typescript-eslint` 明確拒絕載入，官方公告要等 7.1+ 才支援）。

**Why:** 2026-09-23 逐一嘗試升級時發現，兩者都不是設定問題，是上游套件（`eslint-config-next`、`typescript-eslint`）還沒跟上，沒有繞過的辦法。

**Pros:** 之後升級好處：更快的 lint/typecheck（TS 7 是 Go 原生編譯器，官方號稱 8–12 倍）、ESLint 10 的新規則。

**Cons:** 現在做不了，勉強做會直接打斷開發環境。

**Context:** 已完成同批的其他升級：React 19.2.4→19.3.0、Vitest 4.1.11→5.0.1、`concurrently` 9→10（v0.7.3.0）。

**Effort:** 不確定（等上游）　**Priority:** P4

**Depends on / blocked by:** `eslint-config-next` 支援 ESLint 10；`typescript-eslint` 支援 TypeScript ≥7.1。

**解鎖後：** 把 `.github/dependabot.yml` 裡 `typescript` 和 `eslint` 的 `ignore` 規則拿掉，Dependabot 才會再開這兩個升級 PR。

**重新確認（2026-10-03）：** 仍然卡住。`eslint-config-next@16.3.8` 依賴 `eslint-plugin-react@^7.37.0`，最新 7.37.5 的 peer 是 `eslint ^9.7`（沒有 10）；`typescript-eslint` 最新 8.71.0 的 peer 是 `typescript <6.1.0`（TS 已到 7.0.2）。

---

## CI 在 Ubuntu 26 上試跑一次，通過再換掉固定的 ubuntu-24.04

**What:** `.github/workflows/ci.yml` 目前把 `runs-on` 固定在 `ubuntu-24.04`。找一個 PR 把它改成 `ubuntu-26.04`（或 `ubuntu-latest`）跑一次完整 CI，全過就換，不過就記下壞在哪。

**Why:** GitHub 從 2026-10-19 起把 `ubuntu-latest` 換成 Ubuntu 26。先固定版本是為了不在某天突然紅燈；但不能永遠停在 24.04，等它停止支援時會被迫一次升。

**Pros:** 主動、可控地升級；壞的話只影響那一個試跑 PR。

**Cons:** 最可能出問題的是 `npx playwright install --with-deps chromium` 裝的系統套件，可能要跟著調整。

**Context:** v0.9.14.3 固定版本時加的（`docs/designs/maintenance-2026-10.md` B1）。只要改 `runs-on` 那一行；CI 其他步驟不用動。

**Effort:** S　**Priority:** P3

**Depends on / blocked by:** GitHub 的 Ubuntu 26 runner 正式可用。

---

## 等待隊伍的觀眾反應（表情 / 加油 / 噓聲）

**What:** 等待中的隊伍在手機上點表情，大螢幕浮現，DM 旁白可提到。

**Why:** 全域回合制每隊只有 1/N 時間在答題，其餘時間手機只是被動畫面（審查 E5）。若第二次測試後「等待太無聊」仍是主要抱怨，這是首選解法。

**Pros:** 手機從只看狀態變成有事可做；可餵給 DM 旁白。

**Cons:** 新增玩家輸入面，需要限頻、防洗版與不當內容處理。

**Context:** 見同上 CEO plan。新增 `REACT` 訊息，伺服器限頻後廣播。另一個做法（Codex 的「燈籠」點子，`docs/designs/phone-answering.md`）：等待隊伍在別隊答題時偷偷鎖一個預測，揭曉時在大螢幕顯示，猜對的累積成打首領用的共用燈籠。

**Effort:** M（人工約 2 天 / CC 約 1 小時）　**Priority:** P2

**Depends on / blocked by:** 第二次真人測試結果。

---

## 手機答題模式（選擇題 + 自動判定）

**What:** 題目改成選擇題，玩家在手機選答案，系統自動判定，host 不再手動按對錯。

**Why:** 手機在遊戲中幾乎閒置，host 也被綁在判定工作上（審查 E6）。

**Pros:** 手機變主角；host 可以下場玩。

**Cons:** 改變第一輪已驗證的核心玩法；題庫要全部重寫並加迷惑選項；重答與逃跑規則要重新設計手機 UI。

**Context:** 見同上 CEO plan。風險最高，應在氛圍假設驗證後再評估。v0.11.0.0 已上第一階段（`docs/designs/phone-answering.md` PR 1）：手機選擇、鎖定、自動判定、重答／逃跑，第一房只有 6 題示範選擇題。第二階段（PR 2）也已完成：預設題庫 52 題全部改成四選一（第一房 12 題，其他房和王各 8 題）。剩下：正式環境的題庫存在 BankStore 裡，要另外重新種子（使用者決定），否則正式環境還是舊的文字題。

**Effort:** L（人工約 1 週 / CC 約半天）　**Priority:** P3

**Depends on / blocked by:** 第二次真人測試結果，題庫格式定案。

---

## 手機答題的剩餘小風險（/review 2026-10-25）

**Priority:** P3

**What:** phone-answering 分支 /review 找到、但這次刻意沒修的幾項：
1. 主持人「等 15 秒才出現重答／逃跑」只擋在主持人頁，伺服器不檢查（主持人本來就是被信任的一方）。
2. 房間重啟還原 `eliminated`、`pendingWrong` 時沒驗證資料形狀，壞掉的存檔可能讓房間卡住。
3. 等待重答／逃跑的隊伍離線時一直保留回合；房間重啟後所有隊伍都離線，只能靠主持人的卡住按鈕救。
4. 鎖定被伺服器丟掉時（離線、重啟、`selection_changed`），手機要等 3 秒才顯示「沒送出」，沒有立即的錯誤。
5. `scripts/check-bundle.sh` 用選項文字比對選擇題答案，很短的選項（如「6 個」）可能誤判成洩漏。
6. `eliminated` 整場只增不減的部分已修（題目離開就清掉），但每次 STATE 仍整包廣播。
7. 大螢幕的選項方塊是 `<button tabIndex={-1}>`，語意上應該是純顯示元素；D8/D9 規格寫 17px 標籤、30px 字母塊，程式是 15px、28px。
8. 房間只剩 1 題時，答錯後逃跑會再抽到同一題，`eliminated` 沒清掉，上次刪掉的選項還是灰的（程式註解說「重新抽到就從頭開始」，這個情況不成立）。正式房間題目多，不會發生。

**Why:** 都不會在一般派對現場發生，或發生時主持人有辦法處理。這次 PR 先修會影響公平的問題（輪次、選項洩漏、大螢幕溢出、兩支手機搶鎖定）。

**Context:** 審查紀錄在 `.gstack/qa-reports/review-20261025-phone/`；設計見 [docs/designs/phone-answering.md](docs/designs/phone-answering.md)。

**Depends on / blocked by:** 第一次真人試玩手機答題後再決定哪些值得做。

---

## 題庫編輯器：載入或儲存途中的編輯會被蓋掉（/review 2026-10-25）

**Priority:** P3

**What:** 按「載入題庫」之後、資料回來之前，題目欄位仍然可以改；載入完成時 `setBank` 直接整包覆蓋，剛改的內容會不見，也沒有「有未儲存的變更」提醒。儲存也一樣（main 上原本就有）：按下儲存後、回應回來前改的內容，會被 `save()` 成功時的 `setBank(versioned.bank)` 換回送出那一刻的版本，版本號照樣前進，下次儲存不會出現 409 提醒。另外兩個小點：`fetch` 沒有逾時，最新一次載入卡住時按鈕會一直停在「載入中…」；非 403 的載入失敗會保留上一把金鑰載到的題庫；載入前開始上傳的圖片，上傳完成時會寫進剛載入的題庫（題目還在就會被下次儲存一起存進去，題目不在了 R2 圖檔就變孤兒）。

**Why:** 一般使用時，載入只要幾百毫秒，又是主持人自己按的，很少撞到。CI 那次失敗是開發模式（StrictMode）重複自動載入造成的，fix-bank-editor-save-race 已用載入序號處理，儲存和載入兩顆按鈕也改成互斥（一個進行中，另一個不能按）。

**Context:** `app/bank-editor/page.tsx` 的 `load()` 和 `save()`；做法可以是載入／儲存中鎖住題目列，或丟棄前先確認未儲存的變更。注意伺服器存的是 `parseBank` 之後的版本，儲存成功時不能直接改成只更新 `version`。

**Depends on / blocked by:** 無。

---

## 逃跑・換房（flee-switch-room）

**What:** 答錯後除了「重答」和「逃跑・同房」，再加一個「逃跑・換房」：跳到另一間房、面對另一隻怪物。

**Why:** 你在 2026-09-18 的 /plan-ceo-review 提出「逃跑可以選擇同一房或換房」。工程審查（/plan-eng-review，T1）決定先延後，改用全域已用題目牌堆解決題目重複，換房是狀態空間最大的新增規則，也還沒有真人測試要求過。

**Pros:** 讓逃跑成為真正的策略選擇，符合設計文件「放棄較高難度換取簡單」的精神。

**Cons:** 每隊需要記錄已通關的房間，「走完」的定義、被放棄的房間難度、`roomIndex` 不再線性都要重新定義，會動到第一輪已驗證的核心。

**Context:** 見 [docs/designs/critical-answer-iteration-2.md](docs/designs/critical-answer-iteration-2.md)「Engineering review decisions」T1。預設草案：換到下一間尚未通關的房、難度為該房基礎難度 −1、回頭打被放棄的房恢復基礎難度。

**Effort:** M（人工約 1-2 天 / CC 約 1 小時）　**Priority:** P3

**Depends on / blocked by:** 第二次真人測試結果、牌堆規則穩定。

---


## 開場與首領房的轉場動畫

**What:** 按下「開始遊戲」後、以及第一隊進入首領房時，各有一段短轉場（例如大門打開、首領登場）。

**Why:** 設計審查 3A 選擇延後（決定 `98cb576b`，完整度 3/10）。上限：中段沒有結構性的高潮，30–60 分鐘的遊戲可能像一個平的循環。

**Pros:** 給一場遊戲節奏起伏，首領登場更有份量。

**Cons:** 要新增場景切換與動畫，還要決定旁白怎麼配合。

**Context:** 觸發條件：第二次玩測有人說「太長」或「沒事件」。

**Effort:** M（人工約 1 天 / CC 約 40 分鐘）　**Priority:** P2

**Depends on / blocked by:** 第二次真人測試結果。

---




## 8 支隊伍的大螢幕版面

**What:** 實測 8 隊同時在線時大螢幕上方隊伍卡的版面，太窄的話改成兩排或縮成頭像加分數。

**Why:** 遊戲最多支援 8 隊，但核准的畫面只有 3 隊。隊伍卡設成可以縮小，8 隊時每張只有約 70px 寬，名稱會被截斷。還沒有實測過。

**Pros:** 避免人多的局大螢幕變得看不清。

**Cons:** 要決定人多時捨棄哪些資訊。

**Context:** 隊伍外觀有 8 種（3 種帽型配 8 種顏色），見 [DESIGN.md](DESIGN.md)。

**Effort:** S（人工約 0.5 天 / CC 約 20 分鐘）　**Priority:** P2

**Depends on / blocked by:** 實測結果。

---

---

## 旁白語氣是否耐聽

**What:** 玩測後檢查 AI 與腳本旁白在一整場裡會不會膩，需要的話擴充腳本句、調提示詞。

**Why:** 真的 API 測試（26 句）事實正確、延遲 1.1 秒，但用詞有重複（「應聲倒地」「智慧之光」出現很多次）。是否耐聽只能靠真人一整場來判斷。

**Pros:** 旁白是這一輪的核心賣點。

**Cons:** 主觀，需要玩測資料（旁白紀錄 JSON 有每句的來源與延遲）。

**Context:** 提示詞在 `lib/narration/llm.ts`，腳本句在 `lib/narration/scripted.ts`。

**Effort:** S（人工約 0.5 天 / CC 約 20 分鐘）　**Priority:** P2

**Depends on / blocked by:** 第二次真人測試結果。

---

## 房間密碼（知道 4 碼代碼的人都能加入）

**What:** 房間可選擇設定一組加入密碼，或由主持人核准每支隊伍。

**Why:** 2026-09-21 的 /cso 審計：隊伍身分已加上密鑰，別人不能冒用既有隊伍，但知道代碼的人仍可加入、把 8 個隊伍名額佔滿，也可以在伺服器重啟後搶先認領主持人（主持人金鑰是第一個認領者贏，屬於已接受的設計，工程審查 T2）。

**Pros:** 公開網址之後才不會被路人搗亂。

**Cons:** 多一步加入手續；區網朋友聚會用不到。

**Context:** 見 `lib/room/dungeon-room.ts` 的 `handleJoin` 與 `handleHostClaim`。已經加上的：每隊密鑰、每房間 60 條連線上限。

**Effort:** S（人工約 0.5 天 / CC 約 20 分鐘）　**Priority:** P3（公開部署之前升 P1）

**Depends on / blocked by:** 正式部署（見上）。

---

## 「下一句這樣說」：主持人指定下一句旁白

**What:** 主持人在 `⚙ 更多` 輸入一句話，下一次旁白一定會把它自然地說出來，說完就用掉（一次性）。

**Why:** 第二次玩測（2026-09-21）的旁白紀錄顯示，主持人把「下一句是 不怕死的冒險者不知道珍珠是什麼意思？能吃嗎?」寫進導演筆記，但旁白完全沒說。原因是導演筆記在設計上只是語氣和風格的指示，不是逐字台詞。導演筆記的第二條「貨幣是什麼能吃嗎」拖到後記才出現。「改寫目前旁白」也不一樣：它換掉已經出現的那一句，不能預先安排下一句。

**Pros:** 主持人可以臨場插入笑點或情境梗；跟導演筆記（風格）和改寫（事後修正）分工清楚。

**Cons:** 要決定 AI 怎麼「自然地」放進去（要求必須包含這句，還是改寫過也行）、腳本旁白怎麼處理（直接當第一句？）、以及沒開 AI 時是否還有意義。

**Context:** 見 `lib/narration/llm.ts` 的 `buildPrompt`、`lib/room/dungeon-room.ts` 的 `HOST_SET_NOTES` 處理。順手做：導演筆記欄位的說明改成「語氣與風格，不是逐字台詞」。

**Effort:** S（人工約 0.5 天 / CC 約 30 分鐘）　**Priority:** P2

**Depends on / blocked by:** 下一個階段再做（2026-09-21 決定）。


---




## 主持人頁的大螢幕網址要能直接點開

**What:** 主持人頁「更多」面板裡的大螢幕網址（`/room/<代碼>/screen`）改成可以點的連結，在新分頁開啟。現在只是一行文字（`app/room/[code]/host/page.tsx` 的「大螢幕（在電視或投影機開這個網址）」區塊），只能手動複製。

**Why:** 主持人常常用同一台電腦接電視或投影機，點一下就能開大螢幕，不用複製貼上或手打網址。

**Pros:** 改動很小，只要把文字包成 `<a href target="_blank" rel="noopener">`；開場準備少一個步驟。

**Cons:** 在手機上點開會跳離主持人頁，要用新分頁開，主持人頁才不會斷線。網址不含主持人 token，公開也沒關係。

**Context:** 2026-10-24 使用者在活地圖上線後提出。可以順便考慮加一個「複製網址」按鈕，但使用者只要求可以點擊開啟。改 UI 前要先給 PNG。

**Effort:** S（人工約 30 分 / CC 約 5 分鐘）　**Priority:** P2

**Depends on / blocked by:** 無。

---

## Completed

## 首領房的選擇題規則重新設計（手機作答之後）

**What:** 手機鎖定作答上線後，重新想首領房的規則。至少要處理：首領房大家共用一題，三隊各答錯一個都選重答，第四隊上場只剩正解，白拿一刀（可能就是拿擊殺獎勵的那刀）。

**Why:** 手機作答設計的 premise 7 說首領房這輪先照一般房間的規則，之後重新設計。工程審查 E8 使用者選「接受，等首領房重新設計」，這條就是那個「之後」。

**Pros:** 首領房的公平性有地方追；E8 的上限和升級條件寫在一起。

**Cons:** 會動 `lib/game-state.ts` 的首領分支，可能也要改 `/play`、`/screen` 的首領畫面（先給 PNG）。

**Context:** 2026-10-24 `/plan-eng-review` of `docs/designs/phone-answering.md`：E6（整場一張「已答錯選項」表，按題目編號）、E8（只剩一個選項時不換題）。從 `lib/game-state.ts` 的首領答錯分支（約 439 行，`nextBossQuestionId`）開始看。

**Effort:** M（人工約 1 天 / CC 約 30 分鐘，不含討論）　**Priority:** P3

**Depends on / blocked by:** 手機作答 PR 1 上線、真的玩過一輪。

**Completed:** v0.15.0.0 (2026-10-26)。首領房選擇題答錯一律換題（D1=A），而且不再問重答／逃跑：紅格停 2 秒後自動換題、輪下一隊（D2=B）。首領題庫維持獨立、所有題算難度 5、題型仍是四選一（D3=A）。見 [docs/designs/phone-answering.md](docs/designs/phone-answering.md) 的「首領房規則（v0.15）」。

---

## 題庫改成依分數分類，房間依需要的難度抽題

**What:** 題庫不再是「每房一組題」，改成「每種分數（1–5）一組題」的大題庫，每個房間依自己的難度去對應分數的題庫抽題。隊伍逃跑後分數降 1，換題時就抽降級後那個分數的題（使用者 2026-10-25 選 D9=A）。同時讓 `lib/game-state.ts` 的 `deal()` 在沒有空題時，寧可發回這隊自己剛逃的題，也絕不發別隊手上的題。另外每場開局時在 server 端打亂每題的選項順序（`correctIndex` 跟著換，快照、`restore()`、公布答案的格式都要一起改），並在重寫題目時避開兩種可猜的規律：年份題答案常是「第二早」的年份（r3-q5、r3-q6、r3-q7、r3-q8、r4-q4、r4-q8、boss-q6），以及錯誤選項從答案改出來（r3-q1 的「2357 萬元」、r2-q7 的 2-2-8 排列、boss-q7 的富士山／聖母峰高度）。

**Why:** 現在每房只有 8 題（第一房 12 題），8 隊擠在同一房時有一隊逃跑，`deal()` 找不到沒人拿的題，會發別隊手上的題；別隊答對時大螢幕公布答案，這隊就看到了。分數題庫讓題目多、分數和難度一致，逃跑真的變簡單。

**Pros:** 不會再發重複題；分數＝難度，玩家一看就懂；加題時不用管放哪一房。

**Cons:** 題庫格式、題庫編輯器、`parseBank`、`scripts/check-bundle.sh`、正式環境 BankStore 的舊資料都要轉換，測試要大改。1 分題會被多個房間共用，需要更多 1 分題。

**Context:** 2026-10-25 /ship（PR 2，預設題庫改選擇題）紅隊審查發現第一房 8 題＝`MAX_TEAMS`，8 隊時逃跑會發重複題。使用者選 D8=A：這個 PR 先把第一房加到 12 題，分數題庫跟「重新設計計分」一起做，題庫格式只改一次。選項打亂和可猜規律是同一次紅隊審查第 5 輪的發現，使用者選 D11=A 一起放進這一項。

**Effort:** L（人工約 2–3 天 / CC 約 1–2 小時）　**Priority:** P2

**Depends on / blocked by:** 規則已定（[docs/designs/scoring-and-score-pools.md](docs/designs/scoring-and-score-pools.md)），這一項是那份設計的 PR B：分數池、第 6～8 房與 3 隻新怪物、約 20 題新題、選項洗牌。計分本身（PR A）已在 v0.13.0.0 上線。

---

**Completed:** v0.14.0.0 (2026-10-26)。格式 v2（依難度分的題庫）、選項每場打亂、第 6～8 房與 20 題新題、編輯器分頁，見 [docs/designs/scoring-and-score-pools.md](docs/designs/scoring-and-score-pools.md) 的「PR B as built」。

## 重新設計計分（首領門檻、提早進王房的分數顯示、冠軍怎麼算）

**What:** 一次想清楚計分：(1) 活地圖上線後，有隊伍先進王房，其他隊答對一題就進王房，這時手機和主持人畫面還顯示「9 / 15」和分數條；(2) 要不要告訴玩家「拿滿 15 分就能打王」（手機其實已經顯示 /15）；(3) 冠軍看總分（`lib/game-state.ts` 的 `finishGame`），但打王答對不加分，只有最後一擊有獎勵分。

**Why:** 活地圖的 D9 規則讓「15 分」只對第一隊有意義。三件事互相牽動，分開改會互相矛盾。

**Pros:** 手機、主持人、大螢幕的分數說法一致；冠軍結果不會讓人意外。

**Cons:** 會動到 `/play`、`/host`、`components/pixel.tsx` 的分數條，可能還有 `finishGame` 的勝負規則。改 UI 前要先給 PNG。

**Context:** 2026-10-23 活地圖工程審查 D5：使用者說「先不動分數 之後我們重新研究分數」，D5b 確認這次 PR 不碰 `/play`、`/host`。取代原本的「要不要告訴玩家 15 分」TODO。Codex outside voice 指出冠軍看分數這一點。從 `lib/turn-info.ts` 的 `BOSS_THRESHOLD` 和 `describeTurn().inBoss` 開始看。

**Effort:** M（人工約 1 天 / CC 約 30 分鐘，不含討論）　**Priority:** P2

**Completed:** v0.13.0.0 (2026-10-25)。規則見 [docs/designs/scoring-and-score-pools.md](docs/designs/scoring-and-score-pools.md)：進度分（只有主持人看得到）決定進王房，獎勵分決定冠軍；主持人可以從「更多」把隊伍送進王房。

**Depends on / blocked by:** 活地圖（D9 規則）上線後再做。

---

## 共享大螢幕活地圖

**What:** 大螢幕顯示地城地圖，各隊棋子從房間移到房間，首領房有血條。設計已定案，見 `docs/designs/live-map.md`（2026-10-23 設計審查：地圖條取代隊伍卡、戰爭迷霧、王房開門，並改了一條遊戲規則：有隊伍進王房後，其他隊答對下一題就能進王房）。

**Why:** 讓等待中的隊伍看到對手進度，緩解全域回合制每隊只有 1/N 時間在答題的問題。設計文件 Next Steps 第 8 步原本就列了這項；2026-09-18 審查（E3）選擇先不做，先測氛圍是否為賣點。

**Pros:** `getSpectatorView()` 已回傳各隊房間、分數、首領血量，只剩 UI 工作。

**Cons:** 美術與版面成本高，隊伍數與房間數要能自適應；視覺方向須先由 /plan-design-review 決定。

**Context:** 見同上 CEO plan。房間規則後來由工程審查 T1 改成：所有隊伍共用一條線性房間，最後一房停在原地重複出題，不再追加額外房間。`/screen` 已經上線（題目、怪物、隊伍卡、頒獎台），只是還沒有地圖。

**Effort:** M（人工約 2 天 / CC 約 1 小時）　**Priority:** P2

**Completed:** v0.10.0.0 (2026-10-23)

**Depends on / blocked by:** 視覺方向已定案（/plan-design-review，2026-10-23）。工程審查已完成（/plan-eng-review，2026-10-23），可以開始做。

---

## 背景音樂的低音全部擠在每圈結尾一起響

**What:** `lib/bgm.ts` 的 `songEvents()` 回傳的音符改成依 `start` 排序（或 `lib/bgm-player.ts` 的 `schedule()` 每個聲部分開排），再補一個單元測試確認事件按時間排列。

**Why:** `songEvents()` 先推完所有旋律、再推所有低音，`schedule()` 遇到第一個超出預排範圍的音符就停。結果每圈約 16 秒只聽得到旋律，低音要等旋律全排完才在圈尾一次全部響起（開始時間都已過去）。大螢幕一開音樂就聽得出來。

**Pros:** 一行排序就修好；根因已確認。

**Cons:** 會改變大螢幕聽到的音樂（這正是目的），要人耳確認一次。

**Context:** 2026-10-07 `/ship`（v0.9.15.0，ponytail-audit-cuts）的測試覆蓋稽核發現，main 上本來就有，不是那個分支造成的；當時 e2e 試過，開音樂後只出現 `square` 振盪器、不出現 `triangle`。為了讓那個重構 PR 保持純重構，決定另開 PR 修。

**Effort:** S　**Priority:** P1

**Completed:** v0.9.15.1 (2026-10-07)

**Depends on / blocked by:** 無。

---


## localStorage「讀取，沒有就生成並存起來」邏輯重複

**What:** 把 `useOwnerKey`（`app/bank-editor/page.tsx`）跟 TTS 開關偏好（`app/room/[code]/screen/page.tsx`）裡各自寫一份的「讀 localStorage、沒有就生成一個值存起來」邏輯，抽成一個共用的小工具函式。

**Why:** 純粹 DRY，不是 bug。2026-09-23 比對 `hitster_online` repo 時注意到它把同樣的邏輯抽成 `lib/device-id.ts` 的 `getOrCreatePersistedId(key)`，一行函式，值得抄這個做法。

**Pros:** 少幾行重複程式碼，之後要加第三個用到 localStorage 偏好的功能時直接複用。

**Cons:** 目前只有 2 個地方用到，效益有限；抽出來本身有一點重構風險（要小心兩邊 SSR-hydration-mismatch 的處理方式是否一致）。

**Effort:** XS（人工約 15 分鐘 / CC 約 10 分鐘）　**Priority:** P4

**Depends on / blocked by:** 無。

**Completed:** v0.9.14.0 (2026-10-01)，`lib/stored.ts` 的 `readStored` / `writeStored`，bank editor 與大螢幕都改用它（另見 `lib/room-code.ts` 的 `storedOrCreate`）。

---

## 首領登場的敘事事件（DM 分支回提用）

**Priority:** P2　**Completed:** v0.9.11.0 (2026-09-29)

**What:** 沒有另開新事件（那會多一個 eventId、也要改 runner「每個事件恰好 emit 一次」的契約）：讓隊伍越過首領門檻的那次答對，`correct` 事件多帶 `entersBoss: { branches }`（隊伍一路上的分支選擇，依房間順序）。時序問題自然消失：事件在那次判定當下產生，而共用首領如果已經被打倒，遊戲早就結束了。LLM 旁白會提到踏進首領房並呼應分支選擇；scripted 備用台詞只宣告進入首領房，不硬塞「你選了 X」模板（T4）。見 `lib/narration/events.ts`、`scripted.ts` 的 `BOSS_ENTER_VARIANTS`、`llm.ts` 的 `describeEvent`。

---

## 主持人頁的鍵盤操作

**Priority:** P3　**Completed:** v0.9.10.0 (2026-09-29)

**What:** 主持人頁判分可以用鍵盤：`1` 答對、`2` 答錯・重答、`3` 答錯・逃跑；揭曉答案時 `1` 或 Enter 是「下一題」。按鍵只在對應按鈕可按時生效，加了修飾鍵（Ctrl+1 是瀏覽器切分頁）、長按重複、或正在輸入框（主持人筆記）打字時不作用；對應邏輯在 `lib/host-keys.ts`（單元測試）。有滑鼠的裝置在按鈕上顯示小小的 1/2/3 提示（`aria-hidden`，手機不顯示）。焦點框原本就有（`.px-btn:focus-visible`）。e2e `host-keys.spec.ts` 抓到一個真 bug：`{ ...e }` 不會複製 KeyboardEvent 的 getter，Ctrl+1 會被當成 1，已修正。

---

## 大廳營火

**Priority:** P3　**Completed:** v0.9.12.0 (2026-09-29)

**What:** `/screen` 大廳中央加了一個程式繪製的營火（`lib/pixel-art.ts` 的 `campfire` 精靈，兩格火焰用 CSS 交替閃爍，加上光暈），隊伍角色一半在左、一半在右圍著它跑進來；5 隊以上角色縮小、隊名過長截斷，8 隊也放得下（8 隊時最外側角色會稍微碰到兩側火把）。設計審查 2A 的最後一塊。

---

## 怪物美術：目前只有三張圖

**Priority:** P3　**Completed:** v0.9.13.0 (2026-09-29)

**What:** 第 3–5 房各有自己的角色，不再是換色：迷路史萊姆（藍色，頭上一個大問號）、愛哭幽靈（兩道眼淚、嘴巴扁扁）、守門史萊姆王（紫色，戴王冠拿長矛）。顏色直接畫進精靈（`hue` 設成 0），不再靠 `hue-rotate`，否則王冠、長矛、眼淚也會被換色。`lib/pixel-art.ts` 的 slime 拆成 `slimeBody`／`slimeFace` 共用。注意：題庫編輯器沒有換圖選項，已經存在伺服器上的正式題庫會維持舊的 `sprite`；新圖只套用在重新播種的題庫（`data/question-bank.json`）。

---

## 玩家手機與大螢幕的斷線提示

**Priority:** P2　**Completed:** v0.9.9.0 (2026-09-29)

**What:** 手機和大螢幕網路斷線時顯示「連線中斷，重新連線中…」，連回來就自動消失（休息／過期仍用原本的提示）。手機重新連上後比對斷線前後的 `eventId`：斷線時剛好輪到自己、期間有判定，就顯示「斷線時剛好輪到你們，這一回合被跳過了。」；不是自己的回合就顯示期間進行了幾次判定，10 秒後自動消失。判斷邏輯在 `lib/offline-notice.ts`（單元測試），不需要改協議。e2e `disconnect.spec.ts` 模擬斷線期間主持人判了別隊。移除了 host 頁的 `gstack-shortcut(dec-ac659960)` 標記。

---

## 音效與背景氛圍音樂

**Priority:** P3　**Completed:** v0.9.8.0 (2026-09-29)

**What:** 大螢幕 `/screen` 在開始遊戲、答對、答錯重答、逃跑、打中首領、打倒首領時各播一段 8-bit 音效，跟背景音樂一樣用 Web Audio 即時合成（`lib/sfx.ts`），沒有音檔、沒有授權問題。server 在 STATE 帶 `cue`（由該事件的旁白事件類型決定），大螢幕只在 `eventId` 變大時播一次，重新連線不會重播。音效跟著「🎵 音樂」開關，不另外加按鈕；背景音樂的部分在 v0.9.5.0 完成。

---

## 語音旁白：語音清單還沒載完時到達的旁白會被永久靜默跳過

**Priority:** P3　**Completed:** v0.9.7.0 (2026-09-29)

**What:** `/screen` 的 `speak()` 在語音開著、但語音清單還沒載入時，改成把最後一句存進 `pendingLines`，等 `voiceschanged` 讓 `ttsVoice` 出現後立刻補念；只保留最新一句，關掉語音或房間重置（LOBBY）時清掉。e2e `narration-tts.spec.ts` 用「語音清單一開始是空的」的 stub 重現：沒修時那句永遠不念，修了之後載入語音就念出來。

---

## 房間過期時的關閉碼與提示跟「休息」共用，可能誤導

**Priority:** P3　**Completed:** v0.9.6.0 (2026-09-29)

**What:** 過期改用自己的關閉碼 `4002`（`lib/room/close-codes.ts` 的 `CLOSE_EXPIRED`），三個頁面用 `restKindOf` 分辨，顯示「房間已過期：…上一場遊戲已經清除。重新連線會開一個新的空房間。」；休息（`4001`）的文案不變。兩種都停止自動重連、按「重新連線」恢復。e2e `rested.spec.ts` 加了過期的情境。

---

## 自動重連（非人為）也算活動，理論上可讓房間永不休息

**Priority:** P3　**Completed:** v0.9.6.0 (2026-09-29)

**What:** 不用重構 `handleJoin`／`handleHostClaim`：`/host`、`/play` 的自動重連在 `HOST_CLAIM`／`JOIN` 上帶 `resume: true`（第一次連線、重新整理、按「重新連線」都不帶），房間照常接受、恢復身分，但不把它算成活動。單元測試確認帶 `resume` 的重連不會延後休息（先在沒修的程式上重現失敗），e2e 確認自動重連帶旗標、手動重連不帶。

---

## 增加背景音樂

**Priority:** P3　**Completed:** v0.9.5.0 (2026-09-29)

**What:** 大螢幕 `/screen` 加了背景音樂：一段用 Web Audio API 即時合成的 A 小調 8-bit 地城循環（方波旋律＋三角波低音，`lib/bgm.ts` 是曲子資料、`lib/bgm-player.ts` 負責播放）。跟美術一樣用程式產生，所以沒有素材授權問題、也不用下載音檔。右下角「🎵 音樂」按鈕切換，預設關閉、會記住設定（記住開啟時，重新整理後第一次點擊頁面才開始播，因為瀏覽器規定）；語音旁白在念的時候音樂自動降低音量。只放在大螢幕，手機不播。

---

## 語音旁白：重連時剛好落在 GAME_OVER 到 EPILOGUE 之間會漏念後記

**Priority:** P3　**Completed:** v0.9.4.0 (2026-09-29)

**What:** 採用 server 協議改動：`onConnect` 重送的 EPILOGUE 帶 `replay: true`，即時廣播不帶；`lib/narration/tts.ts` 的 `shouldSpeakEpilogue` 改成只看這個欄位，`/screen` 拿掉 `sawLiveGameOver`。連線落在 GAME_OVER 和後記之間時，後記會正常念出來；重整已結束的遊戲仍然不會重念。

---

## 上傳但從未存檔的題庫圖片會永久留在 R2

**Priority:** P3　**Completed:** v0.9.3.0 (2026-09-29)

**What:** 不用另寫週期性掃描：圖片一上傳成功就排進 v0.9.1.0 做好的延後刪除佇列（`BankStore.queueUploadedImage`，由 `worker/index.ts` 的上傳路徑呼叫 bank DO 的 `imageUploaded`）。期限內被存進題庫的圖，alarm 會看到它還在使用中而把它移出佇列；從沒存檔的（關分頁、當機、409）期限一到就刪。排隊失敗只記 log，不影響上傳本身。

---

## 旁白 emit() 無條件覆蓋 lastNarration，較慢的舊事件可能在新事件之後 resolve 並蓋掉它

**Priority:** P3　**Completed:** v0.9.2.0 (2026-09-29)

**What:** `lib/room/dungeon-room.ts` 的 `emit()` 現在只接受不比目前 `lastNarration` 舊、也不超過 `eventSeq` 的 eventId：較慢才回來的舊事件旁白直接丟掉，不再蓋掉新旁白，也不會被重播給重連的連線；`reset()` 之前留下、在重置後才回來的旁白（eventId 比歸零後的 `eventSeq` 大）也一併丟掉。測試 `drops an older event's narration that resolves after a newer one's` 先在沒修的程式上重現了 bug。

---

## 遊戲進行中在題庫編輯器換圖，會立刻刪掉那一局還在用的 R2 圖片

**Priority:** P2　**Completed:** 2026-09-29

**What:** `BankStore.putBank()` 不再立刻刪掉新題庫沒用到的 R2 圖片，而是把 key 連同刪除時間排進 Durable Object storage 的佇列（`pendingImageDeletes`），等超過房間壽命（`ROOM_EXPIRE_MS`，預設 24 小時，再加 1 小時緩衝）後由 bank DO 的 alarm 呼叫 `runImageCleanup()` 刪除。刪除前會再檢查一次：如果之後的存檔又把這張圖放回題庫（復原），就不刪；拿掉 → 放回 → 再拿掉，會重新計時。已知限制：一局遊戲如果一直有活動、撐超過房間壽命，還是可能丟圖（每次活動都會延後過期），機率很低，先接受。見 `lib/bank-store.ts`、`worker/index.ts` 的 `BankStoreDO.alarm()`。

---

## 修改主頁的背景圖，換成更有特色、更有內容的圖片

**Priority:** P3　**Completed:** v0.9.1.0 (2026-09-28)

**What:** 主頁背景從單純的石牆換成一整幅程式繪製的地城走廊（第一人稱透視）：兩側磚牆延伸進黑暗、木樑天花板掛著鐵鍊與蜘蛛網、兩側牆上會閃爍的火把、盡頭一扇鐵箍木門與兩盞小壁燈，地上有骷髏、骨頭、寶箱和木桶，牆腳長青苔。第一版做的是「月夜城堡外觀」，使用者回饋要「真的有 dungeon 造型」，改成地城內部。素材授權的阻塞點用 DESIGN.md 既有的「全部用程式畫、不放圖檔」原則解掉——沒有圖檔、零授權問題、首頁不多載任何位元組。場景依視窗大小重新計算格數（`homeSceneCell`），每個場景像素都是整數倍的螢幕像素，不再像舊背景那樣被拉伸變形。見 `lib/pixel-art.ts` 的 `drawHomeScene`、`components/pixel.tsx` 的 `HomeBackground`。

---

## 問答題／選擇題的題目可以是圖片／YouTube 影片／文字，並移除獨立的「圖片題」類型；公布解答時可加一段可換媒材的詳解

**Priority:** P2　**Completed:** v0.9.0.0 (2026-09-24)

**What:** 問答題跟選擇題的「題目」本身都可以選擇用文字／圖片／YouTube 影片來呈現（同一題型，換媒材），移除了獨立的「圖片題」類型；公布解答時多一個可換媒材的「詳解」欄位。已透過 `/office-hours` → `/plan-eng-review` → `/review` → `/ship` 完整流程實作，見 [docs/designs/question-media-content.md](docs/designs/question-media-content.md)。審查過程發現並修正多個真實 bug（Durable Object 重啟後 `revealedQuestionIds` 未回填、bank editor 圖片上傳按鈕 id 衝突、切換媒材類型的重複點擊會誤刪內容、公布解答的詳解媒體漏掉 React key 導致壞圖狀態卡住）。

---

## DM 語音旁白（瀏覽器 TTS）

**Priority:** P2　**Completed:** v0.7.0.0 (2026-09-22)

**What:** 大螢幕用瀏覽器內建 Web Speech API（zh-TW 聲音）把旁白念出來，並提供關閉開關。已透過 `/office-hours` → `/plan-eng-review` → `/review` → `/ship` 完整流程實作，見 [docs/designs/dm-voice-narration-tts.md](docs/designs/dm-voice-narration-tts.md)。審查過程發現並修正兩個真實 bug（重播誤判導致語音修正被靜默吞掉、`zh-Hant-HK`/`zh-Hant-MO` 誤判為台灣腔），另有兩個較低嚴重度的邊角案例延後為 P3 待辦項目（見上方「語音旁白：…」兩項）。

---

## 題庫編輯器：image 題型 + Cloudflare R2 上傳

**Priority:** P3　**Completed:** v0.6.0.0 (2026-09-22)

**What:** 實作 Cloudflare R2 bucket binding、圖片上傳表單、`image` kind 的 schema、`/play` 顯示圖片。已在 `image-question-type` 分支完成（image kind schema、R2 綁定、上傳 API、bank editor 上傳表單、`/play`・`/screen` 顯示圖片）。

---

## 題庫覆核：AI 起草的 8 題

**Priority:** P1　**Completed:** 2026-09-23 (docs-only PR #23, no version bump — between v0.7.1.0 and v0.7.2.0)

**What:** 每房最後 5 題和首領最後 3 題（共 28 題）是 AI 起草的台灣常識題，需要人工查證答案。

**Why:** 作者沒辦法上網查證。主持人在現場發現答案錯了會很尷尬，也會傷害玩家對答案的信任。

**Context:** [data/question-bank.json](data/question-bank.json)。每房前 3 題（2026 年時事）來自第一輪題庫，不在這次查證範圍內。

**查證結果：** 28 題逐題用 WebSearch 查證，**全數正確，沒有發現任何答案錯誤**。兩個答案用詞可以更精確但不算錯（`r1-q5` 阿里山森林鐵路主要跨嘉義市與嘉義縣，答案「嘉義縣」是通俗但合理的簡化；`r2-q5` 太魯閣峽谷地質範圍橫跨花蓮／台中／南投三縣市，答案「花蓮」是最廣為人知的所在地）——兩者都不影響遊戲使用，不需要改。

---

## 題庫編輯器：multipleChoice 題型

**Priority:** P3

**What:** 給 `PublicQuestion`（`lib/protocol.ts`）加 `options` 欄位、`/play` 加選項渲染與選擇訊息、host 判分邏輯支援選項判分，然後題庫 schema 才能真的加回 `multipleChoice` kind。

**Why:** `question-bank-editor` PR 的 outside-voice 審查發現一個 P0：原設計想先建 `multipleChoice` 的 schema/CRUD，但遊戲引擎目前完全沒有能力播放它（`PublicQuestion` 只有 `text` 欄位，整個判分流程是「host 念題目、host 判斷對錯」，沒有選項渲染/選擇/判分邏輯）。先建一個沒有消費者的題型只是空的「可擴充性」。這輪因此把 `multipleChoice` 全部切掉，只做 `text` 題型的編輯器。

**Context:** 見 [docs/designs/question-bank-editor.md](docs/designs/question-bank-editor.md) 的 NOT in scope 段落與 Revision note，以及本項完成時新增的 [docs/designs/multiple-choice-questions.md](docs/designs/multiple-choice-questions.md)。

**Completed:** v0.5.0.0 (2026-09-22)。`lib/question-bank.ts` 的 `kind` 判別聯集、`lib/protocol.ts` 的 `TEAM_SELECT_OPTION`、`lib/game-state.ts` 的 `Team.currentSelection`/`recordOptionSelection`、`lib/room/dungeon-room.ts` 的 `handleTeamSelectOption`、`/play` 選項渲染、`/host` 選擇高亮、題庫編輯器的題型切換 UI，全部完成並有測試覆蓋（433 單元測試 + e2e）。

---

## 斷線重連 / 狀態持久化完整方案

**What:** 設計真正的斷線重連與遊戲狀態持久化方案（目前決定：第一輪純 in-memory，伺服器重啟整場遊戲遺失）。

**Why:** 現在的決定只適合第一輪小規模真人測試（朋友聚會、幾十分鐘一場），正式上線後伺服器意外重啟會毀掉整場進行中的遊戲，不適合正式難度。

**Pros:** 提升正式上線後的可靠度；玩家手機斷線也能無縫恢復。

**Cons:** 需要選定持久化層（檔案/SQLite/其他），增加實作與測試複雜度。

**Context:** 見 [docs/designs/critical-answer-party-game.md](docs/designs/critical-answer-party-game.md) 的 Open Questions 與 Architecture Review（/plan-eng-review, 2026-09-17）。決策記錄在該次審查的問題 1B。

**Depends on / blocked by:** 需先完成第一輪範圍（狀態機 + 首領回合制 + 輕量真人測試），驗證玩法後再投入持久化工程。

**Completed:** v0.2.0.0 (2026-09-22)。由 persist-room-state PR（Durable Object 儲存、還原、重連）與 room-lifecycle PR（閒置關連線、24 小時過期）共同完成，見 `lib/room/dungeon-room.ts` 的 `persist()`／`restore()`／`onAlarm()`。

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

**Completed（改走替代方案）：** v0.2.0.0 (2026-09-22)。沒有等到 PartyKit 修復，改走上面列的替代方案：繞過 partykit CLI，直接用 `partyserver` + `wrangler` 部署成原生 Cloudflare Worker + Durable Object（cf-minimal-room PR 起）。房間已部署在 `https://critical-answer.aiko-studio.workers.dev`。

---

## 房間重啟時對 BankStore 發出用不到的 RPC

**Priority:** P3

**What:** `worker/index.ts`'s `Room.onStart()` 在每次房間喚醒時都呼叫 `bankOrFallback(() => ...getVersionedBank())`，但如果這個房間是「復原」（不是全新建立），緊接著的 `this.game.restore()` 會用房間自己存的 snapshot 覆蓋掉這個 RPC 結果——等於每次已存在房間醒來都白打一通 BankStore 的電話。

**Why:** `/review` adversarial pass（Claude subagent，2026-09-22）發現的：不是正確性問題（`bankOrFallback` 的容錯已經保護了它），純粹是多餘的延遲跟對 BankStore 可用性的非必要依賴——跟決策 7「房間不該依賴 BankStore 存活」的精神有點矛盾。

**Pros:** 修掉可以省一次 DO-to-DO 呼叫的延遲，也讓「已存在房間的喚醒完全不碰 BankStore」這件事名副其實。

**Cons:** 需要重排 `onStart()`/`restore()` 的順序（先確認 storage 有沒有既有 snapshot，再決定要不要打這通 RPC），改動比表面看起來大一點，且目前的浪費只是效能成本，沒有正確性風險。

**Context:** 見 [docs/designs/question-bank-editor.md](docs/designs/question-bank-editor.md) 決策 7，以及 `worker/index.ts` 的 `Room.onStart()`。

**更新（2026-10-03，維護輪 /plan-eng-review）：** 不能直接「有存檔就不抓」。`lib/room/dungeon-room.ts` 的 `reset()` 會用醒來時抓到的 `initialBank` 開新局，跳過抓取會讓閒置過期後重開的房間改用內建題庫，你在編輯器改的題目就不見了。正確修法是懶載入：`DungeonRoom` 收一個 `loadBank`，只在沒有存檔、存檔壞掉、`reset()` 時呼叫。決定（dec-f5965fd8）：先不做；`worker/index.ts` 的 `onStart()` 有 `gstack-shortcut` 標記。升級觸發點：房間喚醒延遲或 BankStore 可用性成為實際問題。

**Depends on / blocked by:** 無，隨時可做，非阻塞。
