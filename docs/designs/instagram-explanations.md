# Instagram 影片當詳解

狀態：站長核准（2026-11-10），實作中。
活動：2026-11-21，功能截止 2026-11-18（站長要求活動前做，原本 TODOS 寫「活動後」）。

## 要做什麼

站長 2026-11-10 想用 Instagram 的影片（Reels／貼文影片）。先查官方嵌入能做什麼（下面），再決定範圍。

**站長決定（2026-11-10）：**「先限定IG只當詳解 題目只限定youtube或圖片 詳解就直接照lane設計」。所以 Instagram **只能放在詳解欄**；題目欄照舊只有文字、圖片、YouTube。原本 /autoplan 審的是「Instagram 當題目」的版本（主持人「播完了」開始倒數、搶答等 ▶ 這些），那些只為題目欄存在的部分都拿掉了。

## 查證：Instagram 官方嵌入能做到什麼（2026-11-10）

只用官方嵌入 iframe，不抓、不下載 Instagram 的影片檔（違反 Instagram 使用條款）。

查法：網路搜尋 Meta 的文件，加上一頁本機測試頁（`localhost`，一個 iframe 加 `message` 監聽），在瀏覽器裡開一支公開的 @natgeo 影片貼文。

| 問題 | 結果 | 依據 |
|---|---|---|
| 要不要登入、要不要 token | **都不用。** `https://www.instagram.com/p/<shortcode>/embed/` 直接放進 iframe 就能看、能播。`/reel/<shortcode>/embed/` 也一樣。oEmbed API（拿嵌入 HTML 用的）要 Meta app token，但我們不需要它：iframe 網址自己組就好。 | 測試頁；Meta oEmbed 文件 |
| 主持人能不能遠端播放／暫停 | **不能。** 沒有像 YouTube IFrame API 的播放器 API。對 iframe 送 `{type:"pause"}`、`{method:"pause"}`（player.js）、`{event:"command",func:"pauseVideo"}`（YouTube 格式）都沒反應，影片照播。 | 測試頁；Meta 文件只寫 embed.js 的 `instgrm.Embeds.process()`，沒有播放控制 |
| 有沒有 ready／ended 事件 | **只有版面事件。** iframe 只送 `LOADING`、`MEASURE {height}`、`MOUNTED {styles}`。按播放、播完都**沒有**任何訊息。播完後畫面停在「Watch again on Instagram」。 | 測試頁（看完一整支 30 多秒的影片） |
| 自動播放、有聲音 | **不行。** `?autoplay=1` 被忽略，畫面停在封面加播放鍵；一定要有人在 iframe **裡面**點一下才會播。點了是使用者手勢，聲音應該會出來（無頭瀏覽器測不到聲音，要在活動大螢幕上實測）。 | 測試頁 |
| 能不能知道有人點了影片 | **可以，間接。** 點 iframe 時外層視窗會收到 `blur`，而且 `document.activeElement` 是那個 iframe。測試頁實測成功。這是瀏覽器的焦點行為，不是 Instagram 的 API。 | 測試頁 |
| 能不能停下來 | **可以，間接。** 把 iframe 重新掛上（換 `key`）會回到封面，聲音停掉。 | React 行為 |
| 播放區間（從第幾秒播） | **不行。** 沒有 `start` 參數。 | — |

結論：做不到 YouTube 那種「主持人按 ▶ 大螢幕就播」。詳解是公布答案後看的，不用計時，所以做得到的版本就夠用：大螢幕放官方嵌入，**大螢幕旁邊的人點一下影片**才會播；主持人的 ▶ 讓大螢幕跳出「👆 點影片開始播放」提示；⏸、⟲ 讓嵌入重新載入（回封面、聲音停掉）。

## 設計

### 題庫格式

`MediaContent.kind` 多一個 `"instagram"`，`value` 是 shortcode（網址 `/p/`、`/reel/`、`/reels/`、`/tv/` 後面那段）。

- **只能放在 `explanation`**，放在 `content` 伺服器拒收。
- shortcode 驗證 `/^[A-Za-z0-9_-]{5,40}$/`（官方沒寫長度；常見 11 字元，寬一點）。
- 只能有 `end`，意思是**影片長度（秒）**，選填：有人點了影片之後過了這麼久，大螢幕把 BGM 放回來。不能有 `audioOnly`、`start`（嵌入做不到）。
- 舊題庫不用改。`BANK_FORMAT` 7 → 8：存過 Instagram 詳解的題庫存成格式 8，退回舊版本時編輯器變唯讀，不會把詳解存掉；沒有 Instagram 詳解的題庫照舊存成原本的格式。

### shortcode 只給主持人和帶金鑰的大螢幕

照 `docs/designs/screen-video-key.md` 的規則：

- `STATE` 的 `reveal.explanation` 只寫 `{ kind: "instagram" }`，不帶 shortcode。手機顯示「▶ 詳解影片請看大螢幕」。
- shortcode 走 `SCREEN_VIDEO { questionId, video: { kind: "instagram", shortcode, end? } }`，只送主持人頁和帶金鑰的大螢幕。房間的 `shownVideoId()` 在公布答案、詳解是 Instagram 時回答的那題，`sendVideo()` 那時送詳解的影片，不送題目的。
- 詳解是 Instagram 時，題目自己的 YouTube 不在公布答案時重放（跟圖片／YouTube 詳解一樣，詳解佔那一格，D17）。

### 大螢幕

新元件 `components/instagram-player.tsx`：

- iframe `https://www.instagram.com/p/<shortcode>/embed/`（不用 `captioned`）。iframe 寬 326、高照它的 `MEASURE` 訊息（只收 `origin === "https://www.instagram.com"` 而且 `event.source` 是這個 iframe；收到之前用 640），再用 CSS `transform: scale()` 整個縮進框裡。詳解在公布答案的面板中間單獨一塊，框 260×440，直式影片看得清楚（YouTube 詳解只有 356×200）。
- 不裁掉帳號名稱和下方按鈕（裁掉 Meta 的嵌入外觀有違反嵌入規範的風險）。帳號名稱可能洩答案：編輯器提醒。
- 主持人的 ▶ ⏸ ⟲ 照舊走 `HOST_MEDIA`。什麼時候重新掛上用現有的 `playerSteps`：`pause` 或 `restart` 就重新掛上；`play` 只在還沒人點時顯示「👆 點影片開始播放」。
- 每 250ms 看 `document.activeElement === iframe`（比只聽 `blur` 穩）→ 有人點了：BGM 靜音、旁白停（`onVideoPlaying(true)`）。有 `end` 就計時，時間到 BGM 放回來；重新掛上或卸下時也放回來。
- 沒金鑰的大螢幕顯示 🔒 提示，沒有 iframe（跟 YouTube 一樣）。
- 不蓋 YouTube 的「👆 點一下大螢幕」遮罩：點 iframe 本身就是播放需要的手勢。

### 主持人頁

公布答案、詳解是 Instagram 時，出現 ▶ ⏸ ⟲（文字：「▶ 請大螢幕點影片」「⏹ 停止」「⟲ 重新載入」）。

### 題庫編輯器

- 詳解欄多一顆「Instagram」（題目欄沒有）：貼網址或 shortcode，看不懂顯示「看不出這是 Instagram 網址」。
- 「影片長度」一格（選填，`0:35` 或 `35`）。
- 預覽：同一個嵌入，可以直接點播。出題的人在這裡確認播得出來（私人帳號、限制級、用了有版權音樂的 Reels 可能不能嵌）。
- 一行提醒：大螢幕要有人點影片才會播；影片上方會顯示發文帳號，帳號名稱別洩答案。

## 不做

- Instagram 當題目（站長決定，2026-11-10）。所以也沒有「播完了」鍵：它只為 Instagram 題目的作答倒數而設計，YouTube 題目自己會偵測播完。
- 抓 Instagram 影片檔自己播（違反使用條款）；oEmbed API（要 Meta app，用不到）；播放區間；偵測貼文被刪。

## 風險

- Instagram 改版：嵌入網址或焦點行為變了，最壞是 BGM 不會自動靜音，主持人按 ⏸ 停影片；遊戲不受影響（詳解不擋下一題）。
- 聲音要在活動大螢幕上實測（併入 TODOS「11/21 前在活動用的大螢幕瀏覽器實測 YouTube 聲音」）。
- 大螢幕旁要有人能點；只有遙控器的電視不行。

## 測試

- `lib/instagram.test.ts`：各種網址、參數、錯誤輸入。
- `lib/question-bank.test.ts`：詳解欄收、題目欄拒收、只能有 `end`、`formatOf` 回 8。
- `lib/room/dungeon-room.test.ts`：公布答案時 `STATE` 不帶 shortcode、`SCREEN_VIDEO` 帶給主持人、`HOST_MEDIA` 在公布答案時收。
- e2e：CI 跑，不新增。

## Review record

/autoplan 2026-11-10，lean、單一審查者（lane 指示不開額外 subagent、不用外部意見，所以各階段的 native subagent 和 Codex 都沒跑，共識欄是 N/A）。審的是「Instagram 當題目」版本，結論：嵌入沒有播放 API、沒有播完事件、不能自動播，只能做「大螢幕有人點」的版本。四個品味決定：選填長度（保留）、詳解欄不放 Instagram（**被站長推翻**：改成只放詳解，詳解給大框）、不裁帳號名稱（保留）、搶答時停影片（題目欄沒有 Instagram 了，不適用）。沒有 user challenge。
