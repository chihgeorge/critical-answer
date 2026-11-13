<!-- /autoplan restore point: "(local-only) .gstack/tmp/autoplan/timing-tap-timeline-autoplan-restore-20261113-142830.md" -->
## Implementation plan
# 卡點題揭曉：時間軸＋重播

站長 2026-11-13 的要求。Branch: timing-tap-timeline
Status: APPROVED（站長 2026-11-13：T1 選 A、T2 選 1×、T3 選「早／晚 0.12」）
前提：卡點題已上線（#243、#244，`docs/designs/timing-tap.md`）。
樣張（只在本機）：`~/.gstack/projects/chihgeorge-critical-answer/mock/timing-tap-timeline-A.png`、`-B.png`。

> e2e 只在 GitHub CI 跑，不要在本機跑 `npm run e2e`。

## 要做什麼

卡點題揭曉後，大螢幕用一條時間軸配著影片重播，讓大家看到每隊按在哪、目標在哪、差多少。

## 現在的樣子

- 回合收掉（目標＋2 秒，或全部按完後目標＋0.5 秒）後，STATE 帶 `reveal.timing`：`targetMs`（影片時間毫秒）、`rows`（每隊 `errorMs`、小獎勵，最近的在前）、`tie`、`stunned`、`latencyMs`。
- 大螢幕的 `TimingReveal` 是一張 560px 的 cream 表，蓋在題目卡上（zIndex 7）。表下面那支 384×216 的影片照常播到片段結尾（房間在卡點題揭曉時不把 `media` 改成 paused），但被表蓋住，看不到。
- 影片時間的尺：YouTube 片段的 `start`/`end`（秒）在 SCREEN_VIDEO 裡；上傳檔從 0 開始，SCREEN_VIDEO 沒有長度。`targetMs` 跟它同一把尺。
- `TapClockReporter` 和播放器的 `timeRef` 只在回合中（`!reveal`）開著，揭曉後就沒有讀播放器時間的路。

缺的資料：沒有。每隊按的影片時間 = `targetMs + errorMs`，片段開頭、喇叭延遲、隊伍顏色大螢幕都有；片段結尾不需要（見方案 2）。不改協定、不改房間。

## 方案

只改大螢幕（`components/timing-screen.tsx`、`app/room/[code]/screen/page.tsx`）和兩個播放器（`components/youtube-player.tsx`、`components/file-player.tsx`），純函式放 `lib/tap-clock.ts`。不改協定、不改房間、不改手機和主持人頁。

1. **版面（960×540 舞台，樣張量過）**：卡點題揭曉時，題目卡（top 96）裡：
   - 左上影片：還是 384×216 的同一個播放器（D17：換 width/height 會重建播放器），外面包一層 `transform: scale(0.75)`，看起來 288×162。
   - 右上：贏家帽子＋「命中！{隊名}」（26px，誤差超過 1 秒照舊寫「最接近！」）、「晚 0.08 秒　目標 3:10.35「蹬」」；下面排名兩欄、每欄 4 列（每列 22px，最多 8 隊）：名次、隊伍顏色方塊、隊名（放不下截斷加…）、早／晚、小獎勵 chip。沒按、暈眩排最後（`--dim-ink`），順序跟現在的 `TimingReveal` 一樣；平手的「同秒先到」留著。
   - 下面整寬時間軸，98px 高（影片列和時間軸上面的間距都收成 4px）。最下層 label 底在 y≈396，剛好在魔王名牌（bottom 112）上緣；題目卡底 y≈406，跟一般影片揭曉一樣被名牌壓到一點邊，旁白框（bottom 12、至少 96 高）上緣 y≈432，不會蓋到。
   - 詳解：版面塞滿到名牌，所以卡點題揭曉時大螢幕不顯示文字、圖片、YouTube、Instagram 詳解（review 時改的；手機照樣顯示文字、圖片、YouTube 詳解）。上傳檔詳解照舊取代題目影片放在影片位置，沒有重播。
   - 原本蓋在影片上的 560px 表拿掉；「正解：…」「✅ 答對 +N」兩行在卡點題不顯示（贏家那行已經說了）。`timing-reveal` testid 留在新的區塊上。
2. **時間軸範圍（決定 T1）**：以目標為中心，兩邊各自放大到「那一邊最遠的按 ×1.3」，至少 1 秒、最多 2 秒（收回合最晚是目標＋2 秒，晚的那邊一定放得下）。比 −2 秒還早的按釘在左端，標「◀ {隊名} 早 3.40」；超過右端的（收回合前多收的 0.3 秒）同樣釘在右端，標「{隊名} 晚 2.30 ▶」。每 0.5 秒一個刻度。下限夾在片段開頭（`start`，上傳檔是 0）；上限不用夾：`parseBank` 已經保證 `target + 2 ≤ end`，所以上傳檔沒有長度也沒關係。
3. **標記**：目標是一條紅直線，下面紅底 label「蹬 3:10.35」（沒 label 時只有時間）。每隊一個隊伍帽子顏色（`look(index).hat`）的方塊，label「早／晚 0.12」（見 T3），label 底線同色；贏家的方塊大一號、`--turn2` 外框、label `--turn` 底。label 放四層（軸上兩層、軸下兩層，軸下那層先避開目標 label），從最準的開始放，放不下的只留方塊（排名表有數字）。
4. **重播（1×，決定 T2）**：揭曉進來、這台大螢幕有影片、而且 `media.state` 是 playing（主持人沒按 ⏸）時，等 1 秒（大家先看贏家），播放器跳到「目標 − 2.5 秒」（夾在片段開頭）照常播下去，播到片段結尾，跟現在「歌照常播到片段結尾」一樣。只做一次 seek，不在本機暫停：本機暫停會讓主持人之後按 ▶ 沒反應（`playerSteps` 看到的狀態一直是 playing，不會送 play）。
   - 播放器多一個 `replay?: { key: string; fromS: number }` prop：`key` 變的時候 `seekTo(fromS)`＋`playVideo()`（上傳檔設 `currentTime`＋`play()`），並把 `ended` 清掉（片段已經播完停在結尾時也能重播；之後播到結尾照舊自己停，主持人 ▶ 照舊從頭）。主持人的 `MediaCommand` 照舊由原本的 effect 處理，⏸、▶、⟲ 都照常。
   - 播放頭：`timeRef` 在卡點題揭曉時也開著。每個畫格（`requestAnimationFrame`）讀播放器時間；YouTube 的時間是快取值，用現有 `nextAnchorWindow`／`anchorOf` 算本機的「影片 0 秒」錨點（取樣只會偏晚，取最小值；跳超過 150 ms 自動重來，所以 seek 後馬上換新），播放頭 = `(performance.now() − 錨點) − 喇叭延遲`。暫停、緩衝時讀到 null，播放頭停在原地。
   - 喇叭延遲（`reveal.timing.latencyMs`）：按的時間是用「影片時間 − 延遲」量的，播放頭也減掉同一個值，才會在大家聽到那一拍時剛好經過目標。這是主持人校正的值，不是量出來的，所以播放頭的準度跟計分一樣，不會更準。
   - 播放頭還沒經過的方塊和 label 畫淡一點（35%），經過時變實心。
5. **沒有重播的大螢幕**：沒有影片（沒金鑰的大螢幕、播放錯誤、詳解影片取代了題目影片）：時間軸一出來就全部實心，沒有播放頭。主持人揭曉時按著 ⏸：重播等主持人按 ▶ 才跑（實作時改的：比「永遠不重播」少一個特例）。兩台大螢幕各自重播，不對齊彼此（各自配自己那台電視的聲音）。
6. **主持人頁、手機**：不變。

## 決定

- **T1 時間軸範圍**：A 放大到按的那一帶（±1–2 秒，建議）；B 整段片段（站長原話「整段 clip」）。樣張 B：30 秒的片段畫在 660px 上，五隊 0.6 秒內全疊成一團，label 疊在一起看不出誰是誰。A 在大家都在 ±0.6 秒內時是 ±1 秒，0.1 秒在電視上約 66px。
- **T2 重播速度**：1×（建議）。放慢的問題：YouTube `setPlaybackRate` 只接受 `getAvailablePlaybackRates()` 回的值（通常 0.25、0.5、0.75、1…2，每 0.25 一級；有些影片只有 1），而且只是「建議」，非同步生效；換速度那一下常常卡一下緩衝，剛好卡在那一拍；目前的播放器介面也沒接這個 API。放慢後聲音被拉長，不像大家按的那一拍。上傳檔的 `playbackRate` 可以，但兩種來源行為不同不好。1× 加上放大的時間軸已經看得出差距。
- **T3 label 文字**：沿用「早／晚 0.12」（建議，跟手機、揭曉表、主持人頁同一套字，`timing-tap.md` 規定不用 ＋／−）；站長原話是「± 毫秒」，也可以改成「+80 ms」。

## 不做

- 主持人的「再重播一次」按鈕（⟲ 從頭就能整段再放）。
- 放慢重播。
- 手機、主持人頁上的時間軸。
- 多台大螢幕的重播對齊。

## 測試

- `lib/tap-clock.ts` 純函式：時間軸範圍（±1 秒下限、±2 秒上限、×1.3、夾片段開頭、−2 秒以前的釘在左端）；label 分層（從最準的放、避開目標 label、放不下回傳隱藏）；播放頭換算（錨點、扣喇叭延遲、null 時停住）；重播起點（目標 − 2.5 秒夾在 `start`）；要不要重播（有影片、`media` 是這題且 playing）。
- 元件（`renderToStaticMarkup`，照 `lib/error-screen.test.ts` 的寫法）：沒有影片時全部實心、沒有播放頭；`timing-reveal` testid 還在；沒按、暈眩的隊伍排最後；8 隊時排名兩欄。
- 播放器的 seek 是 effect，靜態 render 測不到：`replay.key` 一樣時不再 seek 的判斷抽成純函式測。
- 版面：靠樣張（8 隊、兩行旁白）量過；e2e 不在本機跑，CI 跑現有卡點題 e2e。

## Review record

/autoplan 2026-11-13，lean run（一位外部評審）。UI scope：有；DX scope：沒有（2.5 跳過）。外部評審：Codex（gpt-6-luna，唯讀），VERDICT: FINDINGS，8 條，全部處理如下。Claude 子評審沒有另外跑（lean run 只用一位評審）；CEO／設計／工程各段落沒有照完整模板逐段寫，這裡只記結論。

| # | Codex 意見 | 嚴重度 | 處理 |
|---|---|---|---|
| 1 | 揭曉時 `TapClockReporter` 和 `timeRef` 都關了，重播沒有讀時間的路 | High | 接受：`timeRef` 在卡點題揭曉時也開；播放頭自己算錨點（方案 4） |
| 2 | 本機 seek／暫停會跟主持人的 `MediaCommand` 打架，`ended` 會讓 ▶ 從頭 | High | 接受：只 seek 一次、不在本機暫停、清 `ended`（方案 4） |
| 3 | 多台大螢幕各自重播；沒金鑰的大螢幕沒影片 | High | 接受：寫明各自重播、不對齊；沒影片時全部實心（方案 5） |
| 4 | 上傳檔沒有長度，範圍夾不了結尾 | Medium | 不需要：`parseBank` 保證 `target + 2 ≤ end`，範圍上限最多目標＋2 秒（方案 2） |
| 5 | 播放頭同步說得太滿 | Medium | 接受：寫明喇叭延遲是校正值，播放頭準度等於計分準度 |
| 6 | 「0.1 秒 28px」算錯（5 秒範圍是 14px） | Medium | 接受：改成放大到 ±1–2 秒，重算 |
| 7 | 版面沒量過，會撞旁白框 | Medium | 接受：第一版樣張真的撞到；影片改 0.75 倍（transform，不重建），樣張量過 |
| 8 | 測試沒涵蓋主持人控制、跳動、版面 | Medium | 部分接受：判斷抽純函式測；effect 和版面靠樣張與 CI e2e |

Codex 對 T2：同意 1×。

<!-- autoplan-accepted:ceo -->
- 揭曉時間軸只改大螢幕，不改協定、房間、手機、主持人頁；資料只用 `reveal.timing`、SCREEN_VIDEO 的 `start`、隊伍顏色。
<!-- /autoplan-accepted:ceo -->
<!-- autoplan-accepted:design -->
- 版面照方案 1（影片 0.75 倍、右上贏家＋兩欄排名、下面整寬時間軸），題目卡底不超過旁白框上緣；樣張 A 為準，等站長選 T1–T3。
<!-- /autoplan-accepted:design -->
<!-- autoplan-accepted:eng -->
- 重播只 seek 一次、不在本機暫停、清 `ended`；主持人 ⏸ 時不重播；純函式（範圍、分層、播放頭、重播判斷）有單元測試。
<!-- /autoplan-accepted:eng -->

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | Eng | 重播只 seek 一次，不本機暫停 | Mechanical | P5 | 本機暫停後主持人 ▶ 會失效 | 播到範圍結尾就暫停 |
| 2 | Design | 影片 transform 0.75 倍 | Taste | P1 | 不縮就放不下時間軸；transform 不重建播放器 | 換 width/height（重建）、拿掉排名表 |
| 3 | Design | 時間軸自動放大 ±1–2 秒 | Taste（T1，等站長） | P1 | 0.6 秒內的差距要看得出來 | 整段片段、固定 ±2 秒 |
| 4 | Eng | 1× 重播 | Taste（T2，等站長） | P3 | YouTube 播放速度不可靠、聲音變形 | 放慢 |
| 5 | Design | label 用「早／晚 0.12」 | Taste（T3，等站長） | P4 | 跟現有字一致 | ± 毫秒 |
