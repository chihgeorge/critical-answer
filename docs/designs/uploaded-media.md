## Implementation plan
# 題庫上傳影片和聲音

狀態：站長確認需求（2026-11-11，Captain 轉達），實作中。
活動：2026-11-21，功能截止 2026-11-18。

## 要做什麼

題庫的媒材原本只有文字、上傳的圖片、YouTube、Instagram（只當詳解）。要放的素材（MV、世界盃歌曲剪輯、合成的排序題影片、合成的撥號音詳解影片）放上 YouTube 會被版權偵測靜音或封鎖，所以要能自己上傳影片（MP4，H.264/AAC）和聲音（M4A、MP3），題目欄和詳解欄都能放。

站長確認的需求：

- 比照圖片上傳：同一個 R2 bucket、同一把 `OWNER_KEY`、檢查檔頭 magic bytes、上傳中鎖住編輯器、上傳後沒存檔的檔案排程清掉。
- 單檔上限 25 MB。
- 大螢幕用原生 `<video>`／`<audio>` 從頭播到尾，主持人可以重播。選項格不能被蓋住（#222）。
- 手機不能拿到答案。

## Worker 收得下 25 MB 嗎

Cloudflare Workers 的 request body 上限看帳號方案：Free 和 Pro 是 100 MB，Business 200 MB，Enterprise 500 MB。這個 Worker 跑在 `workers.dev`，上限 100 MB，25 MB 收得下。Worker 記憶體上限 128 MB；`request.arrayBuffer()` 一次讀進 25 MB，再交給 R2 `put`，夠用。

## 設計

### D1 題庫格式：兩個新的 kind

`MediaContent.kind` 加 `"video"` 和 `"audio"`，`value` 跟圖片一樣是上傳端點發的 UUID（`UUID_RE` 驗證）。不能有 `audioOnly`、`start`、`end`：從頭播到尾，剪輯在上傳前做好。題目欄和詳解欄都能放。

`audio` 題就是聽歌題：`isMusicQuestion` 也認它（搶答階段的答案欄位可以用）。

`BANK_FORMAT` 9 → 10：有上傳影音的題庫存成格式 10，退回舊版本時編輯器變唯讀，不會把題目存掉。沒有上傳影音的題庫照舊存成原本的格式。

### D2 上傳端點：沿用 `/api/bank/image`

同一個端點、同一個 handler（`lib/bank-image-api.ts`）多收三種格式，不另開路由：驗證、唯讀檢查、排程清理全部共用，不會兩份漂移。路徑名字叫 image 是歷史，改名要前後端同時部署，不值得。

| 格式 | 檔頭 | 存成的 Content-Type | 上限 |
|---|---|---|---|
| PNG／JPEG／WebP | 照舊 | 照舊 | 5 MB |
| MP4（影片） | 第 4–7 byte 是 `ftyp`，品牌（第 8–11 byte）是 `isom`、`iso2`、`iso5`、`iso6`、`mp41`、`mp42`、`avc1`、`M4V `、`dash` 之一 | `video/mp4` | 25 MB |
| M4A | `ftyp` 加品牌 `M4A `／`M4B ` | `audio/mp4` | 25 MB |
| MP3 | `ID3`，或 MPEG Layer III 的 frame sync（`FF` 後面一個 byte `& 0xE6 == 0xE2`） | `audio/mpeg` | 25 MB |

其他 `ftyp` 品牌（HEIC、AVIF、QuickTime `qt  `、3GP）一律拒收：bucket 是公開的，不能把它們當 `video/mp4` 發出去。

不用 `arrayBuffer()` 一次讀完：一邊讀 `request.body` 一邊數，超過 25 MB 立刻停、回 413（沒有 `Content-Length` 或謊報都一樣擋得住；HTTP/2 的上傳不一定帶 `Content-Length`，所以不回 411）。`Content-Length` 超過 25 MB 先擋；讀完以後照實際格式套上限（圖片超過 5 MB 照舊 413）。上傳成功記一行 `media_uploaded {contentType, bytes}`，拒收記 `media_rejected {reason}`（不記內容）。上傳 API 的錯誤訊息全部改成繁中並寫怎麼修（例如「不支援這種檔案：影片請用 MP4（H.264／AAC），聲音用 M4A 或 MP3」「影片或聲音超過 25 MB，請先剪短或壓縮」「圖片超過 5 MB」），編輯器直接顯示。`bank-image-api.ts` 開頭註明：這裡的 image 指所有上傳媒材。回應多帶 `contentType`，編輯器用它決定存成 `video` 還是 `audio`，不信瀏覽器給的 `file.type`，也不信按了哪顆鈕：在「聲音」上傳了 MP4 影片，存成 `video`，分頁跟著跳到「影片」。

shortcut：只看容器，不看編碼。HEVC 的 MP4 也收得進來，但很多瀏覽器放不出來；編輯器的預覽會先露出來。要擋再讀 `moov` 裡的 codec。

### D3 網址只給主持人和帶金鑰的大螢幕

跟 YouTube 題的 `videoId` 一樣處理（`docs/designs/screen-video-key.md`）。原因：MP3 的 ID3 標籤、MP4 的 metadata 常寫著歌名，手機拿到網址就拿到答案；而且 30 支手機各抓一份 25 MB 會塞爆場地 Wi-Fi。

- 題目欄的上傳影音在 `STATE` 裡是現有的 `HiddenVideo`（`{ kind: "youtube", audioOnly? }`，聲音就是 `audioOnly: true`）。wire 上的 `kind` 沿用 `"youtube"`：意思是「大螢幕上由主持人控制的影片」，所有現有的判斷（手機「🎵 聽大螢幕」、主持人 ▶ ⏸ ⟲、搶答等第一次 ▶、作答倒數等影片播完）不用改就對；舊版頁面也看得懂。
- 詳解欄的上傳影音在 `STATE` 裡是新的 `HiddenFile`（`{ kind: "file", audioOnly? }`），跟 Instagram 詳解一樣：手機顯示「▶ 詳解請看大螢幕」。
- 網址走 `SCREEN_VIDEO`，`video` 多一種 `{ kind: "file", url, audioOnly? }`。`shownVideoId()` 在公布答案、詳解是上傳影音時回答的那題，`sendVideo()` 那時送詳解的檔案。
- `publicMediaContent` 遇到 `video`／`audio` 回 `HiddenVideo`（它原本把不認得的 kind 都當圖片，會把 R2 網址放進 `STATE`）；`publicExplanation` 遇到 `video`／`audio` 回 `HiddenFile`。房間的 `sendVideo()` 另外組出帶網址的 `{ kind: "file", url }`。
- 部署途中舊版手機頁收到 `HiddenFile` 詳解，會走到 YouTube 分支、畫出空的 iframe；Vercel 和 Worker 都在同一次合併後幾分鐘內更新，只影響這幾分鐘，接受。
- `protocol.ts` 的 `HiddenVideo` 旁寫 `shortcut:` 註解：`"youtube"` 在 wire 上代表所有大螢幕影片，是為了相容舊頁面；之後要改名成 `clip` 時前後端一起換。
- 房間裡判斷「這題有影片」的地方（`content.kind !== "youtube"`）改用 `isClip()`：`youtube`、`video`、`audio`。

### D4 大螢幕：`FilePlayer`

新元件 `components/file-player.tsx`，介面跟 `YoutubePlayer` 一樣（`command`、`cover`、`needsTap`、`onPlayingChange`、`onEnded`、`onError`、`errorNote`），所以大螢幕放影片的那一格（題目、題目跟選項格並排的小格、公布答案時原地續播、詳解）只換元件，版面和尺寸不動，選項格照 #222 的規則不被蓋住。

- 一律用 `<video>` 元素（放 M4A／MP3 也行），沒有原生控制列（大螢幕沒有滑鼠），`playsInline`、`preload="auto"`。
- 主持人的 ▶ ⏸ ⟲ 用現有的 `playerSteps` 套到 `play()`／`pause()`／`currentTime = 0`。`play()` 回傳的 Promise 被拒（瀏覽器擋自動播放）要接住，交給 `needsTap` 遮罩，不能變成 unhandled rejection。`waiting` 事件時顯示「載入中…」。
- 聲音：題目時蓋聽歌卡（`MusicCard`，從 `youtube-player.tsx` export 出來，加一個標題參數）；公布答案或詳解是聲音時，卡片寫「正解音樂」／「詳解音樂」。
- `ended` → `onEnded`（作答倒數開始）；`error` → `onError`（主持人頁警告「放不出來」）；錯誤時再按 ▶ 會重新載入（跟 YouTube 一樣）。
- 詳解影音：大螢幕上跟 YouTube 詳解同一格（356×200），主持人控制。題目是影片、詳解也是上傳影音時，公布答案只放詳解（跟現在一樣：有非文字詳解就沒有 `reveal.video`），主持人的 ▶ ⏸ ⟲ 控制的就是詳解。
- 框固定大小、`object-fit: contain`、底色 `var(--k)`：直式手機影片或怪比例不會撐大框，選項格不會被蓋住。
- 聲音檔不管題目、公布答案還是詳解都蓋卡片（YouTube 是公布答案時露出畫面，聲音檔沒有畫面可露）。卡片標題：題目「聽歌猜題」、公布答案「正解音樂」、詳解「詳解音樂」；狀態字多一個「載入中…」。

### D5 編輯器

- 題目欄和詳解欄的媒材鈕多「影片」「聲音」兩顆。
- 選檔（`accept` 限 `video/mp4`／`audio/mp4,audio/x-m4a,audio/mpeg`），上傳中鎖住整個編輯器（沿用 `uploads` 計數和 `editorBusy`），按鈕文字從「圖片上傳中…」改成「上傳中…」。
- 上傳逾時：25 MB 在慢 Wi-Fi（約 0.35 Mbps，跟圖片的假設一樣）要將近 10 分鐘。影音用 900 秒（`lib/bank-editor-locks.ts` 新增 `MEDIA_UPLOAD_TIMEOUT_MS`；600 秒在 0.35 Mbps 下幾乎沒有餘裕），圖片維持 120 秒；改用 XHR 後用 `xhr.timeout`。
- 檔案大於 25 MB 在瀏覽器先擋，不用等上傳完才 413。
- 上傳中：按鈕旁一條像素進度條（4px `var(--k)` 外框、`var(--ok)` 填色、不做平滑動畫）加「上傳中 43%（10.7／25 MB）」，`aria-live="polite"`；旁邊一顆「取消」呼叫 `xhr.abort()`、解鎖編輯器。
- 上傳好顯示「檔名・長度・大小」（長度從預覽的 `loadedmetadata` 拿），取代「已上傳（uuid…）」；超過 90 秒提醒一行「影片很長：作答倒數要等它播完」。
- 影片預覽 `loadedmetadata` 時 `videoWidth === 0`（例如 HEVC 只出聲音）或 `error`：紅字「這支影片瀏覽器放不出來，請轉成 H.264／AAC 再上傳」。
- 在「聲音」上傳了影片檔：分頁跳到「影片」並顯示「這是影片檔，已放到『影片』」（反過來一樣）。
- 錯誤訊息（繁中）：超過 25 MB「檔案超過 25 MB」、格式不對「只收 MP4（H.264／AAC）、M4A、MP3」、逾時「上傳逾時，請再試一次」、斷線「上傳中斷，請再試一次」、其他照伺服器回的文字。
- 媒材鈕變 7 顆，按鈕列加 `flex-wrap`，窄螢幕會換行。
- 上傳中顯示百分比（`XMLHttpRequest` 的 `upload.onprogress`；`fetch` 拿不到上傳進度）：25 MB 在慢網路要幾分鐘，只寫「上傳中…」會以為當掉。圖片也走同一條。
- 上傳好顯示原生 `<video controls>`／`<audio controls>` 預覽：出題的人在這裡確認放得出來。
- 一行提醒：MP4 請用 H.264／AAC，最多 25 MB；剪好再上傳，大螢幕從頭播到尾。

### D6 清理

`imageKeysOf` 改成收集 `image`、`video`、`audio` 三種 kind 的 key（名字不改，避免動到 bank-store 的呼叫端）；`legacyImageKeys` 也一樣。上傳後沒存檔、換掉、刪題的檔案，照現有排程刪掉。

### D7 Eng review 補的地方

- `formatOf`：difficulty 分支改回傳新常數 `DIFFICULTY_FORMAT = 9`，不再用 `BANK_FORMAT`；video/audio 檢查放鏈的最前面回傳 `MEDIA_FORMAT = 10`（= `BANK_FORMAT`）。測試：只有 difficulty 的題庫仍是 9。
- dungeon-room 裡**每一處**題目 `content.kind === "youtube"` / `!== "youtube"` 都改成 `isClip()`：805（sendVideo）、3053、3066（揭曉時的 `reveal.video`）、3181、3235。1184 的主持人標籤加「（影片題）」「（聲音題）」。1098、3147 讀公開的 HiddenVideo，不用改。
- `hiddenVideo()` 對 `audio` 設 `audioOnly: true`（三個呼叫點都靠它）。
- `sendVideo` 不經過 `publicMediaContent`：對 video/audio 直接組 `{kind:"file", url: base + key, audioOnly?}`；揭曉時詳解是 video/audio 也走同一條（跟 `insta` 並列）。
- `HiddenFile` 不能被當成圖片或 YouTube：screen `mediaExplanation`、play 詳解、host 揭曉控制鈕（`reveal.video || instagram || file`）都要明確處理 `"file"`；`AnswerReveal.explanation` 的型別加上 `HiddenFile`，讓 TypeScript 抓漏掉的地方。
- 上傳讀取：配置一塊 `Uint8Array(MAX_MEDIA_BYTES + 1)`，逐塊複製；超過就 `reader.cancel()` 回 413；用前 12 bytes 判斷類型；把 `subarray(0, n)` 交給 `put`（R2 要知道長度）。`Content-Length` 不是數字就當作沒有。
- 大螢幕播放錯誤：建立揭曉時清掉 `clipError`，揭曉中也顯示主持人警告，詳解影片出錯才報得上來。
- FilePlayer 掛上時第一個指令當起點，用 `playerSteps(null, …)`，跟 youtube-player 一樣。
- 拿掉 `dash`、`M4V ` brand（可能是分段或 DRM 檔）。
- 文件提醒用 `-movflags +faststart` 匯出 MP4（moov 在前面，場地網路才不會卡住）；編輯器不檢查（shortcut）。
- `legacyImageKeys` 不改：只處理格式 3 以前的題庫，不會有影片。
- 編輯器缺漏提示：video/audio 顯示「還沒上傳」。
- 回滾說明加一句：房間裡已存了含影片的題庫副本，舊版讀不了。

### 會改到的檔案

`lib/question-bank.ts`、`lib/protocol.ts`、`lib/bank-image-api.ts`、`lib/bank-store.ts`、`lib/bank-editor-locks.ts`、`lib/room/dungeon-room.ts`、`worker/index.ts`、`components/file-player.tsx`（新）、`components/youtube-player.tsx`（export `MusicCard`）、`app/room/[code]/screen/page.tsx`（`shownVideo.video.kind === "file"` 分支、詳解）、`app/room/[code]/host/page.tsx`（詳解是上傳影音時的 ▶ ⏸ ⟲）、`app/room/[code]/play/page.tsx`（`HiddenFile` 詳解提示）、`app/bank-editor/page.tsx`，`wrangler.jsonc` 註解，文件 `docs/question-bank.md`／`docs/question-bank.en.md`（格式 10、「上傳中…」、25 MB、H.264、900 秒、回滾：退到這版以前，有影音題的題庫變唯讀，新開的房間用預設題庫；要回滾先刪掉影音題）、`docs/deployment.md`／`docs/deployment.en.md`（R2 那段：同一個 bucket 也放影片和聲音，正式活動建議自訂網域）、`TODOS.md`、`changelog.d/media-upload.md`。

## 不做

- 播放區間、轉檔、壓縮（上傳前自己剪）。
- 手機播放上傳影音（題目和詳解都只在大螢幕）。
- 新的上傳路由或新的 R2 bucket。
- 讀 codec 擋 HEVC（見 D2 shortcut；編輯器預覽會提示）。
- 主持人頁顯示大螢幕緩衝中（要新增大螢幕回報訊息；YouTube 也沒有，主持人看大螢幕）。
- 上傳影音的字幕。

## 風險

- r2.dev 公開網址有流量限制，Cloudflare 不建議正式用；一場活動一台大螢幕，量很小。要正式用再綁自己的網域。
- 聲音要在活動大螢幕上實測（併入 TODOS「11/21 前在活動用的大螢幕瀏覽器實測 YouTube 聲音」）。
- 版權：自己上傳的 MV、歌曲放在公開的 r2.dev 網址（UUID 檔名只是難猜，不是私密）。收到下架通知的是跑整個遊戲的同一個 Cloudflare 帳號。TODOS 加一條：活動後刪掉或改成只給帶金鑰的大螢幕讀。
- 場地網路：`preload="auto"` 要等題目出現才開始下載，25 MB 在場地 Wi-Fi 可能播到一半卡住。大螢幕在載入中時顯示「載入中」，主持人等它緩衝；活動前用場地網路把所有影音題試放一次（併入聲音實測的 TODO）；最後手段是主持人用筆電放本機檔。
- 部署途中前端比 Worker 新：編輯器上傳影音會被舊 Worker 拒收（400），重試即可。

## 測試

- `lib/bank-image-api.test.ts`：三種新格式收、AVIF／HEIC／QuickTime 的 `ftyp` 拒收、沒有 `Content-Length` 或謊報的大檔也在讀到 25 MB 時 413、存成對的 Content-Type、影音超過 25 MB 413、圖片超過 5 MB 仍 413、`Content-Length` 超過 25 MB 先擋、亂碼拒收、沒金鑰 401。
- `lib/question-bank.test.ts`：`video`／`audio` 在題目和詳解都收、壞 UUID 拒收、帶 `start`／`audioOnly` 拒收、`isMusicQuestion` 認 `audio`、`imageKeysOf` 收影音的 key、`publicQuestion` 不帶網址、`publicExplanation` 對上傳影音回 `HiddenFile`。
- `lib/bank-store.test.ts`：`formatOf` 回 10；存一份有 `video` 題的題庫再讀回來，內容不變。
- `lib/room/dungeon-room.test.ts`：`STATE` 不帶網址、`SCREEN_VIDEO` 帶網址給主持人、詳解是上傳影音時 `HOST_MEDIA` 收。
- e2e：CI 跑，不新增。

<!-- autoplan-accepted:ceo -->
- 題庫 `MediaContent.kind` 加 `video`、`audio`（UUID value，不能有 audioOnly/start/end），題目和詳解都能放；`isMusicQuestion` 認 `audio`；`BANK_FORMAT` 10 只給用到它們的題庫。測試：question-bank.test.ts、bank-store.test.ts。
- `/api/bank/image` 收 MP4（video/mp4）、M4A（audio/mp4）、MP3（audio/mpeg），影音上限 25 MB、圖片維持 5 MB，以檔頭判斷，回應帶 `contentType`。測試：bank-image-api.test.ts 各格式、超限 413、亂碼 400、沒金鑰 401。
- 上傳影音的網址不進 `STATE`：題目欄是 `HiddenVideo`、詳解欄是 `HiddenFile`；網址只走 `SCREEN_VIDEO` 給主持人和帶金鑰的大螢幕。測試：dungeon-room.test.ts。
- 大螢幕 `FilePlayer` 介面同 `YoutubePlayer`，主持人 ▶ ⏸ ⟲ 控制，播完觸發作答倒數，錯誤時主持人頁警告；版面沿用 YouTube 那一格，選項格不被蓋住。
- 編輯器「影片」「聲音」鈕、25 MB 前端擋、上傳鎖編輯器、影音逾時 900 秒、上傳百分比、原生預覽。
- 清理：`imageKeysOf`、`legacyImageKeys` 收影音 key。測試：question-bank.test.ts。
- TODOS 加「題庫可上傳影片／聲音」並打勾；延後項 E3（HEVC 偵測）進 TODOS；文件中英同步，`npm run check:docs` 過。
<!-- /autoplan-accepted:ceo -->
## Review record

/autoplan 2026-11-11，背景 lane「media-upload」執行；沒有使用者可以問，所有決定照 6 個原則自動做，需要站長決定的列在最後的閘門。

### CEO — Step 0

**模式：** SELECTIVE EXPANSION（/autoplan 規定）。

**系統盤點：** main 最近合了 #222（大螢幕的圖片／影片題不再蓋住選項格）、#221（Instagram 詳解，`SCREEN_VIDEO` 多一種）、#220（圖片上傳鎖編輯器）、#218（圖片清理競態）。這份計畫碰到的都是這幾支 PR 剛改過的路徑，沒有進行中的分支衝突。TODOS 相關：「11/21 前實測 YouTube 聲音」（要把上傳影音併進去）、「存檔可能放回已經刪掉的圖片」（同樣影響影音，不在這次範圍）。

**0A 前提檢查**

| 前提 | 主張 | 依據 | 結論 |
|---|---|---|---|
| P1 | YouTube 放不了版權素材，要自己上傳 | 站長需求（Captain 轉達） | 接受 |
| P2 | Worker 收得下 25 MB | Cloudflare 文件：Free/Pro 100 MB；本機無法驗證 | unverified，實作時用 `wrangler dev` 送 25 MB 驗證不了正式限制，列風險 |
| P3 | 圖片上傳可以直接延伸 | `lib/bank-image-api.ts:21`、`worker/index.ts` putImage | 接受 |
| P4 | 手機拿到網址等於拿到答案（ID3 歌名） | MP3 ID3 TIT2 標籤是常識；`docs/designs/screen-video-key.md` 同理 | 接受 |
| P5 | 現有 YouTube 管線可以直接載上傳影音 | `lib/protocol.ts:54` HiddenVideo、`lib/room/dungeon-room.ts:3141` shownVideoId | 接受 |

do-nothing 的代價：活動要用的 MV、世界盃歌曲、合成影片放不上大螢幕，或要主持人現場用自己的手機放。

**0B 可重用的程式**：上傳（`handleBankImageApi`）、清理（`imageKeysOf`、`queueUploadedImage`）、大螢幕管線（`HiddenVideo`、`SCREEN_VIDEO`、`HOST_MEDIA`、`playerSteps`、`MusicCard`）、編輯器鎖（`editorBusy`）。只有 `FilePlayer` 是新元件。

**0C 夢想狀態**

```
  現在                         這份計畫                       12 個月後
  影音只能 YouTube        ->   上傳 MP4/M4A/MP3 走同一條     ->  媒材庫：重複用、剪輯、自訂網域、
  （版權靜音）                 大螢幕管線，主持人控制             轉檔、上傳進度
```

**0D：** 沒有需要選的做法（計畫照站長需求寫，沒有並列的方案）。

**0F／0G 擴充候選（每項自動決定）**

| # | 提案 | 工作量 | 決定 | 理由 |
|---|---|---|---|---|
| E1 | 編輯器顯示上傳進度條（XHR progress） | S | 接受 | 25 MB 在慢網路要幾分鐘，只有「上傳中…」會以為當掉；在影響範圍內、<1 天（P2） |
| E2 | 播放區間（start/end） | M | 不做 | 站長說從頭播到尾；上傳前剪 |
| E3 | 讀 MP4 codec 擋 HEVC | M | 延後到 TODOS | 編輯器預覽會先露出放不出來；擋要解析 moov box |
| E4 | R2 自訂網域取代 r2.dev | S（設定） | 延後（只寫風險） | 動到部署設定，不是程式；要站長在 Cloudflare 後台做 |
| E5 | 手機播詳解影音 | S | 不做 | 30 支手機各抓 25 MB 會塞爆場地 Wi-Fi；跟 Instagram 詳解一致 |
| E6 | 同一個檔案在多題重用（媒材庫） | L | 不做 | 範圍外，要新的 UI 和清理規則 |

**0I 時間軸**：第 1 小時 bank 格式＋上傳 API＋測試；2–3 小時房間與 wire；4–5 小時大螢幕 FilePlayer、主持人頁、手機；6 小時起編輯器、文件、檢查。人工約 2 天／CC 約 2–3 小時。

<!-- autoplan-accepted:ceo -->
- 題庫 `MediaContent.kind` 加 `video`、`audio`（UUID value，不能有 audioOnly/start/end），題目和詳解都能放；`isMusicQuestion` 認 `audio`；`BANK_FORMAT` 10 只給用到它們的題庫。測試：question-bank.test.ts、bank-store.test.ts。
- `/api/bank/image` 收 MP4（video/mp4）、M4A（audio/mp4）、MP3（audio/mpeg），影音上限 25 MB、圖片維持 5 MB，以檔頭判斷，回應帶 `contentType`。測試：bank-image-api.test.ts 各格式、超限 413、亂碼 400、沒金鑰 401。
- 上傳影音的網址不進 `STATE`：題目欄是 `HiddenVideo`、詳解欄是 `HiddenFile`；網址只走 `SCREEN_VIDEO` 給主持人和帶金鑰的大螢幕。測試：dungeon-room.test.ts。
- 大螢幕 `FilePlayer` 介面同 `YoutubePlayer`，主持人 ▶ ⏸ ⟲ 控制，播完觸發作答倒數，錯誤時主持人頁警告；版面沿用 YouTube 那一格，選項格不被蓋住。
- 編輯器「影片」「聲音」鈕、25 MB 前端擋、上傳鎖編輯器、影音逾時 600 秒、上傳百分比、原生預覽。
- 清理：`imageKeysOf`、`legacyImageKeys` 收影音 key。測試：question-bank.test.ts。
- TODOS 加「題庫可上傳影片／聲音」並打勾；延後項 E3（HEVC 偵測）進 TODOS；文件中英同步，`npm run check:docs` 過。
<!-- /autoplan-accepted:ceo -->

### CEO — 規格審查（Spec Review Loop）

一次（reviewer 1 次），分數 7/10，9 個問題全部修進計畫：`publicMediaContent`／`publicExplanation` 要改（不然把 R2 網址當圖片放進 `STATE`）、MP4 只收已知品牌（擋 HEIC／AVIF／QuickTime）、沒 `Content-Length` 回 411、存的 kind 以伺服器偵測為準、列出會改的檔案、`MEDIA_UPLOAD_TIMEOUT_MS`、舊手機頁的部署窗口、E4 只列風險、圖片也改走 XHR（記入 E1）。沒有重審（修正都是明確的文字補充）。

### CEO — 雙聲道

- Codex：**unavailable**（`Your workspace is out of credits`）。之後各階段同樣沒有外部意見。
- Claude 子代理（native）：完成，7 項。

```
CEO DUAL VOICES — CONSENSUS TABLE:
  Dimension                            Claude   Codex  Consensus
  1. Premises valid?                   partial  N/A    N/A
  2. Right problem to solve?           partial  N/A    N/A
  3. Scope calibration correct?        no       N/A    N/A
  4. Alternatives sufficiently explored? no     N/A    N/A
  5. Competitive/market risks covered? partial  N/A    N/A
  6. 6-month trajectory sound?         partial  N/A    N/A
```

native 的 7 項怎麼處理：

1. 編輯器上傳延到活動後、先用 `wrangler r2 object put` 手動傳（high）→ **品味決定，維持站長的方向**：站長明確要求編輯器能上傳。只有一個聲音，不算 User Challenge；列到閘門讓站長知道有這個省工的選項。
2. 場地 Wi-Fi 串流卡住（high）→ 接受：大螢幕顯示載入中、活動前用場地網路試放、主持人筆電備案，寫進風險和 TODO。預先載入下一題不做：房間不知道下一題是哪題就送不出網址。
3. 版權素材放公開 bucket（high）→ 接受成 TODO（活動後刪或改私密），寫進風險。
4. wire 上 `"youtube"` 兩個名字（medium）→ 接受：`protocol.ts` 寫 `shortcut:` 註解。
5. 格式 10 只測 `formatOf`（medium）→ 接受：加存檔再讀回的測試。
6. 大螢幕放本機資料夾的檔案（medium）→ 不採用：瀏覽器頁面讀不到本機檔，要每次選檔，主持人頁也控制不了；R2 已經在用。
7. 600 秒逾時沒餘裕（medium）→ 接受：改 900 秒。

### CEO — Review Sections

**1 架構**

```
 編輯器 ──XHR POST──> Worker /api/bank/image ──put──> R2 (公開讀)
   │                     │  └─imageUploaded──> BankStoreDO（排程刪除佇列）
   │ PUT /api/bank        ▼
   └────────────────> BankStoreDO（parseBank：video/audio UUID）
                           │ getVersionedBank
                           ▼
                     Room DO (DungeonRoom)
              STATE: HiddenVideo / HiddenFile（沒網址）──> 手機、大螢幕、主持人
              SCREEN_VIDEO {kind:file,url} ──> 主持人頁、帶金鑰的大螢幕
                                                   │
                                     FilePlayer <video src=r2.dev/uuid>
```

新的耦合：房間組 `SCREEN_VIDEO` 時要 `R2_PUBLIC_BASE_URL`（已經有，圖片在用）。資料流四條路：正常（上面）；nil（題庫沒有影音，什麼都不變）；空（`value` 空字串，parseBank 拒收，編輯器擋存檔）；錯誤（R2 put 失敗 502、題庫讀不懂 409、DO 連不上 503，照圖片的處理）。回滾：Worker 回滾到 BANK_FORMAT 9 的版本時題庫變唯讀（設計如此），不會遺失資料。沒有發現問題。

**2 錯誤與救援**

| 路徑 | 會壞的地方 | 處理 | 使用者看到 |
|---|---|---|---|
| 上傳 handler | 沒金鑰／錯金鑰 | 401/403 | 編輯器顯示錯誤 |
| | 太大 | 413 | 「檔案太大」 |
| | 沒 Content-Length | 411 | 錯誤訊息 |
| | 格式不對 | 400 | 「格式不支援」 |
| | 題庫讀不懂 | 409 | 唯讀提示 |
| | DO 連不上 | 503 | 「稍後再上傳」 |
| | R2 put 失敗 | 502 + log `image_upload_failed` | 「上傳失敗」 |
| | 排程刪除失敗 | log `image_upload_queue_failed`，上傳照樣成功 | 無（檔案可能留著） |
| 編輯器 XHR | 逾時／斷線 | `xhr.timeout`、`onerror` → 錯誤訊息，解鎖 | 「上傳逾時，請再試一次」 |
| FilePlayer | 檔案 404、解碼失敗（HEVC） | `error` 事件 → `onError` → 房間 `clipError` | 大螢幕「影片無法播放」，主持人頁警告 |
| | 緩衝中 | `waiting` 事件 → 顯示載入中 | 「載入中…」 |
| | `play()` 被瀏覽器擋（沒點過螢幕） | `needsTap` 遮罩（沿用） | 「點一下大螢幕」 |

`play()` 回傳的 Promise 被拒（autoplay 擋下）要 catch，不能變成 unhandled rejection：寫進 D4。沒有其他缺口。

**3 安全**

| 威脅 | 可能 | 影響 | 處理 |
|---|---|---|---|
| 偽裝檔頭上傳任意檔到公開 bucket | 低（要 OWNER_KEY） | 中 | 檔頭白名單、Content-Type 用偵測值 |
| 手機從網址讀到 ID3 歌名 | 中 | 高（洩答案） | 網址只走 SCREEN_VIDEO |
| 大檔塞爆 Worker 記憶體 | 低 | 中 | 25 MB 上限、411 |
| 版權下架 | 中 | 高 | TODO 活動後清掉 |

沒有新秘密、沒有新依賴。`/cso` 會在實作後再審一次。

**4 資料流與互動邊界**：重複點上傳（上傳中按鈕停用，沿用 `uploading`）；上傳中換分頁／刪題（`editorBusy` 鎖住）；上傳完沒存檔（排程刪除）；換媒材類型（既有確認對話框）；同一題重複出現（`liveMedia` 重設成暫停，沿用）。沒有新缺口。

**5 程式品質**：`sniffContentType` 分支會超過 5 個，拆成「圖片」和「影音」兩個小函式。`isClip` 一個 helper 取代六處 `=== "youtube"`。沒有其他發現。

**6 測試**：見 D 段的測試清單。缺的：`FilePlayer` 沒有單元測試（純 DOM，跟 `YoutubePlayer` 一樣靠 e2e）；在 `lib/youtube.ts` 的 `playerSteps` 已有測試。不新增 e2e（CI 才跑，而且要真的影片檔）。

**7 效能**：Worker 一次持有 25 MB buffer（128 MB 上限內）；R2 對 r2.dev 支援 Range，`<video>` 可以邊下邊播。沒有發現問題。

**8 可觀測性**：沿用 `image_upload_failed`、`image_upload_queue_failed`；大螢幕播放失敗走既有的 `SCREEN_CLIP_ERROR`。在上傳成功的 log 裡沒有記錄類型和大小：加一行 `media_uploaded {contentType, bytes}`，事後查得到誰傳了什麼。

**9 部署**：不用遷移；BANK_FORMAT 10 只在存了影音題後才寫；Worker 和 Vercel 各自自動部署，前端先到時上傳影音會 400（重試即可）；回滾見 1。部署後檢查：編輯器上傳一個小 MP3、存檔、開房間在大螢幕按 ▶。

**10 長期**：可逆性 4/5（格式 10 是單向，但只影響用了影音的題庫）。技術債：wire 上的 `"youtube"` 名稱、端點名 `image`（都寫 `shortcut:` 註解）。

**11 設計**：狀態表

| 功能 | 載入中 | 空 | 錯誤 | 成功 |
|---|---|---|---|---|
| 編輯器上傳 | 「上傳中 42%」 | 「選擇影片／聲音」 | 紅色錯誤框 | 預覽播放器 |
| 大螢幕題目 | 「載入中…」 | 🔒（沒金鑰） | 「影片無法播放」 | 播放／聽歌卡 |
| 手機 | — | — | — | 「🎵 聽大螢幕」／「▶ 詳解請看大螢幕」 |

細節交給 Phase 2 設計審查。

### CEO — 登錄表

Failure Modes Registry

```
  CODEPATH        | FAILURE MODE       | RESCUED? | TEST? | USER SEES?        | LOGGED?
  upload handler  | bad magic          | Y        | Y     | 400 訊息          | N
  upload handler  | R2 put fails       | Y        | Y     | 502「上傳失敗」   | Y
  editor XHR      | timeout            | Y        | N     | 逾時訊息          | N
  FilePlayer      | decode error/404   | Y        | N(e2e)| 影片無法播放      | Y(clip error)
  FilePlayer      | play() rejected    | Y        | N     | 點一下大螢幕      | N
  room sendVideo  | no base URL        | Y        | Y     | 壞網址→無法播放   | Y
```

沒有 CRITICAL GAP（每一列都有使用者看得到的結果）。

**NOT in scope**：E2 播放區間（站長要從頭播）；E5 手機播影音；E6 媒材庫；本機檔案播放；預先載入下一題。延後：E3 HEVC 偵測（TODOS）、版權清理（TODOS）。

**What already exists**：見 0B。

**Dream state delta**：這次到「能上傳、能播、主持人能控制」；離 12 個月的媒材庫還差重用、剪輯、轉檔、自訂網域。

```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | SELECTIVE EXPANSION                         |
  | System Audit         | 碰到 #218–#222 剛改過的路徑，無衝突          |
  | Step 0               | 6 個擴充：1 接受、1 延後、1 只列風險、3 不做 |
  | Section 1  (Arch)    | 0 issues found                              |
  | Section 2  (Errors)  | 13 error paths mapped, 1 GAPS（play() 拒絕）|
  | Section 3  (Security)| 4 issues found, 0 High 未處理               |
  | Section 4  (Data/UX) | 5 edge cases mapped, 0 unhandled            |
  | Section 5  (Quality) | 2 issues found                              |
  | Section 6  (Tests)   | Diagram produced, 1 gaps（FilePlayer 無單元測試）|
  | Section 7  (Perf)    | 0 issues found                              |
  | Section 8  (Observ)  | 1 gaps found（上傳成功 log）                |
  | Section 9  (Deploy)  | 1 risks flagged                             |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 2           |
  | Section 11 (Design)  | 0 issues（交給 Phase 2）                    |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (5 items)                           |
  | Error/rescue registry| 13 rows, 0 CRITICAL GAPS                    |
  | Failure modes        | 6 total, 0 CRITICAL GAPS                    |
  | TODOS.md updates     | 2 items proposed                            |
  | Scope proposals      | 6 proposed, 1 accepted                      |
  | Outside voice        | codex unavailable (out of credits)          |
  | Unresolved decisions | 0（1 個品味決定進閘門）                     |
  +====================================================================+
```

REALITY: premise-table pass 5 premises, unverified=1 (Worker body limit, external doc) lib/bank-image-api.ts:21
REALITY: already-done pass no hit on origin/main for video/audio upload lib/question-bank.ts:31
REALITY: surface-check pass /api/bank/image route exists worker/index.ts:221
REALITY: binding-decisions pass no branch decisions recorded; matches instagram-explanations pattern docs/designs/instagram-explanations.md:28
REALITY: numbers finding 25 MB/100 MB/128 MB are [estimated] from docs, not measured lib/bank-image-api.ts:21
REALITY: deferred-asks pass no linked issue lib/bank-store.ts:46
REALITY: pr-count pass one PR (pr_count default 1) .gstack/ship-policy.json:30

### Design（Phase 2）

**Step 0：** 設計完整度 5/10：沿用 YouTube 那一格和 `MusicCard` 是對的，但沒寫上傳進度、取消、緩衝、聲音詳解、比例。10 分是每個畫面（編輯器、大螢幕、主持人、手機）每個狀態都寫出看到什麼。DESIGN.md 存在（像素風、4px 黑框、`--k`／`--lav`／`--ok`、兩格 `steps()` 動畫），全部照它。設計工具：沒有跑 mockup（`$D` 沒有圖片 API key，見 learnings `design-png-without-image-key`；而且沒有新版面，全部沿用現有元件）。

**雙聲道：** Codex unavailable（額度用完）；Claude 子代理完成，平均 5.4/10，14 項。

| 審查 | 分數（前→後） | 處理 |
|---|---|---|
| 1 資訊層級 | 6 → 8 | 編輯器結果列改成「檔名・長度・大小」 |
| 2 狀態 | 4 → 8 | 進度條＋取消、錯誤字串、聲音卡「載入中…」 |
| 3 使用者旅程 | 5 → 7 | 出題者看得到長度；主持人看不到緩衝（不做，見下） |
| 4 AI 味 | 8 → 8 | 沿用 `MusicCard`、`px-btn`、chip |
| 5 DESIGN.md | 7 → 9 | 框 `--k` 底、進度條 `--k` 框 `--ok` 填、不做平滑動畫 |
| 6 RWD／無障礙 | 4 → 7 | 按鈕列換行、`aria-live` 進度、取消鈕有文字；沒有字幕（不做） |
| 7 未決 | 4 → 9 | 詳解取代題目影片、聲音永遠蓋卡、`object-fit: contain`、90 秒提醒 |

整體 5.4 → 8.0。

逐項（每項自動決定）：

1. 題目影片＋上傳詳解在公布答案時誰佔那一格（critical）→ 詳解取代（跟現有規則一致），寫進 D4。
2. 上傳 15 分鐘沒辦法取消（critical）→ 加「取消」。
3. 怪比例撐大框蓋住選項格（high）→ 固定框、`object-fit: contain`。
4. 聲音在公布答案時露出黑框（high）→ 聲音永遠蓋卡。
5. 主持人看不到大螢幕在緩衝（high）→ **不做**：要新增大螢幕回報訊息，YouTube 也一樣只靠主持人看大螢幕（`gstack-shortcut(dec-b741774e)`）。
6. 不知道影片多長（high）→ 顯示長度，超過 90 秒提醒（**品味決定**：90 秒是估的）。
7. HEVC 只出聲音不報錯（high）→ 編輯器預覽檢查 `videoWidth === 0`。
8. 錯誤字串（medium）→ 列進 D5。
9. 分頁默默跳走（medium）→ 顯示一行說明。
10. 7 顆按鈕在手機溢出（medium）→ `flex-wrap`。
11. 字幕（low）→ 不做，列 NOT in scope。

Litmus（大螢幕／編輯器）：品牌一眼可辨 YES／NO（原生預覽控制列，可接受）；一個視覺焦點 YES／—；掃一眼看得懂 YES／YES（加了結果列後）；一區一件事 YES／YES；卡片必要 YES（蓋黑框）；動態有幫助 YES（`.px-eq` 只在播放時動）；沒陰影也好看 YES／YES。

**NOT in scope（設計）：** 主持人頁緩衝狀態、字幕、mockup。**What already exists：** `MusicCard`、`needsTap` 遮罩、錯誤畫面、`MediaControls`、`MediaPicker`、`px-btn`、DESIGN.md tokens。

<!-- autoplan-accepted:design -->
- 公布答案時上傳詳解取代題目影片，主持人控制的是詳解。
- `FilePlayer` 框固定大小、`object-fit: contain`、`var(--k)` 底；選項格不被蓋住。
- 聲音檔永遠蓋 `MusicCard`，標題依情境「聽歌猜題／正解音樂／詳解音樂」，狀態多「載入中…」。
- 編輯器：像素進度條＋百分比＋MB（`aria-live`）、取消（`xhr.abort()` 並解鎖）、結果列「檔名・長度・大小」、超過 90 秒提醒、`videoWidth === 0` 提示轉 H.264、分頁自動切換時說明、錯誤字串、按鈕列 `flex-wrap`。
<!-- /autoplan-accepted:design -->

### DX（Phase 2.5）

DX 範圍是因為計畫裡出現「API」「command」被自動判定；這不是開發者工具，這裡的「開發者」是 repo 的貢獻者和自己部署的 fork。Codex unavailable；Claude 子代理完成，整體 6/10，TTHW：已經設好圖片上傳的 fork 0 分鐘 → 0 分鐘（不用新設定）；全新 fork 25–40 分鐘 → 不變（同一個 bucket）。

| 項目 | 分數（前→後） | 處理 |
|---|---|---|
| TTHW | 8 → 9 | 部署文件註明 bucket 也放影音、建議自訂網域 |
| 錯誤訊息 | 4 → 8 | 上傳 API 全部繁中＋修法；`media_rejected` log |
| 命名 | 6 → 7 | `bank-image-api.ts` 開頭註明 image＝所有媒材；log 事件名不改（保留查舊 log 的連續性，品味決定） |
| 文件 | 5 → 8 | 加 deployment 中英、wrangler 註解、回滾說明 |
| 升級／回滾 | 7 → 8 | 文件寫「回滾前先刪影音題」 |
| 可測試性 | 6 → 6 | 本機 `wrangler dev` 上傳的檔案在本機 bucket，大螢幕連的是正式 r2.dev，本機看不到播放：寫進回報，不改 |
| 除錯 | 5 → 7 | `media_uploaded`／`media_rejected`；`MediaError.code` 傳到主持人頁不做（要改協定，編輯器預覽已會提示 HEVC） |

另外改掉一個真問題：計畫原本沒有 `Content-Length` 就回 411，但 HTTP/2 上傳不一定帶它，會讓所有上傳失敗。改成邊讀邊數、超過就停。

開發者旅程：fork 部署（不變）→ 上傳 25 MB MV（看得到百分比）→ HEVC 檔（預覽紅字說轉 H.264）→ 活動當天（載入中、主持人備案）→ 回滾（文件說先刪影音題）。

同理心：一個 fork 的主持人把手機剪的 MV 拖進來，進度跑到 100%，預覽卻是黑的；改了以後預覽下方直接說「請轉成 H.264／AAC」，他知道下一步。

<!-- autoplan-accepted:dx -->
- 上傳 API 邊讀邊數，超過 25 MB 立刻 413；不需要 `Content-Length`。
- 上傳 API 錯誤訊息繁中＋修法；`media_uploaded`、`media_rejected` log。
- 文件：`docs/deployment.md`／`.en.md` R2 段、`wrangler.jsonc` 註解、`docs/question-bank.md`／`.en.md` 含回滾說明。
<!-- /autoplan-accepted:dx -->

### Eng（Phase 3）

外部審查：無法使用（Codex 額度用完）。原生子代理：完成，13 項（1 Critical、4 High、4 Medium、4 Low），全部採納，寫進 D7。

```
ENG DUAL VOICES — CONSENSUS TABLE:
  Dimension                           Claude  Codex  Consensus
  1. Architecture sound?               yes*    N/A    N/A
  2. Test coverage sufficient?         no→fixed N/A   N/A
  3. Perf risks + budget/bench named?  yes     N/A    N/A
  4. Security threats covered?         yes     N/A    N/A
  5. Error paths handled?              no→fixed N/A   N/A
  6. Deployment risk manageable?       yes     N/A    N/A
* 前提是 D7 的漏網點都補上。單一聲道的 Critical：formatOf（已在程式碼確認 bank-store.ts:67）。
```

架構：

```
bank-editor ──XHR──▶ worker /api/bank/image ──▶ bank-image-api (sniff, 25 MB cap) ──▶ R2 images
                                   │
                                   └─ queueUploadedImage ──▶ BankStoreDO (imageKeysOf 清理)
BankStoreDO ──▶ Room (dungeon-room)
   STATE (全部) : content video/audio → HiddenVideo{youtube,audioOnly}; 詳解 → HiddenFile
   SCREEN_VIDEO (host + 帶金鑰的大螢幕) : {kind:"file", url}
screen page ──▶ FilePlayer (<video>) ◀── HOST_MEDIA (playerSteps)
```

測試對照（Section 3）：

| 程式路徑 | 測試 | 狀態 |
|---|---|---|
| sniff MP4/M4A/MP3 → Content-Type | bank-image-api.test | 新增 |
| HEIC/AVIF/QuickTime/3GP/dash 拒收 | bank-image-api.test | 新增 |
| 沒有或亂寫 Content-Length，串流到 25 MB+1 → 413、reader 取消 | bank-image-api.test | 新增 |
| 6 MB PNG → 413；put 收到剛好 n bytes；回應 contentType | bank-image-api.test | 新增 |
| 沒 key 401、亂碼 400 | 既有 + 新增 | 新增 |
| parseMediaContent video/audio 兩個欄位、壞 UUID、多餘欄位 | question-bank.test | 新增 |
| hiddenVideo(audio).audioOnly、publicExplanation → HiddenFile、imageKeysOf | question-bank.test | 新增 |
| formatOf：difficulty 9、media 10、存取往返 | bank-store.test | 新增 |
| STATE 不含 UUID；SCREEN_VIDEO 只給 host/帶金鑰大螢幕 | dungeon-room.test | 新增 |
| 答對後 reveal.video 保留 audioOnly；詳解檔 SCREEN_VIDEO + HOST_MEDIA | dungeon-room.test | 新增 |
| 聲音題按 ▶ 前不能搶答；SCREEN_CLIP_ENDED 開始倒數 | dungeon-room.test | 新增 |
| FilePlayer、編輯器進度條 | e2e（CI） | 本次不加 e2e，延後：元件靠原生 `<video>`，單元測試覆蓋伺服器端；P6 |

失敗模式登錄：

| 失敗 | 處理 | 嚴重缺口？ |
|---|---|---|
| 瀏覽器擋自動播放 | play() reject → 點一下播放 | 否 |
| R2 檔案 404（被清掉） | onError → 主持人警告；清理只刪不再被引用的 key 且延遲 25 小時 | 否 |
| 部署空窗：舊手機頁 | 短暫，接受 | 否 |
| 回滾到舊版 | 含影片的題庫唯讀；文件寫明先刪影片題 | 否 |
| 場地網路慢、moov 在尾端 | 文件提醒 faststart；彩排 TODO | 否 |
| 上傳超過 25 MB | 用戶端先擋，伺服器串流 413 | 否 |

NOT in scope：見「不做」。What already exists：上傳端點、R2 清理、YouTube 大螢幕管線（HiddenVideo、SCREEN_VIDEO、HOST_MEDIA、playerSteps）、MusicCard，全部沿用。

REALITY: 每個 `youtube` 判斷點都已在程式碼對過行號（dungeon-room.ts 805/3053/3066/3181/3235）。
REALITY: Worker 100 MB body 上限來自官方文件，本機沒驗證。
REALITY: r2.dev 是否支援 byte-range 沒驗證（影片拖動需要）。

Completion summary：Step 0 完成；架構 1 個新元件（FilePlayer）、0 個新服務；測試 11 條新路徑；效能：每次上傳 25 MB 單一緩衝，只有主持人能上傳；Critical gap 0（修正後）。

<!-- autoplan-accepted:eng -->
