# 大螢幕試播每支影音

狀態：Captain 指派（2026-11-15，TODOS「題庫健檢讓大螢幕實際載入每支影音」），實作中。
活動：2026-11-21。

## 要做什麼

`🩺 檢查題庫`（`bank-health-check.md`）在伺服器查，看不出地區限制、年齡限制、場地 Wi-Fi 和大螢幕瀏覽器的解碼能力。最近一次 QA 有幾支 YouTube 在大螢幕不給嵌入。這個功能讓主持人在大廳按一顆鈕，**帶金鑰的大螢幕**把題庫裡每支影片和聲音（YouTube、Instagram 詳解、上傳的影片／聲音，題目和詳解都算）實際載入一次（靜音、畫面看不到），回報哪幾支放不出來。主持人頁列出放不出來的那幾題。

## 設計

### D1 一顆鈕，在健檢旁邊

主持人頁大廳「🩺 檢查題庫」下面加「📺 大螢幕試播影音」。按下送 `HOST_SCREEN_TEST {}`。結果列在按鈕下面，格式和健檢的列一樣（紅／黃、`where`＋`#id`、`label`、`problem`），上面一行進度：「大螢幕試播中… 12／40」，跑完「📺 40 支試播完：🔴 2 放不出來 · 🟡 1 太久沒載入」或「✅ 40 支都載得出來」。

- 房間回 `ERROR invalid_action`：`no_screen`（沒有帶金鑰的大螢幕連著）、`bank_loading`；遊戲中 `game_already_started`。
- 再按一次＝重新開始（新的 `runId` 蓋掉舊的）。不另做「跑完才能按」：大螢幕卡住時，主持人再按就好。
- 檢查的是房間現在那份題庫。想先載入剛存的題庫，先按「🩺 檢查題庫」（它會重新載入）。

### D2 協定

```ts
// 主持人 → 房間
{ type: "HOST_SCREEN_TEST" }
// 房間 → 一台帶金鑰的大螢幕（最早連上的那台），不廣播
{ type: "SCREEN_TEST"; runId: number; items: ScreenVideo[] }   // ScreenVideo = SCREEN_VIDEO 的 video
// 大螢幕 → 房間，一支一則
{ type: "SCREEN_TEST_RESULT"; runId: number; index: number; error: ScreenTestError | null }
// ScreenTestError = "blocked" | "gone" | "error" | "timeout" | "no_picture"
// 房間 → 所有主持人頁，每收到一則就送一次
{ type: "HOST_SCREEN_TEST"; done: number; total: number; rows: HealthRow[]; stopped?: true }
```

- `items` 只含大螢幕本來就會在 `SCREEN_VIDEO` 收到的東西（YouTube id／起訖秒數、Instagram shortcode、上傳檔的公開網址），**不含答案**；只送給 `isScreen` 的連線（`screen-video-key.md` 的規則）。同一支影片或檔案在好幾題用到只放一次。
- `rows` 沒有網址、id、R2 key、答案，和 `HOST_BANK_HEALTH` 一樣。
- 房間記 `screenTest = { runId, screenId, list, errors }`，只收那台大螢幕、那個 `runId`、範圍內、還沒收過的 `index`；`error` 只收列舉的值（`parseClientMessage` 擋）。不寫進快照，用 `conn.send` 直接送。
- 每支媒材在伺服器記住用到它的每一題（`where`、`#id`、`label`、題目或詳解），大螢幕只拿到去重後的網址清單；一支壞掉就列出每一題。
- 那台大螢幕斷線**或同一個 id 重連**（重連的是新的頁面，不會接著跑）：丟掉 `screenTest`，主持人頁收到 `stopped: true`（「大螢幕斷線，試播停在 12／40」）。遊戲開始：房間丟掉 `screenTest`（之後的結果不收），主持人頁收到 `STATE` 時清掉。換題庫：主持人頁收到 `HOST_BANKS` 換了題庫時清掉，和健檢一樣；房間記下開始時的題庫 id，之後的結果遇到題庫 id 不同就丟掉整次試播，舊題庫的列不會再冒出來。按「🩺 檢查題庫」重新載入同一份題庫不會打斷試播（這次試播帶著自己的清單）。主持人頁重連時，房間補送目前的進度。
- 沒有整體時間上限：每支 20 秒封頂，主持人看得到進度，卡住可以再按一次重來。

### D3 大螢幕怎麼試

大廳時，大螢幕收到 `SCREEN_TEST` 就一支一支試（一次一支，不搶場地頻寬），每支最多 20 秒：

| 媒材 | 怎麼算載得出來 | 錯誤 |
|---|---|---|
| YouTube | 專用的試播元件，直接用 IFrame API（`loadYoutubeApi`，不改 `YoutubePlayer`），`mute()` 後 `playVideo()`，收到 PLAYING | onError 的錯誤碼 101／150 → `blocked`（不給嵌入）；100、2 → `gone`；其他 → `error`；20 秒 → `timeout` |
| 上傳影片／聲音 | 專用的 `<video muted preload="auto">`（不用 `FilePlayer`：它會照主持人的指令出聲播放），收到 `loadeddata` | `error` 事件 → `error`；`loadeddata` 時影片（不是聲音）`videoWidth === 0` → `no_picture`（瀏覽器解不了畫面，例如 HEVC）；20 秒 → `timeout` |
| Instagram 詳解 | 官方 embed 送出第一則 `MEASURE` 訊息（`measuredHeight`） | 20 秒 → `timeout` |

- 試播的播放器 200×200、`opacity: 0`、`pointer-events: none`、`aria-hidden`，在畫面角落：投影出去看不到影片標題（音樂題的答案）。靜音，不出聲。
- YouTube 的「載得出來」是真的開始播（靜音自動播放各大瀏覽器都允許）。萬一大螢幕的瀏覽器連靜音自動播放都擋，每支都會是黃的 `timeout`，不會誤報成紅。場地網路擋掉 YouTube 的 `iframe_api` 腳本時也算黃 `timeout`：影片本身沒被試到。上傳檔試完就把 `<video>` 的 `src` 拿掉，不讓背景繼續下載搶頻寬。
- 一局開始（收到 `STATE`）或重連就停。
- 紅：`blocked`、`gone`、`error`、`no_picture`。黃：`timeout`（網路慢或被擋，到場再試）。Instagram 的「載得出來」只代表 embed 有回應，不保證影片還在。

## 測試

- `lib/bank-health.test.ts`：`screenTestList` 去重、題目和詳解都算、沒有答案欄位；`screenTestRows` 對應紅黃與「詳解：」前綴、一支多題就列多列。
- `lib/room/screen-test.test.ts`：不是主持人 `not_host`；沒有大螢幕 `no_screen`；只送給帶金鑰的大螢幕；別台／舊 `runId`／重複 `index` 的結果丟掉；每則結果送主持人進度；大螢幕斷線送 `stopped`；遊戲開始後丟掉。
- `lib/protocol.test.ts`：兩則新訊息解析，錯的 `error` 值擋掉。
- 大螢幕的播放器：e2e 只在 CI，不新增（真的 YouTube 在 CI 不穩）。

## 文件

`docs/hosting.md`／`docs/hosting.en.md` 加一段。`changelog.d/feat-bank-health-media-load.md`（`bump: minor`）。TODOS 刪掉這一項。

## 不做

- 讀影片檔尾找 HEVC（`no_picture` 已經用瀏覽器真的試過，比讀檔準）。
- 自動重試、同時試好幾支、主持人頁看縮圖、把結果存檔、合併進 `🩺 檢查題庫` 的同一份清單（兩份結果分開列，各自一顆鈕，程式最少）。
- YouTube 的 `start` 超過影片長度、版權靜音（試播看得出播放，聽不出靜音）。

## Review record

/autoplan 2026-11-15，背景 lane 精簡執行（沒有使用者可以問，照 6 個原則自動決定）。範圍偵測：沒有 UI 設計、沒有 DX 範圍，所以只有 CEO 和 ENG。外部意見用 Codex（`codex exec`，read-only）一次看 CEO＋ENG 兩面，讀了實際的程式碼。介面草圖：`~/.gstack/projects/chihgeorge-critical-answer/mock/bank-health-media.png`（只在本機）。

**CEO：** 前提成立（伺服器健檢看不出現場那台大螢幕的播放能力，screen key 已經有安全的送法）。提醒：去重後要在伺服器記住每支媒材用到哪幾題；試播器在整個載入和拆掉的過程都不能被投影看到。

| # | Codex 發現 | 嚴重度 | 決定 |
|---|---|---|---|
| 1 | 大螢幕同一個 id 重連時，舊的試播還掛著 | High | 採納：重連就停，主持人收到 `stopped`（D2） |
| 2 | `YoutubePlayer` 的 onError 拿不到錯誤碼，分不出不給嵌入和找不到 | High | 採納：專用的試播元件直接用 IFrame API（D3） |
| 3 | 瀏覽器擋自動播放時，PLAYING 不會來 | High | 部分採納：靜音自動播放各大瀏覽器都允許；萬一被擋算黃 `timeout`，不會誤報紅（D3） |
| 4 | `FilePlayer` 沒有靜音、會照指令播放；`videoWidth` 要等 metadata | Medium | 採納：專用 `<video muted>`，`loadeddata` 才看 `videoWidth`（D3） |
| 5 | 中斷的情況沒寫主持人頁怎麼清 | Medium | 採納：照健檢的作法，`STATE`／`LOBBY`／`HOST_BANKS` 清掉（D2） |
| 6 | 沒有整體時間上限 | Medium | 採納為「不設上限、顯示進度、可再按重來」（D2） |
| 7 | 一支多題的對應 | Low | 本來就這樣設計，寫清楚（D2） |

ENG 沒有另跑 Claude 子代理審查：Codex 已讀過要動的每個檔案，計畫小（約 8 個檔案），活動在 6 天後。

### /review 2026-11-15

testing、maintainability、security 三個專門審查加一個對抗式審查（Claude 子代理）。security 沒有發現；其他的處理：

| 發現 | 決定 |
|---|---|
| 換題庫後，房間還在收舊題庫的結果，主持人頁的列被補回來 | 修：房間記下題庫 id，不同就丟掉試播 |
| 「20 秒」寫死在列的文字裡，和元件的逾時常數沒綁在一起 | 修：`SCREEN_TEST_SECONDS` 放在 `lib/protocol.ts`，兩邊共用 |
| 上傳檔試完，脫離畫面的 `<video>` 還在下載 | 修：回報後清掉 `src` |
| YouTube 腳本被擋時每支都標紅 | 修：改黃 `timeout` |
| 主持人頁重連時停在「試播中…」 | 修：`HOST_CLAIM` 時補送進度 |
| 遊戲中大螢幕斷線，下一次大廳冒出「大螢幕斷線」 | 修：遊戲中不送 `stopped` |
| 檔案判斷沒有測試、跑完才斷線沒有測試 | 修：`fileTestError` 抽成純函式加測試；補房間測試 |
| 大螢幕重連後排到最後，試播可能跑在別台帶金鑰的裝置上 | 不改：帶金鑰的裝置本來就拿得到影片 id；主持人關掉別台再按一次就好 |
| 房間重啟（Durable Object 被回收）後主持人頁停在進度 | 不改：「📺 重新試播」可以重來 |
