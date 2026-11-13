<!-- /autoplan restore point: "/Users/georgechih/Repository/critical-answer/.claude/worktrees/agent-ac6ee36390880bc8d/.gstack/tmp/autoplan/worktree-agent-ac6ee36390880bc8d-autoplan-restore-20261112-211006.md" -->
## Implementation plan
# 卡點題（timing tap, boss room only）

站長 2026-11-12 的要求。Branch: worktree-agent-ac6ee36390880bc8d
Status: APPROVED（/autoplan 2026-11-12，自動核准；站長已看過三張樣張）
活動：2026-11-21，功能截止 2026-11-18

> e2e 只在 GitHub CI 跑，不要在本機跑 `npm run e2e`（見 CLAUDE.md, Testing）。

## 要做什麼

大螢幕放歌，每隊手機一顆大按鈕，每隊只能按一次，要按在歌裡某一個準確的時間點。例子：〈I Will Always Love You〉約 3:10「and I」前面那聲鼓「蹬」。最接近的隊伍算答對。

站長的決定（2026-11-12）：

| # | 問題 | 決定 |
|---|---|---|
| U1 | 誰按 | 所有隊伍同時按，最接近的算答對。資格照魔王音樂搶答（boss-buzzer.md、boss-music-buzzer.md）：在魔王房、在線。 |
| U2 | 計分 | 最接近的隊伍＝這題的一般魔王命中（扣血、命中獎勵）。其他隊依誤差拿小獎勵。大螢幕公布每隊誤差（秒）。 |
| U3 | 範圍 | 只在魔王房，跟音樂搶答並列。一般房間不做。 |

## 方案

### 題庫格式

新題型 `kind: "timing"`：

```json
{ "kind": "timing", "id": "b-tap-1",
  "content": { "kind": "youtube", "value": "3JWTaaS7LdU", "audioOnly": true, "start": 170, "end": 200 },
  "target": 190.35, "label": "蹬" }
```

- `content` 必須是片段：YouTube（可設 `start`/`end`、`audioOnly`）或上傳的影片／音檔（`video`/`audio`）。
- `target`：影片時間（秒），跟 `start`/`end` 同一把尺；可小數，存到毫秒（最多三位小數）。必須 ≥ `start`（沒設當 0）。有 `end` 時必須 `target + TAP_GRACE_S ≤ end`，不然片段先停、回合收不了。
- `label`：選填，最多 10 字，手機和大螢幕都看得到（「按在『蹬』那一下」）。目標秒數不公開，揭曉才公布。
- 可以有 `prompt`、`explanation`、`category`、`difficulty`，跟其他題目一樣。
- 只能放在搶答階段（`buzzer: true`）。搶答階段原本「只能填空題」（`lib/question-bank.ts` `parseBank` 和 `BossPhase.buzzer` 的註解、`app/bank-editor/page.tsx` 存檔前檢查那一行「只能放填空題」）放寬成「填空題或卡點題」。放在題目池或一般首領階段，`parseBank` 直接拒絕。
- 沒有 `answer` 欄位（不是填空題）。`answerText(q)`（揭曉和主持人頁看的正解字串）對卡點題回 `3:10.35「蹬」`（沒 label 時只有時間）。
- 單位：題庫裡的 `target`、`start`、`end` 都是秒（跟 YouTube 片段同一把尺）；協定和房間內部一律毫秒：`TEAM_TAP.at`、`SCREEN_TAP_CLOCK.anchor`、`CLOCK_PONG.server` 都是伺服器的 epoch 毫秒（`Date.now()` 那把尺），`HOST_TAP_LATENCY.ms`、`taps[].ms` 是毫秒。常數照單位加字尾：`TAP_GRACE_S`、`TAP_SETTLE_S`、`TAP_MAX_LAG_MS`、`TAP_MAX_LEAD_MS`、`TAP_HEALTH_LEAD_S`（健康檢查的 3 秒）。
- `parseBank` 的錯誤訊息帶實際數值，照現有 `question ${id} …` 的格式：`question b-tap-1: target 169.5 is before the clip start 170`、`question b-tap-1: target 199 + 2 s grace is past the clip end 200`、`question b-tap-1: target has more than 3 decimals`、`question b-tap-1: label is longer than 10 characters`、`question b-tap-1 is a timing question, so it must be in a buzzer phase`、`question b-tap-1: a timing question needs a YouTube or uploaded video/audio clip`。搶答階段原本那句 `every question in it must be a fill-in` 改成 `must be a fill-in or a timing question`。`fields` 只屬於填空題（`kind: "text"`），卡點題的解析不讀它。
- `BANK_FORMAT` 升一版（`TIMING_FORMAT`，放在 `formatOf` 判斷鏈的最前面，因為它是最新的）；有卡點題的題庫存成新版，舊程式拒絕覆寫而不是把題目丟掉。

### 時間怎麼量（重點）

按下的那一刻要對到大螢幕實際播出來的歌，不能用伺服器收到訊息的時間，不然網路延遲決定輸贏。

1. **對時（手機、大螢幕都做）**：`CLOCK_PING { t }` → 房間立刻回 `CLOCK_PONG { t, server }`。用戶端用 `performance.now()` 量來回時間 RTT，`offset = server − (t0 + t1)/2`。保留最近 8 筆，取 RTT 最小的那筆（NTP 的作法：RTT 越小，不對稱誤差越小）。卡點題出現時連打 8 次（每 150 ms），之後每 5 秒補一次。
2. **大螢幕回報播放時鐘**：播放卡點題片段時，大螢幕每 30 ms 讀一次播放器時間（YouTube `getCurrentTime()`，上傳檔 `currentTime`），只在數值變了的那一次取樣：`anchor = 現在 − 播放時間`（「影片 0 秒」在本機時鐘上的時刻）。YouTube 的時間是快取值，取樣只會偏晚，所以取最近 8 次取樣的最小值。換成伺服器時間後送 `SCREEN_TAP_CLOCK { questionId, anchor }`；暫停、緩衝、出錯時送 `anchor: null`。數值變超過 10 ms 就送，但最多每 250 ms 一則；沒變就每秒送一次（心跳，伺服器重啟後一秒內恢復）。最壞情況每秒 4 則，加上 8 次對時，仍在每連線限額（每秒 10、一次 30）內。
3. **手機按下**：用 `pointerdown` 事件的 `event.timeStamp`（觸控那一刻，不是 JS 開始跑的時候），加上 offset 換成伺服器時間，送 `TEAM_TAP { questionId, round, at }`（`round` 是手機看到的 `tapRound`）。offset 最新的樣本超過 10 秒就當成沒有（按鈕回到「連線中…」），`visibilitychange` 回到前景時立刻重新對時：iOS 休眠時 `performance.now()` 會停，舊的 offset 不能用。一次按下只送一則：`pointerdown`、Enter／Space 的 `keydown`、原生 `click` 都可能觸發，用手機本地的「送出中…」狀態擋掉重複。
4. **房間換算**：`at` 比收到時間早超過 `TAP_MAX_LAG_MS`（1000 ms）就拒絕（`tap_late`，手機顯示「沒算到：網路太慢，再按一次」並回到能按的狀態；不夾住，因為夾住會存下一個錯的時間，2 秒後的重送尤其會被扭曲）；比收到時間晚就夾到 `收到時間 + TAP_MAX_LEAD_MS`（300 ms）。再換成歌曲時間存起來。所有「伺服器時間 ↔ 歌曲時間」的換算都走同一個函式 `songMs(serverMs) = serverMs − anchor − 喇叭延遲`：按的時間、收回合計時（`target + 2 s` 換回伺服器時間時要把喇叭延遲加回去）、提早收的下限、片段開頭檢查，全部用它，不然延遲 L 會讓回合早 L 毫秒收掉。收到時沒有 anchor（音樂沒在放）就拒絕（`not_playing`），手機按鈕這時本來就是灰的。歌曲時間早於片段開頭（`start`，沒設當 0）也拒絕（`not_playing`）：⟲ 或跳轉剛換了 anchor 時，路上那個按的時間會落在新片段開始之前。
5. **房間的拒絕碼**（照現有的 `ERROR { error, detail }`；手機怎麼顯示見「畫面」的狀態表）：
   - `TEAM_TAP`：`not_playing`（沒有 anchor、或歌曲時間在片段開頭之前）、`tap_taken`（這隊這回合已經按過）、`tap_closed`（不是卡點題、還沒按 ▶、或回合已經收了）、`tap_late`（見上一點）、`stale_question`（`questionId` 不是現在這題，或 `round` 不是現在的 `tapRound`：⟲ 之前按的、還在路上的那一下）、`stunned`（暈眩坐掉這題）、`cannot_tap`（不在魔王房或這隊沒有在線的連線）。手機收到 `tap_closed`、`stale_question` 時回到 STATE 決定的狀態，不另外提示。
   - 手機按下後 2 秒沒收到 `TAP_OK` 也沒收到拒絕（連線掉了、被限流丟掉）：重送一次同一個 `at`，最多一次；斷線重連後也一樣。重送是安全的：已經記下的會回 `tap_taken`，當成已按。
   - `SCREEN_TAP_CLOCK { questionId, seq, anchor }`：`seq` 是大螢幕收到的 `MediaCommand.seq`（⟲ 一次加 1，現有欄位）。沒有大螢幕金鑰、`questionId` 不是現在這題、或 `seq` 不是現在的 `media.seq`，跟其他 `SCREEN_*` 一樣直接忽略，不回錯誤。⟲ 時房間先把 anchor 設成 null，等新 `seq` 的回報到了才恢復，舊片段的 anchor 不會回來。
   - 所有新訊息在 `parseClientMessage` 驗型別：`at`、`t`、`anchor`（非 null 時）、`ms`、`round`、`seq` 都要是有限數字，`questionId` 照現有訊息限制長度；不合就 `bad_message`。NaN 會穿過 `Math.min`／`Math.max` 弄壞排序。
   - `HOST_TAP_LATENCY`：不是有限數字由 `parseClientMessage` 擋（`bad_message`）；數字就四捨五入成整數、夾在 0–1000 存起來，不報錯。
   - 「🎤 現場放歌」（`HOST_BUZZ_OPEN`）在卡點題：`invalid_action`、`detail: "timing_needs_screen"`，主持人頁顯示「卡點題要大螢幕播放才能量時間，請改按『沒人答對，換下一題』」。
6. **訊息的方向和名字**：`TEAM_TAP`（手機 → 房間，照 `TEAM_*` 慣例）、`SCREEN_TAP_CLOCK`（大螢幕 → 房間）、`HOST_TAP_LATENCY`（主持人 → 房間）；`CLOCK_PING`（手機和大螢幕都會送，所以不加角色前綴）→ `CLOCK_PONG`；`TAP_OK`（房間 → 按的那隊）。每個都在 `lib/protocol.ts` 註解寫方向和單位。卡點題拒絕主持人判定沿用 `auto_judged`：它的意思本來就是「這題由房間自己判，不用主持人按」，主持人頁對它已經有處理。
7. **訊息規則**：`CLOCK_PING`、`SCREEN_TAP_CLOCK` 不算活動（不延後閒置關房、不存檔），跟 `SCREEN_SOUND` 一樣列在 `onMessage` 的例外清單；`CLOCK_PONG` 不走 `sendTo`（`sendTo` 每送一則就 `persist()`，把整個房間序列化一次），直接 `conn.send`，它不帶狀態。anchor 更新只在 `tapLive` 由有變無、由無變有時才 `broadcastState`；其他時候只悄悄重排收回合計時。房間測試檢查：一次 CLOCK_PING 不存檔，一次沒改變 `tapLive` 的 anchor 更新不廣播。兩者都經過 worker 現有的每連線 `RateLimiter`（每秒 10 則、一次最多 30 則），8 次對時加每秒一次心跳遠低於上限。
8. **喇叭延遲（E3-lite，主持人設定）**：電視、HDMI、藍牙喇叭會讓大家晚 L 毫秒才聽到。這會改變誰贏：量到的誤差是 L＋各隊自己的誤差，早按的隊伍會佔便宜。瀏覽器量不到這段（`outputLatency` 只到音訊裝置，不含電視），所以不用它，改成主持人「⚙ 更多」裡一個「喇叭延遲（毫秒）」數字欄：預設 0、範圍 0–1000，跟著房間存檔（`HOST_TAP_LATENCY { ms }`），房間換算時從歌曲時間減掉。彩排時放一題測試卡點題，大家照耳朵按，揭曉表上誤差的中位數就是要填的值（主持人頁在揭曉後顯示「這題誤差中位數 +0.21 秒」給主持人參考）。

### 回合流程

狀態放在 `BuzzState`（跟遊戲一起存檔）：多一個 `taps?: { teamId; ms }[]`（歌曲時間，按收到順序）。卡點題不用 `out`。

公開的東西：回合中誰按了不公開（早按的隊伍會讓別隊知道「快到了」，跟 E4 不做進度條同一個理由）。`view.buzz` 拿掉 `taps`，多一個 `tapRound`（數字，⟲ 一次加 1）。按下後房間回 `TAP_OK { questionId, round }`，送給**這一隊所有的連線**（隊友的另一支手機也一起變「已按」；別隊收不到，所以不算公開）；這隊的手機重新連上、而這回合它已經按過時，房間也補送一次。手機的「已按」只在 `questionId` 和 `round` 都對得上目前的 `buzz` 時才算，⟲ 之後自動失效。還是收到 `tap_taken`（兩支手機幾乎同時按）時，也當成已按。只有主持人頁的 STATE 多 `tapCount`（已按幾隊）。題目的公開資料（`PublicQuestion`）只多 `timing: { label? }`，沒有 `target`；STATE 不帶 `target` 也不帶任何毫秒數，房間測試要檢查。STATE 的 `tapLive?: true`：房間現在有這題的 anchor（來自採用中的那台大螢幕）。

1. 卡點題上大螢幕。跟音樂搶答一樣等主持人按 ▶（`openBuzz`）。
2. 手機：按鈕在「開放且大螢幕有回報播放時鐘（STATE `tapLive`）」時才亮。每隊只能按一次（`tapIn`）。資格：在線、在魔王房、沒被 💫 暈眩（暈眩照 R5 坐掉這題）。`buzzIn` 的「全部都暈就全部解除」是按下去才解，卡點題的手機在暈眩時是灰的、沒人會按，所以改成在開放時（`openBuzz`）就判斷：魔王房裡在線的隊伍全部都暈，就當場全部解除。資格只寫一個函式 `tapEligible(game, teamId)`，`tapIn`、提早收、主持人的分母、STATE 給手機的暈眩狀態都用它，不各寫一份；有單元測試（全部暈眩的回合照常能按）。
3. 收回合：
   - 歌曲時間過了 `target + TAP_GRACE_S`（2 秒）就收。
   - 所有有資格的隊伍都按了，就提早收，但至少等到 `target + TAP_SETTLE_S`（0.5 秒），讓大家聽到那一下。
   - 大螢幕回報片段播完（`SCREEN_CLIP_ENDED`）也收。卡點題要求這則回報帶 `seq`（新加的選填欄位，大螢幕填它收到的 `MediaCommand.seq`），`seq` 不是現在的 `media.seq` 就不收：⟲ 之前那次播完的回報晚到，不能把重新開始的回合收掉。其他題型照舊不看 `seq`。上傳的影音在公開資料裡也是 `hiddenVideo`（`kind: "youtube"` 記號，`lib/question-bank.ts` `hiddenVideo`），所以 `shownVideoId` 和播完回報對它一樣有效。
   - 收的時間用 anchor 算成伺服器時間排 `setTimeout`；anchor 變了、暫停或緩衝（anchor null）就重排／取消，下一個不是 null 的 anchor 到了再排。大螢幕一直沒恢復時，主持人按「沒人答對，換下一題」離開。
4. 結算（純函式 `tapResults`）：每隊誤差 = 歌曲時間 − target；誤差絕對值最小的贏，毫秒數一樣時先到房間的贏。沒有誤差上限：只要有按，最接近的就贏（站長 U2；差 1.9 秒也算命中，不要之後加門檻）。其他隊照誤差拿小獎勵 `TAP_BONUS_TIERS`：0.3 秒內 +3、0.6 秒內 +2、1 秒內 +1（寫成常數）；贏家不另拿級距獎勵，它拿命中獎勵。小獎勵直接加到隊伍的獎勵分（`reward`），不進改判清單；揭曉表就是它的紀錄，要修正用主持人現有的「設定分數／±5」。
5. 贏的隊伍：`buzz.teamId` 設成它，走一般的 `judge(..., correct)`（設 `teamId` 和 `judge` 在同一個狀態步驟裡，中間不廣播：`skipBuzz` 和手機都把 `buzz.teamId` 讀成「有隊伍在口頭回答」）：扣 1 格血、命中獎勵（廚師照算）、最後一擊照擲 4d20、旁白念命中台詞。揭曉（AnswerReveal）多一個 `timing`：目標秒數、label、每隊誤差和小獎勵、贏家。大螢幕公布表，手機看到自己的誤差。贏家跟搶答答對一樣成為下一題的選類別隊伍（M5 的 `picker`），這是刻意的。
6. 沒有任何隊伍按：當作「沒人答對，換下一題」（`skipBuzz`），不公開，題目之後還會出現。
7. 主持人 ⟲ 從頭：清掉這題已按的紀錄（歌曲時間的尺變了），`tapRound` 加 1，重新開放；手機顯示「重新開始，可以再按一次」2 秒。⏸：手機按鈕變灰、收回合計時停止，已按的保留。
8. 主持人的「答對／答錯」在卡點題不能按：`timing` 不加進 `isAutoJudged`（它還管鎖定選項和戰士擲骰），`handleHostJudge` 另外擋，兩種判定都回 `auto_judged`；「改判答對」不會出現（卡點題沒有答錯可以撤）；主持人的改判清單（#240）照常列出贏家的那次命中，可以照它現有的規則改（只動那隊的分數，不補回首領的血、不把命中換給別隊）；「沒人答對，換下一題」照常可以按。「🎤 現場放歌」在卡點題拒絕（沒有大螢幕就量不了時間），主持人頁說明改按換下一題。
9. 回合收掉後歌照常播到片段結束（跟現在搶答判定後一樣，播放器不停），揭曉畫面蓋在音樂卡上。

### 斷線與重啟

- 已按的隊伍斷線：按的紀錄保留，照常比。沒按的隊伍斷線：沒有資格，不等它。每次有隊伍上線／斷線都重新檢查「是不是都按完了」並重排收回合時間。所有有資格的隊伍都斷線也不重開回合：照常等到 `target + 2 s` 收，有人按就比，沒人按就換題。
- 回報 anchor 的大螢幕連線還在但不動了（分頁被凍結、休眠）：房間記下每次回報的時間，超過 `TAP_CLOCK_STALE_MS`（2500 ms，心跳一秒一次）沒收到就當成沒有 anchor，`tapLive` 變 false、收回合計時暫停，跟斷線一樣讓另一台大螢幕接手。
- 回報 anchor 的大螢幕斷線：房間清掉 anchor（按鈕變灰），別的大螢幕或重新連上的那台一秒內補上。兩台大螢幕都在放：只採用先回報的那一台，直到它斷線；它回報 `anchor: null`（暫停、緩衝）時還是它，另一台不會接手。
- 伺服器重啟：`taps` 在存檔裡；anchor、計時器只在記憶體。`MediaCommand` 也只在記憶體（重啟後沒有，大螢幕當成暫停），所以大螢幕的播放器若因此停下，anchor 會一直是 null，要主持人再按一次 ▶；播放器還在放時，心跳一秒內補回 anchor，計時器跟著重排。實作時確認大螢幕沒有 `media` 時播放器的行為，並在 hosting 出狀況那段寫「伺服器重啟後按一次 ▶」。

### 現場彩排與失敗備案

- 活動的題庫要真的排到卡點題：它只能在搶答階段，搶答階段從首領第 2 階段起（hosting 文件寫進彩排清單）。
- 彩排清單：放一題測試卡點題，確認大螢幕已經點過「點一下開聲音」（沒點過的大螢幕不會播，也就不會回報時鐘）、主持人頁「大螢幕播放時鐘：有」一直亮著、大螢幕留在前景（背景分頁的計時器會變慢）、填好喇叭延遲。
- 現場大螢幕放不出來或時鐘一直沒有：主持人按「沒人答對，換下一題」乾淨離開，題目不公開，遊戲照常往下走（房間測試涵蓋）。
- 接受的風險：不同手機的觸控延遲差 30–80 ms，量不到也不補。

### 作弊

- 目標秒數只在伺服器，揭曉才公布；手機只送一個時間戳，不知道 anchor，也不知道目標。
- 時間戳只收收到時間的 −1000 ms ~ +300 ms 內（太早的拒絕成 `tap_late`，太晚的夾到 +300 ms）：改過的手機程式最多能把按的時間往前謊報 1 秒（聽到鼓聲後再補按、謊報成剛好）。這在派對現場要有人自己寫程式改 WebSocket 訊息才辦得到，接受這個風險。
- 一隊多支手機：每隊只算第一次（`tap_taken`），換手機也一樣。
- 大螢幕回報只收有大螢幕金鑰（screen key）的連線，玩家手機不能假冒。

### 畫面

- 手機：沿用搶答按鈕 `BuzzButton` 的大圓鈕（`w-[min(72vw,280px)]`、4px `--k` 外框、內陰影），新元件 `TapButton` 放在同一個位置。按鈕上方一行小字（16px）說規則：「整首只能按一次，最準的隊伍命中」；label 那行 22px：「按在『蹬』那一下」，沒設 label 時「按在關鍵那一拍」。狀態用文字分，不只靠顏色：

  | 狀態 | 按鈕顏色 | 按鈕文字 | 能按 |
  |---|---|---|---|
  | 還沒按 ▶ | 灰 `#5a4a60` | 等音樂開始… | 否 |
  | 播放中、有時鐘、對時好了 | 紅 `#ff5050` | 按！ | 是 |
  | 對時還沒好（還沒收到 PONG） | 灰 | 連線中… | 否 |
  | 主持人 ⏸ | 灰 | 主持人暫停了 | 否 |
  | 開放中但 `tapLive` 沒了（緩衝、廣告、大螢幕斷線） | 灰 | 大螢幕卡住了，等一下 | 否 |
  | 按下、等房間回覆 | 金 `--warn` | 送出中… | 否 |
  | 收到 `TAP_OK` 或 `tap_taken` | 金 `--warn` | 已按 ✓ 等結果 | 否 |
  | 被拒絕 `not_playing` | 回到上面對應的狀態，下面一行 `--warn` 字：「沒算到：音樂剛停，等音樂再按」 | | 視狀態 |
  | 💫 暈眩 | 灰 | 被暈眩了，這題坐掉 | 否 |
  | 不在魔王房／離線 | 不顯示按鈕，沿用現有搶答階段的畫面 | | |
  | 揭曉：命中 | `--ok` | 命中！晚 0.12 秒 | 否 |
  | 揭曉：其他有按 | 灰 | 晚 0.12 秒・+3（第 2 名） | 否 |
  | 揭曉：沒按 | 灰 | 沒按 | 否 |

  按下用 `pointerdown`（只有按鈕本身，外面不算），同一個畫格就換成「送出中…」並震一下（`navigator.vibrate(30)`，iOS 沒有就只有畫面，E2）。鍵盤：按鈕是 `<button>`，Enter／Space 的 `keydown` 一樣用它的 `timeStamp`；`aria-live="polite"` 念出狀態文字；用現有的 focus-visible 外框。秒數一律寫「早／晚 0.12 秒」，不用 `+`／`−`。
- 大螢幕（960×540 舞台）回合中：音樂卡（`MusicCard`，照舊顯示 準備中／播放中／暫停／影片無法播放）旁邊的側欄放一個 `--lav` `Panel`：24px「♪ 卡點題」、28px「按在『蹬』那一下！」（沒 label：「按在關鍵那一拍！」）、16px「每隊只能按一次，最準的命中」。不放隊伍列（回合中不公開誰按了，空的隊伍列只是佔位）。
- 大螢幕揭曉：蓋在題目區的 cream `Panel`，寬 560px。第一行最大：贏家的隊伍帽子 `Sprite` ＋ 32px「命中！{隊名}」；第二行 24px「晚 0.12 秒」；第三行 16px `--dim-ink`「目標 3:10.35「蹬」」。下面每隊一列（最多 8 隊，每列 30px 高、20px 字），依誤差絕對值排序：名次、隊名（超過 110px 截斷加…）、「早／晚 0.40 秒」、小獎勵 `+3`（`--ok` 字在 `--k` 底的 `LabelChip`），贏家那列 `--turn` 底；沒按、暈眩排最後，`--dim-ink` 字寫「沒按」「暈眩」。平手時贏家那列多一個「同秒先到」小字。贏家誤差超過 1 秒時第一行寫「最接近！{隊名}」（計分不變，只是用詞）。
- 主持人頁：卡點題顯示「卡點題・已按 2/4 隊」（分母是現在有資格的隊伍：在線、在魔王房、沒暈眩，隨上線斷線更新）、「大螢幕播放時鐘：有／沒有」，沒有答對／答錯，保留「沒人答對，換下一題」。開放後時鐘「沒有」超過 3 秒，那行變成 `--warn` 底：「大螢幕卡住了：確認大螢幕在前景、按 ▶；不行就按下面的『沒人答對，換下一題』」，按鈕就在這行下面。揭曉後顯示「這題誤差中位數：晚 0.21 秒（喇叭延遲現在 120 ms）」和一個 44px「把延遲改成 330 ms」按鈕（新值 = 現在的延遲 + 中位數，夾在 0–1000；誤差是早的就減），按了才送 `HOST_TAP_LATENCY`。⚙ 更多裡的數字欄旁邊一行字：「彩排放一題測試卡點題，揭曉後按『把延遲改成…』；再放一題，中位數接近 0 就對了」。
- 編輯器：搶答階段的題目多一個題型「卡點題」：目標秒數（`.px-input`，`step 0.01`，欄位右邊即時顯示 `3:10.35`）、label（`maxLength 10`）。內容只能選 YouTube 或上傳的影音。「跟著按」：▶ 試聽片段播放時按一下，把播放器當下的時間記成目標秒數（E1）；旁邊「−0.05」「+0.05」微調鈕，和「從目標前 3 秒試聽」，讓出題的人再聽一次核對（跟著按會帶到自己的反應時間，通常偏晚 0.1–0.2 秒，欄位下面一行字提醒）。錯誤訊息寫在欄位下面：「目標要在片段開頭之後」「目標要比片段結尾早 2 秒以上」「卡點題只能放在搶答階段」「label 最多 10 個字」。

### 題庫健康檢查

`lib/bank-health.ts` 多兩種黃燈（都是提醒，不擋開場），每一列照現有格式帶位置、題號，問題文字直接寫怎麼改：
- 「卡點題的目標離片段開頭不到 3 秒：大螢幕的播放時鐘還沒校準好。把片段開頭往前移 3 秒以上」。
- 「卡點題用 YouTube：可能有廣告、播放時間比較不準。建議改成上傳的音檔」，沒設 `end` 時後面加「；也沒設片段結尾」。
健康檢查本來就從主持人頁「檢查題庫」和編輯器打開，不另外加入口。

### 測試

- `lib/server-clock.ts`：offset 計算、取最小 RTT、樣本視窗。
- `lib/tap-clock.ts`：anchor 最小值濾波、跳動（seek）重置、扣掉主持人設的喇叭延遲；`tapResults` 誤差、排序、平手、獎勵級距；收回合時間。
- `lib/game-state.ts`：`tapIn` 的資格（離線、不在魔王房、暈眩、已按、未開放、題目過期）、結算後的命中和獎勵、沒人按的換題、⟲ 清空。
- `lib/question-bank.ts`：解析和驗證（片段、target 範圍、只能在搶答階段、label 長度）；`docs/question-bank.md` 裡那段卡點題 JSON 例子原樣放進測試，確認 `parseBank` 收得下（文件和程式不會各說各話）。
- 房間（dungeon-room 測試）：TEAM_TAP 換算和夾住、不收沒 anchor 的、全部按完提早收、計時收、SCREEN_TAP_CLOCK 只收有金鑰的大螢幕、揭曉帶 `timing`；`TAP_OK` 只送給按的那隊的每條連線（別隊收不到）、重新連上補送、⟲ 後 `tapRound` 加 1。
- 手機狀態文字：抽成純函式 `tapButtonState`（輸入 STATE 和這支手機的 ack，輸出狀態），單元測試涵蓋上面表格每一列。
- 競態和效能（房間測試）：⟲ 之前按的那一下（舊 `round`）回 `stale_question`、舊 `seq` 的 anchor 被忽略；全部暈眩的回合能按；喇叭延遲 L > 0 時收回合時間晚 L；2 秒後的重送回 `tap_late` 而不是被夾住；CLOCK_PING 不存檔、沒翻轉 `tapLive` 的 anchor 不廣播；NaN 的 `at` 回 `bad_message`。
- 其他依題型分支的地方都要接住 `timing`（它沒有 `answer`）：`scripts/check-bundle.sh` 的 `answer(q)`（不然題庫裡有卡點題時 KeyError）、`lib/text-bank.ts`、`lib/bank-editor-question.ts`、`dungeon-room.ts` 讀 `q.answer` 的地方（`HOST_ANSWER`、法師提示、檢定）。`check:bundle` 用含卡點題的測試題庫跑一次。
- e2e 不在本機跑。

### 文件（中英成對）

- `docs/question-bank.md`／`.en.md`：編輯器那段加卡點題（搶答階段才有、目標秒數、label、跟著按、微調、試聽）；格式號碼那句加「有卡點題的存成格式 11」；回滾那段加「存過卡點題之後（格式 11），回滾到加入卡點題以前的版本也一樣變唯讀，房間裡存著的含卡點題題庫副本舊版也讀不懂（房間重開）；要回滾先刪掉卡點題再存檔」。附一段可以直接複製的 JSON 例子：一個完整的搶答階段（`buzzer: true`、一題卡點題），每個欄位一行說明；寫完怎麼確認：編輯器存檔會跑 `parseBank`，錯誤訊息寫在欄位下面，再按主持人頁的「檢查題庫」看黃燈。
- `docs/rules.md`／`.en.md`：「搶答階段」加一段卡點題：所有隊伍一起按、每隊一次、最接近的命中、其他隊 0.3／0.6／1 秒內 +3／+2／+1、沒人按就換題。
- `docs/hosting.md`／`.en.md`：卡點題怎麼主持；彩排清單；喇叭延遲怎麼校正（放一題、按「把延遲改成…」、再放一題看中位數接近 0）；出狀況：大螢幕卡住先確認前景再按 ▶，不行就換下一題；兩台大螢幕時卡住的那台關掉分頁，另一台一秒內接手；目標秒數現場發現不準時用 ±5 補分；最快排到卡點題的方法：彩排用的題庫第 1 階段（一般首領階段，搶答階段不能是第 1 階段）只放一題、血量設 1，答對一題就進第 2 階段，第 2 階段設成搶答階段放卡點題。
- `changelog.d/<branch-slug>.md`（`bump: minor`）；`TODOS.md` 加 E3 自動校正。

## 不做

- 一般房間的卡點題。
- 多個目標點（一首歌按好幾下）。
- 自動的喇叭延遲校正（例如大螢幕放嗶聲、大家跟著按、自動算中位數，E3）：活動後看實測再說，記在 TODOS.md。這次只做主持人手動填的數字（E3-lite）。
- 誤差上限（差太多不算命中）：站長 U2 決定最接近就算，兩個審查聲音都提過，留給站長在最後確認時決定。

<!-- autoplan-accepted:ceo -->
- Timing-tap is a `kind: "timing"` boss question allowed only in buzzer phases, content a YouTube or uploaded clip, `target` seconds (ms precision) ≥ start and, with `end`, `target + TAP_GRACE_S ≤ end`; optional `label` ≤ 10 chars; tested in question-bank unit tests.
- Taps are judged against the big screen's media clock: phone NTP min-RTT offset, screen anchor from change-only sampling with a sliding minimum, host-entered speaker latency (E3-lite) subtracted, phone `pointerdown` `timeStamp`; never server receive time. Clock math unit-tested.
- Server clamps tap timestamps to `[receive − 1000 ms, receive + 300 ms]`, refuses taps with no live anchor, one tap per team; target hidden until reveal; screen reports only from keyed screens. Tested in room tests.
- Closest |error| wins the normal boss hit through `judge()`; ties go to the earlier-received tap; other teams get `TAP_BONUS_TIERS` (0.3 s +3, 0.6 s +2, 1 s +1); nobody tapped → skip unrevealed; reveal carries per-team error rows. Unit-tested.
- Round closes at `target + 2 s`, or when every eligible team tapped but not before `target + 0.5 s`, or on clip end; ⟲ clears taps; ⏸ greys the button and stops the close timer.
- E1: editor 跟著按 records the preview's current time as target. E2: phone vibrates once on tap.
- Bank health adds yellow rows for target < start + 3 s and for YouTube timing questions (recommend upload; also mention a missing `end`).
- E3 full calibration (an automatic tap test) deferred to TODOS.md; E3-lite (host-entered latency) is in this plan (replacement stated in the next bullets).
- Taps whose song time falls before the clip start are refused; CLOCK_PING and SCREEN_TAP_CLOCK are non-activity messages under the worker RateLimiter; bonuses go straight to `reward` outside the 改判 ledger; the reveal lists every team (沒按, 暈眩 last); a null anchor re-arms on the next live one.
- No per-team tap information is public during a round (no `tapped` list, no target, no ms in STATE or PublicQuestion); host STATE has `tapCount`; STATE `tapLive` means the chosen screen has a live anchor; room test asserts the absence.
- The winner gets no tier bonus, becomes the M5 picker, and wins at any error (no floor). Host 改判 list stays allowed for timing questions.
- E3-lite replaces outputLatency: host sets 喇叭延遲 ms (0–1000, saved with the room, `HOST_TAP_LATENCY`), subtracted from song time; host sees the reveal's median error; no `outputLatencyMs()` in bgm player. YouTube timing questions get one yellow health row recommending upload. Rehearsal checklist and the host-skip fallback are documented and the skip is room-tested.
- `timing` stays out of `isAutoJudged`; handleHostJudge refuses both verdicts; a teammate's second phone learns of the team's tap from `tap_taken`; SCREEN_TAP_CLOCK is throttled to one per 250 ms plus a 1 s heartbeat; the editor's buzzer-phase save check is loosened too.
- Early close re-checks on every presence change; the chosen screen keeps ownership through `anchor: null`; timing questions never use `buzz.out`.
<!-- /autoplan-accepted:ceo -->

<!-- autoplan-accepted:design -->
- Phone `TapButton` reuses the BuzzButton circle; a 16px rule line 「整首只能按一次，最準的隊伍命中」 and a 22px label line (fallback 「按在關鍵那一拍」) sit above it; the 13-row state table in 畫面 is the contract (text states, not color only), implemented through a pure, unit-tested `tapButtonState`.
- Tap acknowledgement: the room sends `TAP_OK { questionId, round }` to every connection of the tapping team (never other teams) and resends it to a reconnecting team connection; `buzz.tapRound` increments on ⟲ and invalidates phones' 已按; `tap_taken` also counts as tapped; a `not_playing` refusal restores the button with 「沒算到：音樂剛停，等音樂再按」. This replaces the CEO bullet's "a teammate's second phone learns of the team's tap from `tap_taken`".
- `pointerdown` on the button only (or Enter/Space keydown) gives same-frame 送出中 + vibrate; `aria-live` state text; house focus ring; 早／晚 wording instead of +/−.
- Screen round: side `--lav` panel (♪ 卡點題, label prompt, rule line), no team row. Screen reveal: 560px cream panel, winner hat + 32px 「命中！{隊名}」 (「最接近！」 when the winner's error > 1 s, scoring unchanged), 24px error, 16px target; ≤ 8 rows of 30px/20px sorted by |error|, bonus `LabelChip`, `--turn` winner row, 「同秒先到」 on a tie, 沒按/暈眩 last in `--dim-ink`; names truncated at 110px.
- Music keeps playing to the clip end after the round closes; the reveal covers the music card.
- Host: 「已按 n/m 隊」 with m = currently eligible teams; clock missing > 3 s turns the line `--warn` with the recovery text and the skip button right under it; after a reveal, the median line and a 44px 「把延遲改成 X ms」 button (current + median, clamped 0–1000) that sends `HOST_TAP_LATENCY` only when pressed; the ⚙ 更多 field carries the two-question calibration hint.
- Editor: m:ss.cc display beside the target field, −0.05/+0.05 nudges, 「從目標前 3 秒試聽」, a reaction-bias hint, and per-field error copy for the four validation failures.
- Tests: `tapButtonState` rows; room tests for TAP_OK scope, reconnect resend and `tapRound`.
<!-- /autoplan-accepted:design -->

<!-- autoplan-accepted:dx -->
- Units are explicit: bank `target`/`start`/`end` in seconds; `TEAM_TAP.at`, `SCREEN_TAP_CLOCK.anchor`, `CLOCK_PONG.server` in server epoch ms; constants carry `_S`/`_MS` suffixes. Timing questions have no `answer`; `answerText(q)` returns `m:ss.cc「label」`.
- `parseBank` messages carry actual values in the existing `question ${id}` form (six listed in 題庫格式); the buzzer-phase message becomes `must be a fill-in or a timing question`; the doc's JSON example is pasted into a question-bank test so docs and parser agree.
- Room refusal codes are fixed: `not_playing`, `tap_taken`, `tap_closed`, `stale_question`, `stunned`, `cannot_tap` for TEAM_TAP; unkeyed or wrong-question SCREEN_TAP_CLOCK is dropped silently; HOST_TAP_LATENCY non-finite → `bad_message`, else rounded and clamped 0–1000; HOST_BUZZ_OPEN on timing → `invalid_action` with detail `timing_needs_screen` and host copy.
- Phone resends the same `at` once when neither TAP_OK nor a refusal arrives within 2 s, and after reconnect; idempotent through `tap_taken`.
- Message direction and naming are documented in `lib/protocol.ts`; `auto_judged` is kept for host verdicts on timing (meaning: the room judges this question).
- Health rows are advisory (never block the opening), each with fix text in the problem line.
- Docs: question-bank (zh+en) gets a timing section with a complete buzzer-phase example, field notes, how to validate, format 11 and rollback (including in-progress rooms); rules and hosting pairs get the scoring text, rehearsal checklist, latency calibration, recovery steps and the fastest rehearsal path; changelog.d fragment `bump: minor`; TODOS.md E3.
<!-- /autoplan-accepted:dx -->

<!-- autoplan-accepted:eng -->
- TEAM_TAP carries `round` (tapRound) and a mismatch is `stale_question`; SCREEN_TAP_CLOCK carries the screen's `MediaCommand.seq` and a mismatch is dropped; ⟲ nulls the anchor until a new-seq report; SCREEN_CLIP_ENDED gains optional `seq`, required to match for timing questions only. Room-tested.
- The room expires the anchor after `TAP_CLOCK_STALE_MS` (2500 ms) without a report: `tapLive` false, close timer paused, another screen may take over. Room-tested.
- A tap older than `receive − TAP_MAX_LAG_MS` is refused as `tap_late` (phone: 「沒算到：網路太慢，再按一次」, button live again), not clamped; the lead side clamps to +300 ms. This replaces the CEO bullet's lag-side clamp.
- One `songMs(serverMs) = serverMs − anchor − latency` is used for taps, the close time, the early-close floor and the clip-start check; tested with latency > 0.
- CLOCK_PONG goes out by `conn.send` without persist; anchor updates broadcast STATE only when `tapLive` flips; room test asserts no save per ping and no broadcast for a non-flipping update.
- All new message fields are finite-number checked in `parseClientMessage` (`bad_message`), `questionId` length-bounded.
- One `tapEligible(game, teamId)` drives tapIn, early close, host denominator and the phone's stun state; when every online boss-room team is stunned at open, all are cleared. Unit-tested.
- Winner: `buzz.teamId` set and `judge()` called in one state step without a broadcast between.
- Phone offset is stale after 10 s (button 連線中…), re-ping on `visibilitychange`; one TEAM_TAP per press across pointerdown/keydown/click.
- Every kind switch handles `timing` (no `answer`): scripts/check-bundle.sh, lib/text-bank.ts, lib/bank-editor-question.ts, dungeon-room `q.answer` readers; check:bundle runs with a timing fixture.
- `auto_judged` is reused as the `detail` of `invalid_action`. Rehearsal checklist adds the screen's tap-to-unlock-audio; hosting adds "after a server restart press ▶ once"; the fastest rehearsal path uses phase 1 (normal, 1 question, HP 1) then a buzzer phase 2.
- Buzzer-phase regression contract: non-timing, non-fill-in kinds stay refused in buzzer phases (existing tests kept, multipleChoice case added).
<!-- /autoplan-accepted:eng -->
## Review record

### CEO review — Step 0 (SELECTIVE EXPANSION, auto-decided by /autoplan)

**System audit.** Clean worktree off main `ba3adc3` (v0.68.0.0). No in-flight timing/tap work on origin/main (`git log origin/main --grep=timing` → nothing relevant). A parallel lane (記憶題) is editing `lib/question-bank.ts`, `app/bank-editor/page.tsx`, the screen and the phone question display: merge conflicts expected, keep shared-file edits small. TODOS.md has no timing item. Recent history: buzzer phase (v0.55), music-buzzer M1–M5, multi-field, uploaded media (format 10), bank health check (#241).

**Taste calibration.** Good references: `lib/game-state.ts` buzz functions (`buzzIn`, `skipBuzz`, `rotatedBuzz`: pure, small, comment the why); `lib/room/rate-limit.ts` (one class, clear contract); `components/file-player.tsx` (mirrors YoutubePlayer through `playerSteps`). Avoid: growing `judgeNow` further with more inline branches (it is already ~200 lines); avoid another per-question in-memory map on the room without a clear owner.

**Landscape (in-distribution; search not run for a party-game niche).** Layer 1: rhythm games (Guitar Hero, osu!, Rock Band) solve this with a per-device audio/visual latency calibration and judge taps against the local audio clock. Kahoot/Jackbox avoid timing-precision mechanics entirely because phones are on varied networks. Layer 2: NTP-style min-RTT offset estimation is the standard for browser multi-device sync (e.g. timesync libraries). Layer 3: here the audio plays from ONE shared speaker, so all teams hear the same sound at the same moment; the only per-device error is the phone's touch-to-timestamp path and clock offset, which NTP min-RTT bounds to ~RTT/2 asymmetry (a few ms on venue Wi-Fi). The shared-speaker constant (TV latency) shifts every team equally, which matters for absolute bonus tiers but only partly for "closest wins".

#### 0A Premise challenge

| Premise | Claim | Receipt | Verdict |
|---|---|---|---|
| P1 | The buzzer phase already gives "all teams, in boss room, online" eligibility | `lib/game-state.ts:814-815` (buzzer phase pulls every team in), `:869` (`!team.online \|\| !team.inBoss`) | valid |
| P2 | Host ▶ opens a buzzer phase's clip and a buzz pauses it | `lib/room/dungeon-room.ts:3498`, `:3515-3516` | valid |
| P3 | A correct buzz goes through `answerQuestion` → normal boss hit + reward + kill dice | `lib/game-state.ts:1116-1163`, `lib/room/dungeon-room.ts:3270-3289` | valid |
| P4 | Server receive time is unfit for judging | Wi-Fi jitter is tens of ms, a drum hit is judged in tens of ms | valid (estimated) |
| P5 | The screen can read the media time | `components/youtube-player.tsx:19` (`getCurrentTime`), `file-player.tsx` `<video>` currentTime | valid |
| P6 | YouTube `getCurrentTime` is precise | It is a cached value refreshed by the iframe's infoDelivery messages | **challenged** → plan samples only on value change and takes a sliding minimum |
| P7 | Only keyed screens may report media state | `lib/room/dungeon-room.ts:1985-1998` (`keyedScreens`), `isScreen` | valid |

unverified=1 (P4 numbers are estimates, re-measure on real devices).

Real problem: a new boss-room mechanic where precision, not speed or knowledge, wins. Do-nothing cost: the owner's song idea (drum hit in "I Will Always Love You") cannot be played, only approximated by a host shouting "now!". The plan solves it directly (not a proxy).

#### 0B Existing code leverage

| Sub-problem | Reuse |
|---|---|
| Eligibility, phase card, everyone in boss room | buzzer phase (`isBuzzPhase`, `enterNextBossPhase`) |
| Opening on ▶, live-play fallback, skip | `openBuzz`, `skipBuzz`, `HOST_BUZZ_SKIP` |
| Boss hit, reward, chef, kill dice, narration, reveal | `judge()` → `answerQuestion` |
| Media control and clip end | `HOST_MEDIA`, `SCREEN_CLIP_ENDED`, `playerSteps` |
| Screen trust | `keyedScreens` / `isScreen` |
| Persisted state | `BuzzState` saved with the game |
| Bank parsing, format gating | `parseQuestions`, `formatOf`, `BANK_FORMAT` |
| Phone big round button | `BuzzButton` look |
| Rate limiting of pings | worker `RateLimiter` (10/s, burst 30) |

New code only where nothing exists: clock sync (`lib/server-clock.ts`), media anchor filter and result math (`lib/tap-clock.ts`).

REALITY: premise-table pass 7 premises, unverified=1 lib/game-state.ts:869
REALITY: already-done pass no timing/tap work on origin/main lib/question-bank.ts:50
REALITY: surface-check pass npm scripts named (test, check:bundle, check:docs, lint) exist package.json:1
REALITY: binding-decisions pass no branch decisions recorded; CLAUDE.md bundle rule and bilingual docs honored CLAUDE.md:1
REALITY: numbers finding bonus tiers and lag bounds are estimates, re-measure on real devices docs/designs/timing-tap.md:56
REALITY: deferred-asks pass no linked issue; owner brief items all covered docs/designs/timing-tap.md:11
REALITY: pr-count pass one PR (default_pr_count 1) .gstack/ship-policy.json:1

#### 0C Dream state

```
  CURRENT STATE                  THIS PLAN                          12-MONTH IDEAL
  Boss buzzer: first to    --->  + timing-tap kind in buzzer  --->  A family of precision mechanics
  arrive wins, host judges       phases; synced clocks, auto        (tap, hold, rhythm) on one
  aloud                          judged, error board on screen      synced-clock layer, per-venue
                                                                    latency calibration
```

#### 0D/0E Mode

No approach choice needed beyond the plan (A: current plan). Mode: SELECTIVE EXPANSION (autoplan override). ~16 changed files estimated (bank, bank-store, game-state, protocol, dungeon-room, two new libs, three pages, two players, bank-health, editor, docs) — above 15, but categories are one feature; override holds.

#### 0F/0G Cherry-picks (auto-decided)

| # | Proposal | Effort | Decision | Reasoning |
|---|---|---|---|---|
| E1 | Editor "跟著按" button: while the clip preview plays, press to record the current time as `target` | S | ACCEPTED | In blast radius (editor + player `onTime` that the screen needs anyway), < 1 day (P2) |
| E2 | Phone vibrates once on tap (`navigator.vibrate(30)`) | S | ACCEPTED | One line, confirms the single tap was taken (P2) |
| E3 | Per-venue manual TV latency calibration (host slider or tap-to-beep test) | M | DEFERRED to TODOS.md | Needs real-device measurement first; outside the event-critical path (P3) |
| E4 | Live song-progress bar on screen during the round | S | SKIPPED | Would let players read the target off the bar |
| E5 | Timing questions in ordinary rooms | M | SKIPPED | Owner decision U3 |

HOLD checks inside SELECTIVE: complexity is ~16 files and two new small libs; no fewer-part design keeps the latency requirement (server-receive time is excluded by the brief). Nothing in current scope deferrable without breaking the brief.

#### 0I Temporal interrogation

- Hour 1: `BuzzState` is public through `view.buzz` (`lib/game-state.ts:2319`) — taps must be stripped from the view. Workers freeze `Date.now()` during a message handler: it is the receive time, which is what we want.
- Hour 2-3: when to convert a tap to song time (at receive, with the anchor then) vs at close; pause/restart semantics.
- Hour 4-5: `judgeNow` builds the reveal and may defer through the kill roll; the tap rows must survive into the reveal built after the 4d20 beat.
- Hour 6+: the memory-question lane's conflicts in shared files; BANK_FORMAT collision (both lanes may take 11).
Effort: human ~3 days / CC ~3 hours.


<!-- autoplan-accepted:ceo -->
- Timing-tap is a `kind: "timing"` boss question allowed only in buzzer phases, content a YouTube or uploaded clip, `target` seconds (ms precision) ≥ start and, with `end`, `target + TAP_GRACE_S ≤ end`; optional `label` ≤ 10 chars; tested in question-bank unit tests.
- Taps are judged against the big screen's media clock: phone NTP min-RTT offset, screen anchor from change-only sampling with a sliding minimum, host-entered speaker latency (E3-lite) subtracted, phone `pointerdown` `timeStamp`; never server receive time. Clock math unit-tested.
- Server clamps tap timestamps to `[receive − 1000 ms, receive + 300 ms]`, refuses taps with no live anchor, one tap per team; target hidden until reveal; screen reports only from keyed screens. Tested in room tests.
- Closest |error| wins the normal boss hit through `judge()`; ties go to the earlier-received tap; other teams get `TAP_BONUS_TIERS` (0.3 s +3, 0.6 s +2, 1 s +1); nobody tapped → skip unrevealed; reveal carries per-team error rows. Unit-tested.
- Round closes at `target + 2 s`, or when every eligible team tapped but not before `target + 0.5 s`, or on clip end; ⟲ clears taps; ⏸ greys the button and stops the close timer.
- E1: editor 跟著按 records the preview's current time as target. E2: phone vibrates once on tap.
- Bank health adds yellow rows for target < start + 3 s and for YouTube timing questions (recommend upload; also mention a missing `end`).
- E3 full calibration (an automatic tap test) deferred to TODOS.md; E3-lite (host-entered latency) is in this plan (replacement stated in the next bullets).
- Taps whose song time falls before the clip start are refused; CLOCK_PING and SCREEN_TAP_CLOCK are non-activity messages under the worker RateLimiter; bonuses go straight to `reward` outside the 改判 ledger; the reveal lists every team (沒按, 暈眩 last); a null anchor re-arms on the next live one.
- No per-team tap information is public during a round (no `tapped` list, no target, no ms in STATE or PublicQuestion); host STATE has `tapCount`; STATE `tapLive` means the chosen screen has a live anchor; room test asserts the absence.
- The winner gets no tier bonus, becomes the M5 picker, and wins at any error (no floor). Host 改判 list stays allowed for timing questions.
- E3-lite replaces outputLatency: host sets 喇叭延遲 ms (0–1000, saved with the room, `HOST_TAP_LATENCY`), subtracted from song time; host sees the reveal's median error; no `outputLatencyMs()` in bgm player. YouTube timing questions get one yellow health row recommending upload. Rehearsal checklist and the host-skip fallback are documented and the skip is room-tested.
- `timing` stays out of `isAutoJudged`; handleHostJudge refuses both verdicts; a teammate's second phone learns of the team's tap from `tap_taken`; SCREEN_TAP_CLOCK is throttled to one per 250 ms plus a 1 s heartbeat; the editor's buzzer-phase save check is loosened too.
- Early close re-checks on every presence change; the chosen screen keeps ownership through `anchor: null`; timing questions never use `buzz.out`.
<!-- /autoplan-accepted:ceo -->
<!-- autoplan-baseline-edits:ceo {"sourceSha256":"8b2ebd0f53a76ad2f06ac430522917d394bde0cce7bd96fef69ec96a75dc5494","replacements":[{"oldText":"- 只能放在搶答階段（`buzzer: true`）。搶答階段原本「只能填空題」放寬成「填空題或卡點題」。放在別的地方存檔會被擋。\n","newText":"- 只能放在搶答階段（`buzzer: true`）。搶答階段原本「只能填空題」（`lib/question-bank.ts` `parseBank` 和 `BossPhase.buzzer` 的註解、`app/bank-editor/page.tsx` 存檔前檢查那一行「只能放填空題」）放寬成「填空題或卡點題」。放在題目池或一般首領階段，`parseBank` 直接拒絕。\n"},{"oldText":"- `BANK_FORMAT` 升一版（`TIMING_FORMAT`）；有卡點題的題庫存成新版，舊程式拒絕覆寫而不是把題目丟掉。\n","newText":"- `BANK_FORMAT` 升一版（`TIMING_FORMAT`，放在 `formatOf` 判斷鏈的最前面，因為它是最新的）；有卡點題的題庫存成新版，舊程式拒絕覆寫而不是把題目丟掉。\n"},{"oldText":"2. **大螢幕回報播放時鐘**：播放卡點題片段時，大螢幕每 30 ms 讀一次播放器時間（YouTube `getCurrentTime()`，上傳檔 `currentTime`），只在數值變了的那一次取樣：`anchor = 現在 − 播放時間`（「影片 0 秒」在本機時鐘上的時刻）。YouTube 的時間是快取值，取樣只會偏晚，所以取最近 8 次取樣的最小值。再加上喇叭延遲估計（`AudioContext.outputLatency`，沒有就 0，上限 500 ms），換成伺服器時間後送 `SCREEN_TAP_CLOCK { questionId, anchor }`；暫停、緩衝、出錯時送 `anchor: null`。數值變超過 10 ms 立刻送，不然每秒送一次（心跳，伺服器重啟後一秒內恢復）。\n","newText":"2. **大螢幕回報播放時鐘**：播放卡點題片段時，大螢幕每 30 ms 讀一次播放器時間（YouTube `getCurrentTime()`，上傳檔 `currentTime`），只在數值變了的那一次取樣：`anchor = 現在 − 播放時間`（「影片 0 秒」在本機時鐘上的時刻）。YouTube 的時間是快取值，取樣只會偏晚，所以取最近 8 次取樣的最小值。換成伺服器時間後送 `SCREEN_TAP_CLOCK { questionId, anchor }`；暫停、緩衝、出錯時送 `anchor: null`。數值變超過 10 ms 就送，但最多每 250 ms 一則；沒變就每秒送一次（心跳，伺服器重啟後一秒內恢復）。最壞情況每秒 4 則，加上 8 次對時，仍在每連線限額（每秒 10、一次 30）內。\n"},{"oldText":"4. **房間換算**：`at` 先夾在 `[收到時間 − TAP_MAX_LAG_MS, 收到時間 + TAP_MAX_LEAD_MS]`（1000 ms / 300 ms），再減掉當時的 anchor 得到歌曲時間（毫秒），存起來。收到時沒有 anchor（音樂沒在放）就拒絕（`not_playing`），手機按鈕這時本來就是灰的。\n","newText":"4. **房間換算**：`at` 先夾在 `[收到時間 − TAP_MAX_LAG_MS, 收到時間 + TAP_MAX_LEAD_MS]`（1000 ms / 300 ms），再減掉當時的 anchor 得到歌曲時間（毫秒），存起來。收到時沒有 anchor（音樂沒在放）就拒絕（`not_playing`），手機按鈕這時本來就是灰的。歌曲時間早於片段開頭（`start`，沒設當 0）也拒絕（`not_playing`）：⟲ 或跳轉剛換了 anchor 時，路上那個按的時間會落在新片段開始之前。\n5. **訊息規則**：`CLOCK_PING`、`SCREEN_TAP_CLOCK` 不算活動（不延後閒置關房、不存檔），跟 `SCREEN_SOUND` 一樣列在 `onMessage` 的例外清單；兩者都經過 worker 現有的每連線 `RateLimiter`（每秒 10 則、一次最多 30 則），8 次對時加每秒一次心跳遠低於上限。\n6. **喇叭延遲（E3-lite，主持人設定）**：電視、HDMI、藍牙喇叭會讓大家晚 L 毫秒才聽到。這會改變誰贏：量到的誤差是 L＋各隊自己的誤差，早按的隊伍會佔便宜。瀏覽器量不到這段（`outputLatency` 只到音訊裝置，不含電視），所以不用它，改成主持人「⚙ 更多」裡一個「喇叭延遲（毫秒）」數字欄：預設 0、範圍 0–1000，跟著房間存檔（`HOST_TAP_LATENCY { ms }`），房間換算時從歌曲時間減掉。彩排時放一題測試卡點題，大家照耳朵按，揭曉表上誤差的中位數就是要填的值（主持人頁在揭曉後顯示「這題誤差中位數 +0.21 秒」給主持人參考）。\n"},{"oldText":"狀態放在 `BuzzState`（跟遊戲一起存檔）：多一個 `taps?: { teamId; ms }[]`（歌曲時間，按收到順序）。STATE 的 `view.buzz` 只給 `tapped: string[]`（誰按了），不給毫秒數。\n","newText":"狀態放在 `BuzzState`（跟遊戲一起存檔）：多一個 `taps?: { teamId; ms }[]`（歌曲時間，按收到順序）。卡點題不用 `out`。\n\n公開的東西：回合中誰按了不公開（早按的隊伍會讓別隊知道「快到了」，跟 E4 不做進度條同一個理由）。`view.buzz` 拿掉 `taps`；手機自己記得這題按過了（重新整理後再按會收到 `tap_taken`，畫面改成「已按」；隊友的另一支手機按鈕還是亮的，按下去一樣收到 `tap_taken`，改成「你們隊已經按了」）。只有主持人頁的 STATE 多 `tapCount`（已按幾隊）。題目的公開資料（`PublicQuestion`）只多 `timing: { label? }`，沒有 `target`；STATE 不帶 `target` 也不帶任何毫秒數，房間測試要檢查。STATE 的 `tapLive?: true`：房間現在有這題的 anchor（來自採用中的那台大螢幕）。\n"},{"oldText":"   - 大螢幕回報片段播完（`SCREEN_CLIP_ENDED`）也收。\n   - 收的時間用 anchor 算成伺服器時間排 `setTimeout`；anchor 變了、暫停（anchor null）就重排／取消。\n4. 結算（純函式 `tapResults`）：每隊誤差 = 歌曲時間 − target；誤差絕對值最小的贏，毫秒數一樣時先到房間的贏。其他隊照誤差拿小獎勵 `TAP_BONUS_TIERS`：0.3 秒內 +3、0.6 秒內 +2、1 秒內 +1（寫成常數）。\n5. 贏的隊伍：`buzz.teamId` 設成它，走一般的 `judge(..., correct)`：扣 1 格血、命中獎勵（廚師照算）、最後一擊照擲 4d20、旁白念命中台詞。揭曉（AnswerReveal）多一個 `timing`：目標秒數、label、每隊誤差和小獎勵、贏家。大螢幕公布表，手機看到自己的誤差。\n","newText":"   - 大螢幕回報片段播完（`SCREEN_CLIP_ENDED`）也收。上傳的影音在公開資料裡也是 `hiddenVideo`（`kind: \"youtube\"` 記號，`lib/question-bank.ts` `hiddenVideo`），所以 `shownVideoId` 和播完回報對它一樣有效。\n   - 收的時間用 anchor 算成伺服器時間排 `setTimeout`；anchor 變了、暫停或緩衝（anchor null）就重排／取消，下一個不是 null 的 anchor 到了再排。大螢幕一直沒恢復時，主持人按「沒人答對，換下一題」離開。\n4. 結算（純函式 `tapResults`）：每隊誤差 = 歌曲時間 − target；誤差絕對值最小的贏，毫秒數一樣時先到房間的贏。沒有誤差上限：只要有按，最接近的就贏（站長 U2；差 1.9 秒也算命中，不要之後加門檻）。其他隊照誤差拿小獎勵 `TAP_BONUS_TIERS`：0.3 秒內 +3、0.6 秒內 +2、1 秒內 +1（寫成常數）；贏家不另拿級距獎勵，它拿命中獎勵。小獎勵直接加到隊伍的獎勵分（`reward`），不進改判清單；揭曉表就是它的紀錄，要修正用主持人現有的「設定分數／±5」。\n5. 贏的隊伍：`buzz.teamId` 設成它，走一般的 `judge(..., correct)`：扣 1 格血、命中獎勵（廚師照算）、最後一擊照擲 4d20、旁白念命中台詞。揭曉（AnswerReveal）多一個 `timing`：目標秒數、label、每隊誤差和小獎勵、贏家。大螢幕公布表，手機看到自己的誤差。贏家跟搶答答對一樣成為下一題的選類別隊伍（M5 的 `picker`），這是刻意的。\n"},{"oldText":"8. 主持人的「答對／答錯」在卡點題不能按（`auto_judged`）；「沒人答對，換下一題」照常可以按。「🎤 現場放歌」在卡點題拒絕（沒有大螢幕就量不了時間），主持人頁說明改按換下一題。\n","newText":"8. 主持人的「答對／答錯」在卡點題不能按：`timing` 不加進 `isAutoJudged`（它還管鎖定選項和戰士擲骰），`handleHostJudge` 另外擋，兩種判定都回 `auto_judged`；「改判答對」不會出現（卡點題沒有答錯可以撤）；主持人的改判清單（#240）照常列出贏家的那次命中，可以照它現有的規則改（只動那隊的分數，不補回首領的血、不把命中換給別隊）；「沒人答對，換下一題」照常可以按。「🎤 現場放歌」在卡點題拒絕（沒有大螢幕就量不了時間），主持人頁說明改按換下一題。\n"},{"oldText":"- 已按的隊伍斷線：按的紀錄保留，照常比。沒按的隊伍斷線：沒有資格，不等它。\n- 回報 anchor 的大螢幕斷線：房間清掉 anchor（按鈕變灰），別的大螢幕或重新連上的那台一秒內補上。兩台大螢幕都在放：只採用先回報的那一台，直到它斷線。\n","newText":"- 已按的隊伍斷線：按的紀錄保留，照常比。沒按的隊伍斷線：沒有資格，不等它。每次有隊伍上線／斷線都重新檢查「是不是都按完了」並重排收回合時間。所有有資格的隊伍都斷線也不重開回合：照常等到 `target + 2 s` 收，有人按就比，沒人按就換題。\n- 回報 anchor 的大螢幕斷線：房間清掉 anchor（按鈕變灰），別的大螢幕或重新連上的那台一秒內補上。兩台大螢幕都在放：只採用先回報的那一台，直到它斷線；它回報 `anchor: null`（暫停、緩衝）時還是它，另一台不會接手。\n"},{"oldText":"- 伺服器重啟：`taps` 在存檔裡；anchor、計時器只在記憶體，大螢幕心跳一秒內補回來，計時器跟著重排。\n","newText":"- 伺服器重啟：`taps` 在存檔裡；anchor、計時器只在記憶體，大螢幕心跳一秒內補回來，計時器跟著重排。\n\n### 現場彩排與失敗備案\n\n- 活動的題庫要真的排到卡點題：它只能在搶答階段，搶答階段從首領第 2 階段起（hosting 文件寫進彩排清單）。\n- 彩排清單：放一題測試卡點題，確認主持人頁「大螢幕播放時鐘：有」一直亮著、大螢幕留在前景（背景分頁的計時器會變慢）、填好喇叭延遲。\n- 現場大螢幕放不出來或時鐘一直沒有：主持人按「沒人答對，換下一題」乾淨離開，題目不公開，遊戲照常往下走（房間測試涵蓋）。\n- 接受的風險：不同手機的觸控延遲差 30–80 ms，量不到也不補。\n"},{"oldText":"- 大螢幕回合中：「♪ 按在『蹬』那一下！」和隊伍列（按了的亮起「已按」）。揭曉：大字目標時間「3:10.35「蹬」」，下面每隊一列依誤差排序：隊名、`+0.12 秒`／`−0.40 秒`／`沒按`、小獎勵 `+3`，贏家那列標「命中！」。\n","newText":"- 大螢幕回合中：「♪ 按在『蹬』那一下！」和隊伍列（回合中不顯示誰按了）。揭曉：大字目標時間「3:10.35「蹬」」，下面每隊一列依誤差排序（搶答階段所有隊伍都在魔王房，所以是每一隊）：隊名、`+0.12 秒`／`−0.40 秒`／`沒按`／`暈眩`、小獎勵 `+3`，贏家那列標「命中！」；沒按和暈眩排最後。\n"},{"oldText":"`lib/bank-health.ts` 多兩種黃燈：目標離片段開頭不到 3 秒（大螢幕的播放時鐘還沒校準好）；YouTube 卡點題沒設 `end`（片段停不住，要靠回合收尾）。\n","newText":"`lib/bank-health.ts` 多兩種黃燈：目標離片段開頭不到 3 秒（大螢幕的播放時鐘還沒校準好）；YouTube 卡點題（建議改上傳音檔：沒有廣告、播放時間更準；沒設 `end` 時一併提醒）。\n"},{"oldText":"- `lib/tap-clock.ts`：anchor 最小值濾波、跳動（seek）重置、加喇叭延遲；`tapResults` 誤差、排序、平手、獎勵級距；收回合時間。\n","newText":"- `lib/tap-clock.ts`：anchor 最小值濾波、跳動（seek）重置、扣掉主持人設的喇叭延遲；`tapResults` 誤差、排序、平手、獎勵級距；收回合時間。\n"},{"oldText":"- 每台電視手動校正喇叭延遲（活動後看實測再說，記在 TODOS.md，E3）。\n","newText":"- 自動的喇叭延遲校正（例如大螢幕放嗶聲、大家跟著按、自動算中位數，E3）：活動後看實測再說，記在 TODOS.md。這次只做主持人手動填的數字（E3-lite）。\n- 誤差上限（差太多不算命中）：站長 U2 決定最接近就算，兩個審查聲音都提過，留給站長在最後確認時決定。\n"}]} -->
<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Mode SELECTIVE EXPANSION | Mechanical | override | autoplan rule | HOLD |
| 2 | CEO | Timing questions live only in buzzer phases | Taste | P4 DRY | reuses eligibility, phase card, ▶ open, skip | separate phase flag / any boss phase |
| 3 | CEO | Accept E1 editor 跟著按 | Mechanical | P2 | in blast radius, S | defer |
| 4 | CEO | Accept E2 vibrate on tap | Mechanical | P2 | one line | skip |
| 5 | CEO | Defer E3 latency calibration | Mechanical | P3 | needs real-device data | add now |
| 6 | CEO | Skip E4 progress bar | Mechanical | P1 | leaks target | add |
| 7 | CEO | Bonus tiers 0.3/0.6/1.0 s → +3/+2/+1 | Taste | P5 | owner's example extended to a smoother three-step curve | owner's literal 0.5 s +3 / 1 s +1 |
| 8 | CEO | Closest tapper always wins, no max-error cap | Taste | P5 | owner said "closest counts as correct" | cap at 3 s |
| 9 | CEO | 改判清單 stays allowed for timing | Taste | P5 | host authority over a glitched round | refuse rejudge |
| 10 | CEO | No per-team tap info during the round | Taste | P1 | early tappers leak the moment | show 已按 lights |
| 11 | CEO | E3-lite host-entered latency replaces outputLatency | Taste | P5 | both voices: shared latency changes the winner; outputLatency misses the TV | outputLatency only |
| 12 | CEO | No beep preview in the editor | Taste | P3 | number refine is enough for the event | beep at target |
| 13 | CEO | Bonus record = reveal + set-score | Taste | P5 | ledger is judgment-only | new bonus ledger entries |
| 14 | CEO | Keep no error cap (owner U2) | Taste | owner | Codex wants a cap, native keeps it | 3 s cap |
| 15 | Design | Mockups as headless Chrome HTML screenshots, not the gstack designer | Taste | P5 | lane brief names the method; no paid image calls | $D variants |
| 16 | Design | No team row on the screen during the round | Taste | P5 | subtraction: an always-empty row only fills space | names-only row |
| 17 | Design | Reveal leads with the winner, target third | Taste | P1 | the room wants who won; song seconds mean little | target time largest |
| 18 | Design | 「最接近！」 instead of 「命中！」 when the winner is > 1 s off | Taste | P5 | owner U2 scoring unchanged, only wording | always 命中 |
| 19 | Design | Team-scoped TAP_OK ack + tapRound | Mechanical | P1 | fixes false 已按 and the ⟲ lockout | phone-local memory |
| 20 | DX | parseBank keeps value-carrying strings, no error codes or field paths | Taste | P5 | matches every existing parseBank message; the editor already shows field copy | stable codes + paths (Codex) |
| 21 | DX | Keep `auto_judged` for host verdicts on timing | Taste | P4 DRY | host page already handles it; meaning fits | new timing_judged code |
| 22 | DX | Phone resends the same `at` once after 2 s with no reply | Mechanical | P1 | idempotent via tap_taken; covers dropped messages | no retry |
| 23 | DX | Doc JSON example pasted into a parseBank test | Mechanical | P1 | docs and parser cannot drift | untested example |
| 24 | Eng | Original arrangement: pure clock/state helpers + thin room handlers | Mechanical | P5 | unit-testable clock math | fold into dungeon-room.ts |
| 25 | Eng | round on TEAM_TAP, seq on SCREEN_TAP_CLOCK and SCREEN_CLIP_ENDED | Mechanical | P1 | both voices: ⟲ races | questionId only |
| 26 | Eng | Anchor expires after 2.5 s without a report | Mechanical | P1 | frozen screen tab keeps a stale clock (Codex) | socket close only |
| 27 | Eng | tap_late refusal instead of clamping the lag side | Mechanical | P1 | clamping stores a wrong time for resends | clamp |
| 28 | Eng | CLOCK_PONG skips persist; anchor broadcasts only on tapLive flips | Mechanical | P3 | sendTo persists the whole room per message | sendTo |
| 29 | Eng | One tapEligible with all-stunned clear at open | Mechanical | P4 DRY | greyed phones never trigger buzzIn's lazy clear | four copies |
| 30 | Eng | No second server timestamp in CLOCK_PONG | Mechanical | P3 | workerd freezes Date.now() within one event | receive+send stamps (Codex) |

#### 0H Spec review loop

Iteration 1 (score 6/10, FAIL): 13 issues. Dispositions (auto-decided, P1/P5):
- C1 target leak → applied: `PublicQuestion.timing` carries only `label`; room test asserts STATE has no target/ms.
- C2 host corrections → applied: 改判答對 unreachable; 改判清單 stays allowed for timing (host fixes a glitched round). Taste (#9).
- C3 presence change → applied: re-check early close on every online/offline change.
- C4 two screens + pause → applied: the chosen screen keeps ownership through `null`.
- Cons1 live 已按 leaks timing → applied: no per-team press info until close; phone tracks its own tap; host sees `tapCount`. Taste (#10).
- Cons2 picker → applied: winner becomes picker on purpose.
- Clarity 1–3 → applied: winner gets no tier bonus; no accuracy floor (U2); `tapLive` defined.
- Scope note → bank-health rows and screen ping were in the base plan, not expansions; no change.
- Feas1 uploaded clips → factual correction: uploads ride `hiddenVideo` (`kind: "youtube"`, lib/question-bank.ts:531), so `shownVideoId` covers them; clarified in plan.
- Feas2 validation/format → applied: spelled out.
- Feas3 outputLatency → applied: reuse bgm-player's unlocked context.
- Feas4 `out` unused → applied: stated; all-eligible-offline waits for the deadline.



Iteration 2 (score 7/10, FAIL): 8 issues, all applied: bonus bookkeeping (straight to reward, outside 改判, fix via 設定分數/±5); reveal lists every team, 沒按/暈眩 last; CLOCK_PING/SCREEN_TAP_CLOCK non-activity + RateLimiter; 改判 promise narrowed to its existing rules; null anchor re-arms on next live anchor, host skip is the way out; base-plan items noted in the CEO summary; output latency labeled best effort; taps before the clip start refused (in-flight tap across ⟲).

Iteration 3 (score 7/10, FAIL; cap reached): 6 issues. Applied: separate host-judge guard (timing not in isAutoJudged); teammate phone learns via tap_taken (no per-team STATE); `outputLatencyMs()` getter named; editor save check named; SCREEN_TAP_CLOCK throttled to 250 ms. Note: the 0H section lives in the Review record, not the plan body. issues verified: 6 of 6 (applied edits checked against the amended text; spec not re-verified by a fourth launch).

### CEO dual voices

Native CEO subagent (INPUT ceo 6bf243e8…, completed): 1 Critical (shared-speaker latency does change the winner; the plan's "大致不受影響" was false), 2 High (author's tap-along target carries reaction bias; six-day scope risk), 3 Medium (YouTube embed weakest link, venue assumptions unstated, no error floor), 1 Low (no competition).
Codex CEO voice (gpt-6-luna, OUTSIDE_STATUS completed): 4 High (event may never reach a buzzer phase; closest-wins turns a miss into a hit; displayed precision exceeds the measurement guarantee; playback failure removes the only clock), 1 Medium (bonuses hard to audit).

```
CEO DUAL VOICES — CONSENSUS TABLE:
  Dimension                           Claude  Codex  Consensus
  1. Premises valid?                   no(P:latency) no(precision) CONFIRMED — latency premise wrong
  2. Right problem to solve?           yes     yes*   CONFIRMED (*if the run of show reaches it)
  3. Scope calibration correct?        tight   tight  CONFIRMED — add E3-lite, keep cut order
  4. Alternatives sufficiently explored? partial partial CONFIRMED — uploaded media preferred
  5. Competitive/market risks covered? n/a     n/a    CONFIRMED — none (single private event)
  6. 6-month trajectory sound?         yes     yes    CONFIRMED
```

Dispositions (auto-decided): latency → E3-lite host-entered 喇叭延遲, replaces `outputLatency` (both voices; taste #11). Error cap → kept per owner U2; Codex wants a cap, native says keep → surfaced at the gate as a taste decision, not a User Challenge (only one voice proposes changing the owner's decision). Tap-along bias → documented: E1 gives a starting point that includes the author's reaction; the author refines the number (beep preview deferred, taste #12). Precision → E3-lite plus rehearsal median; tiers kept. Playback failure → host skip is the clean abort, room-tested. Bonus audit → reveal + set-score is the record (taste #13). Event reach → hosting doc checklist. YouTube → one yellow health row recommending upload.

### Section 1: Architecture

```
   phone (play page)                 Durable Object (dungeon-room)                 big screen
   ───────────────────               ─────────────────────────────                 ──────────────────
   useServerClock ──CLOCK_PING──▶    reply CLOCK_PONG {t, server=now}  ◀──CLOCK_PING── useServerClock
                  ◀─CLOCK_PONG──                                       ──CLOCK_PONG──▶
                                     tapClock {questionId, anchor,     ◀─SCREEN_TAP_CLOCK── anchor filter
                                       connId}  (memory)                    {questionId, anchor|null}
   pointerdown ──TEAM_TAP {at}──▶    clamp(at) − anchor − latency
                                     → game-state tapIn() → BuzzState.taps (saved)
                                     closeTimer (memory) ─▶ tapResults() → bonuses
                                       → judge(winner) → reveal.timing → STATE
   ◀──────────────── STATE (no taps, no target; tapLive; host: tapCount) ────────────────▶
```

New coupling: the room depends on screen reports for judging (justified: the brief forbids server-receive timing). The tap state lives in `BuzzState` (existing persisted object); anchor and timer stay in memory like `media`. Single point of failure: the keyed screen; mitigated by the host skip. Security: CLOCK_PING open to any socket (cheap, rate-limited); SCREEN_TAP_CLOCK keyed screens only; TEAM_TAP joined playing team only. Rollback: revert the PR; banks saved at the new format would be refused by old code (intended format gate), so a rollback needs the bank re-saved without timing questions. Scaling: ≤ 12 teams, trivial.

Data flows — happy: tap → song ms → result. Nil: no anchor → `not_playing`. Empty: no taps by deadline → skip. Error: screen drops → anchor cleared, buttons grey, host skip.

State machine (per timing question):
```
  SHOWN ──▶ ▶ pressed (open) ──▶ LIVE (anchor) ──tap*──▶ LIVE ──deadline/all/clip end──▶ CLOSED
    │            │                 │  ▲ anchor null (⏸/buffer) → PAUSED ─live anchor─┘
    │            │                 └─ ⟲ → taps cleared, LIVE
    └──────── host skip (any state before CLOSED) ──▶ next question (unrevealed)
  CLOSED: taps? winner → judge → REVEAL : skip
  invalid: tap in SHOWN/PAUSED (not_playing), second tap (tap_taken), tap after CLOSED (stale question/closed)
```

### Section 2: Error & Rescue Map

```
  CODEPATH                 | WHAT CAN GO WRONG               | ERROR
  -------------------------|---------------------------------|---------------------------
  handleTeamTap            | no anchor / before clip start   | not_playing
                           | second tap                      | tap_taken
                           | not eligible (offline, stunned) | cannot_tap / stunned
                           | stale question                  | stale_question
  parseClientMessage       | at not finite number            | bad_message
  SCREEN_TAP_CLOCK         | unkeyed socket                  | ignored (like SCREEN_*)
                           | other question id               | ignored
  closeTap                 | judge throws InvalidActionError | logged, round skipped
  useServerClock           | no pong (socket down)           | offset stays null → button grey
  screen anchor sampling   | player throws / not ready       | anchor null
  parseBank                | bad timing fields               | Invalid question bank: …

  ERROR             | RESCUED? | ACTION                         | USER SEES
  ------------------|----------|--------------------------------|---------------------------
  not_playing       | Y        | phone keeps button, no retry   | 「等音樂開始…」
  tap_taken         | Y        | phone marks tapped             | 「你們隊已經按了」
  stale_question    | Y        | dropped                        | next STATE
  judge failure     | Y        | console.error JSON + skipBuzz  | question moves on
  no pong           | Y        | button grey                    | 「連線中…」
```
No catch-alls planned; the judge rescue logs `{event:"timing_close_failed"}`.

### Section 3: Security & threat model

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Fake/backdated tap timestamp | Low | Med | clamp −1000/+300 ms; residual: a modified client can backdate ≤1 s (accepted, documented) |
| Target leak via STATE | Med | High | target never in PublicQuestion/STATE; room test |
| Fake screen anchor from a phone | Low | High | keyed screens only |
| Ping flood | Low | Low | worker RateLimiter |
| Multi-phone double tap | Med | Low | one tap per team |
| Bank injection (huge target, NaN) | Low | Low | parseBank validates finite, ≥ start, ms precision |
No new secrets, deps, PII.

### Section 4: Data flow & interaction edge cases

```
  TEAM_TAP{at} → parse(finite) → playingTeam? → open && anchor? → clamp → ms=at−anchor−latency
     nil/NaN→bad_message   not team→drop   no→not_playing      ms<start→not_playing
  → tapIn (eligible, once) → BuzzState.taps (persist) → maybe reschedule close → STATE
```
| Interaction | Edge case | Handled? |
|---|---|---|
| Tap button | double tap | yes, phone disables after first; server tap_taken |
| Tap button | tap while paused | yes, button grey, server not_playing |
| Tap | phone reloads mid-round | yes, tap_taken restores 已按 |
| Host ⟲ | during round | yes, taps cleared |
| Host ⏸ | during round | yes, timer cancelled, taps kept |
| Host skip | during round | yes |
| Screen | two screens | yes, first reporter owns |
| Screen | reconnect | yes, heartbeat restores |
| Team | disconnect after tap | yes, kept |
Async ordering: the DO handles one message at a time; the close timer callback re-checks `buzz.questionId === current` and the round generation before closing, so a timer from a cleared (⟲) round cannot close the new one.

### Section 5: Code quality

New pure modules `lib/server-clock.ts`, `lib/tap-clock.ts` follow the `answer-clock.ts` pattern (pure + tested). Risk: `judgeNow` grows; keep the timing reveal to one spread line fed by a room field. `handleTeamTap` must stay ≤ 5 branches; move eligibility into `tapIn` (game-state), as `buzzIn` does. No duplication: `tapIn` reuses `buzzIn`'s stun rule via a shared helper only if both would copy it verbatim.

### Section 6: Tests

```
  NEW CODEPATH                      | TYPE | HAPPY                 | FAILURE                | EDGE
  server-clock offset/minRTT        | unit | offset from samples   | empty → null           | equal RTT, window 8
  tap-clock anchor filter           | unit | min of change samples | seek resets            | stale cached value
  tapResults                        | unit | winner + tiers        | no taps → none         | tie → earlier
  closeAt                           | unit | target+2s             | anchor null → none     | all tapped → target+0.5s
  question-bank timing parse        | unit | valid                 | not buzzer / bad target| end-grace boundary
  game-state tapIn                  | unit | first tap stored      | offline/out/twice      | stunned all
  room TEAM_TAP                     | int  | ms stored             | not_playing, clamp     | before start
  room SCREEN_TAP_CLOCK             | int  | anchor set            | unkeyed ignored        | owner keeps on null
  room close + judge + reveal       | int  | winner hit, bonuses   | no taps → skip         | ⟲ clears
  STATE leak                        | int  | —                     | no target/ms/taps      |
```
2am-Friday test: the room integration test from ▶ through reveal with a fake clock. Hostile QA: tap with `at` = 1e15 → clamped. Flakiness: every room test injects `now()` (the room already has `this.now`).

### Section 7: Performance

Per round ≤ 12 taps, one timer, screen 4 msgs/s. Memory: taps array ≤ teams. No slow paths.

### Section 8: Observability

Log one JSON line per closed round: `{event:"timing_round", questionId, taps, winner, errorsMs, latencyMs, anchorAgeMs}` so a disputed round can be reconstructed. Host page shows 「大螢幕播放時鐘：有／沒有」 live and the median error after reveal.

### Section 9: Deployment

No migration. Format gate: banks with timing questions save as the new format; old code refuses to overwrite (intended). Deploy is the normal Workers Build on merge. Post-deploy: owner rehearsal round (checklist in hosting docs).

### Section 10: Trajectory

Reversibility 4/5 (format gate is the one-way-ish part). Debt: E3 full calibration (TODO), touch-latency variance (accepted). The clock layer is reusable for future precision mechanics.

### Section 11: Design & UX

Phone: one button, four states (waiting, live, tapped, result) — matches the buzz button family. Screen: label prompt during the round, sorted error board at reveal. Interaction states: loading (等音樂開始), empty (nobody tapped → skip, no board), error (no clock → host warning), success (board), partial (some 沒按). Full design review runs in Phase 2.

### What already exists / NOT in scope / Dream state delta

What already exists: buzzer phase flow, judge, media control, keyed screens, BuzzState persistence, RateLimiter, format gate (see 0B).
NOT in scope: timing in ordinary rooms (U3); multiple targets per song; automatic latency calibration E3 (deferred to TODOS.md); live progress bar E4 (skipped: leaks); error cap (owner U2, surfaced at gate); beep preview in editor (deferred, taste #12).
Dream state delta: this plan delivers the synced-clock layer and one mechanic with manual latency; the 12-month ideal adds automatic calibration and more mechanics.

### Failure Modes Registry

```
  CODEPATH         | FAILURE MODE            | RESCUED? | TEST? | USER SEES?          | LOGGED?
  -----------------|-------------------------|----------|-------|---------------------|--------
  screen anchor    | YouTube ad / stall      | Y (null) | Y     | button grey         | N
  screen           | disconnect              | Y        | Y     | host: 時鐘：沒有     | N
  TEAM_TAP         | backdated by cheater    | partial  | Y     | wrong winner ≤1 s   | Y (round log)
  close timer      | DO restart mid-round    | Y        | Y     | resumes on heartbeat| N
  judge on close   | throws                  | Y        | Y     | question moves on   | Y
  latency          | host never sets it      | N        | n/a   | early tappers favored| Y (latencyMs)
```
No CRITICAL GAP (no row is unrescued + untested + silent).

```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | SELECTIVE EXPANSION                         |
  | System Audit         | clean base; memory lane conflicts expected  |
  | Step 0               | buzzer-phase-only timing kind; E1,E2 in; E3 deferred→E3-lite in |
  | Section 1  (Arch)    | 2 issues found (latency premise, SPOF screen)|
  | Section 2  (Errors)  | 11 error paths mapped, 0 GAPS               |
  | Section 3  (Security)| 6 issues found, 0 High severity unmitigated |
  | Section 4  (Data/UX) | 9 edge cases mapped, 0 unhandled            |
  | Section 5  (Quality) | 2 issues found                              |
  | Section 6  (Tests)   | Diagram produced, 0 gaps                    |
  | Section 7  (Perf)    | 0 issues found                              |
  | Section 8  (Observ)  | 1 gap found (round log added)               |
  | Section 9  (Deploy)  | 1 risk flagged (format gate on rollback)    |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 2           |
  | Section 11 (Design)  | 0 issues (deep review in Phase 2)           |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (6 items)                           |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 11 rows, 0 CRITICAL GAPS                    |
  | Failure modes        | 6 total, 0 CRITICAL GAPS                    |
  | TODOS.md updates     | 1 item proposed (E3 full calibration)       |
  | Scope proposals      | 5 proposed, 2 accepted (+E3-lite)           |
  | CEO plan             | written                                     |
  | Outside voice        | codex completed                             |
  | Lake Score           | N/A                                         |
  | Diagrams produced    | 4 (architecture, state, data flow, errors)  |
  | Stale diagrams found | 0                                           |
  | Unresolved decisions | 0 (error cap surfaced as taste at the gate) |
  | Reality rows         | 7/7 rows, 1 unverified                      |
  +====================================================================+
```

### Implementation Tasks (CEO)
Synthesized from this review's findings (ratios: features ~30x, tests ~50x).

- [ ] **T1 (P1, human: ~4h / CC: ~20min)** — clock sync — Add pure server-clock offset and tap-clock anchor/result math with unit tests
  - Surfaced by: Section 6 — clock-sync math and tapResults
  - Files: lib/server-clock.ts, lib/tap-clock.ts, tests
  - Verify: `npx vitest run lib/server-clock.test.ts lib/tap-clock.test.ts`
- [ ] **T2 (P1, human: ~1d / CC: ~1h)** — room — Room handlers, close timer and timing reveal
  - Surfaced by: Sections 1 and 4
  - Files: lib/protocol.ts, lib/game-state.ts, lib/room/dungeon-room.ts
  - Verify: `npx vitest run lib/room/dungeon-room.test.ts`
- [ ] **T3 (P1, human: ~1h / CC: ~5min)** — privacy — STATE carries no target/tap ms
  - Surfaced by: Section 3 — target leak via STATE
  - Files: lib/room/dungeon-room.test.ts
  - Verify: room test
- [ ] **T4 (P2, human: ~30min / CC: ~5min)** — observability — timing_round log line
  - Surfaced by: Section 8
  - Files: lib/room/dungeon-room.ts
  - Verify: room test spies console
- [ ] **T5 (P2, human: ~3h / CC: ~20min)** — latency — E3-lite host 喇叭延遲 + median
  - Surfaced by: CEO dual voices
  - Files: lib/protocol.ts, lib/room/dungeon-room.ts, host page
  - Verify: room test subtracts latency
- [ ] **T6 (P2, human: ~1h / CC: ~10min)** — docs — rehearsal checklist, TODOS E3
  - Surfaced by: Codex event-reach finding
  - Files: docs/hosting.md, docs/hosting.en.md, TODOS.md
  - Verify: `npm run check:docs`

### Design review (auto-decided by /autoplan)

Step 0: initial design completeness 5/10. The plan specified the happy path on every surface but none of the failure states a live room hits (rejected tap, ⟲, pause, stall, stun). A 10 has a full phone state table with copy, a 960×540 reveal layout, host recovery and calibration flows, and editor error copy. DESIGN.md exists (pixel dungeon tokens, Cubic 11 + Press Start 2P, 960×540 stage, two-frame motion), so every decision below is calibrated against it. Reuse: `BuzzButton` shape, `MusicCard`, `Panel`, `LabelChip`, `.px-input`, team `Sprite` hats, `--turn` row highlight from the podium/initiative overlays.

Mockups: the gstack designer binary was not used; the lane brief asks for headless Chrome screenshots of small HTML files (taste #15). Local-only files (not committed): `~/.gstack/projects/critical-answer/designs/timing-tap-20261112/timing-tap-phone.png`, `timing-tap-screen-reveal.png`, `timing-tap-editor.png`.

Dual voices: native subagent (INPUT design b3c77e0c…) 2 Critical, 5 High, 5 Medium. Codex (gpt-6-luna, completed) 4 High, 3 Medium, 1 Low.

```
DESIGN OUTSIDE VOICES — LITMUS SCORECARD:
  Check                                    Claude  Codex  Consensus
  1. Brand unmistakable in first screen?   yes     yes    CONFIRMED (existing pixel shell)
  2. One strong visual anchor?             yes     yes    CONFIRMED (the round button / winner line)
  3. Scannable by headlines only?          no      no     CONFIRMED gap → reveal hierarchy fixed
  4. Each section has one job?             yes     yes    CONFIRMED
  5. Cards actually necessary?             n/a     n/a    CONFIRMED (no cards)
  6. Motion improves hierarchy?            n/a     n/a    NOT SPEC'D (none added; two-frame rule)
  7. Premium without decorative shadows?   yes     yes    CONFIRMED (pixel bevels only)
  Hard rejections triggered:               0       0      CONFIRMED
```

Confirmed by both voices (auto-fixed, P5/P1): phone states underspecified; screen reveal layout unspecified at 960×540; host recovery and calibration flows missing; editor target bias needs a correction tool; accessibility of the core control unspecified. Native only: tap ack (Critical), ⟲ leaves phones locked (Critical), first-time rule line, music after close, denominator, mis-tap, editor error copy, 命中 wording for big misses. Codex only: color-only states, YouTube stall experience.

Pass 1 Information architecture 5 → 9. Phone: rule line → label → button. Screen round: music card + side panel (no team row: taste #16). Screen reveal: winner line first, error second, target third (taste #17). Remaining: the 2 s ⟲ notice overlaps the label line on short phones (minor).

Pass 2 Interaction states 3 → 9. Full phone table (13 rows) incl. 連線中, ⏸, 卡住, 送出中, rejection note, stun, reveal rows; host 時鐘沒有 > 3 s recovery line; editor errors. Team-scoped `TAP_OK` + `tapRound` fix the two Criticals. Remaining: the offline phone uses the existing buzzer-phase screen (not redesigned).

Pass 3 Journey 6 → 8.

```
  STEP | USER DOES                      | USER FEELS          | PLAN SPECIFIES?
  1    | sees 卡點題, rule line          | curious, unsure     | yes: rule line on phone + screen
  2    | host ▶, song plays, button red | anticipation        | yes: 按！ only with a live clock
  3    | taps at the drum               | commitment          | yes: same-frame 送出中 + vibrate, then 已按 ✓
  4    | waits for others               | suspense            | yes: no one sees who tapped
  5    | reveal                         | triumph / near-miss | yes: winner line, 早/晚 wording, +3/+2/+1
  6    | next question (winner picks)   | momentum            | yes: M5 picker
```

Pass 4 AI slop 8 → 9. Classifier: APP UI / party-game EXPERIENCE. No hard rejections; reuses the house pixel vocabulary; no new gradients; emoji only where the house already uses ♪ and ✓.

Pass 5 Design system 6 → 9. Tokens named for every new state (`--warn` for 送出中/已按, `--ok` for 命中, `--turn` winner row, `--dim-ink` for 沒按/暈眩, `LabelChip` bonus). The grey `#5a4a60` and red `#ff5050` are the existing BuzzButton literals, kept for consistency.

Pass 6 Responsive & a11y 4 → 8. Phone ≥ 360px reuses `min(72vw,280px)`; `<button>` with Enter/Space keydown using the same timeStamp, `aria-live`, house focus ring, state in words; 44px host buttons; TV rows 20px at 1x = 40px at 1080p. Remaining: the reveal's 16px target line is small at 1x (tertiary by design).

Pass 7 decisions: 8 resolved (all auto-decided), 0 deferred; taste items #15–#18 go to the gate.

NOT in scope (design): beep at target in the editor (taste #12 stands; nudges + 3 s pre-roll cover verification); animating the reveal rows (two-frame rule; a hard cut is enough); a separate rehearsal screen (a normal question is the rehearsal).
What already exists: BuzzButton, MusicCard, Panel/LabelChip/.px-input, podium `--turn` row, host ⚙ 更多 drawer, house focus-visible ring.
TODOS.md: none new from design (E3 full calibration already proposed in CEO).

### Implementation Tasks (Design)
- [ ] **D1 (P1, human: ~3h / CC: ~15min)** — phone — `TapButton` + pure `tapButtonState` covering every table row
  - Surfaced by: Pass 2 — phone states; native Critical 1–2
  - Files: app/room/[code]/play/page.tsx, lib/tap-button-state.ts (+ test)
  - Verify: `npx vitest run lib/tap-button-state.test.ts`
- [ ] **D2 (P1, human: ~2h / CC: ~10min)** — room — `TAP_OK` to all team connections, resend on reconnect, `tapRound`
  - Surfaced by: native Critical 1–2
  - Files: lib/protocol.ts, lib/room/dungeon-room.ts (+ test)
  - Verify: room test
- [ ] **D3 (P2, human: ~3h / CC: ~15min)** — screen — round side panel and 960×540 reveal panel
  - Surfaced by: Pass 1, Codex High 3
  - Files: app/room/[code]/screen/page.tsx
  - Verify: tsc + mockup comparison
- [ ] **D4 (P2, human: ~2h / CC: ~10min)** — host — eligible count, clock warning with inline skip, median + 把延遲改成 button
  - Surfaced by: Codex High 2 and 7; native Medium 8
  - Files: app/room/[code]/host/page.tsx
  - Verify: tsc; median helper unit-tested
- [ ] **D5 (P2, human: ~2h / CC: ~10min)** — editor — timing fields, m:ss.cc display, ±0.05, 3 s pre-roll, error copy
  - Surfaced by: Codex High 4, native High 5 and Medium 11
  - Files: app/bank-editor/page.tsx
  - Verify: tsc + check:bundle

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md present; UI on 4 surfaces          |
  | Step 0               | 5/10, all dimensions                         |
  | Pass 1  (Info Arch)  | 5/10 → 9/10 after fixes                      |
  | Pass 2  (States)     | 3/10 → 9/10 after fixes                      |
  | Pass 3  (Journey)    | 6/10 → 8/10 after fixes                      |
  | Pass 4  (AI Slop)    | 8/10 → 9/10 after fixes                      |
  | Pass 5  (Design Sys) | 6/10 → 9/10 after fixes                      |
  | Pass 6  (Responsive) | 4/10 → 8/10 after fixes                      |
  | Pass 7  (Decisions)  | 8 resolved, 0 deferred                       |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (3 items)                            |
  | What already exists  | written                                      |
  | TODOS.md updates     | 0 items proposed                             |
  | Approved Mockups     | 3 generated (headless Chrome), auto-approved |
  | Decisions made       | 8 added to plan                              |
  | Decisions deferred   | 0                                            |
  | Overall design score | 3/10 → 8/10                                  |
  +====================================================================+
```

<!-- autoplan-accepted:design -->
- Phone `TapButton` reuses the BuzzButton circle; a 16px rule line 「整首只能按一次，最準的隊伍命中」 and a 22px label line (fallback 「按在關鍵那一拍」) sit above it; the 13-row state table in 畫面 is the contract (text states, not color only), implemented through a pure, unit-tested `tapButtonState`.
- Tap acknowledgement: the room sends `TAP_OK { questionId, round }` to every connection of the tapping team (never other teams) and resends it to a reconnecting team connection; `buzz.tapRound` increments on ⟲ and invalidates phones' 已按; `tap_taken` also counts as tapped; a `not_playing` refusal restores the button with 「沒算到：音樂剛停，等音樂再按」. This replaces the CEO bullet's "a teammate's second phone learns of the team's tap from `tap_taken`".
- `pointerdown` on the button only (or Enter/Space keydown) gives same-frame 送出中 + vibrate; `aria-live` state text; house focus ring; 早／晚 wording instead of +/−.
- Screen round: side `--lav` panel (♪ 卡點題, label prompt, rule line), no team row. Screen reveal: 560px cream panel, winner hat + 32px 「命中！{隊名}」 (「最接近！」 when the winner's error > 1 s, scoring unchanged), 24px error, 16px target; ≤ 8 rows of 30px/20px sorted by |error|, bonus `LabelChip`, `--turn` winner row, 「同秒先到」 on a tie, 沒按/暈眩 last in `--dim-ink`; names truncated at 110px.
- Music keeps playing to the clip end after the round closes; the reveal covers the music card.
- Host: 「已按 n/m 隊」 with m = currently eligible teams; clock missing > 3 s turns the line `--warn` with the recovery text and the skip button right under it; after a reveal, the median line and a 44px 「把延遲改成 X ms」 button (current + median, clamped 0–1000) that sends `HOST_TAP_LATENCY` only when pressed; the ⚙ 更多 field carries the two-question calibration hint.
- Editor: m:ss.cc display beside the target field, −0.05/+0.05 nudges, 「從目標前 3 秒試聽」, a reaction-bias hint, and per-field error copy for the four validation failures.
- Tests: `tapButtonState` rows; room tests for TAP_OK scope, reconnect resend and `tapRound`.
<!-- /autoplan-accepted:design -->
<!-- autoplan-baseline-edits:design {"sourceSha256":"73bfb721299ddcde397b04928d621be9becb317c7b4b3a2ca9cf5fe5c693f59a","replacements":[{"oldText":"公開的東西：回合中誰按了不公開（早按的隊伍會讓別隊知道「快到了」，跟 E4 不做進度條同一個理由）。`view.buzz` 拿掉 `taps`；手機自己記得這題按過了（重新整理後再按會收到 `tap_taken`，畫面改成「已按」；隊友的另一支手機按鈕還是亮的，按下去一樣收到 `tap_taken`，改成「你們隊已經按了」）。只有主持人頁的 STATE 多 `tapCount`（已按幾隊）。題目的公開資料（`PublicQuestion`）只多 `timing: { label? }`，沒有 `target`；STATE 不帶 `target` 也不帶任何毫秒數，房間測試要檢查。STATE 的 `tapLive?: true`：房間現在有這題的 anchor（來自採用中的那台大螢幕）。\n","newText":"公開的東西：回合中誰按了不公開（早按的隊伍會讓別隊知道「快到了」，跟 E4 不做進度條同一個理由）。`view.buzz` 拿掉 `taps`，多一個 `tapRound`（數字，⟲ 一次加 1）。按下後房間回 `TAP_OK { questionId, round }`，送給**這一隊所有的連線**（隊友的另一支手機也一起變「已按」；別隊收不到，所以不算公開）；這隊的手機重新連上、而這回合它已經按過時，房間也補送一次。手機的「已按」只在 `questionId` 和 `round` 都對得上目前的 `buzz` 時才算，⟲ 之後自動失效。還是收到 `tap_taken`（兩支手機幾乎同時按）時，也當成已按。只有主持人頁的 STATE 多 `tapCount`（已按幾隊）。題目的公開資料（`PublicQuestion`）只多 `timing: { label? }`，沒有 `target`；STATE 不帶 `target` 也不帶任何毫秒數，房間測試要檢查。STATE 的 `tapLive?: true`：房間現在有這題的 anchor（來自採用中的那台大螢幕）。\n"},{"oldText":"7. 主持人 ⟲ 從頭：清掉這題已按的紀錄（歌曲時間的尺變了），重新開放。⏸：手機按鈕變灰、收回合計時停止，已按的保留。\n","newText":"7. 主持人 ⟲ 從頭：清掉這題已按的紀錄（歌曲時間的尺變了），`tapRound` 加 1，重新開放；手機顯示「重新開始，可以再按一次」2 秒。⏸：手機按鈕變灰、收回合計時停止，已按的保留。\n"},{"oldText":"8. 主持人的「答對／答錯」在卡點題不能按：`timing` 不加進 `isAutoJudged`（它還管鎖定選項和戰士擲骰），`handleHostJudge` 另外擋，兩種判定都回 `auto_judged`；「改判答對」不會出現（卡點題沒有答錯可以撤）；主持人的改判清單（#240）照常列出贏家的那次命中，可以照它現有的規則改（只動那隊的分數，不補回首領的血、不把命中換給別隊）；「沒人答對，換下一題」照常可以按。「🎤 現場放歌」在卡點題拒絕（沒有大螢幕就量不了時間），主持人頁說明改按換下一題。\n","newText":"8. 主持人的「答對／答錯」在卡點題不能按：`timing` 不加進 `isAutoJudged`（它還管鎖定選項和戰士擲骰），`handleHostJudge` 另外擋，兩種判定都回 `auto_judged`；「改判答對」不會出現（卡點題沒有答錯可以撤）；主持人的改判清單（#240）照常列出贏家的那次命中，可以照它現有的規則改（只動那隊的分數，不補回首領的血、不把命中換給別隊）；「沒人答對，換下一題」照常可以按。「🎤 現場放歌」在卡點題拒絕（沒有大螢幕就量不了時間），主持人頁說明改按換下一題。\n9. 回合收掉後歌照常播到片段結束（跟現在搶答判定後一樣，播放器不停），揭曉畫面蓋在音樂卡上。\n"},{"oldText":"- 手機：一顆大圓鈕（沿用搶答按鈕的樣子）。狀態：「等音樂開始…」（灰）、「按！」（亮，上方寫「按在『蹬』那一下」）、「已按 ✓ 等結果」、揭曉後「差 +0.12 秒」。按下時手機震一下（`navigator.vibrate(30)`，不支援就略過，E2）。\n- 大螢幕回合中：「♪ 按在『蹬』那一下！」和隊伍列（回合中不顯示誰按了）。揭曉：大字目標時間「3:10.35「蹬」」，下面每隊一列依誤差排序（搶答階段所有隊伍都在魔王房，所以是每一隊）：隊名、`+0.12 秒`／`−0.40 秒`／`沒按`／`暈眩`、小獎勵 `+3`，贏家那列標「命中！」；沒按和暈眩排最後。\n- 主持人頁：卡點題顯示「卡點題・已按 2/4 隊」、「大螢幕播放時鐘：有／沒有」，沒有答對／答錯，保留「沒人答對，換下一題」。\n- 編輯器：搶答階段的題目多一個題型「卡點題」：目標秒數（`step 0.01`）、label。內容只能選 YouTube 或上傳的影音。「跟著按」：▶ 試聽片段播放時按一下，把播放器當下的時間記成目標秒數（E1）。\n","newText":"- 手機：沿用搶答按鈕 `BuzzButton` 的大圓鈕（`w-[min(72vw,280px)]`、4px `--k` 外框、內陰影），新元件 `TapButton` 放在同一個位置。按鈕上方一行小字（16px）說規則：「整首只能按一次，最準的隊伍命中」；label 那行 22px：「按在『蹬』那一下」，沒設 label 時「按在關鍵那一拍」。狀態用文字分，不只靠顏色：\n\n  | 狀態 | 按鈕顏色 | 按鈕文字 | 能按 |\n  |---|---|---|---|\n  | 還沒按 ▶ | 灰 `#5a4a60` | 等音樂開始… | 否 |\n  | 播放中、有時鐘、對時好了 | 紅 `#ff5050` | 按！ | 是 |\n  | 對時還沒好（還沒收到 PONG） | 灰 | 連線中… | 否 |\n  | 主持人 ⏸ | 灰 | 主持人暫停了 | 否 |\n  | 開放中但 `tapLive` 沒了（緩衝、廣告、大螢幕斷線） | 灰 | 大螢幕卡住了，等一下 | 否 |\n  | 按下、等房間回覆 | 金 `--warn` | 送出中… | 否 |\n  | 收到 `TAP_OK` 或 `tap_taken` | 金 `--warn` | 已按 ✓ 等結果 | 否 |\n  | 被拒絕 `not_playing` | 回到上面對應的狀態，下面一行 `--warn` 字：「沒算到：音樂剛停，等音樂再按」 | | 視狀態 |\n  | 💫 暈眩 | 灰 | 被暈眩了，這題坐掉 | 否 |\n  | 不在魔王房／離線 | 不顯示按鈕，沿用現有搶答階段的畫面 | | |\n  | 揭曉：命中 | `--ok` | 命中！晚 0.12 秒 | 否 |\n  | 揭曉：其他有按 | 灰 | 晚 0.12 秒・+3（第 2 名） | 否 |\n  | 揭曉：沒按 | 灰 | 沒按 | 否 |\n\n  按下用 `pointerdown`（只有按鈕本身，外面不算），同一個畫格就換成「送出中…」並震一下（`navigator.vibrate(30)`，iOS 沒有就只有畫面，E2）。鍵盤：按鈕是 `<button>`，Enter／Space 的 `keydown` 一樣用它的 `timeStamp`；`aria-live=\"polite\"` 念出狀態文字；用現有的 focus-visible 外框。秒數一律寫「早／晚 0.12 秒」，不用 `+`／`−`。\n- 大螢幕（960×540 舞台）回合中：音樂卡（`MusicCard`，照舊顯示 準備中／播放中／暫停／影片無法播放）旁邊的側欄放一個 `--lav` `Panel`：24px「♪ 卡點題」、28px「按在『蹬』那一下！」（沒 label：「按在關鍵那一拍！」）、16px「每隊只能按一次，最準的命中」。不放隊伍列（回合中不公開誰按了，空的隊伍列只是佔位）。\n- 大螢幕揭曉：蓋在題目區的 cream `Panel`，寬 560px。第一行最大：贏家的隊伍帽子 `Sprite` ＋ 32px「命中！{隊名}」；第二行 24px「晚 0.12 秒」；第三行 16px `--dim-ink`「目標 3:10.35「蹬」」。下面每隊一列（最多 8 隊，每列 30px 高、20px 字），依誤差絕對值排序：名次、隊名（超過 110px 截斷加…）、「早／晚 0.40 秒」、小獎勵 `+3`（`--ok` 字在 `--k` 底的 `LabelChip`），贏家那列 `--turn` 底；沒按、暈眩排最後，`--dim-ink` 字寫「沒按」「暈眩」。平手時贏家那列多一個「同秒先到」小字。贏家誤差超過 1 秒時第一行寫「最接近！{隊名}」（計分不變，只是用詞）。\n- 主持人頁：卡點題顯示「卡點題・已按 2/4 隊」（分母是現在有資格的隊伍：在線、在魔王房、沒暈眩，隨上線斷線更新）、「大螢幕播放時鐘：有／沒有」，沒有答對／答錯，保留「沒人答對，換下一題」。開放後時鐘「沒有」超過 3 秒，那行變成 `--warn` 底：「大螢幕卡住了：確認大螢幕在前景、按 ▶；不行就按下面的『沒人答對，換下一題』」，按鈕就在這行下面。揭曉後顯示「這題誤差中位數：晚 0.21 秒（喇叭延遲現在 120 ms）」和一個 44px「把延遲改成 330 ms」按鈕（新值 = 現在的延遲 + 中位數，夾在 0–1000；誤差是早的就減），按了才送 `HOST_TAP_LATENCY`。⚙ 更多裡的數字欄旁邊一行字：「彩排放一題測試卡點題，揭曉後按『把延遲改成…』；再放一題，中位數接近 0 就對了」。\n- 編輯器：搶答階段的題目多一個題型「卡點題」：目標秒數（`.px-input`，`step 0.01`，欄位右邊即時顯示 `3:10.35`）、label（`maxLength 10`）。內容只能選 YouTube 或上傳的影音。「跟著按」：▶ 試聽片段播放時按一下，把播放器當下的時間記成目標秒數（E1）；旁邊「−0.05」「+0.05」微調鈕，和「從目標前 3 秒試聽」，讓出題的人再聽一次核對（跟著按會帶到自己的反應時間，通常偏晚 0.1–0.2 秒，欄位下面一行字提醒）。錯誤訊息寫在欄位下面：「目標要在片段開頭之後」「目標要比片段結尾早 2 秒以上」「卡點題只能放在搶答階段」「label 最多 10 個字」。\n"},{"oldText":"- 房間（dungeon-room 測試）：TEAM_TAP 換算和夾住、不收沒 anchor 的、全部按完提早收、計時收、SCREEN_TAP_CLOCK 只收有金鑰的大螢幕、揭曉帶 `timing`。\n","newText":"- 房間（dungeon-room 測試）：TEAM_TAP 換算和夾住、不收沒 anchor 的、全部按完提早收、計時收、SCREEN_TAP_CLOCK 只收有金鑰的大螢幕、揭曉帶 `timing`；`TAP_OK` 只送給按的那隊的每條連線（別隊收不到）、重新連上補送、⟲ 後 `tapRound` 加 1。\n- 手機狀態文字：抽成純函式 `tapButtonState`（輸入 STATE 和這支手機的 ack，輸出狀態），單元測試涵蓋上面表格每一列。\n"}]} -->

### DX review (POLISH, auto-decided by /autoplan)

Owner note (relayed by the Captain, 2026-11-12): the three mockups (phone states, screen reveal, editor with 跟著按 and ±0.05) and the host-entered speaker latency are approved as drawn.

**Persona.** Two developers. (1) The bank author: knows the editor and JSON banks, writes music questions, has never seen a timing question; wants one that plays at rehearsal. (2) A contributor who changes the timing code later: knows the repo checks, does not know the clock-sync math.

**Empathy narrative.** The author opens the editor, adds a question to a buzzer phase, and looks for 卡點題. Before this review the plan had no doc section, an `answerText` line that read like a bank field, and refusals that said only "invalid". The author would guess at fields, save, read a one-line error with no value, and still not know whether the YouTube warning blocks the game. The contributor would see `at`, `anchor` and `target` with no units and could mix seconds and ms.

**Benchmark.** Existing question types: multipleChoice and sort each shipped with a question-bank doc section and parseBank messages naming the question. Timing must match that bar.

**Journey map.**

| Stage | Before | After |
|---|---|---|
| Find how to write one | no doc | question-bank.md 卡點題 section with a full example |
| Write it | ambiguous `answerText` field | no `answer`; field table; units |
| Validate | generic errors | value-carrying parseBank messages, editor field copy |
| See it play | path to a buzzer phase unknown | hosting: rehearsal bank, phase 1 one question, HP 1 |
| Recover live | not described | refusal codes, resend, host skip, ±5, close the stuck screen tab |

**Confusion report.** `answerText` (field or function?), units of `at`/`anchor`, which refusal the phone shows, whether health rows block, why `CLOCK_PING` has no role prefix, why `auto_judged` on a question that is not in `isAutoJudged`. All six are answered in the plan now.

**Error matrix.**

| Error | What | Fix shown | Recovery |
|---|---|---|---|
| parseBank target before start | value + clip start | field copy 目標要在片段開頭之後 | edit, save |
| parseBank target past end | value + grace + end | 目標要比片段結尾早 2 秒以上 | edit, save |
| parseBank not in buzzer phase | question id | 卡點題只能放在搶答階段 | move question |
| not_playing | phone line | 沒算到：音樂剛停，等音樂再按 | wait for music |
| tap_taken | phone state | 已按 ✓ 等結果 | none needed |
| tap_closed / stale_question | silent | STATE decides | none needed |
| timing_needs_screen | host copy | 請改按『沒人答對，換下一題』 | skip |
| health yellow rows | location + id | fix text in the row | optional |

**Scorecard (8 passes, 0–10, before → after).** Getting started 3 → 8; API/naming 6 → 8; errors 4 → 8; docs 2 → 8; upgrade path 6 → 8; environment/tooling 8 → 8; community/support n/a; measurement 5 → 7 (doc example under test). Overall 4 → 8.

**Checklist.** Units stated ✓; every refusal code named ✓; copy-paste example ✓ (to be tested); docs pairs listed ✓; format bump + rollback ✓; no new dependency ✓.

**TTHW.** Before: unknown (no doc, no path to a buzzer phase), estimated 20+ min. After: copy the example into a rehearsal bank (1 min), save in the editor (1 min), open a room, start, phase 1 at HP 1 to reach the buzzer phase (2 min), press ▶ on the screen. About 4–5 minutes.

**Consensus.**

| Topic | Codex | Native | Result |
|---|---|---|---|
| 5-minute path | High: none | must-fix: hosting fastest path | confirmed, fixed |
| Example shape / `answerText` | High: ambiguous | units + example missing | confirmed, fixed |
| Author docs | High: missing | must-fix docs pairs | confirmed, fixed |
| Refusals agent-ready | High: wants stable codes + field path | value-carrying strings | partly: room codes fixed; parseBank keeps strings (taste #20) |
| Health rows recovery | Medium | — | accepted, fixed |
| Message naming / `auto_judged` | Medium | units/naming | accepted: documented, `auto_judged` kept (taste #21) |
| Rollback in-progress rooms | Medium | cite read-only path | confirmed, fixed |

6/7 confirmed, 1 partial disagreement (parseBank error codes) → gate.

### Implementation Tasks (DX)
- [ ] **X1 (P1, human: ~2h / CC: ~10min)** — docs — question-bank, rules, hosting pairs (zh + en), changelog fragment, TODOS E3
  - Files: docs/question-bank.md, docs/question-bank.en.md, docs/rules.md, docs/rules.en.md, docs/hosting.md, docs/hosting.en.md, changelog.d/, TODOS.md
  - Verify: `npm run check:docs`
- [ ] **X2 (P1, human: ~1h / CC: ~5min)** — parseBank messages with values; doc example under test
  - Files: lib/question-bank.ts (+ test)
  - Verify: `npx vitest run lib/question-bank.test.ts`
- [ ] **X3 (P1, human: ~1h / CC: ~5min)** — room refusal codes, HOST_TAP_LATENCY clamp, timing_needs_screen; phone 2 s resend
  - Files: lib/room/dungeon-room.ts (+ test), lib/protocol.ts, app/room/[code]/play/page.tsx
  - Verify: room test
- [ ] **X4 (P2, human: ~30min / CC: ~3min)** — health rows fix text
  - Files: lib/bank-health.ts (+ test)
  - Verify: `npx vitest run lib/bank-health.test.ts`

<!-- autoplan-accepted:dx -->
- Units are explicit: bank `target`/`start`/`end` in seconds; `TEAM_TAP.at`, `SCREEN_TAP_CLOCK.anchor`, `CLOCK_PONG.server` in server epoch ms; constants carry `_S`/`_MS` suffixes. Timing questions have no `answer`; `answerText(q)` returns `m:ss.cc「label」`.
- `parseBank` messages carry actual values in the existing `question ${id}` form (six listed in 題庫格式); the buzzer-phase message becomes `must be a fill-in or a timing question`; the doc's JSON example is pasted into a question-bank test so docs and parser agree.
- Room refusal codes are fixed: `not_playing`, `tap_taken`, `tap_closed`, `stale_question`, `stunned`, `cannot_tap` for TEAM_TAP; unkeyed or wrong-question SCREEN_TAP_CLOCK is dropped silently; HOST_TAP_LATENCY non-finite → `bad_message`, else rounded and clamped 0–1000; HOST_BUZZ_OPEN on timing → `invalid_action` with detail `timing_needs_screen` and host copy.
- Phone resends the same `at` once when neither TAP_OK nor a refusal arrives within 2 s, and after reconnect; idempotent through `tap_taken`.
- Message direction and naming are documented in `lib/protocol.ts`; `auto_judged` is kept for host verdicts on timing (meaning: the room judges this question).
- Health rows are advisory (never block the opening), each with fix text in the problem line.
- Docs: question-bank (zh+en) gets a timing section with a complete buzzer-phase example, field notes, how to validate, format 11 and rollback (including in-progress rooms); rules and hosting pairs get the scoring text, rehearsal checklist, latency calibration, recovery steps and the fastest rehearsal path; changelog.d fragment `bump: minor`; TODOS.md E3.
<!-- /autoplan-accepted:dx -->
<!-- autoplan-baseline-edits:dx {"sourceSha256":"8319e8f82f7b443b8d574a7d310cbe2ba491d8b9740c318bf74979abdbd988ab","replacements":[{"oldText":"- `answerText`：`3:10.35「蹬」`。\n","newText":"- 沒有 `answer` 欄位（不是填空題）。`answerText(q)`（揭曉和主持人頁看的正解字串）對卡點題回 `3:10.35「蹬」`（沒 label 時只有時間）。\n- 單位：題庫裡的 `target`、`start`、`end` 都是秒（跟 YouTube 片段同一把尺）；協定和房間內部一律毫秒：`TEAM_TAP.at`、`SCREEN_TAP_CLOCK.anchor`、`CLOCK_PONG.server` 都是伺服器的 epoch 毫秒（`Date.now()` 那把尺），`HOST_TAP_LATENCY.ms`、`taps[].ms` 是毫秒。常數照單位加字尾：`TAP_GRACE_S`、`TAP_SETTLE_S`、`TAP_MAX_LAG_MS`、`TAP_MAX_LEAD_MS`、`TAP_HEALTH_LEAD_S`（健康檢查的 3 秒）。\n- `parseBank` 的錯誤訊息帶實際數值，照現有 `question ${id} …` 的格式：`question b-tap-1: target 169.5 is before the clip start 170`、`question b-tap-1: target 199 + 2 s grace is past the clip end 200`、`question b-tap-1: target has more than 3 decimals`、`question b-tap-1: label is longer than 10 characters`、`question b-tap-1 is a timing question, so it must be in a buzzer phase`、`question b-tap-1: a timing question needs a YouTube or uploaded video/audio clip`。搶答階段原本那句 `every question in it must be a fill-in` 改成 `must be a fill-in or a timing question`。`fields` 只屬於填空題（`kind: \"text\"`），卡點題的解析不讀它。\n"},{"oldText":"5. **訊息規則**：`CLOCK_PING`、`SCREEN_TAP_CLOCK` 不算活動（不延後閒置關房、不存檔），跟 `SCREEN_SOUND` 一樣列在 `onMessage` 的例外清單；兩者都經過 worker 現有的每連線 `RateLimiter`（每秒 10 則、一次最多 30 則），8 次對時加每秒一次心跳遠低於上限。\n6. **喇叭延遲（E3-lite，主持人設定）**：電視、HDMI、藍牙喇叭會讓大家晚 L 毫秒才聽到。這會改變誰贏：量到的誤差是 L＋各隊自己的誤差，早按的隊伍會佔便宜。瀏覽器量不到這段（`outputLatency` 只到音訊裝置，不含電視），所以不用它，改成主持人「⚙ 更多」裡一個「喇叭延遲（毫秒）」數字欄：預設 0、範圍 0–1000，跟著房間存檔（`HOST_TAP_LATENCY { ms }`），房間換算時從歌曲時間減掉。彩排時放一題測試卡點題，大家照耳朵按，揭曉表上誤差的中位數就是要填的值（主持人頁在揭曉後顯示「這題誤差中位數 +0.21 秒」給主持人參考）。\n","newText":"5. **房間的拒絕碼**（照現有的 `ERROR { error, detail }`；手機怎麼顯示見「畫面」的狀態表）：\n   - `TEAM_TAP`：`not_playing`（沒有 anchor、或歌曲時間在片段開頭之前）、`tap_taken`（這隊這回合已經按過）、`tap_closed`（不是卡點題、還沒按 ▶、或回合已經收了）、`stale_question`（`questionId` 不是現在這題）、`stunned`（暈眩坐掉這題）、`cannot_tap`（不在魔王房或這隊沒有在線的連線）。手機收到 `tap_closed`、`stale_question` 時回到 STATE 決定的狀態，不另外提示。\n   - 手機按下後 2 秒沒收到 `TAP_OK` 也沒收到拒絕（連線掉了、被限流丟掉）：重送一次同一個 `at`，最多一次；斷線重連後也一樣。重送是安全的：已經記下的會回 `tap_taken`，當成已按。\n   - `SCREEN_TAP_CLOCK`：沒有大螢幕金鑰、或 `questionId` 不是現在這題，跟其他 `SCREEN_*` 一樣直接忽略，不回錯誤。\n   - `HOST_TAP_LATENCY`：不是有限數字由 `parseClientMessage` 擋（`bad_message`）；數字就四捨五入成整數、夾在 0–1000 存起來，不報錯。\n   - 「🎤 現場放歌」（`HOST_BUZZ_OPEN`）在卡點題：`invalid_action`、`detail: \"timing_needs_screen\"`，主持人頁顯示「卡點題要大螢幕播放才能量時間，請改按『沒人答對，換下一題』」。\n6. **訊息的方向和名字**：`TEAM_TAP`（手機 → 房間，照 `TEAM_*` 慣例）、`SCREEN_TAP_CLOCK`（大螢幕 → 房間）、`HOST_TAP_LATENCY`（主持人 → 房間）；`CLOCK_PING`（手機和大螢幕都會送，所以不加角色前綴）→ `CLOCK_PONG`；`TAP_OK`（房間 → 按的那隊）。每個都在 `lib/protocol.ts` 註解寫方向和單位。卡點題拒絕主持人判定沿用 `auto_judged`：它的意思本來就是「這題由房間自己判，不用主持人按」，主持人頁對它已經有處理。\n7. **訊息規則**：`CLOCK_PING`、`SCREEN_TAP_CLOCK` 不算活動（不延後閒置關房、不存檔），跟 `SCREEN_SOUND` 一樣列在 `onMessage` 的例外清單；兩者都經過 worker 現有的每連線 `RateLimiter`（每秒 10 則、一次最多 30 則），8 次對時加每秒一次心跳遠低於上限。\n8. **喇叭延遲（E3-lite，主持人設定）**：電視、HDMI、藍牙喇叭會讓大家晚 L 毫秒才聽到。這會改變誰贏：量到的誤差是 L＋各隊自己的誤差，早按的隊伍會佔便宜。瀏覽器量不到這段（`outputLatency` 只到音訊裝置，不含電視），所以不用它，改成主持人「⚙ 更多」裡一個「喇叭延遲（毫秒）」數字欄：預設 0、範圍 0–1000，跟著房間存檔（`HOST_TAP_LATENCY { ms }`），房間換算時從歌曲時間減掉。彩排時放一題測試卡點題，大家照耳朵按，揭曉表上誤差的中位數就是要填的值（主持人頁在揭曉後顯示「這題誤差中位數 +0.21 秒」給主持人參考）。\n"},{"oldText":"`lib/bank-health.ts` 多兩種黃燈：目標離片段開頭不到 3 秒（大螢幕的播放時鐘還沒校準好）；YouTube 卡點題（建議改上傳音檔：沒有廣告、播放時間更準；沒設 `end` 時一併提醒）。\n","newText":"`lib/bank-health.ts` 多兩種黃燈（都是提醒，不擋開場），每一列照現有格式帶位置、題號，問題文字直接寫怎麼改：\n- 「卡點題的目標離片段開頭不到 3 秒：大螢幕的播放時鐘還沒校準好。把片段開頭往前移 3 秒以上」。\n- 「卡點題用 YouTube：可能有廣告、播放時間比較不準。建議改成上傳的音檔」，沒設 `end` 時後面加「；也沒設片段結尾」。\n健康檢查本來就從主持人頁「檢查題庫」和編輯器打開，不另外加入口。\n"},{"oldText":"- `lib/question-bank.ts`：解析和驗證（片段、target 範圍、只能在搶答階段、label 長度）。\n","newText":"- `lib/question-bank.ts`：解析和驗證（片段、target 範圍、只能在搶答階段、label 長度）；`docs/question-bank.md` 裡那段卡點題 JSON 例子原樣放進測試，確認 `parseBank` 收得下（文件和程式不會各說各話）。\n"},{"oldText":"- e2e 不在本機跑。\n","newText":"- e2e 不在本機跑。\n\n### 文件（中英成對）\n\n- `docs/question-bank.md`／`.en.md`：編輯器那段加卡點題（搶答階段才有、目標秒數、label、跟著按、微調、試聽）；格式號碼那句加「有卡點題的存成格式 11」；回滾那段加「存過卡點題之後（格式 11），回滾到加入卡點題以前的版本也一樣變唯讀，房間裡存著的含卡點題題庫副本舊版也讀不懂（房間重開）；要回滾先刪掉卡點題再存檔」。附一段可以直接複製的 JSON 例子：一個完整的搶答階段（`buzzer: true`、一題卡點題），每個欄位一行說明；寫完怎麼確認：編輯器存檔會跑 `parseBank`，錯誤訊息寫在欄位下面，再按主持人頁的「檢查題庫」看黃燈。\n- `docs/rules.md`／`.en.md`：「搶答階段」加一段卡點題：所有隊伍一起按、每隊一次、最接近的命中、其他隊 0.3／0.6／1 秒內 +3／+2／+1、沒人按就換題。\n- `docs/hosting.md`／`.en.md`：卡點題怎麼主持；彩排清單；喇叭延遲怎麼校正（放一題、按「把延遲改成…」、再放一題看中位數接近 0）；出狀況：大螢幕卡住先確認前景再按 ▶，不行就換下一題；兩台大螢幕時卡住的那台關掉分頁，另一台一秒內接手；目標秒數現場發現不準時用 ±5 補分；最快排到卡點題的方法（彩排用的題庫把第 1 階段放一題、血量設 1）。\n- `changelog.d/<branch-slug>.md`（`bump: minor`）；`TODOS.md` 加 E3 自動校正。\n"}]} -->

### Eng review (FULL_REVIEW, auto-decided by /autoplan)

#### Step 0 — Scope challenge

Scope accepted as-is (P2: never reduce). Complexity: about 17 changed files (lib/question-bank.ts, lib/bank-store.ts, lib/bank-health.ts, lib/protocol.ts, lib/game-state.ts, lib/room/dungeon-room.ts, lib/text-bank.ts, lib/bank-editor-question.ts, scripts/check-bundle.sh, the play/screen/host/editor pages, 6 docs, TODOS.md, changelog fragment) [estimated], and 3 new pure modules (lib/server-clock.ts, lib/tap-clock.ts, lib/tap-button-state.ts). The gate trips (8+ files); structure question auto-decided: original arrangement (pure helpers + thin room handlers). A smaller arrangement (fold the helpers into dungeon-room.ts) keeps the file count lower but loses unit-testable clock math, so it is worse. Pending remedies not decided here: none.

What already solves each sub-problem: BuzzState/openBuzz/skipBuzz/judge (lib/game-state.ts), keyed screens and SCREEN_* silent drop (lib/room/dungeon-room.ts ~2003), MediaCommand.seq for ⟲ (lib/protocol.ts:427), RateLimiter (lib/room/rate-limit.ts), handleClipEnded (lib/room/dungeon-room.ts:1214), bank health rows (lib/bank-health.ts), BuzzButton/MusicCard UI.

Search check: NTP-style min-RTT offset and media-clock anchoring are [Layer 1] (standard practice). Search unavailable for this lane; proceeding with in-distribution knowledge.

TODOS cross-reference: TODOS.md has no timing entry; E3 automatic calibration is added (CEO deferral).

REALITY: premise-table pass 9 claims, unverified=1 (screen player behaviour with no media after restart) lib/protocol.ts:428
REALITY: already-done pass git log origin/main --since=2026-11-12 is empty for the named files lib/question-bank.ts:378
REALITY: surface-check pass every message/field named exists or is new (MediaCommand.seq, SCREEN_CLIP_ENDED, sendTo/persist) lib/room/dungeon-room.ts:903
REALITY: binding-decisions pass owner U1–U3 and approved mockups/E3-lite kept; no overruled default reintroduced docs/designs/timing-tap.md:17
REALITY: numbers pass rate budget 4+8 msgs/s vs 10/s, burst 30 [measured: lib/room/rate-limit.ts]; 24 phones × 8 pings [estimated] lib/room/rate-limit.ts:1
REALITY: deferred-asks pass no linked issue; lane brief asks all covered (editor tap-along included as E1) docs/designs/timing-tap.md:11
REALITY: pr-count pass one PR (ship-policy default_pr_count 1) .gstack/ship-policy.json:1

#### Dual voices

Codex SAYS (eng): 5 findings — stale anchor on a frozen screen (High), TEAM_TAP needs round (High), delayed SCREEN_CLIP_ENDED closes a restarted round (High), offset midpoint ignores server hold time (Medium), rehearsal path in phase 1 invalid (Medium).
Claude SUBAGENT (eng): 14 findings — ⟲ race for tap and anchor (High), CLOCK_PONG/TAP_OK through sendTo persist the room (High), all-stunned round closes empty (High), latency L not applied to close time (Medium), clamp distorts resends (Medium), anchor updates must not broadcast (Medium), validation gaps (Medium), stale offset after sleep (Medium), check-bundle KeyError and other kind switches (Medium), restart media state (Medium), atomic winner step, auto_judged is a detail, double send, name collisions (Low).

```
ENG DUAL VOICES — CONSENSUS TABLE:
  Dimension                           Claude  Codex  Consensus
  1. Architecture sound?               yes*    yes*   CONFIRMED (fixes below)
  2. Test coverage sufficient?         no      no     CONFIRMED gap → race tests added
  3. Perf risks + budget/bench named?  no      —      Claude only (persist per PONG) → fixed
  4. Security threats covered?         yes     yes    CONFIRMED
  5. Error paths handled?              no      no     CONFIRMED gap → round/seq/stale/late fixed
  6. Deployment risk manageable?       yes     yes    CONFIRMED
```
5/6 confirmed, 0 disagreements. Single-voice critical finding flagged: persist-per-PONG (Claude only), accepted.

Codex offset finding rejected (mechanical): workerd freezes `Date.now()` for the duration of one event, so the room's receive and send times are the same number; a second server timestamp would add nothing.

#### Section 1 — Architecture

```
 phone (play page)                 room (DungeonRoom DO)                   screen (screen page)
 ┌──────────────────┐  CLOCK_PING   ┌──────────────────────────────┐ CLOCK_PING ┌─────────────────────┐
 │ server-clock.ts  │──────────────▶│ conn.send CLOCK_PONG (no      │◀───────────│ server-clock.ts      │
 │ min-RTT offset   │◀──────────────│ persist)                      │──────────▶ │                      │
 │ tap-button-state │  TEAM_TAP     │ tapIn ← tapEligible           │ SCREEN_TAP_│ tap-clock.ts anchor  │
 │ TapButton        │──{q,round,at}▶│ songMs() ← anchor, latency    │◀─CLOCK─────│ sampler (min of 8)   │
 │                  │◀── TAP_OK ────│ close timer (setTimeout)      │ {q,seq,a}  │ MusicCard/FilePlayer │
 └──────────────────┘   STATE       │ tapResults() → judge()        │◀─CLIP_ENDED│                      │
                       tapLive      │ game-state.ts BuzzState.taps  │   {q,seq}  └─────────────────────┘
 host page ──HOST_TAP_LATENCY──────▶│ latency (saved)               │
          ◀──STATE tapCount─────────│ reveal.timing                 │
                                    └──────────────────────────────┘
```
Design-twice: shape A (chosen) keeps clock math in pure modules and state in BuzzState; shape B keeps everything in DungeonRoom. A hides more behind less (one `songMs`, one `tapEligible`). Red flags: hand-synced eligibility (fixed: one `tapEligible`); two time conversions (fixed: one `songMs`). Single point of failure: the screen (host skip, stale expiry, second screen).

Findings: [CRITICAL] (9/10) lib/room/dungeon-room.ts:906 `if (msg.type !== "ERROR") this.persist();` — PONG through sendTo serializes the room per ping; fixed. [CRITICAL] (8/10) lib/protocol.ts:427 seq exists but plan did not use it — ⟲ races; fixed with round/seq. [CRITICAL] (8/10) lib/room/dungeon-room.ts:1214 clip-ended has no generation; fixed with optional seq. [INFORMATIONAL] (7/10) stale anchor on a frozen screen; fixed with TAP_CLOCK_STALE_MS.
Dispositions: all accepted (mechanical, P1/P5).

#### Section 2 — Code quality

Findings: [INFORMATIONAL] (8/10) scripts/check-bundle.sh:18 `answer = lambda q: ... else q["answer"]` — KeyError on timing; add branch. [INFORMATIONAL] (8/10) lib/room/dungeon-room.ts:1265,3708,4183 read `q.answer`; timing must be excluded. [INFORMATIONAL] (7/10) eligibility in four places → `tapEligible`. [INFORMATIONAL] (6/10) screen page already uses `tapped`/`needsTap` for audio unlock; name the new state `tapClock*`. `auto_judged` is a `detail` of `invalid_action` (lib/room/dungeon-room.ts:3028); plan wording fixed to reuse it as the detail.
Dispositions: all accepted.

#### Section 3 — Test review

Framework: vitest (`npm run test`), playwright CI-only.

```
CODE PATHS                                              USER FLOWS
[+] lib/server-clock.ts                                 [+] Team taps on the beat
  ├── [GAP→unit] offset = server − (t0+t1)/2              ├── [GAP→unit] tapButtonState every table row
  ├── [GAP→unit] min-RTT of last 8                        ├── [GAP→room] TEAM_TAP → TAP_OK to team conns only
  └── [GAP→unit] stale after 10 s                         ├── [GAP→room] resend → tap_taken counts as tapped
[+] lib/tap-clock.ts                                      └── [→E2E CI] full round on phone + screen (optional)
  ├── [GAP→unit] anchor min filter, reset on seek       [+] Host flows
  ├── [GAP→unit] songMs with latency L                    ├── [GAP→room] skip with no clock
  ├── [GAP→unit] tapResults sort, tie, tiers, no-tap      ├── [GAP→unit] median + new latency clamp
  └── [GAP→unit] close time (target+2 s, +0.5 floor, L)   └── [GAP→room] HOST_TAP_LATENCY clamp/round
[+] lib/game-state.ts tapIn/tapEligible                 [+] Error states
  ├── [GAP→unit] offline / not boss room / stunned        ├── [GAP→room] not_playing, tap_late, stale_question
  ├── [GAP→unit] all-stunned clears at open               ├── [GAP→room] old seq anchor dropped, old clip-end dropped
  └── [GAP→unit] winner judge(), bonuses, skip on none    └── [GAP→room] frozen screen → tapLive false at 2.5 s
[+] lib/room/dungeon-room.ts                            [+] Author flows
  ├── [GAP→room] PONG no persist; anchor no broadcast     ├── [GAP→unit] parseBank six messages + doc example
  ├── [GAP→room] keyed screen only                        ├── [GAP→unit] bank-health two rows
  └── [GAP→room] STATE has no target/ms                   └── [GAP→ci] check:bundle with a timing fixture
COVERAGE: 0/27 today (all new) | all 27 planned with ★★★ unit/room tests, 1 optional E2E
```
Value cards are in the test plan artifact. Regression risk: the buzzer-phase rule (fill-in only) loosens — existing parseBank tests for buzzer phases stay and a new case asserts multipleChoice is still refused (CRITICAL regression contract, auto-approved: behaviour preserved for non-timing kinds). Test plan: ~/.gstack/projects/critical-answer/georgechih-worktree-agent-ac6ee36390880bc8d-eng-review-test-plan-20261112.md (local-only).

#### Section 4 — Performance

Hot paths: CLOCK_PING (≈190 msgs in 1.2 s at question start with 24 phones [estimated]) — fixed by skipping persist; SCREEN_TAP_CLOCK ≤ 4/s — fixed by broadcasting only on tapLive flips; close timer — one setTimeout per round. No queries. Budget: no persist per PING/clock message (room test asserts). No bench needed beyond that assertion.

#### Failure modes registry (eng)

| Path | Failure | Test | User sees | Critical gap |
|---|---|---|---|---|
| ⟲ while a tap is in flight | old tap counted | room test (round) | — | fixed |
| screen tab frozen | stale anchor keeps button live | room test (stale) | 大螢幕卡住了 | fixed |
| all teams stunned | empty round | unit | — | fixed |
| PING storm | room slow | room test (no persist) | — | fixed |
| server restart, player stopped | anchor null | doc + manual | 大螢幕卡住了, host ▶ | no (clear message) |
| timing question in bank JSON | check:bundle KeyError | CI fixture | CI red | fixed |
0 critical gaps.

NOT in scope (eng): a second server timestamp in CLOCK_PONG (no value on workerd); per-phone touch latency compensation (accepted risk); E2E of the full round (CI may add later, not required).
What already exists: listed in Step 0; reused, not rebuilt.
Parallelization: sequential implementation, no parallelization opportunity (one lane, shared room/game-state modules).

Completion summary:
- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted, 1 unverified premise
- Architecture Review: 4 issues found
- Code Quality Review: 4 issues found
- Test Review: diagram produced, 27 gaps identified (all planned)
- Performance Review: 2 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item (E3 automatic calibration), auto-approved
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, completed
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: N/A (auto-decided, no scored answers)

### Implementation Tasks (Eng)
- [ ] **E1 (P1, human: ~2h / CC: ~10min)** — room — round/seq guards for TEAM_TAP, SCREEN_TAP_CLOCK, SCREEN_CLIP_ENDED; anchor stale expiry
  - Files: lib/protocol.ts, lib/room/dungeon-room.ts (+ test)
  - Verify: room tests for both ⟲ races and the frozen screen
- [ ] **E2 (P1, human: ~1h / CC: ~5min)** — room — CLOCK_PONG without persist; broadcast only on tapLive flips
  - Files: lib/room/dungeon-room.ts (+ test)
  - Verify: room test asserts no save per ping
- [ ] **E3 (P1, human: ~1h / CC: ~5min)** — game-state — `tapEligible` with all-stunned clear at open
  - Files: lib/game-state.ts (+ test)
  - Verify: `npx vitest run lib/game-state.test.ts`
- [ ] **E4 (P1, human: ~1h / CC: ~5min)** — tap-clock — one `songMs` for taps, close time, floor, clip-start; `tap_late` instead of lag clamp
  - Files: lib/tap-clock.ts (+ test), lib/room/dungeon-room.ts
  - Verify: `npx vitest run lib/tap-clock.test.ts`
- [ ] **E5 (P1, human: ~1h / CC: ~5min)** — kind switches — check-bundle, text-bank, bank-editor-question, q.answer readers handle timing
  - Files: scripts/check-bundle.sh, lib/text-bank.ts, lib/bank-editor-question.ts, lib/room/dungeon-room.ts
  - Verify: `npm run check:bundle` with a timing fixture
- [ ] **E6 (P2, human: ~30min / CC: ~3min)** — phone — offset stale at 10 s, re-ping on visibilitychange, single send per press
  - Files: lib/server-clock.ts, app/room/[code]/play/page.tsx
  - Verify: unit test for staleness

<!-- autoplan-accepted:eng -->
- TEAM_TAP carries `round` (tapRound) and a mismatch is `stale_question`; SCREEN_TAP_CLOCK carries the screen's `MediaCommand.seq` and a mismatch is dropped; ⟲ nulls the anchor until a new-seq report; SCREEN_CLIP_ENDED gains optional `seq`, required to match for timing questions only. Room-tested.
- The room expires the anchor after `TAP_CLOCK_STALE_MS` (2500 ms) without a report: `tapLive` false, close timer paused, another screen may take over. Room-tested.
- A tap older than `receive − TAP_MAX_LAG_MS` is refused as `tap_late` (phone: 「沒算到：網路太慢，再按一次」, button live again), not clamped; the lead side clamps to +300 ms. This replaces the CEO bullet's lag-side clamp.
- One `songMs(serverMs) = serverMs − anchor − latency` is used for taps, the close time, the early-close floor and the clip-start check; tested with latency > 0.
- CLOCK_PONG goes out by `conn.send` without persist; anchor updates broadcast STATE only when `tapLive` flips; room test asserts no save per ping and no broadcast for a non-flipping update.
- All new message fields are finite-number checked in `parseClientMessage` (`bad_message`), `questionId` length-bounded.
- One `tapEligible(game, teamId)` drives tapIn, early close, host denominator and the phone's stun state; when every online boss-room team is stunned at open, all are cleared. Unit-tested.
- Winner: `buzz.teamId` set and `judge()` called in one state step without a broadcast between.
- Phone offset is stale after 10 s (button 連線中…), re-ping on `visibilitychange`; one TEAM_TAP per press across pointerdown/keydown/click.
- Every kind switch handles `timing` (no `answer`): scripts/check-bundle.sh, lib/text-bank.ts, lib/bank-editor-question.ts, dungeon-room `q.answer` readers; check:bundle runs with a timing fixture.
- `auto_judged` is reused as the `detail` of `invalid_action`. Rehearsal checklist adds the screen's tap-to-unlock-audio; hosting adds "after a server restart press ▶ once"; the fastest rehearsal path uses phase 1 (normal, 1 question, HP 1) then a buzzer phase 2.
- Buzzer-phase regression contract: non-timing, non-fill-in kinds stay refused in buzzer phases (existing tests kept, multipleChoice case added).
<!-- /autoplan-accepted:eng -->
<!-- autoplan-baseline-edits:eng {"sourceSha256":"3c1095c43472d891cef0681df07b8c4157d565519fea12cf8059079fedd6decf","replacements":[{"oldText":"3. **手機按下**：用 `pointerdown` 事件的 `event.timeStamp`（觸控那一刻，不是 JS 開始跑的時候），加上 offset 換成伺服器時間，送 `TEAM_TAP { questionId, at }`。\n4. **房間換算**：`at` 先夾在 `[收到時間 − TAP_MAX_LAG_MS, 收到時間 + TAP_MAX_LEAD_MS]`（1000 ms / 300 ms），再減掉當時的 anchor 得到歌曲時間（毫秒），存起來。收到時沒有 anchor（音樂沒在放）就拒絕（`not_playing`），手機按鈕這時本來就是灰的。歌曲時間早於片段開頭（`start`，沒設當 0）也拒絕（`not_playing`）：⟲ 或跳轉剛換了 anchor 時，路上那個按的時間會落在新片段開始之前。\n","newText":"3. **手機按下**：用 `pointerdown` 事件的 `event.timeStamp`（觸控那一刻，不是 JS 開始跑的時候），加上 offset 換成伺服器時間，送 `TEAM_TAP { questionId, round, at }`（`round` 是手機看到的 `tapRound`）。offset 最新的樣本超過 10 秒就當成沒有（按鈕回到「連線中…」），`visibilitychange` 回到前景時立刻重新對時：iOS 休眠時 `performance.now()` 會停，舊的 offset 不能用。一次按下只送一則：`pointerdown`、Enter／Space 的 `keydown`、原生 `click` 都可能觸發，用手機本地的「送出中…」狀態擋掉重複。\n4. **房間換算**：`at` 比收到時間早超過 `TAP_MAX_LAG_MS`（1000 ms）就拒絕（`tap_late`，手機顯示「沒算到：網路太慢，再按一次」並回到能按的狀態；不夾住，因為夾住會存下一個錯的時間，2 秒後的重送尤其會被扭曲）；比收到時間晚就夾到 `收到時間 + TAP_MAX_LEAD_MS`（300 ms）。再換成歌曲時間存起來。所有「伺服器時間 ↔ 歌曲時間」的換算都走同一個函式 `songMs(serverMs) = serverMs − anchor − 喇叭延遲`：按的時間、收回合計時（`target + 2 s` 換回伺服器時間時要把喇叭延遲加回去）、提早收的下限、片段開頭檢查，全部用它，不然延遲 L 會讓回合早 L 毫秒收掉。收到時沒有 anchor（音樂沒在放）就拒絕（`not_playing`），手機按鈕這時本來就是灰的。歌曲時間早於片段開頭（`start`，沒設當 0）也拒絕（`not_playing`）：⟲ 或跳轉剛換了 anchor 時，路上那個按的時間會落在新片段開始之前。\n"},{"oldText":"   - `TEAM_TAP`：`not_playing`（沒有 anchor、或歌曲時間在片段開頭之前）、`tap_taken`（這隊這回合已經按過）、`tap_closed`（不是卡點題、還沒按 ▶、或回合已經收了）、`stale_question`（`questionId` 不是現在這題）、`stunned`（暈眩坐掉這題）、`cannot_tap`（不在魔王房或這隊沒有在線的連線）。手機收到 `tap_closed`、`stale_question` 時回到 STATE 決定的狀態，不另外提示。\n","newText":"   - `TEAM_TAP`：`not_playing`（沒有 anchor、或歌曲時間在片段開頭之前）、`tap_taken`（這隊這回合已經按過）、`tap_closed`（不是卡點題、還沒按 ▶、或回合已經收了）、`tap_late`（見上一點）、`stale_question`（`questionId` 不是現在這題，或 `round` 不是現在的 `tapRound`：⟲ 之前按的、還在路上的那一下）、`stunned`（暈眩坐掉這題）、`cannot_tap`（不在魔王房或這隊沒有在線的連線）。手機收到 `tap_closed`、`stale_question` 時回到 STATE 決定的狀態，不另外提示。\n"},{"oldText":"   - `SCREEN_TAP_CLOCK`：沒有大螢幕金鑰、或 `questionId` 不是現在這題，跟其他 `SCREEN_*` 一樣直接忽略，不回錯誤。\n","newText":"   - `SCREEN_TAP_CLOCK { questionId, seq, anchor }`：`seq` 是大螢幕收到的 `MediaCommand.seq`（⟲ 一次加 1，現有欄位）。沒有大螢幕金鑰、`questionId` 不是現在這題、或 `seq` 不是現在的 `media.seq`，跟其他 `SCREEN_*` 一樣直接忽略，不回錯誤。⟲ 時房間先把 anchor 設成 null，等新 `seq` 的回報到了才恢復，舊片段的 anchor 不會回來。\n   - 所有新訊息在 `parseClientMessage` 驗型別：`at`、`t`、`anchor`（非 null 時）、`ms`、`round`、`seq` 都要是有限數字，`questionId` 照現有訊息限制長度；不合就 `bad_message`。NaN 會穿過 `Math.min`／`Math.max` 弄壞排序。\n"},{"oldText":"7. **訊息規則**：`CLOCK_PING`、`SCREEN_TAP_CLOCK` 不算活動（不延後閒置關房、不存檔），跟 `SCREEN_SOUND` 一樣列在 `onMessage` 的例外清單；兩者都經過 worker 現有的每連線 `RateLimiter`（每秒 10 則、一次最多 30 則），8 次對時加每秒一次心跳遠低於上限。\n","newText":"7. **訊息規則**：`CLOCK_PING`、`SCREEN_TAP_CLOCK` 不算活動（不延後閒置關房、不存檔），跟 `SCREEN_SOUND` 一樣列在 `onMessage` 的例外清單；`CLOCK_PONG` 不走 `sendTo`（`sendTo` 每送一則就 `persist()`，把整個房間序列化一次），直接 `conn.send`，它不帶狀態。anchor 更新只在 `tapLive` 由有變無、由無變有時才 `broadcastState`；其他時候只悄悄重排收回合計時。房間測試檢查：一次 CLOCK_PING 不存檔，一次沒改變 `tapLive` 的 anchor 更新不廣播。兩者都經過 worker 現有的每連線 `RateLimiter`（每秒 10 則、一次最多 30 則），8 次對時加每秒一次心跳遠低於上限。\n"},{"oldText":"2. 手機：按鈕在「開放且大螢幕有回報播放時鐘（STATE `tapLive`）」時才亮。每隊只能按一次（`tapIn`）。資格：在線、在魔王房、沒被 💫 暈眩（暈眩照 R5 坐掉這題；全部都暈就全部解除，跟 `buzzIn` 同規則）。\n","newText":"2. 手機：按鈕在「開放且大螢幕有回報播放時鐘（STATE `tapLive`）」時才亮。每隊只能按一次（`tapIn`）。資格：在線、在魔王房、沒被 💫 暈眩（暈眩照 R5 坐掉這題）。`buzzIn` 的「全部都暈就全部解除」是按下去才解，卡點題的手機在暈眩時是灰的、沒人會按，所以改成在開放時（`openBuzz`）就判斷：魔王房裡在線的隊伍全部都暈，就當場全部解除。資格只寫一個函式 `tapEligible(game, teamId)`，`tapIn`、提早收、主持人的分母、STATE 給手機的暈眩狀態都用它，不各寫一份；有單元測試（全部暈眩的回合照常能按）。\n"},{"oldText":"   - 大螢幕回報片段播完（`SCREEN_CLIP_ENDED`）也收。上傳的影音在公開資料裡也是 `hiddenVideo`（`kind: \"youtube\"` 記號，`lib/question-bank.ts` `hiddenVideo`），所以 `shownVideoId` 和播完回報對它一樣有效。\n","newText":"   - 大螢幕回報片段播完（`SCREEN_CLIP_ENDED`）也收。卡點題要求這則回報帶 `seq`（新加的選填欄位，大螢幕填它收到的 `MediaCommand.seq`），`seq` 不是現在的 `media.seq` 就不收：⟲ 之前那次播完的回報晚到，不能把重新開始的回合收掉。其他題型照舊不看 `seq`。上傳的影音在公開資料裡也是 `hiddenVideo`（`kind: \"youtube\"` 記號，`lib/question-bank.ts` `hiddenVideo`），所以 `shownVideoId` 和播完回報對它一樣有效。\n"},{"oldText":"5. 贏的隊伍：`buzz.teamId` 設成它，走一般的 `judge(..., correct)`：扣 1 格血、命中獎勵（廚師照算）、最後一擊照擲 4d20、旁白念命中台詞。揭曉（AnswerReveal）多一個 `timing`：目標秒數、label、每隊誤差和小獎勵、贏家。大螢幕公布表，手機看到自己的誤差。贏家跟搶答答對一樣成為下一題的選類別隊伍（M5 的 `picker`），這是刻意的。\n","newText":"5. 贏的隊伍：`buzz.teamId` 設成它，走一般的 `judge(..., correct)`（設 `teamId` 和 `judge` 在同一個狀態步驟裡，中間不廣播：`skipBuzz` 和手機都把 `buzz.teamId` 讀成「有隊伍在口頭回答」）：扣 1 格血、命中獎勵（廚師照算）、最後一擊照擲 4d20、旁白念命中台詞。揭曉（AnswerReveal）多一個 `timing`：目標秒數、label、每隊誤差和小獎勵、贏家。大螢幕公布表，手機看到自己的誤差。贏家跟搶答答對一樣成為下一題的選類別隊伍（M5 的 `picker`），這是刻意的。\n"},{"oldText":"- 已按的隊伍斷線：按的紀錄保留，照常比。沒按的隊伍斷線：沒有資格，不等它。每次有隊伍上線／斷線都重新檢查「是不是都按完了」並重排收回合時間。所有有資格的隊伍都斷線也不重開回合：照常等到 `target + 2 s` 收，有人按就比，沒人按就換題。\n","newText":"- 已按的隊伍斷線：按的紀錄保留，照常比。沒按的隊伍斷線：沒有資格，不等它。每次有隊伍上線／斷線都重新檢查「是不是都按完了」並重排收回合時間。所有有資格的隊伍都斷線也不重開回合：照常等到 `target + 2 s` 收，有人按就比，沒人按就換題。\n- 回報 anchor 的大螢幕連線還在但不動了（分頁被凍結、休眠）：房間記下每次回報的時間，超過 `TAP_CLOCK_STALE_MS`（2500 ms，心跳一秒一次）沒收到就當成沒有 anchor，`tapLive` 變 false、收回合計時暫停，跟斷線一樣讓另一台大螢幕接手。\n"},{"oldText":"- 伺服器重啟：`taps` 在存檔裡；anchor、計時器只在記憶體，大螢幕心跳一秒內補回來，計時器跟著重排。\n","newText":"- 伺服器重啟：`taps` 在存檔裡；anchor、計時器只在記憶體。`MediaCommand` 也只在記憶體（重啟後沒有，大螢幕當成暫停），所以大螢幕的播放器若因此停下，anchor 會一直是 null，要主持人再按一次 ▶；播放器還在放時，心跳一秒內補回 anchor，計時器跟著重排。實作時確認大螢幕沒有 `media` 時播放器的行為，並在 hosting 出狀況那段寫「伺服器重啟後按一次 ▶」。\n"},{"oldText":"- 彩排清單：放一題測試卡點題，確認主持人頁「大螢幕播放時鐘：有」一直亮著、大螢幕留在前景（背景分頁的計時器會變慢）、填好喇叭延遲。\n","newText":"- 彩排清單：放一題測試卡點題，確認大螢幕已經點過「點一下開聲音」（沒點過的大螢幕不會播，也就不會回報時鐘）、主持人頁「大螢幕播放時鐘：有」一直亮著、大螢幕留在前景（背景分頁的計時器會變慢）、填好喇叭延遲。\n"},{"oldText":"- 時間戳被夾在收到時間的 −1000 ms ~ +300 ms 內：改過的手機程式最多能把按的時間往前謊報 1 秒（聽到鼓聲後再補按、謊報成剛好）。這在派對現場要有人自己寫程式改 WebSocket 訊息才辦得到，接受這個風險。\n","newText":"- 時間戳只收收到時間的 −1000 ms ~ +300 ms 內（太早的拒絕成 `tap_late`，太晚的夾到 +300 ms）：改過的手機程式最多能把按的時間往前謊報 1 秒（聽到鼓聲後再補按、謊報成剛好）。這在派對現場要有人自己寫程式改 WebSocket 訊息才辦得到，接受這個風險。\n"},{"oldText":"- 手機狀態文字：抽成純函式 `tapButtonState`（輸入 STATE 和這支手機的 ack，輸出狀態），單元測試涵蓋上面表格每一列。\n","newText":"- 手機狀態文字：抽成純函式 `tapButtonState`（輸入 STATE 和這支手機的 ack，輸出狀態），單元測試涵蓋上面表格每一列。\n- 競態和效能（房間測試）：⟲ 之前按的那一下（舊 `round`）回 `stale_question`、舊 `seq` 的 anchor 被忽略；全部暈眩的回合能按；喇叭延遲 L > 0 時收回合時間晚 L；2 秒後的重送回 `tap_late` 而不是被夾住；CLOCK_PING 不存檔、沒翻轉 `tapLive` 的 anchor 不廣播；NaN 的 `at` 回 `bad_message`。\n- 其他依題型分支的地方都要接住 `timing`（它沒有 `answer`）：`scripts/check-bundle.sh` 的 `answer(q)`（不然題庫裡有卡點題時 KeyError）、`lib/text-bank.ts`、`lib/bank-editor-question.ts`、`dungeon-room.ts` 讀 `q.answer` 的地方（`HOST_ANSWER`、法師提示、檢定）。`check:bundle` 用含卡點題的測試題庫跑一次。\n"},{"oldText":"- `docs/hosting.md`／`.en.md`：卡點題怎麼主持；彩排清單；喇叭延遲怎麼校正（放一題、按「把延遲改成…」、再放一題看中位數接近 0）；出狀況：大螢幕卡住先確認前景再按 ▶，不行就換下一題；兩台大螢幕時卡住的那台關掉分頁，另一台一秒內接手；目標秒數現場發現不準時用 ±5 補分；最快排到卡點題的方法（彩排用的題庫把第 1 階段放一題、血量設 1）。\n","newText":"- `docs/hosting.md`／`.en.md`：卡點題怎麼主持；彩排清單；喇叭延遲怎麼校正（放一題、按「把延遲改成…」、再放一題看中位數接近 0）；出狀況：大螢幕卡住先確認前景再按 ▶，不行就換下一題；兩台大螢幕時卡住的那台關掉分頁，另一台一秒內接手；目標秒數現場發現不準時用 ±5 補分；最快排到卡點題的方法：彩排用的題庫第 1 階段（一般首領階段，搶答階段不能是第 1 階段）只放一題、血量設 1，答對一題就進第 2 階段，第 2 階段設成搶答階段放卡點題。\n"}]} -->

### Final approval gate (auto-approved, lane brief: do not ask)

- User Challenges: none. Both voices raised an error cap; owner decision U2 (closest wins at any error) stands, listed as taste #8/#14.
- Taste decisions carried to the final report: #2, #7, #8/#14, #9, #10, #11, #12, #13, #15–#18, #20, #21.
- Aggregated tasks: CEO T1–T6, Design D1–D5, DX X1–X4, Eng E1–E6 (21 tasks; 14 P1).
- Mockups (local-only, `~/.gstack/projects/critical-answer/designs/timing-tap-20261112/`) approved by the owner as drawn, relayed by the Captain.
