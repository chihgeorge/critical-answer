# YouTube 影片題與聽歌題

狀態：eng review 與 design review 完成（2026-11-06），已在 `feat/youtube-media` 實作（T1–T9）。下面的草稿原文保留不動，後來的決定見 Decision ledger 和 D12–D22。
分支：`feat/youtube-media`
活動：2026-11-21，功能截止 2026-11-18

## 要做什麼

站長 2026-11-06 決定兩個都做，而且都只用 YouTube，不做影音上傳：

1. **影片題**：大螢幕播 YouTube 影片，隊伍看完作答。
2. **聽歌題**：一樣是 YouTube，但大螢幕把畫面藏起來，只放聲音。

## 現況（2026-11-06 讀程式）

| 項目 | 現況 | 位置 |
|---|---|---|
| 題庫格式 | `content` 可以是 `{kind:"youtube", value:<11 字元 id>}`，跟文字題幹二選一 | `lib/question-bank.ts:27`、`:149` |
| 題庫編輯器 | 已經有 文字／圖片／YouTube 切換，貼網址會抽出 id | `app/bank-editor/page.tsx:679-791` |
| 大螢幕 | `QuestionMedia` 用一般 iframe，260×160，比 YouTube 規定的最小 200×200 還矮 | `components/pixel.tsx:28`、`app/room/[code]/screen/page.tsx:264` |
| 手機 | 也嵌一個 iframe，280×200 | `app/room/[code]/play/page.tsx:711` |
| 主持人頁 | 只顯示「影片題（看大螢幕）」，沒有播放控制 | `app/room/[code]/host/page.tsx:578` |
| 播放控制 | 沒有。誰要播就去點大螢幕上的 iframe | — |
| BGM | 只在 TTS 說話時降音量，不知道影片在播 | `app/room/[code]/screen/page.tsx:550` |

缺口：
- 題目一旦是 YouTube，就沒有文字題幹（「這首歌是誰唱的？」放不進去）。
- 沒有「只放聲音」的選項。
- 沒有播放區間（從第幾秒播到第幾秒）。
- 主持人不能從自己的頁面播放、暫停、重播；大螢幕通常離主持人很遠。
- 手機也在播，聲音會疊在一起；聽歌題的影片標題和封面也會在手機上洩題。

## 提案

### 題庫格式

`youtube` 內容加三個選填欄位，舊題庫不用改：

```ts
interface MediaContent {
  kind: "text" | "image" | "youtube";
  value: string;
  /** youtube only: 題幹文字，顯示在影片上方，例如「這首歌是誰唱的？」 */
  prompt?: string;
  /** youtube only: true = 聽歌題，大螢幕藏畫面只放聲音 */
  audioOnly?: boolean;
  /** youtube only: 播放區間（秒） */
  start?: number;
  end?: number;
}
```

`parseMediaContent` 在伺服器端驗證：`prompt` 長度上限、`start`/`end` 是非負整數且 `end > start`。公開投影（`toPublicMedia`）照樣逐欄挑選，答案不會跟著走。

### 播放控制

- 主持人頁出現「▶ 播放／⏸ 暫停／⟲ 從頭」三顆鍵（只在 YouTube 題時出現）。
- 房間收到 `HOST_MEDIA`（`play` / `pause` / `restart`），記下 `media: { questionId, state, seq }` 放進 STATE 廣播。
- 大螢幕用 YouTube IFrame API 的 postMessage 指令（`enablejsapi=1`，不加套件）照 `media.state` 播放或暫停；`restart` 跳回 `start` 秒。
- 換題、公布答案、結束遊戲時，房間清掉 `media`，大螢幕停止播放。

### 大螢幕

- 影片題：播放器放大到 16:9、寬 480 左右，題幹顯示在上方。
- 聽歌題：播放器維持 YouTube 要求的最小尺寸，但用一張像素風「🎵 聽歌猜題」卡蓋住畫面，看不到標題和封面。
- 播放期間 BGM 暫停，播完或暫停時恢復。
- 電視瀏覽器第一次播放需要一次手勢；大螢幕本來就要點「開聲音」才有 BGM，那一下就能解除 autoplay 限制。沒解除時顯示「點一下大螢幕開聲音」。

### 手機

不再嵌 YouTube。影片題顯示題幹加「看大螢幕 ▶」，聽歌題顯示題幹加「聽大螢幕 🎵」。這樣聲音不會疊，聽歌題也不會在手機洩題。

### 題庫編輯器

YouTube 欄位多出：題幹、☐ 只放聲音（聽歌題）、開始秒數、結束秒數。

## 待決（eng review 決定）

1. 聽歌題「蓋住畫面」是否違反 YouTube 嵌入規範？替代做法：把播放器縮到 1×1 藏起來。
2. 題幹放在 `MediaContent` 上，還是放在題目本身（`BankQuestion.prompt`），讓圖片題也能用？
3. `HOST_MEDIA` 要不要給大螢幕以外的端點回報實際播放狀態（影片結束、影片已下架）？
4. 斷線重連或房間重啟後，播放狀態要不要恢復？

## 測試

- `lib/question-bank.test.ts`：新欄位的驗證、公開投影不帶多餘欄位。
- `lib/room/dungeon-room.test.ts`：`HOST_MEDIA` 只有主持人能用、只在 YouTube 題可用、換題清掉。
- e2e（CI）：主持人按播放，大螢幕的播放器收到 play 指令；手機沒有 iframe。
- `npm run check:bundle`：確認題幹以外的答案沒有進到前端。

---

# /plan-eng-review（2026-11-06）

審查目標：本檔 `docs/designs/youtube-questions.md`。上面的草稿原文保留不動，審查紀錄寫在這裡。

## Scope Challenge

### 已經有的東西

- `lib/youtube.ts`：`YOUTUBE_ID_RE`、`extractYoutubeId`、`youtubeEmbedUrl`，直接沿用。
- `components/pixel.tsx:27` `QuestionMedia`：大螢幕、手機、主持人頁共用的媒體元件，YouTube 分支是一個沒有 API 的 iframe。
- `lib/question-bank.ts:143` `parseMediaContent`：題庫驗證的唯一入口，新欄位加在這裡。
- 房間訊息的模式（`HOST_REVEAL` 帶 `questionId`，房間檢查是不是目前的題目）可以照抄給 `HOST_MEDIA`。
- 大螢幕的 `QuestionMedia` 只在 `!reveal` 時畫出來（`screen/page.tsx:255`），公布答案時播放器自動卸載，所以「公布答案就停」不用另外寫。
- 使用者已經有一份聽歌題草稿：`local-banks/boss-music.json`（git 不追蹤）。12 題魔王題，每題都有 `start` 和 `end`（15 秒片段），題幹是整組共用（「這首歌是什麼的主題曲？」），答案分兩段（類別＋名稱）。檔案自己寫著「格式先不管遊戲限制，之後改遊戲支援」。

### 複雜度

正式程式要改 9 個檔，新增 1 個元件，超過 8 個檔的門檻：

| # | 檔案 | 改什麼 |
|---|---|---|
| 1 | `lib/question-bank.ts` | 新欄位驗證、公開投影 |
| 2 | `lib/protocol.ts` | `HOST_MEDIA` 訊息、STATE 的 `media` 欄位、`PublicMediaContent` 新欄位 |
| 3 | `lib/room/dungeon-room.ts` | 處理 `HOST_MEDIA` |
| 4 | `components/pixel.tsx` | `QuestionMedia` 的 YouTube 分支 |
| 5 | `components/youtube-player.tsx`（新） | 用 IFrame API 控制播放器 |
| 6 | `app/room/[code]/screen/page.tsx` | 放大播放器、聽歌卡、BGM 暫停 |
| 7 | `app/room/[code]/host/page.tsx` | 三顆播放鍵 |
| 8 | `app/room/[code]/play/page.tsx` | 拿掉 iframe，改顯示提示 |
| 9 | `app/bank-editor/page.tsx` | 題幹、只放聲音、開始／結束秒數 |

另外是測試（`lib/question-bank.test.ts`、`lib/room/dungeon-room.test.ts`、一個 e2e）和文件（題庫格式、主持說明，中英各一份）。

### 查證（Search check）

- [Layer 1] YouTube 的規範：嵌入播放器至少 200×200，16:9 建議至少 480×270；禁止「分離或單獨取出影片的聲音或畫面」。來源：[Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)、[Developer Policies guide](https://developers.google.com/youtube/terms/developer-policies-guide)。
- [Layer 1] 控制播放器：官方 IFrame API 需要 `enablejsapi=1`；不載入官方 script、自己送 postMessage 也能動，但那是非官方用法，要等 iframe 載入完才能送指令。部分 Android 平板在使用者碰過畫面之前不能 play。來源：[IFrame API reference](https://developers.google.com/youtube/iframe_api_reference)、[無 script 寫法](https://medium.com/@mihauco/youtube-iframe-api-without-youtube-iframe-api-f0ac5fcf7c74)。

### TODOS

`TODOS.md` 沒有擋住這個計畫的項目。

### Reality rows

| premise | claim | receipt | verdict |
|---|---|---|---|
| 大螢幕 iframe 太小 | 260×160 | `screen/page.tsx:264` | true |
| 手機也嵌 iframe | 280×200 | `play/page.tsx:711` | true |
| 主持人頁沒有控制 | 只顯示「影片題（看大螢幕）」 | `host/page.tsx:578` | true |
| BGM 只為 TTS 降音量 | `duck(speechSynthesis.speaking)` | `screen/page.tsx:550` | true |
| YouTube 和文字題幹二選一 | `content` 只有 kind/value | `lib/question-bank.ts:27` | true |
| 編輯器已有 YouTube 分頁 | `youtubeInput` state | `app/bank-editor/page.tsx:679` | true |

REALITY: premise-table pass 6 claims, unverified=0 `lib/question-bank.ts:27`
REALITY: already-done pass origin/main 自 2026-11-05 起沒有 YouTube 播放控制相關提交 `lib/youtube.ts:1`
REALITY: surface-check finding 不載官方 script 的 postMessage 指令是非官方介面（見 D4） `components/pixel.tsx:43`
REALITY: binding-decisions pass 本分支沒有決策紀錄；舊決策「content 取代文字題幹」（question-media-content.md D1）會被題幹欄位改動，見 D5 `lib/question-bank.ts:22`
REALITY: numbers pass 200×200、480×270 [measured: YouTube RMF 頁]；12 題、15 秒 [measured: local-banks/boss-music.json] `screen/page.tsx:264`
REALITY: deferred-asks finding 沒有 issue，但 boss-music.json 要求「之後改遊戲支援」，轉檔是否在範圍內見 D8 `local-banks/boss-music.json:2`
REALITY: pr-count pass 沒有 ship-policy，預設一個 PR `docs/designs/youtube-questions.md:4`

### 範圍決定

feature answers: D1=A（編輯器新欄位這次一起做）; structure: D2=A（Original arrangement，新檔 `components/youtube-player.tsx`）; accepted scope: 草稿全部功能，9 個正式程式檔＋1 個新元件; pending remedies: D3–D8。
Scope Challenge 結果：scope accepted as-is。

## Decision ledger

### R1: 聽歌題怎麼藏畫面
Finding: 1, INFORMATIONAL, confidence 8/10, 草稿「聽歌題」段, Claude。YouTube Developer Policies 禁止分離影片的聲音和畫面；播放器至少 200×200。不管用卡片蓋住還是縮成 1×1，都算「只放聲音」，嚴格說都違規。1×1 另外還違反 200×200 的下限。
Plan baseline: 草稿提案：播放器維持 ≥200×200，用像素卡蓋住。
Runtime evidence: 目前沒有聽歌題（`lib/question-bank.ts:27` 沒有 audioOnly）。
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 藏畫面方式 | 草稿：卡片蓋住 | 卡片蓋住，播放器 ≥200×200 | 不藏，聽歌題也看得到畫面 | 縮成 1×1 |
| 其他 D4–D8 | pending | pending | pending | pending |
Question D3: 見下一個 AskUserQuestion。
State: approved
Actual answer: D3 重問 = A) 像素卡蓋住（2026-11-06）
Accepted scope: 聽歌題的播放器維持 ≥200×200，整個被「🎵 聽歌猜題」像素卡蓋住。文件（題庫格式說明）寫明這違反 YouTube「不得分離聲音」規範，只適合私人活動。
History: D3 第一版有三個選項（卡片蓋住／不藏／1×1）。使用者要求先研究。

研究結果（2026-11-06）：
- 開源猜歌遊戲都用官方嵌入播放器，再用 CSS 藏畫面：[VGMB](https://github.com/adsuth/VGMB) 用看不見的 iframe；[Guess Opening](https://github.com/justkesha/guess-opening) 用 IFrame API 播聲音，畫面做成模糊背景；[guess-the-song-ph](https://github.com/raykamisama/guess-the-song-ph) 設開始時間和片段長度。
- YouTube 沒有只放聲音的官方嵌入方式（[AddictiveTips](https://www.addictivetips.com/web/how-to-embed-the-audio-from-a-youtube-video/)）。
- 新發現：VGMB 提醒影片常常會壞掉（被檢舉、刪除）。很多唱片公司的 MV 也關掉了「允許嵌入」，嵌進來只會顯示「影片無法播放」。見 R1b。

### R2: 大螢幕怎麼控制播放器
Finding: 2, INFORMATIONAL, confidence 7/10, 草稿「播放控制」段, Claude。草稿要不載官方 script、自己送 postMessage。這是非官方介面：沒有 onReady 就不知道何時能送指令，也收不到「播完」「影片不能嵌入」等事件。聽歌題的 `end` 秒數、錯誤提示都要靠這些事件。
Plan baseline: 草稿提案：`enablejsapi=1` ＋自己送 postMessage，不加套件。
Runtime evidence: 現在是沒有 API 的 iframe（`components/pixel.tsx:43`）。專案沒有 CSP 設定，載入 youtube.com 的 script 不會被擋。
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 控制方式 | 沒有控制 | 官方 IFrame API script（`https://www.youtube.com/iframe_api`），不加 npm 套件 | 自己送 postMessage |
| R1 藏畫面 | approved D3=A | 不變 | 不變 |
| D5–D8 | pending | pending | pending |
Question D4: 見對話紀錄。
State: approved
Actual answer: D4 = A) 官方 IFrame API（2026-11-06）
Accepted scope: `components/youtube-player.tsx` 載入 `https://www.youtube.com/iframe_api`（不加 npm 套件），等 onReady 再送指令，用 onStateChange／onError 事件。e2e 用假的 `window.YT` 替換，不連外網。
History: none

### R3: 題幹放哪裡
Finding: 3, INFORMATIONAL, confidence 9/10, `lib/question-bank.ts:27`, Claude。YouTube 題現在沒有題幹。草稿把 `prompt` 放在 `MediaContent` 上；但 `MediaContent` 也用在詳解（explanation）欄，那裡的題幹沒有意義，得另外擋。圖片題一樣沒有題幹。
Plan baseline: 草稿提案：`MediaContent.prompt`，只給 youtube。
Runtime evidence: `MediaContent` 用在 content 和 explanation 兩個欄（`lib/question-bank.ts:160`、`:168`）。
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 題幹位置 | 沒有 | 題目上的 `prompt?`，內容不是文字時才能用（圖片、YouTube） | `MediaContent.prompt`，只給 youtube，詳解欄擋掉 |
| R1/R2 | approved | 不變 | 不變 |
| D6–D8 | pending | pending | pending |
Question D5: 見對話紀錄。
State: approved
Actual answer: D5 = A) 題目上的 prompt（2026-11-06）
Accepted scope: `BankQuestion` 兩種 kind 都加選填 `prompt?: string`，只在 content 不是 text 時允許（text 題有 prompt 就驗證失敗），有長度上限。`PublicQuestion` 帶 `prompt`。大螢幕、手機、主持人頁在圖片／YouTube 上方顯示。`MediaContent` 只加 youtube 用的 `audioOnly`、`start`、`end`。
History: none

### R4: 斷線重連、房間重啟後的播放狀態
Finding: 4, INFORMATIONAL, confidence 8/10, 草稿待決 4, Claude。房間會存快照（`lib/room/persistence.test.ts`），重啟後從快照恢復。播放狀態要不要進快照？大螢幕斷線重連時收到 STATE，要不要照狀態接著播？
Plan baseline: 草稿未決定。
Runtime evidence: 快照有 `SCHEMA_VERSION`（`lib/room/`），加欄位要跟著處理版本。
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 重啟 | 不適用 | 播放狀態只在記憶體；重啟後變成「暫停」，主持人再按一次 ▶ | 寫進快照，重啟後恢復成原狀態 |
| R4 重連 | 不適用 | 大螢幕重連收到 STATE：狀態是播放中就從 start 秒重播 | 同 A |
| R1–R3 | approved | 不變 | 不變 |
Question D6: 見對話紀錄。
State: approved
Actual answer: D6 = A) 只存記憶體（2026-11-06）
Accepted scope: 房間的 `media` 狀態不進快照、不升 `SCHEMA_VERSION`。重啟後 STATE 沒有 `media`，大螢幕視為暫停。大螢幕（重）連線收到 `media.state === "playing"` 時從 `start` 秒播。
History: none

### R5: 大螢幕要不要回報播放狀態
Finding: 5, INFORMATIONAL, confidence 7/10, 草稿待決 3, Claude。D4 選了官方 API，大螢幕收得到「播完」「錯誤」事件（錯誤碼 101/150 = 影片不允許嵌入；100 = 影片不存在）。問題是要不要把這些傳回房間給主持人頁。
Plan baseline: 草稿未決定。
Runtime evidence: 大螢幕目前不會送任何訊息給房間（只收 STATE）。
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 錯誤顯示 | 沒有 | 大螢幕自己在播放器位置顯示「影片無法播放」 | 同 A，另外主持人頁也顯示 |
| R5 回報給房間 | 沒有 | 不回報；主持人頁的鍵照 `media.state` 顯示 | 大螢幕送新訊息回報 播放中／播完／錯誤，主持人頁顯示 |
| R1–R4 | approved | 不變 | 不變 |
Question D7: 見對話紀錄。
State: approved
Actual answer: D7 = A) 只在大螢幕顯示（2026-11-06）
Accepted scope: 大螢幕收到 onError 時，在播放器位置顯示「影片無法播放」。不新增大螢幕→房間的訊息；主持人頁的鍵照 `media.state`（主持人自己下的指令）顯示。這是有上限的取捨，決策紀錄 `b741774e`：上限是主持人頁看不到真實播放狀態；主持人離開大螢幕主持、或活動中因壞影片浪費一回合時再升級。程式裡要標 `gstack-shortcut(dec-b741774e)`。
History: none

### R6: 把 boss-music.json 轉成遊戲題庫
Finding: 6, INFORMATIONAL, confidence 9/10, `local-banks/boss-music.json:2`, Claude。這份草稿寫著「之後改遊戲支援」，但格式跟題庫不同：題幹在整組（mode）上、答案是兩段物件、`youtube` 是網址。遊戲支援新欄位後，它還是不能直接載入。
Plan baseline: 草稿沒提到這份檔案。
Runtime evidence: 12 題（themeSong），singerSong 是空的。2026-11-06 用 YouTube oEmbed 查過 12 支影片，全部回 200（公開、存在）。oEmbed 200 不保證每個地區都能嵌入播放，活動前仍要在大螢幕實際按一次。
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R6 轉檔 | 沒有 | 功能做完後我手動轉一次，寫進 `local-banks/`（git 不追蹤），不提交程式 | 寫一支轉檔 script 提交進 repo | 不轉，你之後自己改 |
| 轉法 | — | `kind:"text"`、content youtube＋`audioOnly`、`start`/`end`、題幹用 mode 的 prompt、答案合成一行（例：「廣告：萬家福〈美好有家在〉」） | 同 A | — |
| R1–R5 | approved | 不變 | 不變 | 不變 |
Question D8: 見對話紀錄。
State: approved
Actual answer: D8 = A) 我手動轉一次（2026-11-06）
Accepted scope: 功能完成後，把 `local-banks/boss-music.json` 的 12 題轉成題庫格式，存進 `local-banks/`（git 不追蹤）。不提交轉檔程式。
History: none

## 1. Architecture review

```
主持人頁 ──HOST_MEDIA{questionId, action}──▶ 房間 (dungeon-room.ts)
                                              │ 檢查：主持人、遊戲中、questionId = 目前題目、
                                              │       content 是 youtube、沒有在公布答案
                                              │ media = {questionId, state, seq++}（只在記憶體，D6）
                                              ▼
                              STATE{..., media?} 廣播給所有人
              ┌───────────────────────┼─────────────────────────┐
              ▼                       ▼                         ▼
        大螢幕 screen             手機 play                 主持人頁
  <YoutubePlayer> (D2, D4)     不嵌播放器，顯示題幹       ▶ ⏸ ⟲ 三顆鍵
  media.questionId ≠ 題目 → 視為暫停   ＋「看／聽大螢幕」     照 media.state 亮
  playing → seekTo(start) 或 playVideo
  到 end 秒 → pause（播放器自己停）
  onError → 「影片無法播放」(D7)
  audioOnly → 像素卡蓋住 (D3)
  播放中 BGM 暫停
```

設計兩種形狀（新元件 `components/youtube-player.tsx`）：
- 形狀 A（採用）：宣告式元件 `<YoutubePlayer videoId start end cover command={{state, seq}} />`。載入 script、等 onReady、指令佇列、end 秒停止都藏在裡面，外面只給目前想要的狀態。
- 形狀 B：命令式 hook `useYoutubePlayer()` 回傳 `play/pause/restart`，大螢幕頁自己比對 STATE 變化去呼叫。比對邏輯會漏到頁面上（red flag 2）。
- 選 A：介面小、藏的多；大螢幕頁只把 STATE 傳進去。

Red flags：
- Hand-synced list：`MediaContent`（`lib/question-bank.ts:27`）和 `PublicMediaContent`（`lib/protocol.ts:41`）要各加一次 youtube 欄位。這是現有慣例，由 `publicMediaContent` 逐欄挑選；測試要檢查兩邊一致（見 Test review）。
- 其他七項：無。

Findings：
- [INFORMATIONAL] (confidence: 9/10) `app/room/[code]/screen/page.tsx:227` — 題目框 `top: 96`，怪物 `bottom: 146`、對話框 `bottom: 12`，舞台 960×540（`components/stage.tsx`）。播放器至少 200 高，題目框一定會蓋住怪物；480×270 會壓到對話框。見 D9。
- [INFORMATIONAL] (confidence: 8/10) `app/room/[code]/screen/page.tsx:549` — 草稿用「開聲音」那一下解除自動播放限制，但 BGM 預設是關的，大螢幕可能從頭到尾沒被點過。做法沿用草稿：沒被點過時（`navigator.userActivation.hasBeenActive` 為 false）顯示「點一下大螢幕啟用影片聲音」。屬於草稿已有的範圍，不另外問。
- [INFORMATIONAL] (confidence: 9/10) Prior learning applied: split-deploy-new-state-field (confidence 9/10, from 2026-10-31)。前端和 Worker 分開部署，舊 Worker 沒有 `media` 欄位。用戶端一律把缺少的 `media` 當成暫停（`game.media?.questionId === question.id`）。
- [INFORMATIONAL] (confidence: 7/10) `app/room/[code]/screen/page.tsx:250` — 詳解的 YouTube 是 300×140，低於 200×200（既有問題，不在這次範圍）。記進 TODOS。
- [INFORMATIONAL] (confidence: 6/10) 草稿沒處理旁白 TTS 和歌聲重疊。主持人控制按播放的時機，可以等旁白念完。Medium confidence，不另外處理。

Dispositions：版面 → D9 pending；自動播放提示 → 沿用草稿；split deploy → 實作守則；詳解尺寸 → TODOS；TTS → 不處理。

### R7: 大螢幕播放器大小
Finding: Section 1 第 1 項。
Plan baseline: 草稿提案：16:9、寬 480 左右，題幹在上；聽歌題維持最小尺寸，卡片蓋住。
Runtime evidence: 見上方 finding；草圖是本機暫存檔，沒有提交。
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R7 播放器大小 | 260×160 | 384×216，聽歌卡同大小 | 356×200（規範最小值），聽歌卡同大小 |
| 怪物 | 被部分蓋住 | 被題目框蓋住 | 被題目框蓋住，下緣多露 16px |
| R1–R6 | approved | 不變 | 不變 |
Question D9: 見對話紀錄。
State: approved
Actual answer: D9 = A) 384×216（2026-11-06）
Accepted scope: 大螢幕影片題播放器 384×216，題幹在上方；聽歌題的像素卡同為 384×216，蓋住同尺寸的播放器。
History: none

## 2. Code quality review

- [INFORMATIONAL] (confidence: 8/10) `lib/question-bank.ts:143` — `parseMediaContent` 是唯一驗證入口。新欄位規則都放這裡：`audioOnly` 是 boolean、`start`/`end` 是非負整數且 `end > start`，三者只有 youtube 能用；`audioOnly` 不能出現在詳解欄（詳解不受主持人控制）。題目的 `prompt` 在 `parseQuestion` 驗證：內容是 text 時不能有 prompt，長度上限跟 `MAX_RAW_TEXT`（200，`lib/protocol.ts:322`）一樣。屬於 D3/D5 的必要實作，不另外問。
- [INFORMATIONAL] (confidence: 8/10) `app/bank-editor/page.tsx:679` — D1 的理由是「編輯器存檔不能吃掉新欄位」。編輯器的 YouTube 分頁要讀進並寫回 `audioOnly`/`start`/`end`，題目層要讀寫 `prompt`。
- [INFORMATIONAL] (confidence: 7/10) 播放器的判斷邏輯（還沒 ready 時把指令排隊、`seq` 變了才 restart、到 `end` 秒暫停）是新的分支邏輯。單元測試只跑 `lib/**/*.test.ts`、node 環境（`vitest.config.ts:7-8`），所以把判斷寫成 `lib/youtube.ts` 裡的純函式，元件只負責接上 `window.YT`。照 `lib/bgm-player.ts` 的既有做法。
- [INFORMATIONAL] (confidence: 7/10) script 載入失敗（離線、被擋）要跟 onError 一樣顯示「影片無法播放」，不然大螢幕會停在空白。屬於 D7 的範圍。
- 共用程式：沒有值得抽出的重複。

Dispositions：全部照上面寫的做，屬於已核准決定的必要實作。

## 3. Test review

```
CODE PATHS                                              USER FLOWS
[+] lib/question-bank.ts parseMediaContent/parseQuestion [+] 主持人播放影片題
  ├── [★★★ TESTED] youtube id 驗證 — question-bank.test.ts:238   ├── [GAP] [→E2E] 按 ▶ → 大螢幕播放器收到 play
  ├── [GAP] audioOnly/start/end 合法值、型別錯、end<=start     ├── [GAP] [→E2E] 按 ⟲ → 從 start 秒重播
  ├── [GAP] 這些欄位用在 image/text 被擋                       └── [GAP]        換題後舊指令被忽略（questionId 不同）
  ├── [GAP] 詳解欄有 audioOnly 被擋                         [+] 聽歌題
  ├── [GAP] prompt：text 題被擋、過長被擋、image/youtube 可用   ├── [GAP] [→E2E] 大螢幕有聽歌卡、手機沒有 iframe
  └── [GAP] publicQuestion 帶 prompt；公開內容帶 audioOnly/start/end，不帶答案
[+] lib/room/dungeon-room.ts HOST_MEDIA                   [+] 錯誤狀態
  ├── [GAP] 非主持人送 → 忽略                               ├── [GAP] onError → 「影片無法播放」（純函式測）
  ├── [GAP] questionId 不是目前題目 → 忽略                   └── [GAP] 大螢幕沒被點過 → 顯示啟用聲音提示
  ├── [GAP] 目前題目不是 youtube / 公布答案中 → 忽略
  ├── [GAP] play/pause/restart → STATE.media，restart seq+1
  └── [GAP] 重啟後快照沒有 media（D6）
[+] lib/protocol.ts readRoomMessage
  └── [GAP] HOST_MEDIA 的 action 不在 play/pause/restart → 拒絕
[+] lib/youtube.ts 播放器判斷（新純函式）
  ├── [GAP] 未 ready 時排隊，ready 後執行最後一個指令
  ├── [GAP] 同 seq 重複 STATE 不重播；seq 變了 → seekTo(start)
  └── [GAP] 播到 end 秒 → pause
[+] app/bank-editor 存檔保留新欄位
  └── [GAP] [→E2E] 開一題有 start/end/audioOnly/prompt 的題目再存，欄位還在

COVERAGE: 1/20 paths tested (5%)  |  Code paths: 1/15  |  User flows: 0/5
QUALITY: ★★★:1  |  GAPS: 19 (4 E2E)
```

要加的測試（都是已核准行為的必要證明）：
- `lib/question-bank.test.ts`：在既有的錯誤表（`:238`）加列；加一個「公開投影只帶允許的欄位」。
  Value: protects=壞題庫在載入時被擋、答案不外流; fails_when=驗證規則被拿掉或公開投影多帶欄位; why_new=現有測試只驗 id; seam=none; no_claim=none beyond protects
- `lib/room/dungeon-room.test.ts`：HOST_MEDIA 的守門與狀態。
  Value: protects=只有主持人能控制、只對目前的 YouTube 題; fails_when=守門條件被拿掉或 seq 不遞增; why_new=新訊息; seam=none; no_claim=大螢幕真的播放（e2e 用假 YT）
- `lib/protocol.test.ts`：HOST_MEDIA 解析加列。
- `lib/youtube.test.ts`：播放器判斷純函式。
  Value: protects=指令不被吞、restart 才重播、end 秒停; fails_when=排隊或 seq 比對被改壞; why_new=新邏輯; seam=none; no_claim=真的 YouTube 播放器行為（假的 YT）
- e2e（CI）：新 spec，`page.route` 擋掉 youtube.com、`addInitScript` 塞假的 `window.YT` 記錄呼叫。主持人按 ▶/⟲，大螢幕的假播放器收到 playVideo/seekTo；聽歌題有卡片；手機沒有 iframe。擴充 `e2e/bank-editor.spec.ts` 驗存檔保留欄位。
  Value: protects=主持人→房間→大螢幕整條路; fails_when=任何一段沒接上; why_new=沒有現成流程測試; seam=none; no_claim=真實 YouTube 與電視瀏覽器的自動播放政策
- 會過時的測試：`e2e/image-question.spec.ts` 裡若有斷言手機上有 YouTube iframe，要改成斷言沒有。

## 4. Performance review

- [INFORMATIONAL] (confidence: 8/10) `iframe_api` script 只載一次（全頁共用一個 Promise）。換題時元件卸載要呼叫 `player.destroy()`，不然每題留一個播放器在記憶體。
- 房間端：HOST_MEDIA 是主持人按鍵頻率，每次一個 STATE 廣播，跟其他主持人訊息同量級。沒有迴圈或查詢。
- 手機少嵌一個 iframe，載入變輕。

Dispositions：照做，屬於必要實作。

## Outside Voice（Codex，2026-11-06）

```
CODEX SAYS (plan review — outside voice):
- Medium — "Pause BGM, then resume" currently means restart from the beginning. lib/bgm-player.ts only exposes start() and stop(). stop() closes the audio context; start() creates a fresh one and resets the music loop. Define pause/resume behavior before wiring this into screen state.
- Medium — Clip-end behavior has no timing contract. The plan requires pausing at `end`, but doesn't say whether the player checks YouTube's playback time or uses a wall-clock timer. A wall-clock timer can cut clips short during buffering or ads.
Recommendation: revise the playback design before implementation because BGM resumption and clip timing are underspecified against the actual player behavior.
```

Cross-model tension：
- 片段結束時間：事實修正，不用另外問。IFrame API 本身支援 `startSeconds`/`endSeconds`（`cueVideoById`／`loadVideoById`），由播放時間決定，不用計時器。⟲ 從頭 = `seekTo(start)` 後 `playVideo()`。播放器判斷純函式的測試改成檢查呼叫參數，不測時間。
- BGM：Codex 說得對，`lib/bgm-player.ts` 沒有暫停，只有 `start()`/`stop()`（stop 會關掉 AudioContext）。但它有 `duck(on)`（`lib/bgm-player.ts:117`），把音量從 0.05 降到 0.015，旁白念的時候就是用這個（`screen/page.tsx:550`）。見 D10。

### R8: 影片播放時 BGM 怎麼處理
Finding: Outside Voice 第 1 項, Medium, confidence 9/10, `lib/bgm-player.ts:107`, Codex。
Plan baseline: 草稿：播放期間 BGM 暫停，播完或暫停時恢復。
Runtime evidence: BgmPlayer 只有 start/stop/duck；stop 後再 start 會從頭重新播主題曲。
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R8 BGM | 只為旁白降音量 | 影片播放中也用 duck 降到 0.015（約三成），跟旁白同一條規則 | BgmPlayer 新增靜音（gain 0），影片播放中完全無聲 |
| R1–R7 | approved | 不變 | 不變 |
Question D10: 見對話紀錄。
State: approved
Actual answer: D10 = B) 完全靜音（2026-11-06）
Accepted scope: `lib/bgm-player.ts` 加靜音狀態（master gain 到 0，不關 AudioContext，主題曲繼續跑）。大螢幕在影片播放中（`media.state === "playing"` 且是目前題目）靜音，否則照原本的旁白降音量規則。`lib/bgm-player.test.ts` 加測：靜音時 gain 為 0、解除後回到原音量（或旁白中的降低音量），不重建 context。
History: none

### R9: 詳解欄的 YouTube 太小
Finding: Section 1 第 4 項, INFORMATIONAL, confidence 7/10, `app/room/[code]/screen/page.tsx:250`, Claude。
Plan baseline: 不在原本範圍。
Runtime evidence: 詳解媒體 `maxWidth={300} maxHeight={140}`，低於 YouTube 200×200 下限。
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R9 詳解影片 | 300×140 | 記進 TODOS | 不記 | 這次一起修，放大並重排公布答案版面 |
Question D11: 見對話紀錄。
State: approved
Actual answer: D11 = C) 這次一起修（2026-11-06）
Accepted scope: 大螢幕詳解欄的 YouTube 至少 356×200，公布答案版面跟著重排。實作前先畫公布答案版面草圖（PNG）給站長確認。

### TODOS
- 新增「反 AI 作弊：玩家用手機問 AI 查答案」（P2）。站長 2026-11-06 在審查中直接要求加入，不另外問。跟這個 PR 一起提交。

Approval readiness: PASS — D1=A、D2=A、D3=A（重問）、D4=A、D5=A、D6=A、D7=A（決策 b741774e）、D8=A、D9=A、D10=B、D11=C，全部有對話中的實際回答。

## NOT in scope

- 大螢幕回報真實播放狀態給主持人頁：D7 選 A，決策 `b741774e` 記了升級條件。
- 播放狀態寫進房間快照：D6 選 A，重啟後主持人再按一次 ▶。
- 轉檔 script：D8 選 A，手動轉一次，不提交程式。
- 影片聲音在旁白念時自動降低：主持人控制按播放的時機。
- 上傳音檔或影片：站長 2026-11-06 決定只用 YouTube。
- 聽歌題的影片 id 不對玩家隱藏（/review D25，接受的風險）：每個連線收到同一份 STATE，懂開發工具的玩家拿到 id 就能查標題。/screen 不用登入又必須拿到 id 才能播，要封住得先給大螢幕加驗證，併入 TODOS.md「反 AI 作弊」。

## What already exists

- `lib/youtube.ts`：id 抽取、嵌入網址，沿用；播放器判斷純函式加在這裡。
- `lib/question-bank.ts` `parseMediaContent`：唯一驗證入口，擴充不重寫。
- `lib/bgm-player.ts` `duck()`：旁白降音量，D10 在旁邊加靜音。
- `HOST_REVEAL` 的「帶 questionId、房間比對目前題目」模式：`HOST_MEDIA` 照用。
- 編輯器的 YouTube 分頁（`app/bank-editor/page.tsx:679`）：加欄位，不重做。

## Failure modes

| 路徑 | 實際會怎麼壞 | 測試 | 使用者看到 |
|---|---|---|---|
| 載入 `iframe_api` | 現場網路擋 youtube.com | e2e 擋網路＋假 YT；載入失敗分支 | 「影片無法播放」 |
| 影片本身 | 唱片公司關嵌入（錯誤 101/150） | `lib/youtube.test.ts` onError 分支 | 「影片無法播放」 |
| 自動播放 | 電視瀏覽器從沒被點過，有聲播放被擋 | 不可自動測；活動前實機按一次 | 「點一下大螢幕啟用影片聲音」提示 |
| HOST_MEDIA | 第二台主持人裝置送舊題的指令 | 房間測試：questionId 不符 → 忽略 | 沒反應（正確） |
| 分開部署 | 新前端、舊 Worker 沒有 `media` | 用 `?.` 判斷 | 鍵按了沒反應幾分鐘 |

沒有「沒測試、沒錯誤處理、又無聲無息」的路徑。Critical gaps：0。

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity. `lib/protocol.ts` 和 `lib/question-bank.ts` 的型別是後面所有步驟的前提，三個頁面又共用同一份 STATE 欄位。

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

假設：功能約 30 倍、測試約 50 倍（人工 ÷ CC）。

- [ ] **T1 (P1, human: ~3h / CC: ~10min)** — 題庫 — `prompt`、`audioOnly`、`start`、`end` 驗證與公開投影
  - Surfaced by: D3、D5、Section 2 第 1 項
  - Files: `lib/question-bank.ts`, `lib/protocol.ts`, `lib/question-bank.test.ts`
  - Verify: `npm run test -- question-bank`
- [ ] **T2 (P1, human: ~3h / CC: ~10min)** — 房間 — `HOST_MEDIA` 訊息與 STATE `media`（只在記憶體）
  - Surfaced by: Section 1 架構圖、D6
  - Files: `lib/protocol.ts`, `lib/room/dungeon-room.ts`, `lib/protocol.test.ts`, `lib/room/dungeon-room.test.ts`
  - Verify: `npm run test -- dungeon-room protocol`
- [ ] **T3 (P1, human: ~4h / CC: ~15min)** — 播放器 — `components/youtube-player.tsx`＋`lib/youtube.ts` 判斷純函式（官方 API、startSeconds/endSeconds、onError、script 載入失敗、`destroy()`、`gstack-shortcut(dec-b741774e)` 標記）
  - Surfaced by: D2、D4、D7、Outside Voice 片段結束時間、Section 4
  - Files: `components/youtube-player.tsx`, `lib/youtube.ts`, `lib/youtube.test.ts`
  - Verify: `npm run test -- youtube`
- [ ] **T4 (P1, human: ~1h / CC: ~5min)** — BGM — 靜音狀態
  - Surfaced by: D10
  - Files: `lib/bgm-player.ts`, `lib/bgm-player.test.ts`
  - Verify: `npm run test -- bgm-player`
- [ ] **T5 (P1, human: ~4h / CC: ~15min)** — 大螢幕 — 384×216 播放器＋題幹、聽歌卡、靜音 BGM、啟用聲音提示、詳解影片放大（先給站長看公布答案版面 PNG）
  - Surfaced by: D3、D9、D10、D11、Section 1 第 2、3 項
  - Files: `app/room/[code]/screen/page.tsx`, `components/pixel.tsx`
  - Verify: e2e（CI）＋本機截圖
- [ ] **T6 (P1, human: ~2h / CC: ~10min)** — 主持人頁與手機 — 三顆鍵、題幹；手機拿掉 iframe
  - Surfaced by: 草稿「播放控制」「手機」、D5
  - Files: `app/room/[code]/host/page.tsx`, `app/room/[code]/play/page.tsx`
  - Verify: e2e（CI）
- [ ] **T7 (P1, human: ~2h / CC: ~10min)** — 編輯器 — 四個新欄位，存檔保留
  - Surfaced by: D1、Section 2 第 2 項
  - Files: `app/bank-editor/page.tsx`, `e2e/bank-editor.spec.ts`
  - Verify: e2e（CI）
- [ ] **T8 (P1, human: ~3h / CC: ~10min)** — e2e — 新 spec：假 YT、主持人 ▶/⟲、聽歌卡、手機無 iframe
  - Surfaced by: Test review
  - Files: `e2e/youtube-media.spec.ts`, `e2e/image-question.spec.ts`
  - Verify: CI
- [ ] **T9 (P2, human: ~2h / CC: ~10min)** — 文件 — 題庫格式（新欄位、YouTube 規範提醒）、主持說明（播放鍵），中英各一份；DESIGN.md
  - Surfaced by: D3、雙語文件規則
  - Files: `docs/*.md`, `docs/*.en.md`, `DESIGN.md`
  - Verify: `npm run check:docs`
- [ ] **T10 (P2, human: ~1h / CC: ~10min)** — 題目 — 把 `local-banks/boss-music.json` 12 題轉成題庫格式（git 不追蹤）
  - Surfaced by: D8
  - Files: `local-banks/`
  - Verify: 用編輯器或載入題庫驗證通過

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted (`PLAN_REALITY: phase=eng rows=7/7 missing=none unverified=0 verdict=complete`), 0 unverified premises
- Architecture Review: 5 issues found
- Code Quality Review: 4 issues found
- Test Review: diagram produced, 19 gaps identified
- Performance Review: 1 issue found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 2 items（反 AI 作弊：站長要求直接加入；詳解影片：D11 改成這次一起修）
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, completed（2 Medium findings → 1 事實修正、1 個 D10）
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 2/9（D1、D11 選了 10/10 的選項）

# /plan-design-review（2026-11-06）

審查目標：本檔。範圍：大螢幕、主持人頁、玩家手機、題庫編輯器。起始設計完整度 5/10。草圖 PNG 只存在本機的 scratchpad，沒有進 git。

## 決策紀錄

| # | 問題 | 回答 | 落實方式 |
|---|---|---|---|
| D12 | 審查範圍 | 全部 7 個面向 | — |
| D13 | 外部意見 | Codex＋Claude 子代理都跑 | 見下方「外部意見」 |
| D14 | YouTube 題上 DC 牌、法師提示、隊伍答案放哪 | A) 影片右邊側欄 | YouTube 題時，題目框內影片靠左（384×216），DC 牌、`MageHint`、隊伍打的答案改放右側欄，20px 字不縮。DC 牌不再用固定的 `top:262`。 |
| D15 | 聽歌卡要不要顯示狀態 | A) 完整版五種狀態 | 準備中／播放中／暫停／播完／無法播放。卡片用 `--lav`，音符用像素畫（不用 emoji），播放中的等化器用兩格 `steps()` 動畫，右上角顯示片段長度。`prefers-reduced-motion` 時等化器不動。狀態來自大螢幕播放器自己的 `onStateChange`，不是 `media.state`。 |
| D16 | 「點一下開聲音」提示放哪 | A) 大廳就提醒 | `navigator.userActivation.hasBeenActive` 為 false 時，大廳頂端黃色橫幅「👆 點一下大螢幕，開啟影片和音樂的聲音」。YouTube 題出現時仍沒點過，播放器上再蓋一層提醒。主持人頁在 YouTube 題下方加一行小字「沒聲音？看大螢幕提示」。 |
| D17 | 聽歌題公布答案時要不要露出 MV | A) 掀開露出 MV | 公布答案時，如果題目沒有詳解影片，拿掉聽歌卡，MV 停在原位置。房間的 `HOST_MEDIA` 守門條件改成：公布答案中也接受，只要畫面上的影片屬於這題。公布答案時播放器不卸載（改寫 eng review 的「公布答案就停」：改成暫停，不卸載）。 |
| D18 | 公布答案時影片和大菜卡怎麼擺 | A) 並排 | 詳解影片或 MV 至少 356×200。有大菜卡時影片在左、大菜卡在右（寬約 270，菜名 24px）；沒有時影片置中。整個框要在對話框（y≈428）上方。v0.39 起菜卡等主持人按「🍲 上菜」才出現（monster-cuisine.md「煮菜動畫」），公布答案時影片一律置中。 |
| D19 | 主持人頁播放鍵 | A) 三顆鍵 | ▶ 播放、⏸ 暫停、⟲ 從頭，放在輪到隊伍面板的題幹下方，答對／答錯上方。每顆至少 56px 高，目前狀態那顆是綠色（`ok` 色），上方一行「大螢幕：播放中／已暫停」。每顆有 `aria-label`。⟲ 一律跳回開始秒數並播放，暫停中按也一樣。 |
| D20 | 旁白還在唸時按 ▶ | A) 播放時停掉旁白 | 大螢幕播放器進入播放狀態時，取消正在唸的語音旁白。只改大螢幕。 |
| D21 | 玩家手機怎麼顯示 YouTube 題 | A) 小提示 | 題幹放在 `QuestionStrip`，下方一個小標籤「🎵 聽大螢幕」或「▶ 看大螢幕」。作答區一出題就能用，不等片段播完。 |
| D22 | 編輯器的開始／結束時間 | A) 分:秒＋試聽 | 欄位接受 `1:05` 或 `65`，存成秒數；格式錯時欄位下方顯示錯誤。旁邊「▶ 試聽片段」用 `components/youtube-player.tsx` 從開始放到結束，試聽時畫面照常顯示。分:秒解析放在 `lib/youtube.ts` 的純函式，附單元測試。 |

### 更正：BGM 靜音的依據

D10（播放中 BGM 完全靜音）原本寫成照 `media.state` 靜音。Claude 子代理指出：影片自己播到 `end` 秒停下時，房間的 `media.state` 還是 `play`，BGM 會一直靜音。更正為：照大螢幕播放器的實際狀態（`onStateChange` 的 PLAYING）靜音，其他狀態恢復。

## 外部意見

Codex 和 Claude 子代理都跑了（D13）。兩邊找到的缺口都已經變成 D14–D22 的問題，或上方的 BGM 更正（來自子代理）。各項出自哪一邊，見審查當天的對話紀錄。

## 7 個面向

| 面向 | 前 | 後 | 說明 |
|---|---|---|---|
| 1 資訊層級 | 5 | 9 | D9、D14：題幹 → 影片／聽歌卡 → 側欄 → 旁白。 |
| 2 互動狀態 | 3 | 9 | D15 五種狀態、D16 解鎖提示、D17 公布答案、D20 旁白；「影片無法播放」沿用 eng review。 |
| 3 使用者旅程 | 5 | 8 | 開場前解鎖聲音 → 題目懸念 → 公布答案露出 MV。 |
| 4 AI 罐頭感 | 6 | 9 | 聽歌卡用像素音符和兩格動畫，不用通用的播放器外觀。 |
| 5 設計系統 | 5 | 8 | 只用 `Panel`、`LabelChip`、`PixelButton`、`--lav`、`ok` 色；DESIGN.md 要補 YouTube 播放器和聽歌卡（T9）。 |
| 6 響應式與無障礙 | 4 | 8 | 主持人鍵 ≥56px 加 `aria-label`；手機作答區不用捲；減少動態時等化器不動。 |
| 7 未決事項 | 6 | 10 | 全部有回答。 |

整體：5/10 → 9/10。

## 設計實作任務（併入 eng review 的 T 編號）

- [ ] **T5 補充（大螢幕）** — D14 側欄、D15 聽歌卡五種狀態、D16 大廳橫幅與題目提醒、D17 公布答案露出 MV、D18 並排版面、D20 播放時取消旁白、BGM 照播放器實際狀態靜音。
- [ ] **T2 補充（房間）** — D17：公布答案中也接受這題的 `HOST_MEDIA`；公布答案時 `media` 改成暫停，不清掉。加單元測試。
- [ ] **T6 補充（主持人頁、手機）** — D19 三顆鍵與狀態行、「沒聲音？看大螢幕提示」；D21 手機小提示。
- [ ] **T7 補充（編輯器）** — D22 分:秒欄位與試聽，`lib/youtube.ts` 的分:秒解析加單元測試。
- [ ] **T9 補充（文件）** — DESIGN.md 加 YouTube 播放器、聽歌卡、主持人播放鍵。

## Design Review Completion Summary

- 決策：11 個（D12–D22），全部有站長的回答。
- 草圖：8 張 PNG 對照（本機 scratchpad，未提交）。
- 更正：1 項（BGM 靜音依據）。
- 新增 TODO：0。
- 設計完整度：5/10 → 9/10。

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review`, `/plan-design-review` | Independent 2nd opinion | 2 | completed | eng 2 項；design 的發現併入 D14–D22，都已處理 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 29 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | 5/10 → 9/10，11 個決策 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex（eng、design）＋ Claude 子代理（design），completed。
- **CROSS-MODEL:** 子代理找到的 BGM 靜音問題推翻了 eng review 的 D10 寫法，已更正。
- **VERDICT:** Eng 和 Design 都跑完。Eng Review 的 issues_open 是已排進 Implementation Tasks 的工作，不是未決事項。可以開始實作。

NO UNRESOLVED DECISIONS
