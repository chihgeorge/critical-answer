# 卡點題：自動校正喇叭延遲（timing-tap.md E3）

站長核准的行為（2026-11-16）。Branch: worktree-agent-abcf628f7c63a92bc
Status: APPROVED（/autoplan 2026-11-16，lean run，自動核准；lane 指示不問站長。樣張：`~/.gstack/projects/chihgeorge-critical-answer/designs/tap-calibrate-{host,phone,screen}.png`，只在本機）
合併：活動（2026-11-21）之後。這次只開 PR。

> e2e 只在 GitHub CI 跑，不要在本機跑 `npm run e2e`（見 CLAUDE.md, Testing）。

## 要做什麼

現在卡點題的喇叭延遲是主持人手動填（E3-lite，`HOST_TAP_LATENCY`）：事先放一題測試卡點題，照揭曉後的「把延遲改成…」按。這次加一個自動量的方法：大螢幕放 8 聲嗶，大家用手機跟著按，房間算出建議延遲，主持人按「套用」才寫進去。

站長的決定：

| # | 問題 | 決定 |
|---|---|---|
| C1 | 在哪裡按 | 大廳，主持人「⚙ 更多」裡的「🎯 校正喇叭」。遊戲中不能校正。 |
| C2 | 大螢幕 | 放 8 聲嗶，每秒一聲。只有聲音，畫面不跟著閃（大家照耳朵按，不是照眼睛）。 |
| C3 | 手機 | 每支加入的手機出現一顆大按鈕，跟著嗶聲按。 |
| C4 | 怎麼算 | 用現有的對時（`lib/tap-clock.ts`、`lib/server-clock.ts`）把每一下換成伺服器時間，跟排定的嗶聲時間比；丟掉前 2 聲；所有手機的所有按合起來取中位數；離中位數太遠的不算；按的次數太少就說「按的人太少，再試一次」。 |
| C5 | 結果 | 主持人頁顯示「建議延遲 N ms」和「套用」「取消」。只有「套用」會寫入喇叭延遲（送現有的 `HOST_TAP_LATENCY`），不會自動改。 |
| C6 | 聲音 | 大螢幕還沒開聲音時，不開始，改顯示現有的「開聲音」提示。🎵 關著也一樣（大螢幕那時回報沒聲音）。大螢幕正在放影片（大廳裡只有「大螢幕試播影音」會放）也不開始。 |

## 方案

### 協定（`lib/protocol.ts`）

- `HOST_TAP_CALIBRATE`（主持人 → 房間）：開始一輪校正。沒有欄位。
- `CALIBRATE_TAP { run, at }`（手機 → 房間）：`run` 是這輪的編號，`at` 是按下那一刻的伺服器 epoch 毫秒（`pointerdown` 的 `timeStamp` 加上對時 offset，跟 `TEAM_TAP.at` 同一把尺）。
- `LOBBY` 多兩個選填欄位：
  - `calibrate?: { run, startAt, beats, gapMs }`：校正進行中。`startAt` 是第 1 聲嗶的伺服器時間。大螢幕照它排嗶聲，手機看到它就顯示按鈕。
  - `tapLatency?: number`：目前的喇叭延遲（0 時不帶），結果卡片顯示「現在 M ms」。
- `SCREEN_CALIBRATE { run }`（房間 → 一台大螢幕）：只送給一台有金鑰、有聲音的大螢幕，只有它嗶。兩台都嗶的話大家會聽到兩次、各有各的延遲。
- `TAP_CALIBRATE_RESULT { run, ms, taps, phones }`（房間 → 主持人頁）：`ms` 是建議延遲，按的太少或結果不清楚時是 `null`；`taps`、`phones` 是算進去的按數和手機數。
- 拒絕（`ERROR invalid_action` 的 `detail`）：
  - `no_screen`：沒有大螢幕連著（現有的字）。
  - `screen_muted`：有大螢幕但沒開聲音或 🎵 關著。主持人頁在「🎯 校正喇叭」底下顯示黃色提示，指到大廳大螢幕上現有的開聲音按鈕：「大螢幕還沒開聲音：去點大螢幕上的『點一下開啟音效與氣氛』，再按一次」；🎵 關著時是「大螢幕的 🎵 音樂關著：在上面打開，再按一次」。（大廳沒有右下角的「👆 開聲音」，所以不直接沿用遊戲中的 `ScreenSoundBanner` 文字。）
  - `screen_testing`：「大螢幕試播影音」還在跑。
  - `calibrating`：這輪還沒結束。
  - 遊戲中按：`game_already_started`（跟試播影音一樣）。

### 房間（`lib/room/dungeon-room.ts`）

- 記憶體裡一個 `calib: { run, screenId, taps: { who, at }[], timer } | null`（`who` 是隊伍，重連或開兩個分頁還是同一支手機），不存檔：伺服器重啟就沒了，主持人再按一次。開始遊戲或房間重置時直接取消（不送結果，過期的房間不會被計時器再存回去）；嗶的那台大螢幕斷線就立刻結算成 0 下（主持人頁說「沒收到有效的按」）。
- `HOST_TAP_CALIBRATE`：照上面的拒絕條件檢查（試播影音「還在跑」是指還有片段沒回報；跑完留下的結果不擋），然後 `startAt = now + CALIBRATE_LEAD_MS`（3 秒，給手機和大螢幕對時），送 `SCREEN_CALIBRATE` 給一台大螢幕、廣播 LOBBY，排一個計時器在最後一聲之後 `CALIBRATE_TAIL_MS`（2 秒：最後一聲的視窗 0.7 秒加上 `acceptTapAt` 容許的 1 秒網路延遲）結算。`run` 用 `max(上一個 + 1, now)`，伺服器重啟後也不會重複。
- 反過來，校正進行中按「大螢幕試播影音」回 `calibrating`。
- `CALIBRATE_TAP`：只收有隊伍的連線（加入的手機）、`run` 對、這輪還在。`at` 走現有的 `acceptTapAt`（早於收到時間超過 1 秒不收，晚的夾到 +300 ms）。第一個算數的拍子之前的按不收（倒數時亂按不會用掉額度），每隊最多收 `CALIBRATE_BEATS * 2` 下（擋洗版）。不回 ack。
- 結算：純函式算建議延遲，送 `TAP_CALIBRATE_RESULT` 給每個主持人頁，清掉 `calib`，再廣播 LOBBY（按鈕和大螢幕字卡收起來）。開始遊戲時校正和試播影音都清掉。
- 結算寫一行 log：`{ event: "tap_calibrate", run, taps, phones, ms, latencyMs }`，活動後可以跟 `timing_round` 的紀錄對。
- `CALIBRATE_TAP` 不算活動、不存檔（跟 `CLOCK_PING` 一樣列在例外清單）：一輪最多 8 × 手機數則，每則都存檔沒有意義；主持人的 `HOST_TAP_CALIBRATE` 照常算活動。

### 算法（`lib/tap-clock.ts`，純函式）

常數：`CALIBRATE_BEATS = 8`、`CALIBRATE_GAP_MS = 1000`、`CALIBRATE_SKIP = 2`、`CALIBRATE_EARLY_MS = 300`、`CALIBRATE_OUTLIER_MS = 250`、`CALIBRATE_MIN_TAPS = 6`。

1. 每一下歸給一聲嗶：`k = floor((at − startAt + 300) / 1000)`，也就是嗶聲前 300 ms 到後 700 ms 之間都算這一聲（聽到的時間只會比排定的晚，所以往後留得多）。`k < 2`（前 2 聲）或 `k ≥ 8` 丟掉。
2. 同一支手機同一聲只算第一下。
3. 誤差 `e = at − (startAt + k × 1000)`。
4. 先取中位數 `m0`，丟掉 `|e − m0| > 250` 的（亂按、慢半拍的），剩下的再取中位數。
5. 剩下不到 6 下：`null`（「按的人太少，再試一次」）。6 下就是一支手機按滿後 6 聲，一個人試也能用；人越多越準。
6. 中位數早於 −150 ms：`null`（「量不出來：大家按得不齊，或延遲超過 0.7 秒」）。聽到的聲音只會晚，大幅提早代表延遲超過視窗（800 ms 會被讀成下一聲的 −200 ms），給 0 會是錯的。
7. 建議延遲 = 中位數，負的當 0。不是「現在的延遲＋中位數」：校正量的是絕對延遲，不經過現在的設定。

能量到的延遲上限是 700 ms（再晚就會被歸到下一聲，第 6 點擋掉大部分這種情況）。電視加藍牙一般在 100–300 ms。站長定了每秒一聲，所以不靠拉長間隔來加大範圍。

量到的值包含大螢幕的音訊輸出、電視、藍牙喇叭，也包含大家平均的反應偏差（按的人習慣晚一點按，卡點題比賽時也一樣晚），跟卡點題比賽時要扣掉的是同一個東西。

### 大螢幕（`app/room/[code]/screen/page.tsx`）

- 收到 `SCREEN_CALIBRATE` 時：開始對時（現有的 `useRoomClock` + `useClockPings`）。等到第 1 聲前 1 秒（對時的 8 次已經跑完）才用當時的 offset 一次排好 8 聲嗶：現有 bgm player 的 `pattern()`，host 層（`lib/sfx.ts` 加 `CALIBRATE_BEEP`）。`pattern()` 自己會往後推 20 ms，排的時候扣回來，不然這 20 ms 會被當成喇叭延遲。之後的對時不再移動已經排好的嗶。已經過去的嗶不補。
- LOBBY 帶 `calibrate` 時，每台大螢幕的音樂和環境音都靜音（`hold`），結束後恢復。
- 🎵 在校正中被關掉：剩下的嗶取消（`pattern()` 回傳的函式）。
- 畫面：大廳上方一張不動的字卡兩行「🎯 校正喇叭」／「聽嗶聲，用手機跟著按」。沒有閃、沒有倒數、沒有跟著拍子動的東西。

### 手機（`app/room/[code]/play/page.tsx`，新元件 `components/calibrate-tap.tsx`）

- 大廳裡、這支手機已經加入、LOBBY 帶 `calibrate` 時，在「等待主持人開始遊戲…」上面顯示：「🎯 校正喇叭」、「聽大螢幕的嗶聲，每一聲都按一下」，和一顆跟卡點題一樣大的圓按鈕「嗶！」。
- 按下用 `pointerdown` 的 `timeStamp` + offset，跟 `TapButton` 同一套；Enter／Space 也可以（按住不放的自動重複不算）；螢幕閱讀器的啟用是沒有 `pointerdown` 的 `click`，也算，但 `pointerdown` 之後 500 ms 內的 `click` 是同一下（`TapButton` 用 1.5 秒，這裡每秒一聲所以縮短）。對時還沒好時按鈕灰色「對時中…」。按下震動 30 ms，按鈕下方顯示「按了 N 下」。
- 這輪結束（LOBBY 不帶 `calibrate`）按鈕收起來。手機不顯示結果。

### 主持人頁（`components/more-drawer.tsx`、`app/room/[code]/host/page.tsx`）

- 大廳時「⚙ 更多」多一段「🎯 校正喇叭」（遊戲中不顯示）：說明一行「大螢幕放 8 聲嗶，大家用手機跟著按，算出卡點題的喇叭延遲」，下面一顆按鈕。
- 按下後按鈕變「校正中…大家跟著嗶聲按」灰色：從按下到下一則 LOBBY，之後跟著 LOBBY 的 `calibrate`（房間說了算，伺服器重啟或開始遊戲都不會卡住）。
- 結果卡片（在同一段）：
  - 有值：「建議延遲 N ms」、「現在 M ms・算了 T 下、P 支手機」，按鈕「套用」「取消」。「套用」送 `HOST_TAP_LATENCY { ms: N }`，卡片收起；「取消」只收起卡片。
  - 有值時多一行「套用後放一題測試卡點題，看揭曉的誤差中位數接近 0 就好」：嗶聲走網頁音效、卡點題走影片，路徑不完全一樣。
  - `null`：按數不到 6 是「按的人太少，再試一次」，不然是「量不出來：大家按得不齊，或延遲超過 0.7 秒。再試一次」；按鈕「再試一次」「取消」。
- 這次按下被拒絕（`screen_muted`、`no_screen`、`screen_testing`、`calibrating`）：在同一段顯示一行黃色說明，不進頁面的錯誤行（抽屜蓋住它）。

## 測試

- `lib/tap-clock.test.ts`：歸拍（早 300 ms、晚 700 ms 的邊界）、丟前 2 聲、同手機同拍只算一次、離群值、最少按數、略早當 0、800 ms 被讀成提早時不給數字。
- `lib/room/tap-calibrate.test.ts`：新訊息的驗型別；拒絕條件（非主持人、遊戲中、沒大螢幕、沒聲音、試播中、進行中）；只有一台有聲音的大螢幕收到 `SCREEN_CALIBRATE`；LOBBY 帶 `calibrate`；只收加入的手機和對的 `run`；晚到超過 1 秒的不收；結算送結果給主持人頁且清掉 `calib`；按的太少回 `null`；開始遊戲後不送結果；`CALIBRATE_TAP` 不算活動；試播跑完不擋、跑一半擋、校正中不能試播；套用走 `HOST_TAP_LATENCY` 且 LOBBY 帶新的 `tapLatency`。
- e2e：新 spec `e2e/tap-calibrate.spec.ts`（主持人按下、手機看到按鈕、按了、主持人看到結果並套用）。只在 CI 跑。

## 文件

- `docs/hosting.md`／`.en.md`：喇叭延遲那段加「🎯 校正喇叭」的用法。
- `docs/designs/timing-tap.md`：E3 指到這份。
- `DESIGN.md`：手機校正按鈕和主持人結果卡片。
- `TODOS.md`：E3 移到 Completed。
- `changelog.d/<branch-slug>.md`（`bump: minor`）。

## 不做

- 遊戲中校正。
- 每台大螢幕各自量：只有一台嗶（`SCREEN_CALIBRATE`），兩台大螢幕喇叭延遲不同時以嗶的那台為準。
- 自動套用。
- 手機看自己的誤差。

## Review record

### /autoplan 2026-11-16（lean run）

Lane 指示：站長已核准行為，全部自動決定、不問站長。這次是精簡版：Claude 自己做 CEO／設計／工程三方面的審查，外部聲音只跑一次 Codex（`codex exec`，唯讀，涵蓋三方面）。沒有跑完整 pipeline 的每階段 subagent、spec review loop 和 snapshot 工具。

UI scope：有（主持人抽屜、手機按鈕、大螢幕字卡）。DX scope：沒有（不是給開發者用的介面）。

**CEO**：前提（站長要、活動後合併）成立。TODOS.md 原本寫「先看活動那天的 `timing_round` 紀錄再決定值不值得做」；站長已經決定先做，PR 活動後才合併，這個順序沒有衝突。結算多寫一行 `tap_calibrate` log（含當時的 `latencyMs`），活動後可以跟 `timing_round` 對。範圍合適：只在大廳、不自動套用、手機不顯示結果。

**設計**（7 項各 0–10）：資訊層次 8、狀態涵蓋 9（閒置、校正中、有值、太少、量不出來、沒聲音、沒大螢幕、試播中）、使用者旅程 8、AI 味 9（沿用現有 Panel、PixelButton、卡點題按鈕的圓形）、設計系統一致 9、響應式 8（手機按鈕 `min(68vw, 260px)`）、無障礙 8（`role="status"`、鍵盤、螢幕閱讀器 click）。樣張三張見上。

**工程**：

```
host ⚙ 更多 ──HOST_TAP_CALIBRATE──▶ room ──SCREEN_CALIBRATE──▶ 一台大螢幕（pattern() 排 8 聲嗶）
                                     │ └─LOBBY{calibrate}──▶ 每台大螢幕（靜止字卡、hold 音樂）
                                     │                    └─▶ 加入的手機（CalibrateTap）
phone ──CALIBRATE_TAP{run, at}──────▶ room（acceptTapAt，每連線最多 16 則，不算活動）
                                     │ timer：startAt + 7 s + 2 s
                                     └─TAP_CALIBRATE_RESULT──▶ host 卡片 ──套用──▶ HOST_TAP_LATENCY
```

測試對應：`calibrateLatency` → `lib/tap-clock.test.ts`；房間訊息流 → `lib/room/tap-calibrate.test.ts`；三個畫面 → `e2e/tap-calibrate.spec.ts`（只在 CI 跑）。

**Codex 外部意見**（VERDICT: FINDINGS，11 項）與決定：

| # | 嚴重度 | 意見 | 決定 |
|---|---|---|---|
| 1 | High | 嗶聲（網頁音效）和卡點題（影片）量的路徑、按法不同，系統偏差量不到 | Taste：照站長的嗶聲做；結果卡片和 hosting 文件都寫「套用後放一題測試卡點題確認」 |
| 2 | High | 800 ms 延遲會被讀成下一聲的 −200 ms，最後建議 0 | 採用：中位數早於 −150 ms 不給數字（「量不出來」）；站長定了每秒一聲，不拉長間隔 |
| 3 | Medium | `pattern()` 多 20 ms | 採用：排的時候扣掉 |
| 4 | High | 3 秒前置不保證對時好，第一個 pong 就排會鎖住較差的 offset | 採用：第 1 聲前 1 秒才用當時的 offset 一次排好（burst 已跑完），之後不動 |
| 5 | High | 兩台大螢幕都會嗶 | 採用：`SCREEN_CALIBRATE` 只送一台 |
| 6 | High | 中斷時 UI 卡住、結果沒有 run | 採用：校正中狀態跟著 LOBBY；結果帶 `run`；`run` 用時間，重啟不重複；開始遊戲不送結果 |
| 7 | Medium | 試播影音要雙向互斥，且跑完的不該擋 | 採用 |
| 8 | Medium | 最後一聲的按可能在結算後才到 | 採用：結算延到最後一聲後 2 秒 |
| 9 | Medium | 重新連線換連線 id、被拒的訊息算活動 | 部分採用：`CALIBRATE_TAP` 整個不算活動；10 秒內重新連線算成兩支手機的情況接受（少見，只多算一支手機的按） |
| 10 | Medium | 大廳沒有右下角「👆 開聲音」 | 採用：大廳專用文字，指到「點一下開啟音效與氣氛」 |
| 11 | Medium | 重複點按的無障礙、文案 | 採用：按住不放的自動重複不算、click 去重 500 ms、「量不出來」另一句 |

<!-- autoplan-accepted:ceo -->
- 大廳才有「🎯 校正喇叭」；遊戲中 `game_already_started`。只有「套用」寫入喇叭延遲（`HOST_TAP_LATENCY`）。房間測試涵蓋。
- 結算寫 `tap_calibrate` log（run、taps、phones、ms、latencyMs）。
<!-- /autoplan-accepted:ceo -->

<!-- autoplan-accepted:design -->
- 大螢幕只有一張靜止字卡，沒有閃動或跟拍子動的東西；手機是卡點題同款圓按鈕、「對時中…」、「按了 N 下」；主持人卡片涵蓋閒置、校正中、有值、太少、量不出來與四種拒絕。樣張三張。e2e 檢查文字。
<!-- /autoplan-accepted:design -->

<!-- autoplan-accepted:eng -->
- 算法：歸拍 [−300, +700) ms、丟前 2 聲、同手機同拍一次、離中位數 250 ms 外不算、至少 6 下、中位數早於 −150 ms 不給數字、負的當 0；單元測試涵蓋邊界與 800 ms 混疊。
- 只有一台有聲音的大螢幕收到 `SCREEN_CALIBRATE`；試播影音雙向互斥；結算在最後一聲後 2 秒；`CALIBRATE_TAP` 不算活動；結果帶 run；開始遊戲不送結果。房間測試涵蓋。
- 大螢幕在第 1 聲前 1 秒一次排好嗶聲並扣掉 `pattern()` 的 20 ms；🎵 關掉取消剩下的嗶。
<!-- /autoplan-accepted:eng -->

DX：skipped（沒有開發者介面）。

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | CEO | 照站長要求先做，活動後合併 | Mechanical | P6 | 站長已核准 | 等活動資料再做 |
| 2 | Eng | 結果路徑偏差只文件化，不改用影片校正 | Taste | P5 | 站長指定嗶聲；影片校正要另一套播放與 anchor | 用影片片段校正 |
| 3 | Eng | 混疊用中位數下限擋 | Mechanical | P1 | 不給錯的 0 | 拉長間隔（違反站長的每秒一聲） |
| 4 | Eng | 只送一台大螢幕 | Mechanical | P1 | 兩台會互相干擾 | 只寫在文件 |
| 5 | Eng | 重新連線算兩支手機：接受 | Taste | P3 | 少見、影響小；要穩定 id 得改協定 | 用隊伍 id（會把同隊兩支手機合併） |
| 6 | Design | 大廳專用的開聲音提示 | Mechanical | P5 | 大廳沒有「👆 開聲音」 | 沿用遊戲中的 banner 文字 |
