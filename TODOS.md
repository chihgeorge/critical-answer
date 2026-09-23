# TODOs


## 語音旁白：重連時剛好落在 GAME_OVER 到 EPILOGUE 之間會漏念後記

**Priority:** P3

**What:** `/screen` 的語音旁白（`lib/narration/tts.ts` 的 `shouldSpeakEpilogue`）用「這次連線有沒有先看過即時 GAME_OVER」判斷後記是不是重播。如果連線（重新整理、WS 重連）剛好落在首領死亡（GAME_OVER 廣播）到後記文字準備好（`EPILOGUE_DELAY_MS`，約 4 秒）之間，這個連線既沒收到即時 GAME_OVER，onConnect 也還沒有 `this.epilogue` 可以重播——4 秒後真正的即時 EPILOGUE 廣播抵達時，會被誤判成重播而永遠不念。畫面上後記文字正常顯示，但語音永遠漏那一段，沒有任何錯誤提示。

**Why:** adversarial review（`/review`，2026-09-23）找到的真實 bug，正確修法需要 server 協議改動（明確標記訊息是重播還是即時廣播）或一個只靠 client 的啟發式解法，兩者都有成本。

**Pros:** 修好後後記語音在所有重連時機下都能正確播放。

**Cons:** 發生機率低（4 秒視窗、需要剛好在那個時間點重新整理或斷線重連），需要 server 端配合才能徹底修好。

**Context:** 見 [docs/designs/dm-voice-narration-tts.md](docs/designs/dm-voice-narration-tts.md)、`lib/narration/tts.ts` 的 `shouldSpeakEpilogue`、`lib/room/dungeon-room.ts` 的 `sendEpilogue`（`EPILOGUE_DELAY_MS`）。

**Depends on / blocked by:** 無直接阻塞，等真的有人回報這個情況再處理。

---

## 語音旁白：語音清單還沒載完時到達的旁白會被永久靜默跳過

**Priority:** P3

**What:** `speak()`（`app/room/[code]/screen/page.tsx`）在 `ttsVoice` 還沒設定（語音清單尚未透過 `voiceschanged` 載入完成）時會直接不播放，且不會補念——如果旁白事件剛好在使用者點開開關跟語音清單真正載完之間的空檔到達，那句旁白就永久遺失，沒有任何提示。

**Why:** adversarial review（`/review`，2026-09-23）找到的缺口，設計文件本身已經點出語音清單非同步載入是已知風險，但目前只處理了「不對還沒準備好的清單呼叫 speak()」，沒處理「那句旁白後來要補念」。

**Pros:** 修好後不會在語音清單載入較慢的瀏覽器上漏念偶發的第一句旁白。

**Cons:** 需要加一個緩衝機制（記下最後一句還沒念的旁白，`voiceschanged` 後補念），語音清單通常載入很快，實際發生機率低。

**Context:** 見 [docs/designs/dm-voice-narration-tts.md](docs/designs/dm-voice-narration-tts.md)、`app/room/[code]/screen/page.tsx` 的 `speak()` 函式。

**Depends on / blocked by:** 無直接阻塞。

---

## Host 自訂題庫文字進 LLM prompt 前的內容審核

**Priority:** P3

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

## 題庫編輯器：image 題型 + Cloudflare R2 上傳

**Priority:** P3

**What:** 實作 Cloudflare R2 bucket binding、圖片上傳表單、`image` kind 的 schema、`/play` 顯示圖片。

**Why:** `question-bank-editor` PR 的 Step 0 complexity check 觸發（9+ 檔案、2 個新基礎設施在同一個 PR），使用者選擇把 image/R2 切到這個後續 PR，先讓 `BankStore` + `text` 題型上線。

**Pros:** 完成後題庫可以有圖片題，符合原設計文件的完整範圍。

**Cons:** R2 需要額外處理上傳大小限制、內容類型驗證、簽章 URL、房間關閉後的孤兒檔案清理——是這條功能線裡最重的一塊。

**Context:** 見 [docs/designs/question-bank-editor.md](docs/designs/question-bank-editor.md) 的決策 5（原 D4）與 NOT in scope 段落。

**Depends on / blocked by:** 無直接阻塞，可以在 `question-bank-editor` 的 text-only v1 之後任何時間做。

**更新（2026-09-22，`image-question-type` 分支完成）：** 已實作完成（image kind schema、R2 綁定、上傳 API、bank editor 上傳表單、`/play`・`/screen` 顯示圖片）。此項結案。

---

## 上傳但從未存檔的題庫圖片會永久留在 R2

**Priority:** P3

**What:** `lib/bank-store.ts` 的孤兒圖片清理機制是「存檔前後的 bank 內容比對」（`imageKeysOf(current) \ imageKeysOf(next)`）。這個機制結構上抓不到「上傳成功但從未被存進任何一版 bank」的圖片——因為它從沒被任何一版 bank「擁有」過，沒有「之前」可以比對。

**Why:** 觸發條件很日常：在題庫編輯器上傳圖片後，使用者還沒按「儲存」就關分頁、瀏覽器當機，或存檔時剛好版本衝突（409）。這張圖已經進了 R2，但永遠不會被任何清理邏輯發現。adversarial review 找到這個結構性漏洞（finding #2），未在本輪修。

**Pros:** 修了之後就沒有這個緩慢累積的儲存洩漏。

**Cons:** 沒有簡單修法——`beforeunload` 觸發不穩定（分頁被強制關閉時不會跑），穩妥做法需要一支背景排程 worker/cron 定期掃描「未被任何 bank 版本引用的物件」，複雜度超出這次 R2 整合的範圍。

**Context:** 見 [docs/designs/image-question-type.md](docs/designs/image-question-type.md) 的「R2 cleanup mechanism」決策；`lib/bank-store.ts` 的 `putBank()` 與 `lib/question-bank.ts` 的 `imageKeysOf()`。

**Depends on / blocked by:** 無直接阻塞。使用者決定：目前規模（單人維護、圖片數量少、R2 免費額度）下這只是浪費幾 KB～幾 MB，先延後，等真的在意儲存成本或圖片量變大時再做週期性掃描機制。

---


## ~~DM 語音旁白（瀏覽器 TTS）~~ ✅ 已完成 2026-09-22

**What:** 大螢幕用瀏覽器內建 Web Speech API（zh-TW 聲音）把旁白念出來，並提供關閉開關。已透過 `/office-hours` → `/plan-eng-review` → `/review` → `/ship` 完整流程實作，見 [docs/designs/dm-voice-narration-tts.md](docs/designs/dm-voice-narration-tts.md)。審查過程發現並修正兩個真實 bug（重播誤判導致語音修正被靜默吞掉、`zh-Hant-HK`/`zh-Hant-MO` 誤判為台灣腔），另有兩個較低嚴重度的邊角案例延後為上方的 P3 待辦項目。

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

**Context:** 見同上 CEO plan。房間規則後來由工程審查 T1 改成：所有隊伍共用一條線性房間，最後一房停在原地重複出題，不再追加額外房間。`/screen` 已經上線（題目、怪物、隊伍卡、頒獎台），只是還沒有地圖。

**Effort:** M（人工約 2 天 / CC 約 1 小時）　**Priority:** P2

**Depends on / blocked by:** 視覺方向定案（/plan-design-review）。

---

## 音效與背景氛圍音樂

**What:** 答對、答錯、逃跑、首領死亡各有音效，加上地城背景音。

**Why:** 音效是讓按鈕點擊變成「我真的在地城裡」的最低成本方式（審查 E4）。

**Pros:** 接在 `NarrationEvent` 下游；host 既有的「開始遊戲」按鈕可拿來解鎖瀏覽器自動播放限制。

**Cons:** 素材授權要弄清楚（CC0 或自行生成），這比寫程式更花時間。

**Context:** 見同上 CEO plan。2026-09-23 比對 `hitster_online` repo（同類 party-game 專案）時注意到它的 `VictoryPlayer.tsx` 有「瀏覽器擋自動播放 → 顯示按鈕讓使用者手動點一下解鎖」的處理模式，跟這次 DM 語音旁白（`lib/narration/tts.ts` 的解鎖 utterance）解決的是同一類問題，可以直接參考那個模式，不用重新設計。

**Effort:** S（人工約 1 天 / CC 約 30 分鐘）　**Priority:** P3

**Depends on / blocked by:** 第二輪的 `NarrationEvent` 接縫完成、素材授權來源確定。

---

## localStorage「讀取，沒有就生成並存起來」邏輯重複

**What:** 把 `useOwnerKey`（`app/bank-editor/page.tsx`）跟 TTS 開關偏好（`app/room/[code]/screen/page.tsx`）裡各自寫一份的「讀 localStorage、沒有就生成一個值存起來」邏輯，抽成一個共用的小工具函式。

**Why:** 純粹 DRY，不是 bug。2026-09-23 比對 `hitster_online` repo 時注意到它把同樣的邏輯抽成 `lib/device-id.ts` 的 `getOrCreatePersistedId(key)`，一行函式，值得抄這個做法。

**Pros:** 少幾行重複程式碼，之後要加第三個用到 localStorage 偏好的功能時直接複用。

**Cons:** 目前只有 2 個地方用到，效益有限；抽出來本身有一點重構風險（要小心兩邊 SSR-hydration-mismatch 的處理方式是否一致）。

**Effort:** XS（人工約 15 分鐘 / CC 約 10 分鐘）　**Priority:** P4

**Depends on / blocked by:** 無。

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

## 大廳營火

**What:** `/screen` 大廳中央加一個營火（或大火盆），隊伍的角色圍著它跑進來。

**Why:** 設計審查 2A 核准了「營火 + 大房間代碼 + 加入 QR + 各隊冒險者跑進來」，實作時只做了代碼、QR、隊伍角色和兩側火把，營火沒做。

**Pros:** 大廳是玩家最先看到的畫面，最能決定第一印象。

**Cons:** 需要新增一個動畫精靈（兩格火焰加光暈），畫面已經滿，要重排。

**Context:** 見 [docs/designs/critical-answer-iteration-2.md](docs/designs/critical-answer-iteration-2.md) 決定 2A。

**Effort:** S（人工約 0.5 天 / CC 約 20 分鐘）　**Priority:** P3

**Depends on / blocked by:** 無。

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

## 玩家手機與大螢幕的斷線提示

**What:** 玩家手機或大螢幕斷線時，畫面要有提示。

**Why:** 設計審查 2D 縮減範圍（決定 `ac659960`，完整度 5/10）：目前只有主持人頁有「重新連線中」。上限：玩家手機斷線後看到的是凍結畫面，不知道自己的回合被系統跳過了。程式裡有 `gstack-shortcut(dec-ac659960)` 標記。

**Pros:** 玩家知道自己斷線了、輪到誰被跳過。

**Cons:** 要決定斷線時的文案與重連後的補資訊。

**Context:** 觸發條件：第二次玩測有人搞不清楚為什麼被跳過，或遊戲要離開區網。

**Effort:** S（人工約 0.5 天 / CC 約 20 分鐘）　**Priority:** P2

**Depends on / blocked by:** 無。

---

## 主持人頁的鍵盤操作

**What:** 主持人用筆電時，判分鈕支援鍵盤（例如 1/2/3），並有清楚的焦點框。

**Why:** 設計審查 6C 選擇不做（決定 `6c02a72b`，完整度 3/10）。上限：筆電主持人只能用觸控板或滑鼠，鍵盤使用者沒有無障礙的焦點狀態。觸控目標已達標（判分鈕高 78px）。

**Pros:** 筆電主持人的判分速度更快；符合無障礙基本要求。

**Cons:** 約 15 行程式，但要決定快捷鍵不與瀏覽器衝突。

**Context:** 觸發條件：主持人反映筆電上判分太慢，或任何公開發布之前。

**Effort:** S（人工約 0.3 天 / CC 約 15 分鐘）　**Priority:** P3

**Depends on / blocked by:** 無。

---

## 怪物美術：目前只有三張圖

**What:** 幽靈、史萊姆、小黑龍之外，每個房間各有自己的角色。

**Why:** 題庫有 5 個怪物，但只畫了 3 個角色，第 3–5 房是同一張圖換色（`hue-rotate`）。

**Pros:** 房間之間更有辨識度，玩家記得「那隻怪」。

**Cons:** 每個角色要在 `lib/pixel-art.ts` 用程式一格一格畫，需要試幾次才好看。

**Context:** 怪物在 `data/question-bank.json` 的 `monster.sprite` 指定，換圖不用動規則。

**Effort:** M（人工約 1 天 / CC 約 45 分鐘）　**Priority:** P3

**Depends on / blocked by:** 無。

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

## 題庫覆核：AI 起草的 8 題

**What:** 每房最後 5 題和首領最後 3 題（共 28 題）是 AI 起草的台灣常識題，需要人工查證答案。

**Why:** 作者沒辦法上網查證。主持人在現場發現答案錯了會很尷尬，也會傷害玩家對答案的信任。

**Pros:** 避免錯誤答案進到遊戲。

**Cons:** 需要人工逐題查證。

**Context:** [data/question-bank.json](data/question-bank.json)。每房前 3 題（2026 年時事）來自第一輪題庫。

**Effort:** S（人工約 0.5 小時）　**Priority:** P1

**Depends on / blocked by:** 無，第二次玩測之前要做完。

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

**Context:** 見 `party/index.ts` 的 `handleJoin` 與 `handleHostClaim`。已經加上的：每隊密鑰、每房間 60 條連線上限。

**Effort:** S（人工約 0.5 天 / CC 約 20 分鐘）　**Priority:** P3（公開部署之前升 P1）

**Depends on / blocked by:** 正式部署（見上）。

---

## 「下一句這樣說」：主持人指定下一句旁白

**What:** 主持人在 `⚙ 更多` 輸入一句話，下一次旁白一定會把它自然地說出來，說完就用掉（一次性）。

**Why:** 第二次玩測（2026-09-21）的旁白紀錄顯示，主持人把「下一句是 不怕死的冒險者不知道珍珠是什麼意思？能吃嗎?」寫進導演筆記，但旁白完全沒說。原因是導演筆記在設計上只是語氣和風格的指示，不是逐字台詞。導演筆記的第二條「貨幣是什麼能吃嗎」拖到後記才出現。「改寫目前旁白」也不一樣：它換掉已經出現的那一句，不能預先安排下一句。

**Pros:** 主持人可以臨場插入笑點或情境梗；跟導演筆記（風格）和改寫（事後修正）分工清楚。

**Cons:** 要決定 AI 怎麼「自然地」放進去（要求必須包含這句，還是改寫過也行）、腳本旁白怎麼處理（直接當第一句？）、以及沒開 AI 時是否還有意義。

**Context:** 見 `lib/narration/llm.ts` 的 `buildPrompt`、`party/index.ts` 的 `HOST_SET_NOTES` 處理。順手做：導演筆記欄位的說明改成「語氣與風格，不是逐字台詞」。

**Effort:** S（人工約 0.5 天 / CC 約 30 分鐘）　**Priority:** P2

**Depends on / blocked by:** 下一個階段再做（2026-09-21 決定）。


---

## 房間過期時的關閉碼與提示跟「休息」共用，可能誤導

**What:** 房間閒置 2 小時（休息，遊戲仍保留）和閒置 24 小時（過期，房間已被整個清除）目前用同一個 WebSocket 關閉碼 `4001`，三個畫面也顯示同一句「房間休息中：太久沒有動作，連線已暫停，遊戲進度都還在」。過期時這句話是錯的：進度已經不在了。

**Why:** `/review`（2026-09-21，PR #15）由 Codex 外部審查指出。實際發生的條件很窄：需要有連線在過期那一刻剛好還連著、且從那之後沒有再重新連線過（一般手機和主持人頁重連時會送出訊息，等同重新計時，不會落入過期分支；主要風險在 `/screen`，因為它從不主動送訊息）。

**Pros:** 使用者不會被誤導以為進度還在；行為更誠實。

**Cons:** 需要新的關閉碼（例如 4002）、新的三語系提示文案、三個頁面（host/play/screen）的 `onClose` 都要改，且要決定過期後點「重新連線」該顯示什麼（房間其實是全新的空大廳）。

**Context:** 見 `lib/room/dungeon-room.ts` 的 `onAlarm()` 與 `expire()`，`lib/room/close-codes.ts` 的 `CLOSE_IDLE`，三個頁面裡對 `CLOSE_IDLE` 的處理。

**Effort:** S（人工約 3 小時 / CC 約 30 分鐘）　**Priority:** P3

**Depends on / blocked by:** 無，可獨立處理；建議等真人測試回饋再決定文案。

---

## 自動重連（非人為）也算活動，理論上可讓房間永不休息

**What:** `/host`、`/play` 每次 WebSocket 重新連上都會自動發送 `HOST_CLAIM`／`JOIN`（見各自的 `onOpen`），不論是使用者按下「重新連線」還是網路短暫抖動、手機系統自動重連。這些都被視為「活動」，重新計時房間的閒置時鐘。

**Why:** `/review` 的 Claude 對抗性審查（2026-09-21，PR #15）指出：如果一支手機或電腦在背景週期性自動重連（沒有人真的在用），房間就會一直被重新計時，永遠不會進入「休息」，等於免費額度保護（T16）在這個情境下失效。

**Pros:** 修正後更貼近「有人在用」的真實定義，行為更誠實。

**Cons:** 需要在 `handleJoin`／`handleRejoin`／`handleHostClaim` 區分「第一次加入」與「重連既有身分」，是中等重構，且要重新驗證所有重連相關的測試。

**Context:** v1.0 只給自己和朋友使用、不對外公開（2026-09-21 office-hours 決定），瀏覽器與行動裝置本來就會抑制背景分頁的自動重連，實際發生機率低。與此相關的 TODOS 項目「房間過期時的關閉碼與提示跟休息共用」也是同一類「/screen 沒有主動訊息」的邊界情況。

**Effort:** M（人工約 4 小時 / CC 約 40 分鐘）　**Priority:** P3

**Depends on / blocked by:** 無，可獨立處理；建議等實際聚會使用後看是否真的發生再決定要不要修。

---

## 首領登場的敘事事件（DM 分支回提用）

**What:** 新增一個「隊伍進入首領房」的旁白事件型別（`lib/narration/events.ts` 目前只有 `correct`/`boss-hit`/`boss-kill`，沒有進房事件），讓 DM 分支互動能在首領登場時回提隊伍先前選過的分支。

**Why:** `/plan-eng-review`（2026-09-21）的 Codex 外部審查指出這個接進點不存在，且共用首領可能在某隊進房前就被別隊打死，事件設計要處理這個時序問題。設計文件原本假設「首領登場時回提選擇」，但這一輪決定先不做，只做每房分支本身。

**Pros:** DM 分支互動的敘事收尾（讓玩家的選擇被記得、被提起）需要這個事件才能做。

**Cons:** 要新增事件型別、處理共用首領被搶先擊殺的時序、更新 narration runner 的事件契約。

**Context:** 見 [docs/designs/dm-branching-and-question-types.md](docs/designs/dm-branching-and-question-types.md)。`lib/room/dungeon-room.ts` 的 `handleHostJudge` 是唯一會產生 `NarrationEvent` 的地方，新事件要從那裡發出。

**更新（2026-09-21，DM 分支互動實作階段）：** 設計文件 Implementation Tasks 的 T4（LLM 不可用時跳過首領回提、不硬塞模板）併進本項——因為回提事件本身還沒做，T4 現在沒有程式碼可改，等這項開工時一起處理降級邏輯。`lib/narration/runner.ts` 目前對任何事件都保證恰好 emit 一次（LLM 失敗會自動換 scripted 備用台詞，不會卡住），新事件型別要決定是沿用這個「保證 emit」的既有契約（一定講一句話，用備用台詞頂）還是真的要能「完全跳過不講」——後者需要修改 runner 的契約，前者不用。

**Effort:** M（人工約 1 天 / CC 約 1 小時）　**Priority:** P2

**Depends on / blocked by:** ~~DM 分支互動（每房觸發版）先實作完成~~ — 已在 v0.3.0.0（2026-09-22）實作完成（`lib/game-state.ts` 的 `recordBranchChoice`／`TEAM_BRANCH_CHOICE`），本項不再被阻擋，可以開工。

---

## Completed

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

**What:** `worker/index.ts`'s `Room.onStart()` 在每次房間喚醒時都呼叫 `bankOrFallback(() => ...getBank())`，但如果這個房間是「復原」（不是全新建立），緊接著的 `this.game.restore()` 會用房間自己存的 snapshot 覆蓋掉這個 RPC 結果——等於每次已存在房間醒來都白打一通 BankStore 的電話。

**Why:** `/review` adversarial pass（Claude subagent，2026-09-22）發現的：不是正確性問題（`bankOrFallback` 的容錯已經保護了它），純粹是多餘的延遲跟對 BankStore 可用性的非必要依賴——跟決策 7「房間不該依賴 BankStore 存活」的精神有點矛盾。

**Pros:** 修掉可以省一次 DO-to-DO 呼叫的延遲，也讓「已存在房間的喚醒完全不碰 BankStore」這件事名副其實。

**Cons:** 需要重排 `onStart()`/`restore()` 的順序（先確認 storage 有沒有既有 snapshot，再決定要不要打這通 RPC），改動比表面看起來大一點，且目前的浪費只是效能成本，沒有正確性風險。

**Context:** 見 [docs/designs/question-bank-editor.md](docs/designs/question-bank-editor.md) 決策 7，以及 `worker/index.ts` 的 `Room.onStart()`。

**Depends on / blocked by:** 無，隨時可做，非阻塞。
