# TODOs

## 索引

### P1

- [11/21 前在活動用的大螢幕瀏覽器實測 YouTube 聲音](#1121-前在活動用的大螢幕瀏覽器實測-youtube-聲音) — S（人工約 20 分鐘，要真機）

### P2

- [美術改版：冒險者野餐桌](#美術改版冒險者野餐桌) — L（人工約 1–2 週 / CC 約 1–2 天）
- [bank-editor 兩個 e2e 測試在 CI 偶發失敗](#bank-editor-兩個-e2e-測試在-ci-偶發失敗) — S
- [AI key 的錯誤會被之後的狀態訊息蓋掉](#ai-key-的錯誤會被之後的狀態訊息蓋掉) — S
- [平衡五個職業：盜賊太強，法師和戰士太弱](#平衡五個職業盜賊太強法師和戰士太弱) — M（人工約 1 天 / CC 約 1 小時）
- [等待隊伍的觀眾反應（表情 / 加油 / 噓聲）](#等待隊伍的觀眾反應表情--加油--噓聲) — M（人工約 2 天 / CC 約 1 小時）
- [開場與首領房的轉場動畫](#開場與首領房的轉場動畫) — M（人工約 1 天 / CC 約 40 分鐘）
- [旁白語氣是否耐聽](#旁白語氣是否耐聽) — S（人工約 0.5 天 / CC 約 20 分鐘）
- [新題型：排序題](#新題型排序題) — M（人工約 3 天 / CC 約 1.5 小時）
- [反 AI 作弊：玩家用手機問 AI 查答案](#反-ai-作弊玩家用手機問-ai-查答案) — 未定（先決定做法）

### P3

- [把「冒險出現岔路」的選擇加回玩家手機](#把冒險出現岔路的選擇加回玩家手機) — S
- [遊戲開始後，新隊伍可以中途加入](#遊戲開始後新隊伍可以中途加入) — M
- [主持人開房時可以用自己的題庫](#主持人開房時可以用自己的題庫) — L
- [題目比隊伍少時，兩隊可能一直拿同一題](#題目比隊伍少時兩隊可能一直拿同一題) — S
- [題庫讀不懂期間的小問題](#題庫讀不懂期間的小問題) — S
- [OpenRouter 一鍵登入拿 key，手機主持人不用複製貼上](#openrouter-一鍵登入拿-key手機主持人不用複製貼上) — M
- [加入密碼沒有猜錯次數限制](#加入密碼沒有猜錯次數限制) — S
- [後進王房的隊伍，旁白還在說「推開最後一道門」](#後進王房的隊伍旁白還在說推開最後一道門) — S（人工約半天 / CC 約 15 分鐘）
- [CI 在 Ubuntu 26 上試跑一次，通過再換掉固定的 ubuntu-24.04](#ci-在-ubuntu-26-上試跑一次通過再換掉固定的-ubuntu-2404) — S
- [手機答題模式（選擇題 + 自動判定）](#手機答題模式選擇題--自動判定) — L（人工約 1 週 / CC 約半天）
- [手機答題的剩餘小風險（/review 2026-10-25）](#手機答題的剩餘小風險review-2026-10-25) — 未註明
- [手機顯示題目的剩餘小風險（/ship 2026-10-29）](#手機顯示題目的剩餘小風險ship-2026-10-29) — 未註明
- [題庫編輯器：載入或儲存途中的編輯會被蓋掉（/review 2026-10-25）](#題庫編輯器載入或儲存途中的編輯會被蓋掉review-2026-10-25) — 未註明
- [逃跑・換房（flee-switch-room）](#逃跑換房flee-switch-room) — M（人工約 1-2 天 / CC 約 1 小時）
- [魔王分階段的兩個小瑕疵（/qa 2026-10-28）](#魔王分階段的兩個小瑕疵qa-2026-10-28) — 未註明
- [地城料理風格 3：旁白用美食節目／生物學家口吻](#地城料理風格-3旁白用美食節目生物學家口吻) — S（人工約半天 / CC 約 20 分鐘）
- [上架手機版本](#上架手機版本) — PWA S（人工約半天 / CC 約 30 分鐘）；上架 L（人工約 1–2 週 / CC 約半天，不含審核）
- [每次行動可以選不同的動作，不只答題](#每次行動可以選不同的動作不只答題) — 未註明
- [每個職業有自己的動畫和音效](#每個職業有自己的動畫和音效) — 未註明
- [法師填空題提示：答案帶註記時第一個字會誤導](#法師填空題提示答案帶註記時第一個字會誤導) — 未註明
- [主持人按錯「答錯」可以改回答對](#主持人按錯答錯可以改回答對) — 未註明
- [旁白念出戰士擲到幾點](#旁白念出戰士擲到幾點) — 未註明
- [房間最多只能存在 6 小時](#房間最多只能存在-6-小時) — S（人工約半天 / CC 約 20 分鐘）
- [不檢查房間代碼格式，任何名字都能開出新房](#不檢查房間代碼格式任何名字都能開出新房) — S（人工約 2 小時 / CC 約 15 分鐘）
- [一條連線能佔滿 8 隊，60 條連線能鎖死房間](#一條連線能佔滿-8-隊60-條連線能鎖死房間) — S/M
- [每則訊息都把整個房間序列化一次，而且沒有速率限制](#每則訊息都把整個房間序列化一次而且沒有速率限制) — S（人工約半天 / CC 約 30 分鐘）
- [HOST_AI_KEY 能被拿來批次驗證偷來的 Anthropic key](#host_ai_key-能被拿來批次驗證偷來的-anthropic-key) — S（人工約 2 小時 / CC 約 20 分鐘）
- [填空題可以有好幾個要填的欄位](#填空題可以有好幾個要填的欄位) — M（人工約 2 天 / CC 約 1 小時）
- [房間除了問答怪物，還有事件卡（像大富翁的機會／命運）](#房間除了問答怪物還有事件卡像大富翁的機會命運) — M（人工約 2-3 天 / CC 約 1.5 小時）
- [⭐ 靈感：主持人給，下一次擲骰取優勢](#-靈感主持人給下一次擲骰取優勢) — S
- [玩家自己選攻擊或說服](#玩家自己選攻擊或說服) — M
- [說服檢定的剩餘小風險（/ship 2026-11-06）](#說服檢定的剩餘小風險ship-2026-11-06) — S
- [在全新的 Cloudflare／Vercel 帳號上照部署指南做一遍](#在全新的-cloudflarevercel-帳號上照部署指南做一遍) — S（人工約 2 小時 / CC 約 30 分鐘）
- [開場擲先攻，取代固定的輪流順序](#開場擲先攻取代固定的輪流順序) — S（人工約半天 / CC 約 30 分鐘）
- [旁白訊息依場次區分](#旁白訊息依場次區分) — S

### P4

- [Host 自訂題庫文字進 LLM prompt 前的內容審核](#host-自訂題庫文字進-llm-prompt-前的內容審核) — 未註明
- [量 e2e 對前端（app/、components/）的實際覆蓋率](#量-e2e-對前端appcomponents的實際覆蓋率) — M
- [開發工具鏈剩 5 個 npm audit 漏洞（上游沒有修補版）](#開發工具鏈剩-5-個-npm-audit-漏洞上游沒有修補版) — S
- [/health 補上死碼與 shell 腳本檢查](#health-補上死碼與-shell-腳本檢查) — S
- [ESLint 10 / TypeScript 7 升級被上游卡住](#eslint-10--typescript-7-升級被上游卡住) — 不確定（等上游）

---

## 11/21 前在活動用的大螢幕瀏覽器實測 YouTube 聲音

**What:** 在活動當天真的會接大螢幕的那台電腦或電視瀏覽器上，開一個房間，主持人按 ▶ 播一題影片題和一題聽歌題，確認有畫面也有聲音。

**Why:** v0.38.0.0 的 YouTube 播放器靠主持人按鍵觸發，大螢幕本身沒有人點。Safari 和電視瀏覽器的自動播放限制可能把聲音擋掉，CI 的 e2e 用的 Chromium 測不出來。

**Context:**
- 播放器在 `components/youtube-player.tsx`，聲音要開之前大螢幕要先有一次使用者操作（看 BGM 的解鎖方式）。
- 如果被擋：先在大螢幕點一下畫面再開始遊戲，或改用 Chrome。

**Effort/Priority:** S（人工約 20 分鐘，要真機）/ P1，期限 2026-11-21 活動前

**Depends on:** 無，v0.38.0.0 已上線。

**Notes:**
- Pros：活動當天不會在第一題影片題才發現沒聲音。
- Cons：只能人工測，沒辦法放進 CI。

---

## 美術改版：冒險者野餐桌

**What:** 照 2026-11-07 定案的「冒險者野餐桌」重畫畫面。大螢幕是俯瞰的野餐桌：綠格紋桌巾（`#2f4a3c`，用 CSS 畫）、頂端曬衣繩地圖（各隊三角旗）、紙卡各自歪 ±1.5° 加可可色偏移影子、怪物保留像素圖但做成白邊貼紙、A–D 答案卡用番茄 `#f2735a`／蛋黃 `#f6c445`／豌豆 `#8fc76a`／藍莓 `#7b96e0` 四色、旁白紙薄荷 `#cdebd5`、文字一律可可 `#3b2a20`。

**Why:** 站長 2026-11-07 在 /design-consultation 比過 8 種地城美術風格和 3 個暖色童書提案（Codex、獨立子代理、Claude）後定案這一版（原本的方向 A、暖色地城風格 2 都併進來）。

**Context:**
- 定案圖：`~/.gstack/projects/critical-answer/designs/art-style-survey-20261107/warm-1.png`（只在本機）；比較圖在同一資料夾
- `DESIGN.md`、`app/globals.css`、`lib/pixel-art.ts`、`components/pixel.tsx`

**Effort/Priority:** L / P2

**Depends on:** 11/21 活動之後。

**Notes:**
- 待決定：答案要不要改叫「番茄／蛋黃／豌豆／藍莓」（會動到手機、主持人頁和旁白用語），還是只換顏色、保留 ABCD。
- 待驗證：子代理提的字型 jf open 粉圓 2.0（Huninn）、芫荽 Iansui、Fredoka 的授權和檔案大小。中文字集要用常用字表裁切，不能用題庫的字（會洩漏答案，同 `check:bundle`）。
- 長題目：題目字放大後約 15 字就會換行，要自動縮字，不能壓到怪物。
- 開始實作時把 DESIGN.md 整份改成這套規格。

---

## AI key 的錯誤會被之後的狀態訊息蓋掉

**What:** 遊戲中換一把錯的 key，`invalid_key` 只跟著這把 key 的回覆送一次。下一句 AI 旁白的 `spend()` 又送一次 `HOST_AI_STATUS`，沒有錯誤，就把它蓋掉了。主持人看不到 key 被拒。

**Why:** 伺服器把每把 key 的錯誤（`invalid_key`、`wrong_owner_key`、`owner_unavailable`）只當成單次訊息，沒存進 `aiError`。ai-key flake 的修正只排好了面板自己送的訊息順序（先上限、後 key），擋不住伺服器自己送的狀態。

**Context:**
- `lib/room/dungeon-room.ts`（`handleAiKey`、`sendAiStatus`、`spend`）
- `components/host-ai.tsx`

**Effort/Priority:** S / P3

**Depends on:** 無。

**Notes:**
- 做法：把最後一把 key 的錯誤存起來，直到下一個 `HOST_AI_KEY` 才清掉。
- 同一處的另一個問題：主持人頁收到 `HOST_AI_STATUS` 時，判斷「這把 key 已套用」（`app/room/[code]/host/page.tsx`，`applied`）不看 `msg.error`。房間已經用站長金鑰時，打錯的 OWNER_KEY 會被當成已套用，勾了記住這台電腦還會存進 localStorage，之後每次 HOST_OK 都重送。修法：有這把 key 的錯誤時不算套用。
- 2026-11-06 /review（ai-key flake 修正）的對抗審查找到。

---

## bank-editor 兩個 e2e 測試在 CI 偶發失敗

**What:** `e2e/bank-editor.spec.ts:355`（伺服器驗證失敗要顯示錯誤）和 `:871`（菜填一半要擋下）在 main 的 CI run 42145135761（v0.33.0.0）各失敗一次：等 5 秒，`bank-editor-error` 都沒出現。

**Why:** 同一份程式碼在其他 CI 都通過，所以是 flaky。失敗時的頁面快照顯示，測試剛清空的欄位又變回伺服器上的值，所以存進去的是合法題庫。

**Context:**
- `app/bank-editor/page.tsx`（`useOwnerKey` 自動載入、`load()` 的 `loadSeq`）
- `e2e/bank-editor.spec.ts`

**Effort/Priority:** S / P2

**Depends on:** 無。

**Notes:**
- 已排除：CI 同時跑多組（兩個 shard 各有自己的 wrangler 和 next dev）、v0.33 的改動。
- 2026-11-06 在 CI 上用探針重跑 5 次都沒重現。同一批探針抓到 `e2e/ai-key.spec.ts:9` 的原因（另外修）。
- 下一步：再失敗時看頁面有沒有中途重新載入。記住的 owner key 會讓頁面自動再載入一次，蓋掉剛做的編輯。

---

## 平衡五個職業：盜賊太強，法師和戰士太弱

**What:** 調整職業的數字，讓五個職業（法師、牧師、戰士、盜賊、廚師）的勝率差不多。

**Why:** 廚師做完後（v0.44.0.0）跑了 `node scripts/balance-sim.ts 20000`：20,000 場、每場 4 隊，勝率（公平是 25%）盜賊 41.2%、牧師 31.2%、廚師 29.8%、法師 18.2%、戰士 15.4%、沒選職業 14.4%。站長 2026-11-07 決定廚師先上線，平衡另開一個 PR。

**Context:**
- `scripts/balance-sim.ts`：模擬用真的 `lib/game-state.ts`。題目全是四選一，答對機率是「會的機率（依難度）＋猜中剩下選項」。技能用在難度 4 以上和首領房；戰士只在擲骰比答題划算時擲。換策略會改數字，調參前先看策略合不合理。
- `lib/game-state.ts`：`ABILITY_USES`、`WARRIOR_TARGET`、`CHEF_BONUS_PERCENT`、`CHECK_BONUS`，盜賊偷襲在 `answerQuestion`（`killBonus` 乘 `sneak`）。
- `docs/designs/class-abilities.md`（「廚師」一節）、`docs/rules.md` 和 `docs/rules.en.md`。

**Effort/Priority:** M / P2

**Depends on:** 無。

**Notes:**
- 可以試的方向：盜賊偷襲不加倍首領的 4d20；戰士門檻從 12 降到 10 或 11；法師多一次使用；每改一項就重跑模擬。
- 每個數字都要站長決定。真正的玩家用技能的方式和模擬不同，活動後可以拿真實紀錄再對一次。

---

## 等待隊伍的觀眾反應（表情 / 加油 / 噓聲）

**What:** 等待中的隊伍在手機上點表情，大螢幕浮現，DM 旁白可提到。

**Why:** 全域回合制每隊只有 1/N 時間在答題，其餘時間手機只是被動畫面（審查 E5）。若第二次測試後「等待太無聊」仍是主要抱怨，這是首選解法。

**Context:**
- `docs/designs/phone-answering.md`

**Effort/Priority:** M（人工約 2 天 / CC 約 1 小時） / P2

**Depends on:** 第二次真人測試結果。

**Notes:**
- Pros：手機從只看狀態變成有事可做；可餵給 DM 旁白。
- Cons：新增玩家輸入面，需要限頻、防洗版與不當內容處理。
- Context 補充：見同上 CEO plan。新增 `REACT` 訊息，伺服器限頻後廣播。另一個做法（Codex 的「燈籠」點子，`docs/designs/phone-answering.md`）：等待隊伍在別隊答題時偷偷鎖一個預測，揭曉時在大螢幕顯示，猜對的累積成打首領用的共用燈籠。

---

## 開場與首領房的轉場動畫

**What:** 按下「開始遊戲」後、以及第一隊進入首領房時，各有一段短轉場（例如大門打開、首領登場）。

**Why:** 設計審查 3A 選擇延後（決定 `98cb576b`，完整度 3/10）。上限：中段沒有結構性的高潮，30–60 分鐘的遊戲可能像一個平的循環。

**Context:**
- 原文未列檔案路徑。

**Effort/Priority:** M（人工約 1 天 / CC 約 40 分鐘） / P2

**Depends on:** 第二次真人測試結果。

**Notes:**
- Pros：給一場遊戲節奏起伏，首領登場更有份量。
- Cons：要新增場景切換與動畫，還要決定旁白怎麼配合。
- Context 補充：觸發條件：第二次玩測有人說「太長」或「沒事件」。

---

## 旁白語氣是否耐聽

**What:** 玩測後檢查 AI 與腳本旁白在一整場裡會不會膩，需要的話擴充腳本句、調提示詞。

**Why:** 真的 API 測試（26 句）事實正確、延遲 1.1 秒，但用詞有重複（「應聲倒地」「智慧之光」出現很多次）。是否耐聽只能靠真人一整場來判斷。

**Context:**
- `lib/narration/llm.ts`
- `lib/narration/scripted.ts`

**Effort/Priority:** S（人工約 0.5 天 / CC 約 20 分鐘） / P2

**Depends on:** 第二次真人測試結果。

**Notes:**
- Pros：旁白是這一輪的核心賣點。
- Cons：主觀，需要玩測資料（旁白紀錄 JSON 有每句的來源與延遲）。
- Context 補充：提示詞在 `lib/narration/llm.ts`，腳本句在 `lib/narration/scripted.ts`。

---

## 反 AI 作弊：玩家用手機問 AI 查答案

**What:** 想辦法讓隊伍沒辦法（或不值得）在作答時用手機問 ChatGPT 之類的 AI 查答案。

**Why:** 站長 2026-11-06 提出。玩家手上本來就拿著手機作答，問 AI 只要幾秒，知識題會變成比誰打字快。

**Context:**
- 題目在手機上看得到（`app/room/[code]/play/page.tsx`），可以直接複製或拍照問 AI。
- 比較難問 AI 的題型：聽歌題（`docs/designs/youtube-questions.md`，手機上沒有影片，只能聽）。但有漏洞：房間把同一份 STATE 送給每個連線，裡面有 YouTube 影片 id，玩家用開發工具拿到 id 就能查影片標題，標題常常就是答案。不登入的 /screen 也一定要拿到 id 才能播，所以要封住得先給大螢幕加驗證（/review 2026-11-06 D25，接受的風險）。
- 可能的方向（還沒評估）：作答時間限制、手機不顯示題目文字只看大螢幕、多出 AI 答不好的題（聽歌、圖片、現場知識）、主持人規則。

**Effort/Priority:** 未定 / P2

**Depends on:** 先決定做法（規則面還是程式面）。

**Notes:**
- Pros：保住知識題的公平性。
- Cons：完全擋不住（玩家可以用第二支手機）；做太嚴會影響正常作答體驗。

---

## 新題型：排序題

**What:** 新增第三種題型「排序題」。題目給四個項目，隊伍要依照規則把它們排成一列，例如「四個角色依年齡由大到小排」。排序規則和正確順序在建立題目時決定。

**Why:** 2026-10-26 使用者提出。比四選一更需要討論，適合隊伍一起想；同一組項目換個規則（年齡、出道年份、身高）就能變成新題目。

**Context:**
- `lib/question-bank.ts`
- `app/room/[code]/play/page.tsx`
- `lib/room/dungeon-room.ts`
- `app/bank-editor/page.tsx`

**Effort/Priority:** M（人工約 3 天 / CC 約 1.5 小時） / P2

**Depends on:** 無。使用者 2026-10-26 說先記下，之後再排。

**Notes:**
- Pros：可以重用選擇題已有的四格版面和每局打亂選項（`shuffledOptionOrders`）；答案可以自動判定，主持人不用按答對。
- Cons：要決定的事：手機上怎麼排（拖拉或依序點選）；要全對才算對，還是排對幾個給部分分；大螢幕怎麼公布正確順序；題庫編輯器要多一種題型的編輯畫面；`parseBank` 的驗證要支援新題型；題庫格式變了，要把 `lib/bank-store.ts` 的 `BANK_FORMAT` 加 1，舊版本才會把新題庫當成讀不懂、不會存檔時把排序題弄丟。
- Context 補充：題型定義在 `lib/question-bank.ts`（`BankQuestion` 目前只有 `text` 和 `multipleChoice`，驗證在 `parseQuestions`）。手機作答在 `app/room/[code]/play/page.tsx`，選擇題的鎖定和判定在 `lib/room/dungeon-room.ts`（`TEAM_SELECT_OPTION` / `TEAM_LOCK_OPTION`）。題庫編輯器在 `app/bank-editor/page.tsx`。改 UI 前要先給 PNG。

---

## 把「冒險出現岔路」的選擇加回玩家手機

**What:** v0.27.1.0 先把手機上「冒險出現岔路，你們要怎麼做？」拿掉了。改遊戲進行方式時，討論要不要、怎麼加回來。

**Why:** 站長 2026-11-04 實測後決定先拿掉，玩法還沒定案。

**Context:**
- `lib/game-state.ts`
- `lib/narration/llm.ts`
- `app/room/[code]/play/page.tsx`

**Effort/Priority:** S / P3

**Depends on:** 「每次行動可以選不同的動作」那類玩法改動。

**Notes:**
  - Context 補充：v0.31.3.0（稽核清理）把伺服器端也拿掉了：`TEAM_BRANCH_CHOICE` 訊息、`lib/game-state.ts` 的 `recordBranchChoice`、`firstPendingBranchRoom`、`BRANCH_OPTIONS`、`BRANCH_LABELS`、隊伍的 `branchChoices`，還有首領房旁白（`lib/narration/llm.ts`）呼應岔路選擇的那句。
  - 加回來時要從 git 歷史把它們找回來（`git log -S recordBranchChoice`），再把 `app/room/[code]/play/page.tsx` 的面板接回去。

---

## 遊戲開始後，新隊伍可以中途加入

**What:** 遊戲開始後有新隊伍要加入時，手機先顯示「等主持人讓你們加入」，主持人頁出現「收這隊」。收了以後，這隊從第一間房開始，排在輪流順序的最後。

**Why:** 現在開始後新隊伍一律被擋下（`game_already_started`），遲到的朋友只能在旁邊看（2026-11-04 盤點功能缺口時找到）。

**Context:**
- `lib/room/dungeon-room.ts`
- `lib/game-state.ts`
- `app/room/[code]/play/page.tsx`
- `app/room/[code]/host/page.tsx`

**Effort/Priority:** M / P3

**Depends on:** 動手前先用 `/plan-eng-review` 定中途加入的計分規則。

**Notes:**
- Pros：加入流程（JOIN、密碼、隊名檢查）都是現成的。
- Cons：要決定中途加入的隊伍要不要補一點起始分，不然幾乎不可能贏；有隊伍已經在王房時，新隊伍是不是直接進王房。共用題庫的牌堆和地圖要能多一隊；房間最多 8 隊的上限照舊。
- Context 補充：`lib/room/dungeon-room.ts`（三處 `game_already_started`）、`lib/game-state.ts`（`turnOrder`、`teams`）、`app/room/[code]/play/page.tsx`、`app/room/[code]/host/page.tsx`。

---

## 主持人開房時可以用自己的題庫

**What:** 主持人開房時可以選題庫：站長的預設題庫，或上傳／貼上自己的題庫。

**Why:** 現在每個房間都只能用站長那一份題庫，想玩自己出的題（例如 `local-banks/` 裡的主題題庫）要站長改正式站的題庫。2026-10 決定「上傳＋多題庫」先延後，但 TODOS.md 裡還沒有這一條（2026-11-04 盤點功能缺口時找到）。

**Context:**
- `lib/bank-store.ts`
- `lib/question-bank.ts`
- `lib/room/dungeon-room.ts`
- `app/bank-editor/page.tsx`

**Effort/Priority:** L / P3

**Depends on:** 先用 `/office-hours` 或 `/plan-ceo-review` 決定範圍；內容審核那條 TODO 要一起考慮。

**Notes:**
- Pros：題庫格式、驗證和編輯器都是現成的。
- Cons：
  - 主持人上傳的題庫要在伺服器端驗證（大小、格式、圖片網址），題目和答案也不能進大螢幕和手機的 bundle（`npm run check:bundle` 的規則照舊）。
  - 自訂題庫的文字會進 AI 旁白的提示詞，跟「Host 自訂題庫文字進 LLM prompt 前的內容審核」那條 TODO 綁在一起。
  - 要決定上傳的題庫存在哪：只存在房間裡，還是存起來下次再用。
  - 題目比隊伍少的問題（「題目比隊伍少時，兩隊可能一直拿同一題」）會變常見。
- Context 補充：`lib/bank-store.ts`、`lib/question-bank.ts`（格式與驗證）、`lib/room/dungeon-room.ts`、`app/bank-editor/page.tsx`。

---

## 題目比隊伍少時，兩隊可能一直拿同一題

**What:** 自訂題庫的題目比隊伍數少時，開局就會有兩隊拿同一題（沒辦法避免）。之後有題目空出來（某隊進王房、被主持人送進王房、或答對換題），只有正在出題的那一隊會換題，共用同一題的兩隊要等其中一隊下次出題才會分開。做法：有題目空出來時，從共用同一題的隊伍裡挑一隊（沒有選錯紀錄的）立刻換到空出來的題目。

**Why:** 共用同一題時，一隊答對公布答案，另一隊就看到自己的答案。

**Context:**
- `/ship`

**Effort/Priority:** S / P3

**Depends on:** 無。

**Notes:**
- Pros：邏輯集中在 `game-state.ts`，`/ship` 的模擬腳本已經能重現（scratchpad `sim.ts` 的 R1release）。
- Cons：會換掉一隊正在等的題目，大螢幕和手機要能接受「沒輪到也換題」；要先決定換哪一隊。預設題庫每池 12～16 題、最多 8 隊，遇不到。
- Context 補充：2026-10-26 `/ship`（score-pools，v0.14.0.0）Claude 對抗審查的隨機模擬提出（5 萬場、只在很小的自訂題庫出現）。

---

## 題庫讀不懂期間的小問題

**What:** 處理「題庫讀不懂期間的小問題」所述事項。

**Why:** 都是少見的情況，但最後一項可能刪掉題庫還在用的圖片。

**Context:**
- 原文未列檔案路徑。

**Effort/Priority:** S / P3

**Depends on:** 無。

**Notes:**
- 原 What：存著的題庫讀不懂時（v0.15.2.0 起編輯器唯讀、上傳被擋），還有幾個小問題：`runImageCleanup` 遇到讀不懂時把 alarm 往後推一個清理延遲，期間一直白跑；待刪佇列在這段期間不會縮小；`version` 不是數字時被當成 1；延後清理時沒有自己的 log；清理在等 R2 刪除時，一個把圖放回題庫的儲存可能剛好插進來，圖還是被刪（這個競態跟讀不懂無關，平常也可能發生）。
- Context 補充：原本是「題庫讀不懂時的後續」的附帶項目，(1)–(4) 做完後拆出來。

---

## OpenRouter 一鍵登入拿 key，手機主持人不用複製貼上

**What:** 主持人頁加「用 OpenRouter 登入」，走 OpenRouter 官方的 PKCE OAuth 流程拿到一把 key，在 `lib/narration/providers.ts` 的 `PROVIDERS` 加一個 `"openrouter"`。

**Why:** 使用者 2026-10-30 提出：用手機當主持人時，從 Anthropic Console 複製 key 再貼上很難。Anthropic 沒有給第三方拿 API key 的 OAuth，OpenRouter 有。

**Context:**
- 原文未列檔案路徑。

**Effort/Priority:** M / P3

**Depends on:** 無。

**Notes:**
- Context 補充：spec #102 的 D11 決定先只做 Anthropic 複製貼上。`AiProvider` 介面已經按 provider 分開（`checkKey`、`createNarrator`），加一個 provider 不用動房間邏輯；要新增 OpenRouter 的 narrator（OpenAI 相容的 chat API）和 PKCE 的回呼頁。

---

## 加入密碼沒有猜錯次數限制

**What:** 房間的加入密碼（v0.15.1.0）沒有限制猜錯次數。同一條連線可以一直送 JOIN 猜密碼。做法：每個房間記錄猜錯次數，超過門檻就暫時擋掉 JOIN，或是猜錯後關掉那條連線。

**Why:** 主持人如果設了很短的密碼（例如 4 位數字），用程式猜幾分鐘就能猜中。

**Context:**
- 原文未列檔案路徑。

**Effort/Priority:** S / P3

**Depends on:** 無。

**Notes:**
- Pros：邏輯集中在 `lib/room/dungeon-room.ts` 的 `handleJoin`。
- Cons：全房間共用的門檻會讓攻擊者把真正的玩家也一起擋在外面，要先決定擋的範圍。目前主持人頁的說明建議公開網址要設密碼，但沒有規定長度。
- Context 補充：2026-10-27 做房間密碼時刻意留下的範圍。

---

## 後進王房的隊伍，旁白還在說「推開最後一道門」

**What:** 第二隊以後進王房時，旁白改用「加入戰局」的台詞，AI 旁白的 prompt 也告訴它這隊是第幾個進來的。現在每隊進王房都用同一組 `BOSS_ENTER_VARIANTS`（`lib/narration/`），聽起來像第一次開門。

**Why:** 活地圖的 D9 規則讓每隊都會「進王房」，但大螢幕上門早就開了，旁白跟畫面對不上。

**Context:**
- 原文未列檔案路徑。

**Effort/Priority:** S（人工約半天 / CC 約 15 分鐘） / P3

**Depends on:** 跟「重新設計計分」一起做。

**Notes:**
- Pros：旁白跟大螢幕一致；後進隊伍有自己的進場台詞。
- Cons：要寫新台詞、改 `buildPrompt`，旁白測試要跟著改。
- Context 補充：2026-10-23 /ship 紅隊審查第 5 點，使用者選 D6=B（記 TODO），跟計分重設計一起處理。`NarrationEvent` 的 `entersBoss` 目前不分第一隊或後進。

---

## CI 在 Ubuntu 26 上試跑一次，通過再換掉固定的 ubuntu-24.04

**What:** `.github/workflows/ci.yml` 目前把 `runs-on` 固定在 `ubuntu-24.04`。找一個 PR 把它改成 `ubuntu-26.04`（或 `ubuntu-latest`）跑一次完整 CI，全過就換，不過就記下壞在哪。

**Why:** GitHub 從 2026-10-19 起把 `ubuntu-latest` 換成 Ubuntu 26。先固定版本是為了不在某天突然紅燈；但不能永遠停在 24.04，等它停止支援時會被迫一次升。

**Context:**
- `docs/designs/maintenance-2026-10.md`

**Effort/Priority:** S / P3

**Depends on:** GitHub 的 Ubuntu 26 runner 正式可用。

**Notes:**
- Pros：主動、可控地升級；壞的話只影響那一個試跑 PR。
- Cons：最可能出問題的是 `npx playwright install --with-deps chromium` 裝的系統套件，可能要跟著調整。
- Context 補充：v0.9.14.3 固定版本時加的（`docs/designs/maintenance-2026-10.md` B1）。只要改 `runs-on` 那一行；CI 其他步驟不用動。

---

## 手機答題模式（選擇題 + 自動判定）

**What:** 題目改成選擇題，玩家在手機選答案，系統自動判定，host 不再手動按對錯。

**Why:** 手機在遊戲中幾乎閒置，host 也被綁在判定工作上（審查 E6）。

**Context:**
- `docs/designs/phone-answering.md`

**Effort/Priority:** L（人工約 1 週 / CC 約半天） / P3

**Depends on:** 第二次真人測試結果，題庫格式定案。

**Notes:**
- Pros：手機變主角；host 可以下場玩。
- Cons：改變第一輪已驗證的核心玩法；題庫要全部重寫並加迷惑選項；重答與逃跑規則要重新設計手機 UI。
- Context 補充：見同上 CEO plan。風險最高，應在氛圍假設驗證後再評估。v0.11.0.0 已上第一階段（`docs/designs/phone-answering.md` PR 1）：手機選擇、鎖定、自動判定、重答／逃跑，第一房只有 6 題示範選擇題。第二階段（PR 2）也已完成：預設題庫 52 題全部改成四選一（第一房 12 題，其他房和王各 8 題）。剩下：正式環境的題庫存在 BankStore 裡，要另外重新種子（使用者決定），否則正式環境還是舊的文字題。

---

## 手機答題的剩餘小風險（/review 2026-10-25）

**What:** 處理「手機答題的剩餘小風險（/review 2026-10-25）」所述事項。

**Why:** 都不會在一般派對現場發生，或發生時主持人有辦法處理。這次 PR 先修會影響公平的問題（輪次、選項洩漏、大螢幕溢出、兩支手機搶鎖定）。

**Context:**
- `.gstack/qa-reports/review-20261025-phone/`
- `docs/designs/phone-answering.md`

**Effort/Priority:** 未註明 / P3

**Depends on:** 第一次真人試玩手機答題後再決定哪些值得做。

**Notes:**
  - 原 What：phone-answering 分支 /review 找到、但這次刻意沒修的幾項： 1. 主持人「等 15 秒才出現重答／逃跑」只擋在主持人頁，伺服器不檢查（主持人本來就是被信任的一方）。 2. 房間重啟還原 `eliminated`、`pendingWrong` 時沒驗證資料形狀，壞掉的存檔可能讓房間卡住。 3. 等待重答／逃跑的隊伍離線時一直保留回合；房間重啟後所有隊伍都離線，只能靠主持人的卡住按鈕救。
  - 4. 鎖定被伺服器丟掉時（離線、重啟、`selection_changed`），手機要等 3 秒才顯示「沒送出」，沒有立即的錯誤。 5. `scripts/check-bundle.sh` 用選項文字比對選擇題答案，很短的選項（如「6 個」）可能誤判成洩漏。 6. `eliminated` 整場只增不減的部分已修（題目離開就清掉），但每次 STATE 仍整包廣播。
  - 7. 大螢幕的選項方塊是 `<button tabIndex={-1}>`，語意上應該是純顯示元素；D8/D9 規格寫 17px 標籤、30px 字母塊，程式是 15px、28px。 8. 房間只剩 1 題時，答錯後逃跑會再抽到同一題，`eliminated` 沒清掉，上次刪掉的選項還是灰的（程式註解說「重新抽到就從頭開始」，這個情況不成立）。正式房間題目多，不會發生。
- Context 補充：審查紀錄在 `.gstack/qa-reports/review-20261025-phone/`；設計見 [docs/designs/phone-answering.md](docs/designs/phone-answering.md)。

---

## 手機顯示題目的剩餘小風險（/ship 2026-10-29）

**What:** 處理「手機顯示題目的剩餘小風險（/ship 2026-10-29）」所述事項。

**Why:** 預設題庫不會發生 1；2、3 不影響答題。第一次用長題目的本機題庫試玩前再處理 1。

**Context:**
- `app/room/[code]/play/page.tsx`
- `docs/designs/phone-question-text.md`

**Effort/Priority:** 未註明 / P3

**Depends on:** 無。

**Notes:**
  - 原 What：phone-question-text 分支 /ship 審查找到、這次沒修的幾項： 1. 題目橫條沒有長度上限。預設題庫最長 34 字，iPhone 12（390×844）放得下；但本機題庫（`local-banks/`）沒有字數限制，約 100 字的題目會多出 4 行，答錯後的重答／逃跑或魔王房的鎖定答案可能被推到螢幕外。
  - 2. （v0.27.1.0 手機已拿掉「冒險出現岔路」面板，這點暫時不存在；加回來時再看會不會被媒體推到螢幕外。） 3. 揭曉時才重新整理或重新連線的手機，看不到剛答對的那題題目（只記得連線期間看過的題目）。設計時已接受。 4. 還沒有 e2e 檢查「揭曉時重新連線不顯示題目」和「等待中的手機不顯示選擇題橫條」。
- Context 補充：設計見 [docs/designs/phone-question-text.md](docs/designs/phone-question-text.md)，畫面在 `app/room/[code]/play/page.tsx` 的 `QuestionStrip`。

---

## 題庫編輯器：載入或儲存途中的編輯會被蓋掉（/review 2026-10-25）

**What:** 處理「題庫編輯器：載入或儲存途中的編輯會被蓋掉（/review 2026-10-25）」所述事項。

**Why:** 一般使用時，載入只要幾百毫秒，又是主持人自己按的，很少撞到。CI 那次失敗是開發模式（StrictMode）重複自動載入造成的，fix-bank-editor-save-race 已用載入序號處理，儲存和載入兩顆按鈕也改成互斥（一個進行中，另一個不能按）。

**Context:**
- `app/bank-editor/page.tsx`

**Effort/Priority:** 未註明 / P3

**Depends on:** 無。

**Notes:**
  - 原 What：按「載入題庫」之後、資料回來之前，題目欄位仍然可以改；載入完成時 `setBank` 直接整包覆蓋，剛改的內容會不見，也沒有「有未儲存的變更」提醒。儲存也一樣（main 上原本就有）：按下儲存後、回應回來前改的內容，會被 `save()` 成功時的 `setBank(versioned.bank)` 換回送出那一刻的版本，版本號照樣前進，下次儲存不會出現 409 提醒。另外兩個小點：`fetch` 沒有逾時，最新一次載入卡住時按鈕會一直停在「載入中…」；
  - 非 403 的載入失敗會保留上一把金鑰載到的題庫；載入前開始上傳的圖片，上傳完成時會寫進剛載入的題庫（題目還在就會被下次儲存一起存進去，題目不在了 R2 圖檔就變孤兒）。
- Context 補充：`app/bank-editor/page.tsx` 的 `load()` 和 `save()`；做法可以是載入／儲存中鎖住題目列，或丟棄前先確認未儲存的變更。注意伺服器存的是 `parseBank` 之後的版本，儲存成功時不能直接改成只更新 `version`。

---

## 逃跑・換房（flee-switch-room）

**What:** 答錯後除了「重答」和「逃跑・同房」，再加一個「逃跑・換房」：跳到另一間房、面對另一隻怪物。

**Why:** 你在 2026-09-18 的 /plan-ceo-review 提出「逃跑可以選擇同一房或換房」。工程審查（/plan-eng-review，T1）決定先延後，改用全域已用題目牌堆解決題目重複，換房是狀態空間最大的新增規則，也還沒有真人測試要求過。

**Context:**
- `docs/designs/critical-answer-iteration-2.md`

**Effort/Priority:** M（人工約 1-2 天 / CC 約 1 小時） / P3

**Depends on:** 第二次真人測試結果、牌堆規則穩定。

**Notes:**
- Pros：讓逃跑成為真正的策略選擇，符合設計文件「放棄較高難度換取簡單」的精神。
- Cons：每隊需要記錄已通關的房間，「走完」的定義、被放棄的房間難度、`roomIndex` 不再線性都要重新定義，會動到第一輪已驗證的核心。
- Context 補充：見 [docs/designs/critical-answer-iteration-2.md](docs/designs/critical-answer-iteration-2.md)「Engineering review decisions」T1。預設草案：換到下一間尚未通關的房、難度為該房基礎難度 −1、回頭打被放棄的房恢復基礎難度。

---

## 魔王分階段的兩個小瑕疵（/qa 2026-10-28）

**What:** 處理「魔王分階段的兩個小瑕疵（/qa 2026-10-28）」所述事項。

**Why:** 1 只有主持人看得到，不影響玩家；2 要題庫作者寫很長的名稱和規則才會發生，平常的名稱（如「主題曲之謎」）不會。

**Context:**
- `.gstack/qa-reports/run-20261029T002140Z/screenshots/`
- `s3-host-card2.jpg`
- `s6-screen-card3.jpg`
- `app/room/[code]/host/page.tsx`

**Effort/Priority:** 未註明 / P3

**Depends on:** 第一次真人試玩魔王分階段後再決定。

**Notes:**
- 原 What：boss-phases-design 分支 /qa 找到、兩項都是低嚴重度，沒修： 1. 換階段的轉場卡開著時，主持人頁題目那一行顯示題目 id（例如「題目 p2a」），不是題目文字；下方答案卻已經看得到。按「下一題」關掉卡片後就正常。重現：三階段題庫，打空第 1 階段，按「下一題」開卡片，看主持人頁。 2. 階段名稱和規則都很長時（約 25 字名稱 + 60 字規則），1280×720 大螢幕上的轉場卡會往下長，蓋住新造型魔王大半個身體，剛好是「換了模樣」那一刻。編輯器的名稱、規則欄位沒有字數上限。
- Context 補充：截圖在 `.gstack/qa-reports/run-20261029T002140Z/screenshots/`（`s3-host-card2.jpg`、`s6-screen-card3.jpg`）。主持人頁題目那一行在 `app/room/[code]/host/page.tsx` 的 `host-question`。

---

## 地城料理風格 3：旁白用美食節目／生物學家口吻

**What:** 改 DM 旁白的 prompt 和固定台詞，用一本正經講料理的口吻，例如「這隻史萊姆的外膜曬乾後口感像寒天……」。

**Why:** 不需要任何素材，就能讓整局語氣最接近「迷宮飯」。

**Context:**
- `lib/narration/`

**Effort/Priority:** S（人工約半天 / CC 約 20 分鐘） / P3

**Depends on:** 無。

**Notes:**
- Pros：改動小、效果明顯；只動文字。
- Cons：要用真的 API 測幾局，確認不會每句都在講吃而變得膩。
- Context 補充：`lib/narration/` 的 `buildPrompt`、`VARIANTS`、`BOSS_ENTER_VARIANTS`；參考待辦「旁白語氣是否耐聽」。

---

## 上架手機版本

**What:** 把玩家手機頁做成可以從 App Store／Google Play 安裝的版本。先比較三條路：PWA（加到主畫面，不上架）、用 Capacitor 包現有網頁再上架、或原生 app。

**Why:** 玩家現在要掃 QR 碼開瀏覽器；裝成 app 可以全螢幕、不怕誤關分頁，也方便下次再玩。

**Context:**
- `app/room/[code]/play/`

**Effort/Priority:** PWA S（人工約半天 / CC 約 30 分鐘）；上架 L（人工約 1–2 週 / CC 約半天，不含審核） / P3

**Depends on:** 無。

**Notes:**
- Pros：體驗更像遊戲；PWA 路線幾乎不用改程式。
- Cons：上架要開發者帳號（Apple 每年 USD 99）和審核；包殼的 app 可能被 Apple 以「只是網頁」退件；兩個商店都要維護版本。
- Context 補充：玩家頁在 `app/room/[code]/play/`，連線走 Cloudflare Worker 的 WebSocket。要先走 /office-hours 決定路線，再 /plan-eng-review。

---

## 每次行動可以選不同的動作，不只答題

**What:** 輪到一隊時，現在只能答題。改成可以從幾個動作裡選一個，答題只是其中之一。

**Why:** 使用者 2026-10-29 提出，讓每回合多一點選擇和策略。

**Context:**
- `lib/game-state.ts`
- `lib/room/dungeon-room.ts`
- `app/room/[code]/play/page.tsx`

**Effort/Priority:** 未註明 / P3

**Depends on:** 還沒寫規格，要先走 /office-hours 決定有哪些動作。

**Notes:**
- Context 補充：回合流程在 `lib/game-state.ts` 和 `lib/room/dungeon-room.ts`；手機畫面在 `app/room/[code]/play/page.tsx`。可以和下面「隊伍職業」一起設計，職業的特殊能力可能就是其中一種動作。

---

## 每個職業有自己的動畫和音效

**What:** 法師、牧師、盜賊用能力時，TV 有各自的動畫和音效。現在只有戰士的骰子有動畫。廚師是被動能力，可以在料理卡的「（廚師 +N）」出現時給一個小音效。

**Why:** 2026-10-29 職業能力的 office hours（Codex 建議），在 eng review 決定先不做（D7）。

**Context:**
- `docs/designs/class-abilities.md`
- `app/room/[code]/screen/page.tsx`
- `lib/`

**Effort/Priority:** 未註明 / P3

**Depends on:** 職業能力 PR 2（法師、牧師、盜賊）上線，並且試玩過一場。

**Notes:**
- 跑團風擲骰之後，戰士骰也播 `roll` 音（跟暴擊骰、檢定骰同一個音）。換成戰士自己的音效時，三種骰子要分開。

**Notes:**
- Context 補充：設計在 `docs/designs/class-abilities.md`。TV 畫面在 `app/room/[code]/screen/page.tsx`，音效在 `lib/` 的 `SfxNote`。

---

## 法師填空題提示：答案帶註記時第一個字會誤導

**What:** 題庫編輯器在填空題答案欄旁提醒：「法師可以讓大家看到答案的第一個字或數字」。

**Why:** 2026-10-31 #106 的 /review。法師看的是答案第一個文字或數字（`firstMeaningfulChar`，`lib/game-state.ts`）。答案寫成「約 300」「（皆可）台北」時，提示是「約」「皆」；「−5」的提示是「5」，負號被跳過。出題的人不知道答案欄會被公開一部分。

**Context:**
- `app/bank-editor/page.tsx`

**Effort/Priority:** 未註明 / P3

**Notes:**
- Context 補充：只改 `app/bank-editor/page.tsx` 的說明文字，不改判定。也可以考慮把註記移到另一個欄位，但那要改題庫格式，先不做。

---

## 主持人按錯「答錯」可以改回答對

**What:** 填空題由主持人判。主持人手滑按了答錯時，可以馬上改成答對。

**Why:** 2026-10-31 #106 的 eng review（D3）。今天的「答錯・重答」也不能改，但牧師填空題答錯後會進入等待（祈禱 / 重答 / 逃跑），等待時畫面上沒有答對鍵，手滑更明顯。

**Context:**
- `lib/game-state.ts`

**Effort/Priority:** 未註明 / P3

**Depends on:** #106 的牧師填空題（PR B）上線。

**Notes:**
- Context 補充：`answerQuestion`（`lib/game-state.ts`）在有 `pendingWrong` 時拒絕 `correct: true`。一個做法：`optionIndex` 為 null（主持人判錯的填空題）、還沒祈禱時，允許主持人改判答對，主持人頁等待時保留答對鍵。

---

## 旁白念出戰士擲到幾點

**What:** 戰士擲骰後，旁白說出點數（例如「擲出 17 點」），不只是一般的答對 / 答錯。範圍縮小：選擇題擲到 20 已經有大成功台詞，剩下的是 2～19，以及沒命中的 1。

**Why:** eng review D1 選了小範圍，`lib/narration` 不改，所以 PR 1 的旁白不念點數。2026-10-29 決定記成 TODO（D8）。

**Context:**
- `lib/narration/events.ts`
- `pendingRoll.value`
- `docs/designs/class-abilities.md`

**Effort/Priority:** 未註明 / P3

**Depends on:** 無，戰士在 v0.19.0.0 上線。

**Notes:**
- Context 補充：旁白事件在 `lib/narration/events.ts`（`toNarrationEvent`），點數在 `pendingRoll.value`。設計在 `docs/designs/class-abilities.md`。

---

## 房間最多只能存在 6 小時

**What:** 房間從建立起最多存在 6 小時，時間到就關閉。現在是 24 小時（`EXPIRE_MS`），而且房間一直有人在用就會一直往後延。

**Why:** 使用者 2026-10-29 提出。一場遊戲不會玩超過 6 小時，房間留太久只會佔資源。

**Context:**
- `lib/room/dungeon-room.ts`
- `worker/index.ts`

**Effort/Priority:** S（人工約半天 / CC 約 20 分鐘） / P3

**Depends on:** 無。

**Notes:**
- Context 補充：常數在 `lib/room/dungeon-room.ts` 的 `EXPIRE_MS`（閒置是 `IDLE_MS` 2 小時）。`worker/index.ts` 用同一個到期時間算孤兒圖片的刪除時間，所以改短會讓舊圖片更早被刪，要一起檢查。也要決定：時間快到時要不要先提醒主持人和玩家。

---

## 不檢查房間代碼格式，任何名字都能開出新房

**What:** 處理「不檢查房間代碼格式，任何名字都能開出新房」所述事項。

**Why:** 不用登入就能大量佔用 Durable Object 的儲存空間和請求次數；把 4 字代碼全部佔掉也會讓主持人頁的重試用完。

**Context:**
- `lib/gate.ts:18-25`
- `worker/index.ts:192-193`
- `lib/room/dungeon-room.ts:753-755`

**Effort/Priority:** S（人工約 2 小時 / CC 約 15 分鐘） / P3

**Depends on:** 無。

**Notes:**
- 原 What：`entryGate` 只檢查 party 名稱是不是 `main` 和 Origin，沒有檢查房間代碼。沒帶 Origin 的請求是允許的，所以腳本可以對 `/parties/main/<任意字串>` 開 WebSocket，每個名字都會建一個 Durable Object、設 alarm、寫一份包含整個題庫的 snapshot，在儲存空間留 24 小時。做法：在 gate 拒絕不符合 `^[BCDEFGHJKLMNPQRSTUVWXYZ]{4}$` 的名字。也可以改成等第一則有效訊息才寫入，這部分是 M。
- Context 補充：`lib/gate.ts:18-25`、`worker/index.ts:192-193`、`lib/room/dungeon-room.ts:753-755`。2026-10-30 系統檢查時找到。

---

## 一條連線能佔滿 8 隊，60 條連線能鎖死房間

**What:** 處理「一條連線能佔滿 8 隊，60 條連線能鎖死房間」所述事項。

**Why:** 代碼就顯示在電視上，有人搗蛋就能讓整場玩不下去。

**Context:**
- `lib/room/dungeon-room.ts:67`

**Effort/Priority:** S/M / P3

**Depends on:** 無。

**Notes:**
- 原 What：沒有加入密碼時，一條連線可以換 8 個 UUID 送 8 次 JOIN，`MAX_TEAMS` 就滿了；`connTeam` 會被直接覆蓋，沒檢查這條連線是不是已經有隊伍。另外 `MAX_CONNECTIONS = 60` 是整個房間的上限，有代碼的人開 60 個 socket，之後連主持人和斷線重連的手機都進不來。做法：一條連線只能有一隊（S）；連線上限保留名額給主持人，或用 `CF-Connecting-IP` 限制每個 IP 的數量（M）。
- Context 補充：`lib/room/dungeon-room.ts:67`、`:745-748`、`:925-932`。2026-10-30 系統檢查時找到。

---

## 每則訊息都把整個房間序列化一次，而且沒有速率限制

**What:** 處理「每則訊息都把整個房間序列化一次，而且沒有速率限制」所述事項。

**Why:** 便宜的請求換到昂貴的 CPU，房間 Durable Object 是單執行緒的。

**Context:**
- `lib/room/dungeon-room.ts:372-375`

**Effort/Priority:** S（人工約半天 / CC 約 30 分鐘） / P3

**Depends on:** 無。

**Notes:**
- 原 What：`sendTo` 每次都先呼叫 `persist()`，`persist()` 會先 `JSON.stringify` 整個房間狀態（含題庫，預設約 27 KB、編輯後最多 200 KB），再跟上次比較有沒有變。所以連錯誤回覆也要付一次完整序列化的代價。一條沒驗證的連線一直送 `{}` 或錯的 HOST_CLAIM，就能拖慢正在進行的遊戲。做法：ERROR 回覆不呼叫 persist，或改用 dirty flag；再加每條連線的簡單速率限制。
- Context 補充：`lib/room/dungeon-room.ts:372-375`、`:414-420`、`:796`。2026-10-30 系統檢查時找到。

---

## HOST_AI_KEY 能被拿來批次驗證偷來的 Anthropic key

**What:** 任何人都能搶到一個新代碼當主持人，然後連續送 HOST_AI_KEY（`own`）。每把格式正確的 key 都會從 Cloudflare 的 IP 打一次 `GET /v1/models`，回覆會告訴對方哪把 key 有效。新訊息會中止舊的檢查，但沒有次數或冷卻限制。做法：每個房間每分鐘只檢查幾次，超過就回 `check_failed`。

**Why:** 我們的 Worker 會變成別人驗證外洩 key 的工具，Cloudflare 的 IP 也可能被 Anthropic 封鎖。

**Context:**
- `lib/room/dungeon-room.ts:337-364`
- `lib/narration/providers.ts:26-37`

**Effort/Priority:** S（人工約 2 小時 / CC 約 20 分鐘） / P3

**Depends on:** 無。

**Notes:**
- Context 補充：`lib/room/dungeon-room.ts:337-364`、`lib/narration/providers.ts:26-37`。v0.21.0.0 加入的路徑。2026-10-30 系統檢查時找到。

---

## 填空題可以有好幾個要填的欄位

**What:** 填空題第一版只有一個答案欄位。之後讓一題可以有好幾個欄位，每一格各自有答案，例如猜歌要同時填「歌手」和「歌名」。要決定：手機上怎麼排好幾格、主持人怎麼判（整題對或錯，還是每一格分開判、可以給部分分數）、題庫格式怎麼存、題庫編輯器怎麼編。

**Why:** 使用者 2026-10-30 提出，猜歌這類題目一題需要填不只一個答案。

**Context:**
- `lib/question-bank.ts`

**Effort/Priority:** M（人工約 2 天 / CC 約 1 小時） / P3

**Depends on:** 口說題改成填空題。

**Notes:**
- Context 補充：接在「口說題改成填空題（手機打字、主持人判）」之後。題庫格式在 `lib/question-bank.ts`（text 題現在只有一個 `answer` 字串）。

---

## 房間除了問答怪物，還有事件卡（像大富翁的機會／命運）

**What:** 進到房間時，不一定是遇到要用問答打的怪物，也可能抽到一張事件卡，例如寶箱、陷阱、商人、泉水回血、詛咒。事件可以是好的也可以是壞的，可能影響分數、能力次數或下一題。

**Why:** 使用者 2026-10-30 提出，讓地城每一間房間不只是答題，多一點意外。

**Context:**
- `lib/game-state.ts`
- `lib/map-layout.ts`

**Effort/Priority:** M（人工約 2-3 天 / CC 約 1.5 小時） / P3

**Depends on:** 還沒寫規格，先走 /office-hours。

**Notes:**
- Context 補充：房間和地圖在 `lib/game-state.ts`、`lib/map-layout.ts`；分支選擇（`recordBranchChoice`，v0.31.3.0 已移除，要用得從 git 歷史找回）原本可能是加事件房的好位置。要決定：事件卡放在題庫裡還是寫死在程式、出現機率、大螢幕怎麼演出、AI 旁白怎麼描述。

---

## ⭐ 靈感：主持人給，下一次擲骰取優勢

**What:** 主持人看到隊伍演得好或答得漂亮，給一個 ⭐ 靈感。這隊下一次擲骰（暴擊骰、說服檢定或戰士骰）擲兩次取高。

**Why:** 跑團風擲骰的 office-hours（2026-11-05，Decision 9）：使用者說「先不加靈感 之後再說」。

**Context:**
- `lib/room/dungeon-room.ts`（`startRoll`）
- `app/room/[code]/host/page.tsx`

**Effort/Priority:** S / P3

**Depends on:** 無（跑團風擲骰 PR 2 已在 v0.35.0.0 上線）。

---

## 玩家自己選攻擊或說服

**What:** 輪到時，手機讓隊伍自己選「攻擊」（出選擇題）或「說服」（出填空題），不再由抽到的題型決定。

**Why:** 跑團風擲骰設計的做法 B。使用者選了 C（題型決定行動），理由是新手少一個決定，題庫也不會只用光一種。B 可以之後在 C 上加一顆選擇鈕。

**Context:**
- `lib/game-state.ts`（`dealFor`）
- `app/room/[code]/play/page.tsx`

**Effort/Priority:** M / P3

**Depends on:** 跑團風擲骰 PR 2 已在 v0.35.0.0 上線；題庫每個難度都有足夠的填空題。

---

## 開場擲先攻，取代固定的輪流順序

**What:** 遊戲開始時每隊擲一次 d20，大螢幕依點數排出輪流順序，取代固定的 A、B、C。所有手機一起參與，約 20 秒。

**Why:** D&D 研究的候選第 4 項（`~/.gstack/projects/critical-answer/dnd-research.md`，只在本機）。開場有一個全場一起看的儀式，順序也公平。站長 2026-11-07 說「加」。

**Context:**
- `lib/game-state.ts`（輪流順序）
- `components/d20.tsx`（`RollOverlay`）
- 可跟「開場與首領房的轉場動畫」一起做

**Effort/Priority:** S / P3

**Depends on:** 11/21 活動之後，除非提早做完其他項目。

---

## 旁白訊息依場次區分

**What:** 旁白訊息帶場次 id，伺服器只收目前場次的。

**Why:** partysocket 的佇列如果跨過「回到大廳」才送出，舊局的 `HOST_EDIT_NARRATION` 可能因 eventId/rev 撞號套到新局。來源：#141 (v0.41.0.0) 已知風險。

**Effort/Priority:** S / P3

**Depends on:** 無。

---

## 在全新的 Cloudflare／Vercel 帳號上照部署指南做一遍

**What:** 用沒部署過這個專案的 Cloudflare 和 Vercel 帳號，照 `docs/deployment.md` 的「第一次部署」從頭做一遍，把卡住或寫錯的地方改掉，然後拿掉指南開頭「還沒在全新的帳號上照著做過一遍」那段提醒（中英兩版都要改）。

**Why:** 這份指南是從現在的設定檔整理出來的，沒有人照著做過。要確認的有：沒有 R2 bucket 時 `wrangler deploy` 會不會失敗、兩個 Durable Object 的 migration 第一次部署會不會自動套用、`NEXT_PUBLIC_PARTYKIT_HOST` 要不要加埠號。（README 重整的 eng review，2026-11-06，R10）

**Context:**
- `docs/deployment.md`、`docs/deployment.en.md`
- `wrangler.jsonc`、`lib/party-host.ts`、`lib/origin.ts`

**Effort/Priority:** S / P3

**Depends on:** README 重整拆出 5 份指南的 PR。

---

## Host 自訂題庫文字進 LLM prompt 前的內容審核

**What:** 對 host 自訂的題庫文字（問題、答案）進行基本的輸入淨化與 prompt injection 防護，才餵進敘事狀態層生成 DM 旁白的 LLM prompt。

**Why:** 第二輪才會接 LLM API 與敘事狀態層，但 host 題庫編輯 UI 若在那之前就先做，容易忘記在資料流的哪一段加防護。

**Context:**
- `docs/designs/critical-answer-party-game.md`

**Effort/Priority:** 未註明 / P4

  - **Depends on:** 第二輪的敘事狀態管理層 + LLM API 接入（Next Steps 第 5-6 步）。
  - **更新（2026-09-20，第二輪實作完成）：** 隊伍名稱進 prompt 的部分已完成並驗證：名稱以「」引起來當資料（並拿掉引號字元）、系統提示明講裡面的指示一律忽略、題目文字與答案完全不進 prompt、輸出驗證（長度、標記、不含題庫答案）。真的 API 測試也確認藏在隊伍名稱裡的指令不會被照做。**仍待處理：** host 自訂題庫文字，等題庫編輯介面出現時再做。
  - **更新（2026-09-18 /plan-ceo-review）：** 第二輪 LLM 旁白已進入範圍，此項不再被擋住。第二輪只處理「隊伍名稱進 prompt」（資料引號化、答案與答錯時的題目文字不進 prompt、輸出驗證，見 CEO plan D8/D19）；host 自訂題庫文字仍待題庫編輯 UI 出現時再處理。
  - **更新（2026-09-22，`/plan-eng-review` question-bank-editor）：** 這條 TODO 等的「題庫編輯介面」這輪要做了，但範圍不變——題目文字/答案本來就不進 prompt（見上，已有防護），所以題庫變成可編輯並不會新增暴露面。真正要處理的情境是：如果未來旁白 prompt 改成會讀題目文字（例如題目本身要融入敘事），才需要回頭做這條 TODO 描述的淨化。用戶決定繼續延後，本次只更新現狀說明。
  - 見 [docs/designs/question-bank-editor.md](docs/designs/question-bank-editor.md)。
  - **更新（2026-10-03，`/cso` 稽核）：** 重新確認：`lib/narration/llm.ts` 的 `buildPrompt` 只放隊伍名、怪物名、分數與主持人導演筆記，題目文字與答案都不進 prompt；名稱以「」包起來並移除引號字元。這條只有在旁白開始讀題目文字時才需要，降為 P4。

**Notes:**
- Pros：避免惡意或不當的 host 輸入內容污染 LLM 輸出（例如注入指令改變旁白行為，或產生不當內容）。
- Cons：需要額外設計淨化規則，可能誤傷正常題目內容（過度過濾）。
- Context 補充：見 [docs/designs/critical-answer-party-game.md](docs/designs/critical-answer-party-game.md) 的 Open Questions（「Host 自訂題庫的文字內容進入 LLM 旁白 prompt 前」）。

---

## 量 e2e 對前端（app/、components/）的實際覆蓋率

**What:** 讓 Next.js 在 e2e 建置時產生 source map，用 Playwright 收集 V8 coverage，算出 `app/` 與 `components/`（約 2,400 行）被 e2e 跑到多少。

**Why:** 單元測試只覆蓋 `lib/`；前端完全靠 e2e，但沒有數字知道哪些頁面流程沒被碰過。

**Context:**
- `docs/designs/maintenance-2026-10.md`
- `playwright.config.ts`

**Effort/Priority:** M / P4

**Depends on:** 無。

**Notes:**
- Pros：補測試有依據，能找出完全沒被 e2e 走過的頁面流程。
- Cons：要加回 `next.config.ts`，而且只能在 e2e 建置開 source map；正式部署帶上 source map 等於公開原始碼。
- Context 補充：維護輪（`docs/designs/maintenance-2026-10.md` D3）審查時決定延後。從 `playwright.config.ts` 的 webServer 建置指令開始。

---

## 開發工具鏈剩 5 個 npm audit 漏洞（上游沒有修補版）

**What:** `npm audit` 剩 5 個 high，全是同一條：`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob@3.3.1`（鎖死版本）→ `micromatch` → `braces <=3.0.3`。`braces` 最新版就是 3.0.3，上游沒有修好的版本。

**Why:** 記下結論，之後看到 audit 報 high 不用重查一遍；上游修好時知道要回來升。

**Context:**
- `fast-glob@3.3.3`
- `@next/eslint-plugin-next`
- `fast-glob@3.3.1`

**Effort/Priority:** S / P4

**Depends on:** 上游 `braces` 或 `@next/eslint-plugin-next`。

**Notes:**
- Pros：省下重複調查的時間。
- Cons：無。
- Context 補充：只在跑 lint 時掃專案自己的檔案路徑，不會進到線上程式。v0.9.14.4 升級修掉另外 3 個（`undici` 等）。用 npm overrides 強制 `fast-glob@3.3.3` 沒用，因為 `braces` 仍有漏洞。上游修好的訊號：`@next/eslint-plugin-next` 不再鎖 `fast-glob@3.3.1`，或 `braces` 出修補版。

---

## /health 補上死碼與 shell 腳本檢查

**What:** 加 `knip`（死碼偵測）當開發依賴、裝 `shellcheck` 檢查 `scripts/*.sh`，再把兩者寫進 CLAUDE.md 的 `## Health Stack`。

**Why:** 第一次 `/health`（2026-10-03）是 10.0/10，但只有 3/6 類別有檢查（型別、lint、測試）；死碼與 shell 腳本沒有工具，分數不完整。

**Context:**
- `[家目錄路徑]`

**Effort/Priority:** S / P4

**Depends on:** 無。

**Notes:**
- Pros：分數更完整，能抓到沒人用的 export 和腳本錯誤。
- Cons：knip 第一次跑可能報出一堆要逐一判斷的結果。
- Context 補充：歷史紀錄在 `~/.gstack/projects/critical-answer/health-history.jsonl`。加工具後覆蓋類別改變，分數會跟第一次不可比。

---

## ESLint 10 / TypeScript 7 升級被上游卡住

**What:** 處理「ESLint 10 / TypeScript 7 升級被上游卡住」所述事項。

**Why:** 2026-09-23 逐一嘗試升級時發現，兩者都不是設定問題，是上游套件（`eslint-config-next`、`typescript-eslint`）還沒跟上，沒有繞過的辦法。

**Context:**
- 原文未列檔案路徑。

**Effort/Priority:** 不確定（等上游） / P4

**Depends on:** `eslint-config-next` 支援 ESLint 10；`typescript-eslint` 支援 TypeScript ≥7.1。

**Notes:**
  - **解鎖後：** 把 `.github/dependabot.yml` 裡 `typescript` 和 `eslint` 的 `ignore` 規則拿掉，Dependabot 才會再開這兩個升級 PR。
  - **重新確認（2026-10-03）：** 仍然卡住。`eslint-config-next@16.3.8` 依賴 `eslint-plugin-react@^7.37.0`，最新 7.37.5 的 peer 是 `eslint ^9.7`（沒有 10）；`typescript-eslint` 最新 8.71.0 的 peer 是 `typescript <6.1.0`（TS 已到 7.0.2）。

**Notes:**
- 原 What：`npm outdated` 列出的兩個 major 版本升級目前做不了：ESLint 9→10（`eslint-config-next@16.3.6` 內建的 `eslint-plugin-react` 用了 ESLint 10 移除的 API，直接噴 `contextOrFilename.getFilename is not a function`）、TypeScript 5→7（`typescript-eslint` 明確拒絕載入，官方公告要等 7.1+ 才支援）。
- Pros：之後升級好處：更快的 lint/typecheck（TS 7 是 Go 原生編譯器，官方號稱 8–12 倍）、ESLint 10 的新規則。
- Cons：現在做不了，勉強做會直接打斷開發環境。
- Context 補充：已完成同批的其他升級：React 19.2.4→19.3.0、Vitest 4.1.11→5.0.1、`concurrently` 9→10（v0.7.3.0）。

---

## Completed

細節見 CHANGELOG.md 與 git 歷史。

PartyKit 部署記錄：`partykit.dev`、[issue #985](https://github.com/partykit/partykit/issues/985)；房間網址 https://critical-answer.aiko-studio.workers.dev。

## 新職業：廚師（被動能力，飽足感多 15%）

- **新職業：廚師（被動能力，飽足感多 15%）** · v0.44.0.0 · 第 5 個職業 🍳 廚師，不用按：這隊每次拿分多 15%，四捨五入、至少 +1，算在整筆分數上（偷襲、大成功、首領 4d20 之後），題庫沒有料理時照加。大螢幕料理卡和手機答對列寫「（廚師 +N）」；手機選職業時廚師卡橫跨兩欄，手機和主持人頁顯示「被動」。說服檢定加值 +1。平衡五個職業另外開了一條 P2，附模擬程式 `scripts/balance-sim.ts`。

## 冒險結束、公布最終分數前，旁白先公布前幾名

- **冒險結束、公布最終分數前，旁白先公布前幾名** · v0.43.0.0 · 首領煮完後，旁白先念「本場大成功王」（擲出最多次 20 的隊伍），再從第三名念到第一名，大螢幕一名一名亮出；前三名同分時先擲 d20 比大小。念到第一名才出分數和皇冠，手機晚大螢幕 1 秒。大螢幕重新整理會接著目前這一步，不會重播。設計見 `docs/designs/podium-reveal.md`。

## 怪物圖鑑 PR2：新畫 17 隻小怪、2 隻首領和 19 道料理圖

- **怪物圖鑑 PR2：新畫 17 隻小怪、2 隻首領和 19 道料理圖** · v0.42.0.0 · 圖鑑補到 20 隻小怪、3 隻首領（加深海大王烏賊、不死火鳥），每隻一張料理圖；預設題庫 8 間房換成 8 隻不同小怪。站長 2026-11-07 看過 PNG 後確認。設計見 `docs/designs/monster-catalog.md`。

## 拿掉導演筆記，改寫旁白搬到主持人頁，並列出下一隊的所有台詞

- **拿掉導演筆記，改寫旁白搬到主持人頁，並列出下一隊的所有台詞** · v0.41.0.0 · 「⚙ 更多」的導演筆記、`HOST_SET_NOTES` 和 prompt 裡的筆記都拿掉。主持人頁「答對！」上方多了「地城主旁白」面板，列出這次旁白的每一句；還沒念完的句子能改（`HOST_EDIT_NARRATION` 帶 eventId 和句子編號），大螢幕回報念到哪，已念完的句子不能改。「下一句這樣說」也搬進面板。設計見 `docs/designs/host-narration-edit.md`。

## 怪物圖鑑：題庫只能從圖鑑選怪物，每被打倒一次換一種小變化

- **怪物圖鑑：題庫只能從圖鑑選怪物，每被打倒一次換一種小變化** · v0.40.0.0 · 原本的 P1「題庫編輯器新增怪物：打名字，AI 產生怪物和料理的像素圖」站長 2026-11-07 改成圖鑑（issue #139）。題庫只存圖鑑 id，料理跟著圖鑑走，編輯器改成下拉選單；同一隻小怪再出場時換顏色、戴配件、名牌加稱號。`BANK_FORMAT` 升到 3，也順便解掉 P2「BANK_FORMAT 沒升：退回 v0.37 存題庫會清掉影片題的新欄位」。新造型在 PR2。設計見 `docs/designs/monster-catalog.md`。

## 答對後切回怪物畫面，用動畫把怪物做成料理

- **答對後切回怪物畫面，用動畫把怪物做成料理** · v0.39.0.0 · 揭曉時大螢幕站著剛被打倒的怪物，料理等主持人按「🍲 上菜」：怪物下鍋、冒泡、一團煙，1.6 秒後端出料理圖和菜卡。打倒首領時結束畫面先煮首領，約 4.6 秒後才出頒獎台。設計見 `docs/designs/monster-cuisine.md`。

## 分數用到骰子時，一律先播擲骰動畫再加分

- **分數用到骰子時，一律先播擲骰動畫再加分** · v0.37.0.0 · 唯一沒有動畫的計分骰是打倒首領的 4d20。現在最後一擊先在大螢幕擲 4 顆骰子，每 0.5 秒停一顆，總分跟著加；偷襲顯示「43 × 2 = 86 分」。約 4 秒後才加分、出頒獎台，手機和頒獎台不會先露出新總分。設計見 `docs/designs/kill-roll.md`。

## 所有 Markdown 文件都有中文版和英文版，可用連結切換

- **所有 Markdown 文件都有中文版和英文版，可用連結切換** · v0.36.0.0 · 範圍縮小（2026-11-06 eng review R6）：README、SECURITY.md 和 `docs/` 的 5 份指南有英文版 `X.en.md`，第一行可切換語言，`npm run check:docs` 檢查配對、切換行和標題層級。`TODOS.md`、`CHANGELOG.md`、`DESIGN.md`、`docs/designs/`、`docs/going-public.md` 和 `CLAUDE.md` 維持單一語言。原本以為 `next dev` 會改寫 `CLAUDE.md`，其實它寫的是 git 排除的 `AGENTS.md`。

## 不同題型變成不同行動：選擇題是打怪物，問答題是說服怪物

- **不同題型變成不同行動：選擇題是打怪物，問答題是說服怪物** · v0.34.0.0 / v0.35.0.0 · 選擇題答對擲暴擊骰（v0.34.0.0）；填空題作答前擲說服檢定，d20 加職業加值對怪物 DC，過了給答案第一個字（v0.35.0.0）。

## 研究怎麼加入 D&D 規則，讓遊戲更像 D&D

- **研究怎麼加入 D&D 規則，讓遊戲更像 D&D** · v0.35.0.0 · 2026-11-05 office-hours 挑出暴擊骰和說服檢定，兩個都已上線；靈感、自選攻擊或說服留在待辦。

## 精簡 README.md

- **精簡 README.md** · v0.33.1.0 · README 開頭只留一頁：遊戲是什麼、活動當天怎麼玩、本機執行與部署、測試指令；原本的完整說明收進「細節」折疊區（2026-11-05）。

## 每一題都由主持人宣布答案，選擇題和填空題節奏一樣

- **每一題都由主持人宣布答案，選擇題和填空題節奏一樣** · v0.33.0.0 · 隊伍鎖定選項後，主持人頁出現綠色「公布答案」（鍵盤 1）；按了大螢幕停頓 2 秒再揭曉，答對後等主持人按「下一題」，不再自動跳。

## 隊伍換手機或換瀏覽器後回不了遊戲

- **隊伍換手機或換瀏覽器後回不了遊戲** · v0.32.0.0 · 主持人頁每一隊都有「交給新手機」，按了會出現 4 位數配對碼（5 分鐘內有效、只能用一次）。

## 兩隊同名時分數會互相覆蓋

- **兩隊同名時分數會互相覆蓋** · v0.31.1.0 · 加入時擋下別隊已經在用的名字（不分大小寫和全形半形），和改名用同一個規則。

## 攻擊成功或失敗的旁白，武器和招式要配合隊伍的職業

- **攻擊成功或失敗的旁白，武器和招式要配合隊伍的職業** · v0.31.0.0 · 旁白事件帶上隊伍職業；AI 旁白照職業用武器和招式，腳本旁白的答對與擊中首領台詞也按職業分開寫。

## 正式遊戲開始前加玩法說明（文字＋圖片）

- **正式遊戲開始前加玩法說明（文字＋圖片）** · v0.30.0.0 · 開局前加入大螢幕玩法說明與主持人講稿。

## 遊戲結束後回到大廳，同一批人不用重新加入就能再玩一場

- **遊戲結束後回到大廳，同一批人不用重新加入就能再玩一場** · v0.29.0.0 · 主持人可保留隊伍回大廳重開，並避開前局已公布題目。

## 主持人可以提早結束遊戲

- **主持人可以提早結束遊戲** · v0.28.0.0 · 主持人可提早結束並依當前分數顯示頒獎台和後記。

## 大廳裡主持人可以踢掉隊伍、改隊名

- **大廳裡主持人可以踢掉隊伍、改隊名** · v0.28.0.0 · 大廳新增移除隊伍和修改隊名功能。

## 大螢幕連結搬到主持人頁最上方

- **大螢幕連結搬到主持人頁最上方** · v0.27.1.0 · 主持人頁頂端顯示大螢幕連結。

## 玩家手機先拿掉「冒險出現岔路」的選擇

- **玩家手機先拿掉「冒險出現岔路」的選擇** · v0.27.1.0 · （拿掉了；加回來另見「把「冒險出現岔路」的選擇加回玩家手機」）。

## 題庫編輯器加一個回首頁的按鈕

- **題庫編輯器加一個回首頁的按鈕** · v0.27.1.0 · 編輯器新增回首頁按鈕。

## 換一組新的 OWNER_KEY，並在正式站測題庫編輯器

- **換一組新的 OWNER_KEY，並在正式站測題庫編輯器** · v0.27.1.0 · 站長 2026-11-04 用 `wrangler secret put` 換好新的 OWNER_KEY 並自己保管。

## 地城料理風格 1：怪物變食材，打倒後端上一道菜

- **地城料理風格 1：怪物變食材，打倒後端上一道菜** · v0.27.0.0 · 題庫每隻怪物可附一道菜（部位、做法、菜名、評語），答對後大螢幕的正解面板下面出現「今晚的菜」，有菜的題庫分數改叫飽足感，旁白和後記會提到吃了什麼。

## 電視和主持人的螢幕會自動休眠

- **電視和主持人的螢幕會自動休眠** · v0.26.0.0 · `lib/use-wake-lock.ts`，大螢幕頁和主持人頁都用；回到前景再要一次，瀏覽器不支援或拒絕就照舊。

## 前端一當掉就整頁白屏，也沒有回報

- **前端一當掉就整頁白屏，也沒有回報** · v0.26.0.0 · `app/error.tsx`、`app/global-error.tsx` 顯示「畫面出錯了」和「重新載入」，並把錯誤送到 Worker 的 `POST /api/client-error` 記一筆 log。

## 用真的 API 驗證後記改用 Sonnet 5.5 之後還正常

- **用真的 API 驗證後記改用 Sonnet 5.5 之後還正常** · v0.25.0.0 · 2026-10-31（v0.25.0.0 出貨時）：`npm run test:live` 9/9 通過，包含後記（`claude-sonnet-5-5`）留住贏家名字的那一項。

## 「下一句這樣說」：主持人指定下一句旁白

- **「下一句這樣說」：主持人指定下一句旁白** · v0.25.0.0 · 主持人在 `⚙ 更多` 排一句，下一次旁白的第二句說出來（`docs/designs/host-next-line.md`）。

## 第一次連線就失敗時，畫面永遠停在「連線中…」

- **第一次連線就失敗時，畫面永遠停在「連線中…」** · v0.24.1.0 / v0.31.1.0 · 手機和大螢幕 10 秒沒連上就顯示「連不上伺服器」和「重試」（`lib/use-room-socket.ts` 的 `unreachable`）。

## 手機被拒絕加入時不顯示原因

- **手機被拒絕加入時不顯示原因** · v0.24.1.0 · 每種加入錯誤都有一句說明（`lib/join-rejection.ts`），也包含 `invalid_team_id`、`bad_token`；被拒絕的手機只顯示原因，不顯示遊戲畫面。

## AI 旁白沒有花費上限：任何人都能開房間觸發付費 LLM 呼叫

- **AI 旁白沒有花費上限：任何人都能開房間觸發付費 LLM 呼叫** · v0.21.0.0 · 主持人貼自己的 Anthropic key（或用站長金鑰），每房預設 300 句上限（spec #102）。

## 每隊有一個代表職業，戰鬥時有不同的特殊能力

- **每隊有一個代表職業，戰鬥時有不同的特殊能力** · v0.20.0.0 · 加入四種職業、各自的戰鬥能力與普通冒險者選項。

## 魔王分成多個階段，每階段題目不同

- **魔王分成多個階段，每階段題目不同** · v0.16.0.0 · 首領戰加入分階段血量、規則與題目。

## 主持人可以指定每一題要出題庫裡的哪一題

- **主持人可以指定每一題要出題庫裡的哪一題** · v0.15.3.0 · 主持人頁每隊旁邊有「指定下一題」，只能選這隊下一間房難度的題；已公布、別隊正在答、已排給別隊的題不能選；有隊伍在王房時另有「首領房下一題」。

## 8 支隊伍的大螢幕版面

- **8 支隊伍的大螢幕版面** · v0.15.2.2 · 實測後只有大廳擠（遊戲中的隊伍卡 8 隊仍看得清），大廳 5 隊以上改成每邊兩排、名字過長加「…」。

## 主持人頁的大螢幕網址要能直接點開

- **主持人頁的大螢幕網址要能直接點開** · v0.15.1.2 · 主持人頁「更多」面板裡的大螢幕網址（`/room/<代碼>/screen`）改成可以點的連結，在新分頁開啟。

## 背景音樂播放器：連點🎵的競態、背景分頁時音符擠成一團

- **背景音樂播放器：連點🎵的競態、背景分頁時音符擠成一團** · v0.15.1.3 · `lib/bgm-player.ts` 兩個問題：(1) `start()` 在 `await ctx.resume()` 之前才檢查 `timer`，連點 🎵 會開兩個 interval，`stop()` 只清掉一個，`resume()` 還沒好就 `stop()` 會讓 `ctx.currentTime` 拋 TypeError；(2) 大螢幕分頁在背景時瀏覽器把 timer 降到約每秒一次，排程落後，回來時已過時間的音符一次全部響。

## 題庫讀不懂時的後續：格式版本號、編輯器唯讀提示、救援步驟

- **題庫讀不懂時的後續：格式版本號、編輯器唯讀提示、救援步驟** · v0.15.0.2 / v0.15.2.0 · 完成格式版本、唯讀提示與救援步驟。

## 房間密碼（知道 4 碼代碼的人都能加入）

- **房間密碼（知道 4 碼代碼的人都能加入）** · v0.15.1.0 · 主持人可在大廳設定選填的加入密碼。

## 首領房的選擇題規則重新設計（手機作答之後）

- **首領房的選擇題規則重新設計（手機作答之後）** · v0.15.0.0 · 首領房選擇題答錯一律換題（D1=A），而且不再問重答／逃跑：紅格停 2 秒後自動換題、輪下一隊（D2=B）。

## 題庫改成依分數分類，房間依需要的難度抽題

- **題庫改成依分數分類，房間依需要的難度抽題** · v0.14.0.0 · 格式 v2（依難度分的題庫）、選項每場打亂、第 6～8 房與 20 題新題、編輯器分頁，見 [docs/designs/scoring-and-score-pools.md](docs/designs/scoring-and-score-pools.md) 的「PR B as built」。

## 重新設計計分（首領門檻、提早進王房的分數顯示、冠軍怎麼算）

- **重新設計計分（首領門檻、提早進王房的分數顯示、冠軍怎麼算）** · v0.13.0.0 · 規則見 [docs/designs/scoring-and-score-pools.md](docs/designs/scoring-and-score-pools.md)：進度分（只有主持人看得到）決定進王房，獎勵分決定冠軍；主持人可以從「更多」把隊伍送進王房。

## 共享大螢幕活地圖

- **共享大螢幕活地圖** · v0.10.0.0 · 大螢幕顯示地城地圖，各隊棋子從房間移到房間，首領房有血條。

## 背景音樂的低音全部擠在每圈結尾一起響

- **背景音樂的低音全部擠在每圈結尾一起響** · v0.9.15.1 · `lib/bgm.ts` 的 `songEvents()` 回傳的音符改成依 `start` 排序（或 `lib/bgm-player.ts` 的 `schedule()` 每個聲部分開排），再補一個單元測試確認事件按時間排列。

## localStorage「讀取，沒有就生成並存起來」邏輯重複

- **localStorage「讀取，沒有就生成並存起來」邏輯重複** · v0.9.14.0 · `lib/stored.ts` 的 `readStored` / `writeStored`，bank editor 與大螢幕都改用它（另見 `lib/room-code.ts` 的 `storedOrCreate`）。

## 首領登場的敘事事件（DM 分支回提用）

- **首領登場的敘事事件（DM 分支回提用）** · v0.9.11.0 · 沒有另開新事件（那會多一個 eventId、也要改 runner「每個事件恰好 emit 一次」的契約）：讓隊伍越過首領門檻的那次答對，`correct` 事件多帶 `entersBoss: { branches }`（隊伍一路上的分支選擇，依房間順序）。

## 主持人頁的鍵盤操作

- **主持人頁的鍵盤操作** · v0.9.10.0 · 主持人頁判分可以用鍵盤：`1` 答對、`2` 答錯・重答、`3` 答錯・逃跑；揭曉答案時 `1` 或 Enter 是「下一題」。

## 大廳營火

- **大廳營火** · v0.9.12.0 · `/screen` 大廳中央加了一個程式繪製的營火（`lib/pixel-art.ts` 的 `campfire` 精靈，兩格火焰用 CSS 交替閃爍，加上光暈），隊伍角色一半在左、一半在右圍著它跑進來；5 隊以上角色縮小、隊名過長截斷，8 隊也放得下（8 隊時最外側角色會稍微碰到兩側火把）。

## 怪物美術：目前只有三張圖

- **怪物美術：目前只有三張圖** · v0.9.13.0 · 第 3–5 房各有自己的角色，不再是換色：迷路史萊姆（藍色，頭上一個大問號）、愛哭幽靈（兩道眼淚、嘴巴扁扁）、守門史萊姆王（紫色，戴王冠拿長矛）。

## 玩家手機與大螢幕的斷線提示

- **玩家手機與大螢幕的斷線提示** · v0.9.9.0 · 手機和大螢幕網路斷線時顯示「連線中斷，重新連線中…」，連回來就自動消失（休息／過期仍用原本的提示）。

## 音效與背景氛圍音樂

- **音效與背景氛圍音樂** · v0.9.8.0 · 大螢幕 `/screen` 在開始遊戲、答對、答錯重答、逃跑、打中首領、打倒首領時各播一段 8-bit 音效，跟背景音樂一樣用 Web Audio 即時合成（`lib/sfx.ts`），沒有音檔、沒有授權問題。

## 語音旁白：語音清單還沒載完時到達的旁白會被永久靜默跳過

- **語音旁白：語音清單還沒載完時到達的旁白會被永久靜默跳過** · v0.9.7.0 · `/screen` 的 `speak()` 在語音開著、但語音清單還沒載入時，改成把最後一句存進 `pendingLines`，等 `voiceschanged` 讓 `ttsVoice` 出現後立刻補念；只保留最新一句，關掉語音或房間重置（LOBBY）時清掉。

## 房間過期時的關閉碼與提示跟「休息」共用，可能誤導

- **房間過期時的關閉碼與提示跟「休息」共用，可能誤導** · v0.9.6.0 · 過期改用自己的關閉碼 `4002`（`lib/room/close-codes.ts` 的 `CLOSE_EXPIRED`），三個頁面用 `restKindOf` 分辨，顯示「房間已過期：…上一場遊戲已經清除。

## 自動重連（非人為）也算活動，理論上可讓房間永不休息

- **自動重連（非人為）也算活動，理論上可讓房間永不休息** · v0.9.6.0 · 不用重構 `handleJoin`／`handleHostClaim`：`/host`、`/play` 的自動重連在 `HOST_CLAIM`／`JOIN` 上帶 `resume: true`（第一次連線、重新整理、按「重新連線」都不帶），房間照常接受、恢復身分，但不把它算成活動。

## 增加背景音樂

- **增加背景音樂** · v0.9.5.0 · 大螢幕 `/screen` 加了背景音樂：一段用 Web Audio API 即時合成的 A 小調 8-bit 地城循環（方波旋律＋三角波低音，`lib/bgm.ts` 是曲子資料、`lib/bgm-player.ts` 負責播放）。

## 語音旁白：重連時剛好落在 GAME_OVER 到 EPILOGUE 之間會漏念後記

- **語音旁白：重連時剛好落在 GAME_OVER 到 EPILOGUE 之間會漏念後記** · v0.9.4.0 · 採用 server 協議改動：`onConnect` 重送的 EPILOGUE 帶 `replay: true`，即時廣播不帶；`lib/narration/tts.ts` 的 `shouldSpeakEpilogue` 改成只看這個欄位，`/screen` 拿掉 `sawLiveGameOver`。

## 上傳但從未存檔的題庫圖片會永久留在 R2

- **上傳但從未存檔的題庫圖片會永久留在 R2** · v0.9.3.0 · 不用另寫週期性掃描：圖片一上傳成功就排進 v0.9.1.0 做好的延後刪除佇列（`BankStore.queueUploadedImage`，由 `worker/index.ts` 的上傳路徑呼叫 bank DO 的 `imageUploaded`）。

## 旁白 emit() 無條件覆蓋 lastNarration，較慢的舊事件可能在新事件之後 resolve 並蓋掉它

- **旁白 emit() 無條件覆蓋 lastNarration，較慢的舊事件可能在新事件之後 resolve 並蓋掉它** · v0.9.2.0 · 丟棄過期旁白，避免舊事件蓋過新事件。

## 遊戲進行中在題庫編輯器換圖，會立刻刪掉那一局還在用的 R2 圖片

- **遊戲進行中在題庫編輯器換圖，會立刻刪掉那一局還在用的 R2 圖片** · 2026-09-29 · 延後刪除未使用圖片，避免進行中的遊戲失去圖片。

## 修改主頁的背景圖，換成更有特色、更有內容的圖片

- **修改主頁的背景圖，換成更有特色、更有內容的圖片** · v0.9.1.0 · 主頁背景從單純的石牆換成一整幅程式繪製的地城走廊（第一人稱透視）：兩側磚牆延伸進黑暗、木樑天花板掛著鐵鍊與蜘蛛網、兩側牆上會閃爍的火把、盡頭一扇鐵箍木門與兩盞小壁燈，地上有骷髏、骨頭、寶箱和木桶，牆腳長青苔。

## 問答題／選擇題的題目可以是圖片／YouTube 影片／文字，並移除獨立的「圖片題」類型；公布解答時可加一段可換媒材的詳解

- **問答題／選擇題的題目可以是圖片／YouTube 影片／文字，並移除獨立的「圖片題」類型；公布解答時可加一段可換媒材的詳解** · v0.9.0.0 · 題目與詳解支援文字、圖片、YouTube。

## DM 語音旁白（瀏覽器 TTS）

- **DM 語音旁白（瀏覽器 TTS）** · v0.7.0.0 · 大螢幕用瀏覽器內建 Web Speech API（zh-TW 聲音）把旁白念出來，並提供關閉開關。

## 題庫編輯器：image 題型 + Cloudflare R2 上傳

- **題庫編輯器：image 題型 + Cloudflare R2 上傳** · v0.6.0.0 · 實作 Cloudflare R2 bucket binding、圖片上傳表單、`image` kind 的 schema、`/play` 顯示圖片。

## 題庫覆核：AI 起草的 8 題

- **題庫覆核：AI 起草的 8 題** · v0.7.1.0 / v0.7.2.0 · 查證 28 題，答案全數正確。

## 題庫編輯器：multipleChoice 題型

- **題庫編輯器：multipleChoice 題型** · v0.5.0.0 · `lib/question-bank.ts` 的 `kind` 判別聯集、`lib/protocol.ts` 的 `TEAM_SELECT_OPTION`、`lib/game-state.ts` 的 `Team.currentSelection`/`recordOptionSelection`、`lib/room/dungeon-room.ts` 的 `handleTeamSelectOption`、`/play` 選項渲染、`/host` 選擇高亮、題庫編輯器的題型切換 UI，全部完成並有測試覆蓋（433 單元測試 + e2e）。

## 斷線重連 / 狀態持久化完整方案

- **斷線重連 / 狀態持久化完整方案** · v0.2.0.0 · 由 persist-room-state PR（Durable Object 儲存、還原、重連）與 room-lifecycle PR（閒置關連線、24 小時過期）共同完成，見 `lib/room/dungeon-room.ts` 的 `persist()`／`restore()`／`onAlarm()`。

## PartyKit 正式部署（卡在工具本身的兩個相容性 bug）

- **PartyKit 正式部署（卡在工具本身的兩個相容性 bug）** · v0.2.0.0 · 改用 partyserver + wrangler 部署 Worker。

## 房間重啟時對 BankStore 發出用不到的 RPC

**Priority:** P3

**What:** `worker/index.ts`'s `Room.onStart()` 在每次房間喚醒時都呼叫 `bankOrFallback(() => ...getVersionedBank())`，但如果這個房間是「復原」（不是全新建立），緊接著的 `this.game.restore()` 會用房間自己存的 snapshot 覆蓋掉這個 RPC 結果——等於每次已存在房間醒來都白打一通 BankStore 的電話。

**Why:** `/review` adversarial pass（Claude subagent，2026-09-22）發現的：不是正確性問題（`bankOrFallback` 的容錯已經保護了它），純粹是多餘的延遲跟對 BankStore 可用性的非必要依賴——跟決策 7「房間不該依賴 BankStore 存活」的精神有點矛盾。

**Pros:** 修掉可以省一次 DO-to-DO 呼叫的延遲，也讓「已存在房間的喚醒完全不碰 BankStore」這件事名副其實。

**Cons:** 需要重排 `onStart()`/`restore()` 的順序（先確認 storage 有沒有既有 snapshot，再決定要不要打這通 RPC），改動比表面看起來大一點，且目前的浪費只是效能成本，沒有正確性風險。

**Context:** 見 [docs/designs/question-bank-editor.md](docs/designs/question-bank-editor.md) 決策 7，以及 `worker/index.ts` 的 `Room.onStart()`。

  - **更新（2026-10-03，維護輪 /plan-eng-review）：** 不能直接「有存檔就不抓」。`lib/room/dungeon-room.ts` 的 `reset()` 會用醒來時抓到的 `initialBank` 開新局，跳過抓取會讓閒置過期後重開的房間改用內建題庫，你在編輯器改的題目就不見了。正確修法是懶載入：`DungeonRoom` 收一個 `loadBank`，只在沒有存檔、存檔壞掉、`reset()` 時呼叫。決定（dec-f5965fd8）：先不做；
  - `worker/index.ts` 的 `onStart()` 有 `gstack-shortcut` 標記。升級觸發點：房間喚醒延遲或 BankStore 可用性成為實際問題。

**Depends on / blocked by:** 無，隨時可做，非阻塞。

---

## 說服檢定的剩餘小風險（/ship 2026-11-06）

**What:** v0.35.1.0 審查找到、這次沒修的幾項，都不影響分數和輪次：
1. 重啟後補發的大成功（`lostCrit`）在回到大廳或遊戲結束時沒有清掉。只有同一隊在下一局碰到同一題、而且又有 20 點紀錄時才會誤發。修法：回大廳和結束時設 `this.lostCrit = null`。
2. 擲到 20 但當下判定失敗（`roll_failed`）時，紀錄會留著；之後房間只要重啟，就會在很久以後補發這個大成功。要決定這種 20 該丟掉還是保留。
3. 補發的大成功如果在別的處理裡觸發，會蓋掉剛設的主持人提示（cue），兩段旁白也可能接連開始。
4. 舊的、隊伍 id 帶冒號的手機重新 JOIN 會被默默拒絕，沒有錯誤訊息（只有自製用戶端做得出這種 id）。
5. 答案太短而沒提示的檢定，如果之後法師給了提示，手機會改顯示「過了！提示法師已經給了」。

**Why:** 都是很少見的情況，活動前不必處理。1 是一行修法，下次動 `lib/room/dungeon-room.ts` 時順手做。

**Context:**
- `lib/room/dungeon-room.ts`（`lostCritOf`、`applyLostCrit`、回大廳）
- `lib/protocol.ts`（JOIN）
- `app/room/[code]/play/page.tsx`（檢定標籤）

**Effort/Priority:** S / P3

**Depends on:** 無。
