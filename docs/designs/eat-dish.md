# Design: 上菜後隊伍吃掉料理（方案 A「隊伍上桌，咬三口」）

Generated from the eat-dish research report on 2026-11-08
Branch: main
Repo: chihgeorge/critical-answer
Status: IMPLEMENTED (feat/eat-dish, 2026-11-08)
Mode: Builder

## Problem Statement

🍲 上菜後，大螢幕煮完菜（怪物 → 鍋子 → 煙 → 料理，`COOK_MS` = 1.6 秒）就停在料理圖和菜卡上，直到主持人按下一題。菜是哪一隊吃的，只寫在左上角「🍲 {隊名}」和旁白裡，畫面上沒有「吃」這件事。

研究報告比較了三種吃法（本機，不進 git：`[owner-local]/designs/eat-dish-20261108/report.md`）。使用者選方案 A：吃到的隊伍角色硬切出現在料理旁邊，分三口把菜吃掉，最後剩空盤、愛心和「嗝～」。

Mockup（本機，不進 git）：

- `[owner-local]/designs/eat-dish-20261108/option-A.png`：四格（1.6 s 上桌、2.6 s 第一口、3.0／3.4 s 第二三口、3.8 s 吃光光）。
- `[owner-local]/designs/eat-dish-20261108/mock.html`：用真的 `lib/pixel-art.ts` 畫的，`bitten()` 和 `emptyPlate()` 可以直接拿來試咬痕。

## Constraints

- DESIGN.md：動畫只能兩格 `steps()` 或硬切，不滑動；減少動態效果直接顯示結束畫面。精靈只能整數倍放大（壓扁格有 `px-idle` 的 `scale(1.05, 0.95)` 先例）。
- 不加新圖檔；精靈都在 `lib/pixel-art.ts` 用程式畫。
- 不改分數、不改旁白內容。旁白照舊在 1.6 秒念「今晚的菜：{菜名}！{隊伍}吃下 {分數} 飽足感。」（`dishLine`）。
- 首領的大菜不吃：`useFinaleStep` 和 `FINISH_PODIUM_MS`（`COOK_MS + 3000` = 4.6 秒）不動，頒獎流程的時鐘不變。
- `data-testid="dish-served"`、`dish-card`、`phone-dish` 保持，e2e 選擇器不用改。
- 題庫資料不進瀏覽器 bundle：這個功能只碰精靈和時間常數，不 import `BANK`。
- 11/18 前合併，活動當天（11/21）不部署。

## Recommended Approach

一個 lane，大約 8 個檔案。

1. **時間常數**（`lib/protocol.ts`）：
   - 新增 `EAT_AT_MS = COOK_MS + 1000`（2600）、`EAT_BITE_MS = 400`、`EAT_MS = EAT_AT_MS + 3 * EAT_BITE_MS`（3800）。
   - `SERVE_HOLD_MS` 從 `COOK_MS + 1000` 改成 `EAT_MS + 1000`（4800）。伺服器的 `HOST_NEXT` 擋門（`lib/room/dungeon-room.ts` 的 `handleHostNext`）和主持人頁「下一題」的解鎖（`app/room/[code]/host/page.tsx`）都讀這個常數，不用另外改。
   - `COOK_MS`、`FINISH_PODIUM_MS` 不動。

2. **步驟**（`components/cooking.tsx`）：
   - `CookStep` 維持 0–3，因為 `useFinaleStep` 回傳 `CookStep | 4`，那個 4 是「切到頒獎台」。新增 `type ServeStep = CookStep | 4 | 5 | 6 | 7`：4／5／6 是第 1／2／3 口，7 是吃光光。
   - 新的 `EAT_STEP_AT`：`[4, EAT_AT_MS]`、`[5, EAT_AT_MS + EAT_BITE_MS]`、`[6, EAT_AT_MS + 2 * EAT_BITE_MS]`、`[7, EAT_MS]`。只有 `useCookStep` 用 `[...STEP_AT, ...EAT_STEP_AT]`，`useFinaleStep` 照舊只用 `STEP_AT`，所以首領不吃。
   - `useCookStep` 回傳 `ServeStep | null`。開頁時已經上菜、或減少動態效果：從 3 改成直接 7（結束畫面）。`onDish` 還是在 3 呼叫；多一個選用的 `onStep(step)`，在 4–7 呼叫，給大螢幕放音效。

3. **全部 `cook === 3` 改成「料理在台上」**（`app/room/[code]/screen/page.tsx`、`app/room/[code]/play/page.tsx`）。現在有五個地方寫死 3，不改的話第 4 步以後會出錯：
   - screen 362 行 `cook === 3 && <DishOnStage>`：改成 `cook >= 3`，不然料理在第一口就消失。
   - screen 459 行 `cook !== 3 && (怪物)`：改成 `cook < 3`，不然怪物會在第一口時回到台上。
   - screen 498–499 行對話框：`cook === 3 ? [line]` 改成 `cook >= 3`，不然第一口時對話框跳回「上菜！」。
   - play 1007 行 `cookStep === 3`：改成 `cookStep >= 3`，不然手機那行「🍲 今晚的菜」在 2.6 秒消失。
   - 建議加一個小 helper `dishUp(step)`，五處都用它。

4. **咬痕**（`lib/pixel-art.ts`、`components/pixel.tsx`）：
   - 純函式 `biteCells(data: Uint8ClampedArray, w, h, n)`：在 RGBA 陣列上算出不透明像素的外框，清掉 n 個圓（右上、正上、左上，`mock.html` 的 `bitten()` 的位置和半徑），把缺口旁邊的像素描成 `K`。用純函式是因為 `lib/pixel-art.test.ts` 的 `fakeCanvas` 沒有 `getImageData`，這樣單元測試不用真的 canvas。
   - `biteSprite(cv, n)`：`getImageData` → `biteCells` → `putImageData`。
   - `Sprite` 加 `bites?: number`：`drawSprite` 之後呼叫 `biteSprite`，`useEffect` 的相依陣列加上 `bites`。料理不在 `BLINKS` 裡，不會被眨眼的重畫蓋掉咬痕；只給料理用。
   - 外框把盤子和熱氣（`STEAM`）也算進去。高瘦的料理（`dish-tower`、`dish-skewer`）和有熱氣的料理，咬痕可能咬到熱氣或只剩一根柱子。實作時把 25 道料理的 0–3 口全部截圖看一次（見 Success Criteria）；不好看就把外框改成只算盤子以上、熱氣以下的列。

5. **空盤**（`lib/sprite-kind.ts`、`lib/pixel-art.ts`）：
   - 新精靈 `plate-empty`，34×12，畫法照 `mock.html` 的 `emptyPlate()`：盤子＋外框＋幾顆碎屑。
   - 報告寫「碎屑取料理的顏色」，但 `DRAW` 的函式拿不到是哪道菜。改成固定的醬汁色；`DishOnStage` 的 `hue-rotate` 會套在空盤上，跟現在料理的盤子一樣。
   - 加進 `SpriteKind`、`SPRITE_SIZE`、`DRAW`。`drawSprite` 的現有測試（每個精靈都畫在自己的 `SPRITE_SIZE`）自動涵蓋它。
   - 空盤用料理的 `scale`，不要重算：`DishOnStage` 的 `scale = min(5, floor(130 / h))`，空盤高 12 會算出 5，高的料理是 4，換到空盤時盤子會突然變大。

6. **吃的人**（`components/cooking.tsx` 的 `DishOnStage`、screen page）：
   - `DishOnStage` 加 `step`（3–7）和 `eater?: number`（`hero` 的外觀編號）。screen page 已經算好 `eaterIdx`（241 行，`view.teams` 的順序，跟其他地方 `hero` 的 `variant` 一樣），直接傳。
   - 隊伍在上菜後被移除（`eaterIdx` 是 -1）：不出現角色和愛心，咬痕照咬。
   - 角色：`hero`，`scale 4`，`bottom 146`，中心在 x≈300（料理左邊，見 mockup）。第 4 步起硬切出現。
   - 嚼（第 5、6 步）：兩張 canvas 用 `px-tf1`／`px-tf2` 交替，跟鍋子一樣。一張睜眼，一張閉眼並套 `scale(1.05, 0.95)`（`transform-origin` 底部，同 `px-idle`）。
   - `Sprite` 沒辦法固定畫閉眼格：`hero` 在 `BLINKS` 裡，自己的眨眼計時器會把它重畫成睜眼。`Sprite` 加 `blink?: boolean`：有給就照它畫，並且不開眨眼計時器。
   - 字：第 4 步「啊嗚！」（料理右上），第 5、6 步「嚼嚼」（角色左上），沿用 `CookFrame` 的 `POP` 樣式。第 7 步角色頭上兩顆 `heart`（`variant 1`，`scale 3`），「嗝～」用 `--turn` 底。
   - 第 7 步：空盤＋角色（睜眼，不交替）＋愛心＋「嗝～」，停到下一題。減少動態效果和重新整理都直接顯示這一格；`px-tf1`／`px-tf2` 在減少動態效果下本來就停住。

7. **音效**（`lib/sfx.ts`）：
   - 報告把 `eat` 寫成 `SFX` 的一個音效，但 `SFX` 是 `Record<SoundCue, …>`，加進去就要改 `lib/protocol.ts` 的 `SoundCue`，而且 `cook` 是伺服器在 `HOST_SERVE` 時送的 cue，伺服器沒有 2.6 秒後的計時器。
   - 改成跟 `BOSS_ALARM` 一樣的兩個常數，由大螢幕自己放：`EAT_BITE`（方波 E5 往下滑到 B4，60 ms），在第 4、5、6 步各放一次；`EAT_DONE`（兩聲上揚，同 `check-pass` 的型），在第 7 步放。
   - `Playing` 多一個 `onCue` prop（同 `Finished` 的 `onCook`），由 `useCookStep` 的 `onStep` 呼叫 `bgm.current?.playCue(...)`。跟其他音效一樣，只在 🎵 開著時響；減少動態效果跳過動畫時不放。
   - `lib/sfx.test.ts` 加這兩個常數的長度檢查（各自 ≤ 0.4 秒）。

8. **文件**：
   - `DESIGN.md` 的 Rules（上菜那條）和 Components 的 `components/cooking.tsx` 描述：加吃菜的步驟、`bites`、`plate-empty`、減少動態效果顯示空盤。
   - `docs/designs/monster-cuisine.md` 的「煮菜動畫」一節：I2 的 `SERVE_HOLD_MS` 改成 4.8 秒，加一條吃菜的時間表，指到這份文件。
   - `changelog.d/<branch-slug>.md`，`bump: minor`。

不做：

- 手機的「😋 吃光光」（報告列為可選）。手機照舊只在 1.6 秒後顯示「🍲 今晚的菜」。
- 菜卡旁邊的小料理圖（報告的「結束畫面看不到料理圖」風險）。菜卡已經寫了菜名。
- 首領吃大菜。
- 新的旁白台詞。

## Success Criteria

- 大螢幕親眼看到上菜：1.6 秒料理上桌，2.6／3.0／3.4 秒各咬一口，3.8 秒空盤＋角色＋愛心＋「嗝～」。每一步都是硬切。
- 角色是吃到那隊的外觀（`TEAM_LOOKS[eaterIdx]`），跟左上角 🍲 緞帶同色。
- 第 4–7 步，菜卡、對話框的菜名台詞、手機的「🍲 今晚的菜」都還在，怪物不會回到台上。
- 減少動態效果、上菜後才開或重新整理的大螢幕：直接顯示第 7 步那一格。
- 主持人在上菜後 4.8 秒內按下一題沒有反應，鈕顯示「🍲 上菜中…」；4.8 秒後才能按。
- 打倒首領的結束畫面跟現在一樣：大菜停約 3 秒，4.6 秒出頒獎台。
- 25 道料理的 0／1／2／3 口和空盤都截圖看過一次（本機，不進 git），沒有咬到只剩熱氣或一根細柱的。
- 單元測試：
  - `biteCells`：0 口不變；每多一口，不透明像素變少；缺口旁邊是 `K`；不會清到外框以外。
  - `useCookStep`：開頁時已上菜回傳 7；`useFinaleStep` 的結果不變。
  - `lib/sfx.test.ts`：`EAT_BITE`、`EAT_DONE` 的長度。
- `npm run test`、`npx tsc --noEmit -p .`、`npx tsc --noEmit -p worker`、`npm run lint`、`npm run check:bundle` 都通過；e2e 在 CI 跑過。

## Open Questions

1. **TTS 跟咬的聲音重疊**：`lib/sfx.ts` 的原則是音效在旁白開口前結束。料理台詞在 1.6 秒開始念，大約念 3–4 秒，三聲咬和「嗝」會疊在念的聲音上。要接受、把音量調低，還是只在第 7 步放一聲？
2. **e2e 預算**：每道菜多等 2.2 秒。`judgeToTheEnd` 打整場的兩個測試（`e2e/main-line.spec.ts` 的 EPLG、`e2e/narration-tts.spec.ts` 的 EPLH）都是 `test.setTimeout(110_000)`，EPLG 的 `bossOnStage` 還有 80 秒上限。一整場有幾道菜要看 CI 的 log 才知道；先看目前這兩個測試在 CI 跑多久，再決定加多少。
3. **咬痕外框**：要不要一開始就排除盤子和熱氣的列（第 4 點），還是先用 `mock.html` 的做法、截圖後再說？
4. **主持人每題多等 2.2 秒**：一場 20–30 題約多 1 分鐘。報告的備案是每口 300 ms（吃光在 3.5 秒、擋 4.5 秒）。先照 400 ms 做，活動前的彩排再決定。

## Dependencies

- 沒有要等的 PR。跟幸運藥水、最後衝刺、頒獎台稱號都不碰同一段程式（頒獎台走 `useFinaleStep`，這裡不改它）。
- 要改的檔：
  - `lib/protocol.ts`（`EAT_AT_MS`、`EAT_BITE_MS`、`EAT_MS`、`SERVE_HOLD_MS`）
  - `components/cooking.tsx`（`ServeStep`、`EAT_STEP_AT`、`useCookStep`、`DishOnStage`）
  - `components/pixel.tsx`（`Sprite` 的 `bites`、`blink`）
  - `lib/pixel-art.ts`（`biteCells`、`biteSprite`、`plate-empty`）
  - `lib/sprite-kind.ts`（`plate-empty`）
  - `lib/sfx.ts`（`EAT_BITE`、`EAT_DONE`）
  - `app/room/[code]/screen/page.tsx`（`cook >= 3` 四處、`eater`、`onCue`）
  - `app/room/[code]/play/page.tsx`（`cookStep >= 3`）
  - 測試：`lib/pixel-art.test.ts`、`lib/cooking.test.ts`（`useCookStep("7")` 從 `"3"` 改成 `"7"`）、`lib/sfx.test.ts`
  - 文件：`DESIGN.md`、`docs/designs/monster-cuisine.md`、`changelog.d/<branch-slug>.md`
- 讀 `SERVE_HOLD_MS` 的測試會自動跟著新值，不用改：`lib/room/dungeon-room.test.ts`、`lib/room/answer-clock.test.ts`。讀 `FINISH_PODIUM_MS` 的 `lib/room/persistence.test.ts` 不受影響。
- e2e 要檢查的逾時（選擇器不用改）：
  - `e2e/answer.ts` 的 `nextQuestion`：`next.click({ timeout: 8000 })`。上菜後要等 4.8 秒，只剩約 3 秒餘裕；建議改成 10_000。
  - `e2e/host-keys.spec.ts:36`：「下一題」`toBeEnabled({ timeout: 8000 })`，同上。
  - `e2e/answer.ts` 的 `judgeToTheEnd`：每道菜等 `SERVE_HOLD_MS + 300`，讀常數，自動變長。
  - `e2e/main-line.spec.ts:156`、`e2e/narration-tts.spec.ts:218` 的 `test.setTimeout(110_000)` 和 `e2e/main-line.spec.ts:193` 的 80 秒 `waitForFunction`：見 Open Question 2。
  - `e2e/boss-phases.spec.ts:87`（25 秒，等 `FINISH_PODIUM_MS`）：首領不吃，不受影響。

## Next Steps

1. `lib/protocol.ts` 的常數，和 `useCookStep` 的 4–7 步；五處 `=== 3` 改成 `>= 3`。這一步做完，畫面還沒變，但時間和擋門已經是新的。
2. `biteCells`／`biteSprite`、`Sprite` 的 `bites`，和單元測試。
3. `plate-empty` 精靈；25 道料理的咬痕截圖檢查。
4. `DishOnStage` 的角色、嚼的兩格、`Sprite` 的 `blink`、愛心和字。
5. `EAT_BITE`／`EAT_DONE` 音效和 `onCue`。
6. e2e 逾時、`DESIGN.md`、`monster-cuisine.md`、changelog fragment。
7. 這份設計還沒有 eng review 和 design review；實作前跑 `/plan-eng-review`（或 `/autoplan`）。

## Eng Review 決定（2026-11-08）

- **F1 音效**：咬的時候不出聲。吃完、變成空盤那一格才放一聲 `EAT_DONE`（「嗝」），不跟旁白搶。`EAT_BITE` 不做。
- **F2 咬痕位置**：咬痕只落在食物本體，盤子和蒸氣那幾列一開始就排除。實作完要把 25 道菜咬完的樣子各截一張圖，放進 PR 給使用者看，高瘦的 `dish-tower`、`dish-skewer` 要特別看。
- **F3 節奏**：每口間隔 400ms（`EAT_BITE_MS = 400`），`SERVE_HOLD_MS` = 4800。
- e2e：兩個 8000ms 的「下一題」等待改成 10 秒。整場的 EPLG、EPLH 每道菜多 2.2 秒，CI 跑過後看實際時間再決定要不要提高 110 秒的上限。

## 上線後修正（2026-11-09，retro design review）

- 「嗝～」移到吃的人旁邊、料理卡下方（`left: EATER_X - 40` 往左貼齊、`bottom: bottom + 10`），菜名和評語都折成兩行、再加廚師加成時也不會蓋到卡片。兩顆愛心往下 20px，放在卡片底下（z 4）。
- 空盤不再是另一個 34×12 的 `plate-empty` 精靈：`Sprite` 的 `bites` 給 4，用 `drawEmptyPlate` 在料理自己的畫布上畫同一個盤子（`PLATE_AT` 記每道有盤子的菜的盤子位置），最後一刀只少了食物。沒有盤子的菜（碗、杯、串）留下一個跟畫布一樣寬的盤子。
- 空盤太小（fix/empty-plate-size）：第 5 點「空盤用料理的 `scale`」現在只對有盤子的菜成立。沒有盤子的菜，空盤那一步換成 `emptyPlateScale`（`lib/pixel-art.ts`），放大到盤子至少 120px 寬（`MIN_EMPTY_PLATE_PX`），最多 ×5；小烏賊從 ×3（84px）變 ×5（140px）。料理和咬的那幾步照舊用 `dishScale`。
- 第三口起蒸氣消失（`biteCells` 清掉旁邊沒有食物的白點；食物上的亮點留著）。
- `EATER_X` 從 300 改成 285，不再站在門框左柱上。
- 第一口咬得最大（半徑 0.3 倍食物寬，往內挪），遠處也看得出開吃了。
- 主持人鈕「🍲 上菜中… n」倒數到「下一題」能按的秒數（`serveSecondsLeft`）。
