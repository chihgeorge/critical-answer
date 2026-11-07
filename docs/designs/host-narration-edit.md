# 主持人頁改寫旁白：列出這次旁白的每一句

狀態：design review 完成（2026-11-07），分支 `feat/host-narration-edit`。來源：TODOS.md P2「拿掉導演筆記，改寫旁白搬到主持人頁，並列出下一隊的所有台詞」。

## 問題

站長 2026-11-04 實測後覺得導演筆記用不到。「改寫旁白」藏在「⚙ 更多」裡，又只能改第一句（`HOST_EDIT_NARRATION` 只換 `lines[0]`），主持人看不出後面還有哪幾句、自己在改哪一句。

## 要做的事（站長給的需求）

1. 拿掉「⚙ 更多」裡的「導演筆記」。`HOST_SET_NOTES` 和旁白 prompt 裡的筆記一起清掉：protocol、room、LLM prompt、測試、文件。
2. 「改寫旁白」從「更多」搬到主持人頁上。
3. 改寫介面列出這次旁白（判完一題、輪到下一隊時）的每一句（1–3 句），不只第一句。主持人選一句再改。`HOST_EDIT_NARRATION` 帶句子編號，房間換掉第 N 句。
   - 大螢幕已經念完的句子不能改：房間拒絕，介面也停用那一句。
   - AI 旁白還在生成時，顯示「旁白生成中…」。
4. 「下一句這樣說」留在「更多」或一起搬上來：站長決定（D7：搬上來）。

## 現況（audit）

- 旁白一次送齊：`lib/narration/runner.ts` 等 AI（最多 3 秒）後一次 `emit` 全部 1–3 句，不是一句一句到。「生成中」實際上是「判完到 NARRATION 抵達」這段。主持人頁可用 `isPending(game.eventId, narration)`（`lib/narration/client.ts`）判斷。
- 房間不知道大螢幕念到哪：`/screen` 從不送訊息；`DialogueBox` 的 `Sequence` 一句一句打字（每句打完停 2.2 秒），TTS 一次把全部句子排進 `speechSynthesis`。
- 改一句的副作用：`DialogueBox` 用 `lines.join("\n")` 當 key，`tts.ts` 的 `shouldSpeakNarration` 比整個陣列，所以改任何一句，大螢幕都從第一句重新打字、重新念全部。
- `DialogueBox` 也用在 `/play`（手機）。

## 決策

對照圖（本機檔，不進 git）：`~/.gstack/projects/critical-answer/designs/host-narration-edit-20261107/`。

- **D2 位置＝答對鈕上方，平常收成一行。** 判題鈕位置不動（DESIGN.md：判題鈕在拇指區）。收合列：owl、`地城主旁白` chip、摘要、右邊「展開 ▾」。點了展開成清單，「收起 ▴」收回。只在 `phase === "playing"`、不在玩法說明時出現。（`d2-placement.png`）
- **D3 念完＝大螢幕回報。** `/screen` 每念完一句（見 D11）送 `SCREEN_NARRATION_PROGRESS { eventId, rev, done }`，done＝已念完的句數。房間只收 eventId、rev 都等於目前旁白、done 比現在大、而且不超過句數的回報（D14）。沒有密鑰：最多只能被惡作劇「提早鎖住」，內容改不了；已加入隊伍的手機和主持人頁送的回報房間不收，玩家用自己的手機鎖不了。
- **D4 接續＝從被改的那一句接著念**（D13 細化）。
- **D5 改法＝就地變輸入框。** 每句一行：編號 chip、句子、右邊「改」（44px）。點「改」那一行變成「改第 N 句（最多 50 字）」＋輸入框（預填原句）＋「取消」「換上大螢幕」。已念完：`--dim-ink` 字、`--dim-line` 虛線框、「✓ 已念完」標籤、沒有「改」。正在念的那一句：`--turn` 底、「▶ 念到這」標籤，仍可改。（`d5-edit.png`）
- **D6 生成中＝一行。** `isPending` 時：收合列摘要「旁白生成中…」（一般墨色：`--dim-ink` 在 `--lav` 上只有 3.1:1，不夠讀）；展開時只有一行「旁白生成中…」，沒有「改」。（`d5-states.png`）
- **D7 下一句這樣說＝搬進旁白面板。** 展開後清單下方：「下一句這樣說（下一次旁白的第二句，最多 40 字）」＋輸入框＋「排進去」；已排的句子顯示在上面（`--turn` 底），有「取消」。收合列摘要後面加「・已排下一句」。「⚙ 更多」拿掉它。（`d7-next-line.png`）
- **D9 改寫帶 eventId。** `HOST_EDIT_NARRATION { eventId, rev, index, line }`。eventId 或 rev 對不上（旁白已換新，或另一台主持人裝置先改了）就拒絕，跟 `HOST_NEXT` 的擋法一樣。
- **D10 編輯中那句被鎖。** 編輯框留著、草稿保留，標題旁出現「✓ 已念完」，下方紅字「大螢幕剛念完這句，改不了。可以改排進下一句。」，「換上大螢幕」換成「改排進下一句」（送 `HOST_NEXT_LINE`）。房間拒絕（已念完、旁白已換新）也用同一個顯示，旁白已換新時文字改成「旁白已換新，沒有送出。可以改排進下一句。」。（`final-approved.png`）
- **D11 念完＝字打完，而且（有開語音時）那句也念完。** 沒開語音或瀏覽器不支援時，只看字。
- **D12 自動收起。** 新旁白送達（eventId 變了）或「換上大螢幕」成功後自動收起；有編輯框開著時不收。「成功」是指廣播回來的第 N 句等於草稿（照房間的規則整理過）；另一台主持人裝置的改句先到時不收，等房間回 `stale_narration` 再顯示紅字。
- **D13 接續細節。** 改的句子在正在念的那句之後：目前這句照常念完，接著念新句子；只有改到正在念的那句，才從它重新打字、重新念。已念完的句子不重打、不重念。語音只抽換還沒開始念的句子，不切掉正在念的。`/play` 的對話框用同一個元件，一起變。
- **D14 進度存在房間。** `lastNarration` 加 `done` 與 `rev`，跟旁白一起存檔；主持人連線（含重連）時送回。多台大螢幕取最大值。每次改寫 `rev + 1`、隨 NARRATION 廣播，舊 rev 的回報不算。
- **D15 收合列文案。** 沒旁白：「還沒有旁白」，不能展開。有旁白、done=0：「N 句・大螢幕還沒開始念」。0<done<N：「N 句・念到第 done+1 句」。done=N：「N 句・都念完了」。有排下一句時加「・已排下一句」。（`final-approved.png`）
- **D16 不標「哪一題的旁白」。** 第 1 句本身就在說發生什麼事，D12 讓舊旁白不殘留。
- **D17 鍵盤與閱讀器。** 展開鈕 `aria-expanded`／`aria-controls`；「改」的 `aria-label`＝「改第 N 句」；點「改」後焦點進輸入框；Enter 送出、Esc 取消並把焦點還給那句的「改」；狀態有文字（✓ 已念完、▶ 念到這），不只靠顏色；摘要與送出結果放在 `aria-live="polite"`。快捷鍵在輸入框裡不生效（`lib/host-keys.ts` 已跳過 input）。
- **D18 改寫上限 50 字**（`MAX_LINE`），預填原句不會被截。「改排進下一句」時草稿超過 40 字，就提示「超過 40 字，請刪短」，不送出。
- 動態：照 DESIGN.md，展開、收起、狀態變化都是直接切換，沒有轉場。

## 互動狀態

| 功能 | 等待 | 空 | 錯誤 | 成功 | 部分 |
|---|---|---|---|---|---|
| 收合列 | 「旁白生成中…」 | 「還沒有旁白」，不能展開 | — | 摘要更新 | 「N 句・念到第 K 句」 |
| 展開清單 | 一行「旁白生成中…」，沒有「改」 | 不能展開 | — | — | 已念完的變灰、正在念的 `--turn` |
| 改一句 | 送出後等房間廣播 | — | D10 紅字＋「改排進下一句」，草稿保留 | 面板收起（D12），大螢幕從該句接上（D13） | 編輯中那句被鎖：D10 |
| 下一句這樣說 | — | placeholder 範例句 | 超過 40 字提示；房間 ERROR 時草稿保留（沿用現狀） | 「已排入：…」＋「取消」，收合列加「・已排下一句」 | — |

## 主持人的流程

| 步驟 | 主持人做 | 感覺 | 計畫怎麼支持 |
|---|---|---|---|
| 1 | 判答對 | 專心判題 | 判題鈕不動；面板收合 |
| 2 | 看收合列 | 「AI 在寫嗎？」 | 「旁白生成中…」→「3 句・大螢幕還沒開始念」 |
| 3 | 發現第 3 句叫錯隊名 | 急 | 展開，第 3 句還能改，「改」就在那一行 |
| 4 | 改字、Enter | 「有沒有換上去？」 | 面板收起，摘要更新；大螢幕念完第 2 句後接新的第 3 句 |
| 5 | 慢了一步，那句念完 | 挫折 | 草稿保留，一鍵改排進下一句 |

## NOT in scope

- 標出旁白屬於哪一題（D16 決定不做）。
- 後記（epilogue）的改寫：結束後面板不出現，跟現在一樣。
- 「旁白紀錄下載」留在「⚙ 更多」。
- 偵測「大螢幕有沒有開」：房間分不出來，D15 的文案只說「還沒開始念」。

## 已經有的東西

- `isPending()`（`lib/narration/client.ts`）判斷生成中。
- `Panel tone="lav"`、`PixelButton`、`LabelChip` 風格的 chip、`.px-input`、`Sprite kind="owl"`。
- `HOST_NEXT` 的 eventId 擋法（D9 照抄）。
- `HOST_NEXT_LINE` 與 `HOST_NEXT_LINE_STATE`（D7 只搬 UI）。
- `lib/host-keys.ts` 在輸入框裡不觸發快捷鍵。
- `sanitizeText`、`MAX_LINE`。

## Implementation Tasks

- [ ] **T1 (P1, human: ~3h / CC: ~20min)** — protocol/room/llm — 拿掉 `HOST_SET_NOTES`、`notes`、prompt 裡的導演筆記、`DirectorEntry.kind "notes"`，舊存檔的 `notes` 欄位讀取時忽略
  - Files: `lib/protocol.ts`, `lib/room/dungeon-room.ts`, `lib/narration/llm.ts`, `lib/narration/runner.ts`, 對應 test、`e2e/host-drawer.spec.ts`
  - Verify: `npx vitest run`
- [ ] **T2 (P1, human: ~4h / CC: ~30min)** — protocol/room — `HOST_EDIT_NARRATION { eventId, rev, index, line }`（D9、D18）、`SCREEN_NARRATION_PROGRESS { eventId, rev, done }`（D3、D14），`lastNarration` 存 `done`/`rev`，NARRATION 帶 `rev`，進度用 `HOST_NARRATION_PROGRESS { eventId, done }` 送給主持人，主持人連線時重送
  - Verify: 單元測試：換第 N 句、已念過被拒、不是主持人被拒、eventId 過期被拒、舊 rev 回報不算、protocol 解析
- [ ] **T3 (P1, human: ~4h / CC: ~30min)** — screen/DialogueBox/tts — 回報進度（D11）、從改的句子接續（D13）
  - Files: `components/pixel.tsx`, `lib/narration/tts.ts`, `app/room/[code]/screen/page.tsx`
  - Verify: 純函式單元測試（接續起點、語音抽換）
- [ ] **T4 (P1, human: ~4h / CC: ~30min)** — host — 旁白面板（D2、D5、D6、D7、D10、D12、D15、D17），從 `MoreDrawer` 拿掉導演筆記、改寫、下一句
  - Files: 新 `components/narration-panel.tsx`, `app/room/[code]/host/page.tsx`, `components/more-drawer.tsx`
  - Verify: 摘要文案純函式單元測試；e2e（CI）改 `host-drawer.spec.ts`、`narration-tts.spec.ts`
- [ ] **T5 (P2, human: ~1h / CC: ~10min)** — docs — `docs/hosting.md`／`.en.md`、DESIGN.md 加 NarrationPanel、TODOS.md 移除該項
  - Verify: `npm run check:docs`

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md 有；UI 範圍：主持人頁、大螢幕對話框 |
  | Step 0               | 3/10；7 面向全做                             |
  | Pass 1  (Info Arch)  | 8/10 → 10/10 after fixes (D2 D7 D16)        |
  | Pass 2  (States)     | 6/10 → 10/10 after fixes (D6 D10 D15)       |
  | Pass 3  (Journey)    | 7/10 → 9/10 after fixes (D12 D13)           |
  | Pass 4  (AI Slop)    | 9/10 → 9/10（無 hard rejection）             |
  | Pass 5  (Design Sys) | 8/10 → 9/10（只用現有 token 與元件）         |
  | Pass 6  (Responsive) | 5/10 → 9/10 after fixes (D12 D17)           |
  | Pass 7  (Decisions)  | 17 resolved, 0 deferred                     |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (4 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 5 boards rendered, 5 approved               |
  | Decisions made       | 17 added to plan (D2–D7, D9–D18; D8 是流程)  |
  | Decisions deferred   | 0                                           |
  | Overall design score | 5/10 → 9/10                                 |
  +====================================================================+
```

設計師（`$D`）沒有圖像 API 金鑰，對照圖改用專案真的 token 與 Cubic 11 字型做成 HTML，再用 headless Chromium 截圖。

### Unresolved Decisions

無。

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|---|---|---|---|
| 位置 | `~/.gstack/projects/critical-answer/designs/host-narration-edit-20261107/d2-placement.png` | B：答對鈕上方收合 | D12 每題自動收 |
| 改一句 | `~/.gstack/projects/critical-answer/designs/host-narration-edit-20261107/d5-edit.png` | A：就地輸入框 | 上限 50 字（D18） |
| 生成中 | `~/.gstack/projects/critical-answer/designs/host-narration-edit-20261107/d5-states.png` | 一行「旁白生成中…」 | |
| 下一句 | `~/.gstack/projects/critical-answer/designs/host-narration-edit-20261107/d7-next-line.png` | B：搬進面板 | |
| 定稿 | `~/.gstack/projects/critical-answer/designs/host-narration-edit-20261107/final-approved.png` | D10、D15 | |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex（design outside voices） | Independent 2nd opinion | 1 | completed | 6 findings（2 High 與 Claude 子代理重疊），全部已處理 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 5/10 → 9/10, 17 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex，design phase，completed，6 findings（eventId、念完定義、編輯衝突、多螢幕與重連、無障礙、上限不一致）。
- **CROSS-MODEL:** Codex 與 Claude 子代理都抓到：改寫缺 eventId、編輯中被鎖、無障礙、字數上限。只有 Codex 提出「念完是打字還是語音」（D11）；只有 Claude 子代理提出收合時機（D12）、接續細節（D13）、缺漏狀態（D15）。
- **VERDICT:** DESIGN CLEARED；eng review required（crew 流程跳過 /plan-eng-review，由 /review 把關）。

NO UNRESOLVED DECISIONS
