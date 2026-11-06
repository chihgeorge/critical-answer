# Design: 遊戲開始前的玩法說明（how-to-play）

Status: design-reviewed 2026-11-04 (/plan-design-review). Next: /plan-eng-review.
Source: TODOS.md「正式遊戲開始前加玩法說明（文字＋圖片）」(P2).

## Problem

The site owner tested the game and found that new players don't know how to play. Today nothing teaches
the rules: the lobby shows the room code, the QR and the campfire. Players learn the rules by asking the host.

## Goal

Before the first question, every player knows:

1. Teams take turns. When it's your turn, a monster appears and the host reads a question.
2. How to answer: fill-in questions are typed on the phone and judged by the host. Multiple-choice
   questions are tapped and locked on the phone.
3. When you're wrong you can 重答 (same question) or 逃跑 (an easier question, same monster).
4. A right answer beats the monster and earns 飽足感／獎勵分. Get far enough and you reach the boss.
5. The highest score wins. Beating the boss ends the game but doesn't make you the winner.
6. Classes: each team can pick one in the lobby (法師、牧師、盜賊、戰士).

## Constraints (from DESIGN.md)

- Everything is drawn in code or CSS: no image assets. "Pictures" means existing sprites
  (`Sprite`: slime, owl, hero, door, heart, crown…), `McOption` tiles, `D20` and `Panel`s, composed in code.
- Big screen is a fixed 960×540 stage. Motion is two-frame `steps()` only, with `prefers-reduced-motion` respected.
- Small orange text goes on `--k` only (`LabelChip`).
- Fonts: Cubic 11 for Chinese, Press Start 2P for digits.

## Existing UI to reuse

- `/screen` `Lobby` (app/room/[code]/screen/page.tsx:69): campfire, room-code panel, `DialogueBox` with the owl.
- `/play` lobby (app/room/[code]/play/page.tsx:551–569): 「等待主持人開始遊戲…」, roster, `ClassPicker` with class cards.
- Host page: 「開始遊戲 ▶」 (app/room/[code]/host/page.tsx:871).

## Design decisions

- **D1 = A (decided 2026-11-04): a big-screen slideshow.** After the host presses 「開始遊戲 ▶」, `/screen` shows
  a short 「怎麼玩？」 slideshow, one rule per page with a picture. The host taps ▶ to go to the next page, and
  pressing ▶ on the last page shows the first question. Phones show 「看大螢幕 👀」 meanwhile. Why: it's a party
  game watched together on one TV, so everyone hears the rules at the same time, and the host can talk over each page.
  This also settles D2 (it is its own step after 開始遊戲) and D3 (the host advances it).
- **D4 + D5 = 4 pages (decided 2026-11-04, pass 1).** Every page has the same structure, top to bottom:
  1. A `LabelChip` 「怎麼玩？ n/4」.
  2. A cream `Panel` with one picture built from existing parts.
  3. One line of big text (about 38px on the 960×540 stage).
  4. A `DialogueBox` with one owl line.

  Classes are left out: they lock at 開始遊戲, and the lobby's class cards already explain them.

  ```
  ┌──────────── 怎麼玩？ 1/4 ────────────┐
  │ ┌────────── cream Panel ──────────┐ │
  │ │      [picture: sprites/tiles]    │ │
  │ │      one line of big text        │ │
  │ └──────────────────────────────────┘ │
  │ [owl] DialogueBox: one line          │
  └──────────────────────────────────────┘
  ```

  | Page | Picture | Big text | Owl line |
  |---|---|---|---|
  | 1 | `TurnRibbon` 「▼ 輪到：{first team's name}」, `hero` sprite facing a `slime` | 各隊輪流上陣，輪到誰，怪物就找誰 | 冒險者們，先聽我說規則……主持人會唸題目。 |
  | 2 | Two small phones: `McOption` A–D with one selected and an `ok` 「鎖定答案」 button; a text box and 「送出」 | 選擇題＝攻擊，答對擲暴擊骰；填空題打字作答 | 答對選擇題會擲骰子，擲到 20 就是大成功！ |
  | 3 | `slime`, the ✕ 答錯 label, `retry` 「重答」 and `flee` 「逃跑」 buttons with a caption under each | 答錯可以重答，或逃跑換一題簡單一點的 | 答錯別慌！可以再試一次，或逃跑換題，怪物還在原地等你。 |
  | 4 | `slime` → a dish (only when the bank has cuisine), the `door` (首領房), the `crown` | 打倒首領會結束冒險，但分數最高的隊伍才是冠軍 | 準備好了嗎？主持人再按一次 ▶，冒險開始！ |

  Page 4's score word follows the game: 「飽足感」 when the bank has cuisine, else 「獎勵分」, the same rule the rest of the
  UI uses. Mockup: `~/.gstack/projects/critical-answer/designs/how-to-play-screen-20261104/` (local only).
- **D7 = host page and phone during the slideshow (decided 2026-11-04, pass 1).**
  - **Host page:** the same cream `Panel` shows 「怎麼玩？ n/4」, 「大螢幕正在說明規則」 and 「這頁：{page topic}」. Below it, a
    lav panel holds 講稿提示, a one-sentence script for the host per page. At the bottom, in the thumb zone where
    「開始遊戲 ▶」 was, there are two buttons: a small `lav` 「◀ 上一頁」 (hidden on page 1) and a 78px `primary`
    「下一頁 ▶」. On page 4 that button reads 「開始冒險 ▶」. Keyboard: → or Enter goes to the next page, ← to the previous one.
    Enter on a focused button presses that button instead, so Enter on a focused 「◀ 上一頁」 goes back. After each page
    turn both buttons and the keys wait 500ms, the same hold as the judge buttons, so a double tap turns one page.
  - **Player phone:** a lav panel with 「看大螢幕 👀」 and 「主持人在講規則」, the team's own row (name and class), page dots,
    and the footer line 「說明結束後，輪到你們時這裡會出現題目」. The phone never repeats the rule text, so everyone looks up at the TV.
    The footer's owl box shows no loading spinner during the intro, also in a game started after 「回到大廳，再玩一場」.
  - Mockup: `pages-host-phone.png` in the same design directory.
- **D8 = a checkbox before the start (decided 2026-11-04, pass 2).** Above 「開始遊戲 ▶」, the host lobby has a cream
  `Panel` with the checkbox 「開始前播放玩法說明」. It is checked for a new room. After 「回到大廳，再玩一場」 it starts
  unchecked, because the same group already heard the rules, and the host can check it again. Unchecked means
  開始遊戲 goes straight to the first question, as it does today. There is no skip once the slideshow has started:
  the host presses ▶ four times. Mockup: `skip-options.png`.
- **D9 = reconnects resume the same page (decided 2026-11-04, pass 2).** The room keeps the current page. After a
  reload or reconnect, `/screen`, every host page (including a second host device) and every phone show that same
  page, the same way reconnects work mid-game today.

### Interaction states

| Surface | Slideshow on | Reconnect mid-slideshow | Checkbox unchecked | Late join |
|---|---|---|---|---|
| `/screen` | page n/4 (D4) | same page n (D9) | no slideshow; the first question as today | not possible: joining closes at 開始遊戲, as today |
| Host page | 「下一頁 ▶」, 講稿提示 (D7) | same page n | 開始遊戲 starts the game | — |
| Phone | 「看大螢幕 👀」 (D7) | same page dots | the normal turn view | refused with the existing 「遊戲已經開始」 message |
- **D10 = pages swap at once; the sprites bob (decided 2026-11-04, pass 5).** The new page replaces the old one
  with no transition. The sprites in the picture use the existing two-frame `steps()` hop (`px-tf1`/`px-tf2`, as at
  the lobby campfire). Under `prefers-reduced-motion` the sprites stand still.
- **D11 = the voice switch reads the owl line (decided 2026-11-04, pass 6).** When the big screen's voice switch is
  on, each page's owl line is spoken through the existing Web Speech path, the same as in-game narration. When it is
  off, nothing is spoken.

### Journey storyboard (pass 3)

| Step | User does | User feels | Plan specifies |
|---|---|---|---|
| 1 | Host checks 「開始前播放玩法說明」 and presses 開始遊戲 | in charge | D8 |
| 2 | The room looks up at the TV: 「怎麼玩？ 1/4」, the first team's name on the ribbon | curious: "that's us!" | D4 page 1 |
| 3 | Host reads 講稿提示 and presses 下一頁 ▶ three times | confident, not reading cold | D7 |
| 4 | Players see how to answer and what 重答／逃跑 mean | relieved: "so that's what to do" | D4 pages 2–3 |
| 5 | Page 4: the boss and the crown, then 「開始冒險 ▶」 | excited | D4 page 4 |
| 6 | The first question appears, as today | ready | unchanged flow |

5-second impression: a game screen, not a manual (one big picture per page). 5-minute impression: the first team
answers without asking the host what to do.

### Accessibility and devices (pass 6)

- Big screen: the fixed 960×540 stage, as today. Big text is about 38px on the stage and the owl line uses the
  `DialogueBox` size, both readable from across a living room. Text sits on cream or lav panels (`--ink` on `--cream`),
  never small orange text on cream.
- Host page: the 「下一頁 ▶」 button is 78px tall in the thumb zone. The keyboard works as described in D7, and the
  keys do nothing while focus is in a text field, as with the existing judge keys.
- Phone: the lav panel is a `role="status"` region holding a line 「第 n／4 頁：<page title>」 that changes each page,
  so a screen reader announces the page change. The dots are `aria-hidden` (eng review D7).
- Voice: D11.

## NOT in scope

- Explaining classes in the slideshow: they lock at 開始遊戲, and the lobby class cards already explain them (D4).
- Boss phases, the warrior's die and other advanced rules: in-game narration covers them.
- A skip button during the slideshow: the D8 checkbox covers veteran groups.
- Editing the slide text per bank: the four pages are fixed copy.
- Rule cards on the phone: the phone points at the TV instead (D7).

## What already exists

DESIGN.md tokens and fonts; `Panel`, `PixelButton` (`primary`, `retry`, `flee`, `lav`), `LabelChip`, `TurnRibbon`,
`DialogueBox`, `Sprite` (hero, slime, owl, door, crown) in `components/pixel.tsx`; `McOption`; the lobby campfire's
`px-tf1`/`px-tf2` hop; the big screen's voice switch and Web Speech narration; the room's STATE replay on reconnect.

## Implementation Tasks

Synthesized from this review's findings. The room-state design belongs to /plan-eng-review.

- [ ] **T1 (P1, human: ~1d / CC: ~30min)** — room — add the slideshow step after HOST_START, with the current page kept in room state
  - Surfaced by: D1, D8, D9
  - Files: lib/protocol.ts, lib/room/dungeon-room.ts, lib/room/snapshot.ts (not lib/game-state.ts: eng D1)
  - Shape (eng D2–D5, F5): HOST_START `intro?: boolean`, missing means no intro; HOST_INTRO { page } accepted at current ±1, page 5 ends the intro; the start cue, eventSeq bump and start narration wait for page 5; LOBBY `replay?: true`; the room's `intro` page is paused, cleared on reset / end game / back to lobby, and saved as an optional snapshot field.
  - Verify: vitest in a new lib/room/how-to-play.test.ts plus protocol.test.ts and snapshot.test.ts. A start with the checkbox on enters page 1. A double tap moves one page. Page 5 deals the first question and only then sends the cue and narration. A reconnect replays the page.
- [ ] **T2 (P1, human: ~1d / CC: ~30min)** — /screen — render the 4 pages
  - Surfaced by: D4, D10, D11
  - Files: app/room/[code]/screen/page.tsx, components/ (a new how-to-play component)
  - Verify: e2e in CI. Each page shows its chip, big text and owl line. Reduced motion stops the hop.
- [ ] **T3 (P1, human: ~4h / CC: ~15min)** — host page — add the checkbox, 下一頁／上一頁, 講稿提示 and the keyboard keys
  - Surfaced by: D7, D8
  - Files: app/room/[code]/host/page.tsx
  - Verify: e2e in CI. The checkbox is checked in a new room and unchecked after 再玩一場. The keys work, but not in a text field.
- [ ] **T4 (P2, human: ~2h / CC: ~10min)** — phone — add the 「看大螢幕 👀」 view with page dots
  - Surfaced by: D7, pass 6
  - Files: app/room/[code]/play/page.tsx
  - Verify: e2e in CI (host-controls.spec.ts). The phone's status line 「第 n／4 頁」 follows the host (eng D7).
- [ ] **T6 (P1, human: ~1h / CC: ~10min)** — e2e — add `startGame(host)` to e2e/answer.ts (unchecks the box, clicks 開始遊戲) and swap the 40 call sites in 18 specs; the intro's own e2e goes in e2e/host-controls.spec.ts
  - Surfaced by: eng D6
  - Files: e2e/answer.ts, 18 specs (host-controls.spec.ts also holds the intro test)
  - Verify: CI e2e green
- [ ] **T5 (P2, human: ~30min / CC: ~5min)** — docs — README 玩法 and DESIGN.md components
  - Surfaced by: the documentation rule
  - Files: README.md, DESIGN.md
  - Verify: /document-release in /ship

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|---|---|---|---|
| Placement (D1) | ~/.gstack/projects/critical-answer/designs/how-to-play-screen-20261104/d1-placement.png | A: big-screen slideshow | local only |
| The 4 pages (D4) | ~/.gstack/projects/critical-answer/designs/how-to-play-screen-20261104/pages-4.png | approved as drawn | page 4's score word follows the bank |
| Host page and phone (D7) | ~/.gstack/projects/critical-answer/designs/how-to-play-screen-20261104/pages-host-phone.png | approved as drawn | — |
| Skip (D8) | ~/.gstack/projects/critical-answer/designs/how-to-play-screen-20261104/skip-options.png | A: checkbox before the start | — |

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md present; UI: /screen, host, /play |
  | Step 0               | 2/10, all 7 passes                          |
  | Pass 1  (Info Arch)  | 3/10 → 9/10 after fixes                     |
  | Pass 2  (States)     | 4/10 → 9/10 after fixes                     |
  | Pass 3  (Journey)    | 8/10 → 9/10 (storyboard recorded)           |
  | Pass 4  (AI Slop)    | 9/10 → 9/10 (no issues)                     |
  | Pass 5  (Design Sys) | 7/10 → 9/10 after fixes                     |
  | Pass 6  (Responsive) | 6/10 → 9/10 after fixes                     |
  | Pass 7  (Decisions)  | 7 resolved, 0 deferred                      |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (5 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 4 rendered by hand (designer had no API key), 4 approved |
  | Decisions made       | 7 added to plan (D1, D4/D5, D7, D8, D9, D10, D11) |
  | Decisions deferred   | 0                                           |
  | Overall design score | 2/10 → 9/10                                 |
  +====================================================================+
```

Unresolved decisions: none.

## Decision ledger

Eng review, 2026-11-04.

### S1: File arrangement (complexity gate, question_id plan-eng-review-structure)
Scope record: feature answers: none (no cuts proposed); structure: A) Smaller arrangement (user, D1); accepted scope: 11 files. The intro lives in the room the way the boss phase card does, so lib/game-state.ts does not change. The e2e goes into an existing spec instead of a new one (see the correction below). Files: lib/protocol.ts, lib/room/dungeon-room.ts, lib/room/snapshot.ts, the screen, host and play pages, a new components/how-to-play.tsx, a new lib/room/how-to-play.test.ts, lib/protocol.test.ts and lib/room/snapshot.test.ts, an existing e2e spec, README.md and DESIGN.md; pending remedies: F1–F6.
Correction (implementation, 2026-11-04): e2e/lifecycle.spec.ts turned out to be a WebSocket-level idle and rest test, not the UI start flow, so the intro's e2e went into e2e/host-controls.spec.ts, which already covers 回到大廳／再玩一場. Same arrangement (an existing spec, no new file); no behavior changed.

### F1: An old host page sends HOST_START without the new field (Architecture, split deploy)
Finding: [P1] (confidence: 9/10) lib/protocol.ts:352–354. HOST_START today carries only `aiNarration`. Vercel and the Worker deploy separately, so for a few minutes a host page from before this change can talk to the new Worker. That page has no 下一頁 button. Prior learning applied: split-deploy-new-state-field.
Plan baseline: D8 says the checkbox is on in a new room; the plan does not say what the room does when the field is missing.
Runtime evidence: the parser keeps only the fields it knows (lib/protocol.ts:354), so a new host page talking to an old Worker simply starts without the intro. The other direction is unknown until the default is chosen.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| F1 missing `intro` field on HOST_START | unspecified | no intro (start as today) | play the intro |
| F2–F6 | pending | pending | pending |
Question D2:
D2 — 舊版主持人頁按「開始遊戲」時沒帶新欄位，房間要不要播說明？
Project/branch/task: claude/how-to-play，/plan-eng-review 的第 1 個發現（F1）。
ELI10: 網頁（Vercel）和房間伺服器（Worker）是分開上線的，中間會差幾分鐘。這幾分鐘裡，主持人手上可能還是舊版網頁。舊版網頁按「開始遊戲」時不會說「要不要播說明」，而且畫面上沒有「下一頁」按鈕。房間要決定：沒說的時候，當成要播還是不播。
Stakes if we pick wrong: 如果沒說也播，用舊網頁的主持人會卡在說明第 1 頁，沒有按鈕可以往下，只能重新整理。
Recommendation: A because 舊網頁沒有下一頁按鈕，播了就卡住。
Completeness: A=10/10, B=5/10
Net: A 讓舊網頁照今天的方式開始；B 讓舊網頁卡住。
Header: 舊頁相容
Options:
A) 沒帶就不播 (recommended)
房間收到沒帶 intro 欄位的「開始遊戲」，就照今天直接發第一題。新網頁一律帶這個欄位。加一個單元測試確認。（human: ~10min / CC: ~2min）
✅ 用舊網頁的主持人照今天的方式開始，不會卡在看不到按鈕的說明頁
✅ 新網頁一律明確帶 intro: true 或 false，房間不用猜主持人的意思
❌ 上線那幾分鐘用舊網頁開的那一場，玩家會看不到說明，要主持人口頭講
B) 沒帶也播
房間收到沒帶欄位的「開始遊戲」也進說明第 1 頁。
✅ 新房間一律先看說明，跟 D8「新房間預設勾選」的意思最一致
✅ 房間的程式少一個分支，預設值就是播，邏輯讀起來比較直觀
❌ 用舊網頁的主持人沒有下一頁按鈕，會卡在第 1 頁，只能重新整理換新版網頁

State: approved
Actual answer: A) 沒帶就不播 (user, D2)
Accepted scope: HOST_START without an `intro` field starts the game as today, with no intro. The new host page always sends `intro: true` or `false`. One unit test covers the missing field.
History: none

### F2: The start fanfare and opening narration fire before the intro (Architecture)
Finding: [P1] (confidence: 9/10) lib/room/dungeon-room.ts:1335–1340. handleHostStart sets `cue = "start"`, bumps eventSeq and calls `narrate(... type: "start", next)` right after createGame. With an intro, the fanfare and the narrator's 「第一隊上場」 line would play over page 1, and the line names a team whose question the room is not showing yet.
Plan baseline: T1 says "▶ on page 4 deals the first question"; it does not say when the start cue and narration run.
Runtime evidence: the cue rides the next STATE (line 645) and the narration goes out at once (line 1340). The boss phase card defers its own cue to openPhaseCard (line 1194), which is the pattern to copy.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| F1 missing field | approved: no intro (D2) | no intro (D2) | no intro (D2) |
| F2 when the start cue and narration run | at HOST_START | when the host leaves page 4 (開始冒險) | at HOST_START, over the intro |
| F3–F6 | pending | pending | pending |
Question D3:
D3 — 開場音效和「第一隊上場」的旁白，要在按「開始遊戲」時就放，還是等說明播完？
Project/branch/task: claude/how-to-play，/plan-eng-review 的第 2 個發現（F2）。
ELI10: 今天按「開始遊戲」會馬上放開場音效，旁白也馬上說「烤肉小隊先上」。加了說明以後，這時大螢幕還在第 1 頁。如果照舊馬上放，音效和旁白會蓋過說明，而且旁白點名的隊伍，題目還沒出來。
Stakes if we pick wrong: 選 B 的話，玩家一邊看說明一邊聽到「輪到烤肉小隊」，會以為已經要作答了。
Recommendation: A because 首領階段卡也是等卡片收起來才放音效，做法一樣。
Completeness: A=10/10, B=4/10
Net: A 等說明播完才放開場；B 少改幾行，但開場會跟說明撞在一起。
Header: 開場時機
Options:
A) 說明播完才放 (recommended)
勾了說明時，開場音效、eventSeq 加一和「start」旁白都移到主持人在第 4 頁按「開始冒險 ▶」那一刻。沒勾說明時照今天。加單元測試確認說明中沒有 cue 也沒有旁白。（human: ~1h / CC: ~5min）
✅ 說明播放時大螢幕很安靜，玩家只聽主持人講規則，不會被旁白打斷
✅ 旁白點名第一隊時，那一隊的題目剛好同時出現在大螢幕和手機上
❌ handleHostStart 要拆成兩段（建立遊戲、正式開場），多一個要測的路徑
B) 照舊馬上放
按「開始遊戲」就放音效和旁白，說明照樣播。
✅ handleHostStart 完全不用拆，程式改動最少，也不用多寫測試路徑
✅ 開場音效一響，大家馬上知道遊戲已經開始了，氣氛比較熱鬧
❌ 旁白會在說明第 1 頁就點名第一隊，題目卻還沒出現，玩家會搞混

State: approved
Actual answer: A) 說明播完才放 (user, D3)
Accepted scope: with the intro on, the start cue, the eventSeq bump and the "start" narration move to the moment the host leaves page 4 (開始冒險 ▶). With the intro off, the start runs as today. Unit tests check that no cue and no narration go out during the intro.
History: none

### F3: How the host page turns a page (Architecture, double taps)
Finding: [P2] (confidence: 8/10) proposed new host message; pattern at lib/protocol.ts:352. A host on a phone can double-tap 下一頁, and the host page can be open in two tabs. A bare "next page" message would skip a page on a double tap.
Plan baseline: D7 gives 上一頁 and 下一頁, plus → / Enter / ← keys; D9 says a reconnect resumes the same page. The message shape is not in the plan.
Runtime evidence: none yet; this is a new message.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| F1 missing field | approved: no intro (D2) | no intro (D2) | no intro (D2) |
| F2 start timing | approved: after page 4 (D3) | after page 4 (D3) | after page 4 (D3) |
| F3 page message | none | HOST_INTRO { page }, accepted only at current ±1; page 5 ends the intro | HOST_INTRO_NEXT / HOST_INTRO_PREV with no page number |
| F4–F6 | pending | pending | pending |
Question D4:
D4 — 主持人翻頁時，要送「我要去第幾頁」，還是只送「下一頁」？
Project/branch/task: claude/how-to-play，/plan-eng-review 的第 3 個發現（F3）。
ELI10: 主持人用手機按「下一頁」時，很容易不小心連按兩下，或開著兩個主持人分頁。如果手機只送「下一頁」，連按兩下就會跳過一頁。如果手機送「我要去第 3 頁」，房間看到第二個「去第 3 頁」時已經在第 3 頁了，就不理它。
Stakes if we pick wrong: 選 B 的話，主持人連按兩下會跳過一整頁說明，要按上一頁回去。
Recommendation: A because 連按兩下也不會跳頁，而且房間只要比對頁碼。
Completeness: A=10/10, B=6/10
Net: A 多帶一個頁碼換來不跳頁；B 訊息最簡單但會跳頁。
Header: 翻頁訊息
Options:
A) 送目標頁碼 (recommended)
新訊息 HOST_INTRO { page }。房間只接受目前頁 ±1，其他的不理。page 5 代表按了「開始冒險 ▶」，說明結束。加 protocol 和房間的單元測試。（human: ~1h / CC: ~5min）
✅ 主持人連按兩下或兩個分頁同時按，都只會翻一頁，不會跳過內容
✅ 「開始冒險」也是同一個訊息（去第 5 頁），不用再多一種訊息
❌ 主持人頁要記得目前頁碼才能送，重連後要等房間的 STATE 回來才能按
B) 只送下一頁／上一頁
兩個新訊息 HOST_INTRO_NEXT 和 HOST_INTRO_PREV，不帶頁碼。
✅ 主持人頁不用知道目前第幾頁，按鈕一按就送，程式最短
✅ 鍵盤 → 和 ← 直接對應兩個訊息，讀程式的人一看就懂
❌ 連按兩下或兩個分頁同時按，會一次翻兩頁，跳過一頁說明

State: approved
Actual answer: A) 送目標頁碼 (user, D4)
Accepted scope: new host message HOST_INTRO { page }. The room accepts it only when page is the current page ±1 and ignores anything else. Page 5 means 開始冒險 ▶ and ends the intro. Unit tests in protocol and room cover a double tap, a jump of two, page 0 and page 5.
History: none

### F4: Where the checkbox's default comes from (Architecture)
Finding: [P2] (confidence: 8/10) lib/room/dungeon-room.ts:628 and :1092. D8 wants the checkbox on in a new room and off after 再玩一場. The LOBBY message today carries only `teams` and `roomEpoch`, so the host page cannot tell a new room from a replay after a reload.
Plan baseline: D8 (approved in the design review): checked in a new room, unchecked after 再玩一場, and the host can change it.
Runtime evidence: the room keeps `playedQuestionIds` (line 170), saves it in the snapshot (line 426) and fills it when the host goes back to the lobby (line 1092–1094). It stays empty when no question was revealed.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| F1 missing field | approved: no intro (D2) | no intro (D2) | no intro (D2) |
| F2 start timing | approved: after page 4 (D3) | after page 4 (D3) | after page 4 (D3) |
| F3 page message | approved: HOST_INTRO { page } (D4) | HOST_INTRO { page } (D4) | HOST_INTRO { page } (D4) |
| F4 checkbox default source | none | room: LOBBY gets optional `replay: true` while playedQuestionIds is not empty | host page memory: off after this tab clicks 再玩一場 |
| F5–F6 | pending | pending | pending |
Question D5:
D5 — 「開始前播放玩法說明」要預設勾還是不勾，由誰決定？
Project/branch/task: claude/how-to-play，/plan-eng-review 的第 4 個發現（F4）。
ELI10: 設計已經決定：新房間預設勾，玩過一場、按「再玩一場」回大廳後預設不勾。問題是主持人頁怎麼知道「這間房已經玩過」。A 是讓房間告訴它（房間本來就記得出過哪些題）。B 是主持人頁自己記，但重新整理或換一支手機就忘了。
Stakes if we pick wrong: 選 B 的話，主持人重新整理後勾勾又回來，同一群人又被迫看一次說明（主持人可以手動取消，所以不嚴重）。
Recommendation: A because 房間已經存著出過的題目，重新整理或換手機都不會忘。
Completeness: A=10/10, B=7/10
Net: A 多一個大廳欄位換來重新整理也記得；B 不改房間但會忘。
Header: 勾選預設
Options:
A) 房間告訴主持人頁 (recommended)
LOBBY 訊息多一個選填欄位 replay: true，條件是房間的 playedQuestionIds 不是空的。主持人頁預設勾選 = 沒有 replay。舊 Worker 不送這個欄位，主持人頁就預設勾。加房間單元測試。（human: ~1h / CC: ~5min）
✅ 主持人重新整理、換手機或開第二個分頁，預設值都一樣，不會忘記已經玩過
✅ 一題都沒出就提早結束的那場不算玩過，下次回大廳仍然預設勾選，比較合理
❌ LOBBY 訊息多一個欄位，protocol 和 snapshot 之外又多一個要測的地方
B) 主持人頁自己記
主持人頁用 React state：這個分頁按過「再玩一場」就改成不勾。房間不用改。
✅ 房間和 protocol 完全不用改，只動主持人頁一個檔，改動最小
✅ 邏輯全在畫面那一層，讀主持人頁程式就看得懂預設值從哪來
❌ 主持人重新整理或換一支手機後又變成勾選，同一群人會再看一次說明

State: approved
Actual answer: A) 房間告訴主持人頁 (user, D5)
Accepted scope: LOBBY gains an optional `replay: true`, sent while playedQuestionIds is not empty. The host page checks the box when `replay` is absent, so an old Worker still gives a checked box. A room unit test covers a new room, a replay and an early end with no question revealed.
History: none

### F5: Clearing and saving the intro page (Architecture)
Finding: [P1] (confidence: 9/10) lib/room/dungeon-room.ts:788, :1072, :1099 and lib/room/snapshot.ts:53. The phase card is cleared on reset, end game and back to lobby, and saved in the snapshot. The intro page must do the same, or 結束遊戲 during the intro leaves a stale page, and a room restored from storage mid-intro shows the first question with no start narration.
Plan baseline: D9 (approved in the design review): a reconnect resumes the same page.
Runtime evidence: phaseCard follows this exact path (lines cited above; snapshot.ts:90 validates it).
Disposition: no question. This is the necessary implementation of D9 and of D2–D4. Carried forward: the room's `intro` page (number or null) is cleared in reset, end game and back to lobby; it is saved in the snapshot as an optional field (a snapshot without it means no intro), validated as 1–4; `paused()` includes it, so team actions get `reveal_pending` and host judging is blocked; STATE carries an optional `intro: { page }` with `question: null`. Unit tests in lib/room/how-to-play.test.ts and lib/room/snapshot.test.ts.
State: approved
Actual answer: carried forward from D9, D2, D3 and D4 (no new question)
Accepted scope: as in Disposition above.
History: none

### F6: Existing e2e tests click 開始遊戲 and would land on the intro (Test review)
Finding: [P1] (confidence: 10/10) e2e/*.spec.ts. 40 places in 18 spec files click `getByRole("button", { name: /開始遊戲/ })` and then expect the first question. With the box checked in a new room (D8), every one of them would see page 1 instead and fail on CI.
Plan baseline: S1 (D1) put the new e2e into e2e/lifecycle.spec.ts; the plan says nothing about the existing specs.
Runtime evidence: grep over e2e/ (40 call sites, 18 files). e2e/answer.ts already holds shared helpers (answerCorrectly, textOnlyBank).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| F1–F5 | approved (D2–D5, carried) | unchanged | unchanged |
| F6 how other specs start a game | click 開始遊戲 | new helper `startGame(host)` in e2e/answer.ts unchecks the box, then clicks; all 40 sites call it | same helper, but it clicks through the 4 pages |
Question D6:
D6 — 現有的 40 個 e2e 測試一按「開始遊戲」就會跑進說明頁，要怎麼處理？
Project/branch/task: claude/how-to-play，/plan-eng-review 的第 6 個發現（F6，第 5 個不用問，照 D9 做）。
ELI10: 新房間預設勾說明，所以現有測試按「開始遊戲」後會看到說明第 1 頁，而不是第一題，18 個測試檔會一起失敗。兩種做法都會做一個共用的 startGame(host)，把 40 個地方換成它。差別在這個共用小幫手是先取消勾選，還是把 4 頁點過去。
Stakes if we pick wrong: 選 B 的話，每個測試多 4 次點擊和等待，CI 會慢一些；說明頁一壞，所有測試一起紅，很難看出是哪裡壞。
Recommendation: A because 說明自己在 lifecycle.spec.ts 有專門測試，其他測試不用重複走一次。
Note: options differ in kind, not coverage — no completeness score.
Net: A 快又分得清楚；B 每個測試都順便走過說明，但慢而且一壞全壞。
Header: 舊 e2e
Options:
A) 小幫手先取消勾選 (recommended)
e2e/answer.ts 加 startGame(host)：取消「開始前播放玩法說明」，再按「開始遊戲」。40 個地方改成呼叫它（機械式替換）。說明本身只在 lifecycle.spec.ts 測。e2e 只在 CI 跑。（human: ~1h / CC: ~10min）
✅ 其他測試照舊直接進第一題，CI 時間不變，失敗時也看得出是哪個功能壞
✅ 說明頁的行為集中在 lifecycle.spec.ts 一個地方測，要改說明時只要看那裡
❌ 18 個測試檔都要改一行，這次的改動檔案數從 11 個變成約 29 個
B) 小幫手把 4 頁點完
startGame(host) 按「開始遊戲」後，按 3 次「下一頁」和 1 次「開始冒險」。
✅ 每個測試都順便走過一次說明，說明在各種題庫下都被測到
✅ 測試走的路跟真實主持人一樣，預設勾選的那條路被測得最徹底
❌ 每個測試多 4 次點擊和等待，CI 變慢；說明一壞，18 個測試檔一起失敗

State: approved
Actual answer: A) 小幫手先取消勾選 (user, D6)
Accepted scope: e2e/answer.ts gains `startGame(host)`, which unchecks 開始前播放玩法說明 and clicks 開始遊戲. All 40 call sites in 18 specs call it (a mechanical swap). The intro itself is tested only in e2e/host-controls.spec.ts (correction above). About 29 files in all. e2e runs on CI only.
History: none

### X1: The phone's status panel does not change text when the page turns (Outside Voice, accessibility)
Finding: [P2] (confidence: 8/10) docs/designs/how-to-play.md accessibility list (phone line); reviewer: Codex (outside voice), confirmed by the parent. The panel marked `role="status"` always reads 「看大螢幕 👀 主持人在講規則」. Only the dots' `aria-label` changes, and it sits outside the live region, so a screen reader says nothing when the page turns.
Plan baseline: the design review's accessibility line: dots carry 「第 n 頁，共 4 頁」, and the lav panel is a `role="status"` region.
Runtime evidence: none; the phone view is not built yet. A live region announces only when its own text changes.
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| F1–F6 | approved | unchanged | unchanged | unchanged | unchanged |
| X1 what the status region says | fixed text, dots outside | region text includes 「第 n／4 頁：<page title>」 and changes each page | keep fixed text | look at how the existing phone status panels announce, then ask again | defer to a TODO |
Question D7:
D7 — 手機的「看大螢幕」區塊，翻頁時要不要讓讀螢幕軟體唸出新的頁數？
Project/branch/task: claude/how-to-play，外部審查（Codex）找到的 1 個問題（X1）。
ELI10: 設計寫說手機的「看大螢幕」區塊會在翻頁時被讀螢幕軟體唸出來。但讀螢幕軟體只會在那個區塊的文字改變時才唸，而這個區塊的文字每頁都一樣，只有下面的圓點換了。所以實際上翻頁時什麼都不會唸。
Stakes if we pick wrong: 選 B 的話，用讀螢幕軟體的玩家不知道說明翻到第幾頁，設計裡寫的無障礙承諾沒有做到。
Recommendation: A because 只要把頁數和這頁標題放進同一個區塊，幾乎不用多寫程式。
Note: options differ in kind, not coverage — no completeness score.
Net: A 讓設計的承諾成真；B 不改但承諾落空；C、D 延後決定。
Header: 讀頁數
Options:
A) Apply this change (recommended)
`role="status"` 區塊裡加一行會變的字：「第 2／4 頁：用手機作答」，圓點留著但標成 aria-hidden。e2e 在 lifecycle.spec.ts 檢查這行字跟著主持人翻頁改變。（human: ~15min / CC: ~3min）
✅ 用讀螢幕軟體的玩家每翻一頁都會聽到頁數和這頁在講什麼
✅ 看得到的玩家也多一行字知道這頁主題，不用只靠小圓點猜
❌ 手機畫面多一行字，比原本設計圖稍微擠一點
B) Keep this row's current value
照原設計，區塊文字固定，只有圓點的 aria-label 會變。
✅ 手機畫面完全照已經核准的設計圖，不用多一行字
✅ 少改一點程式，也不用在 e2e 多檢查一行字
❌ 讀螢幕軟體翻頁時不會唸任何東西，設計寫的無障礙承諾沒有做到
C) Investigate before choosing
先看現有手機頁其他 status 區塊（例如等待主持人那塊）怎麼處理，約 5 分鐘，看完再問一次。這期間 X1 維持未決定。
✅ 可以跟現有手機頁的做法對齊，不會多出一種新寫法
✅ 只花大約 5 分鐘，看完之後再回來做決定
❌ 多一輪問答，現在的決定要再等一下才能定下來
D) Defer this proposed change only
寫進 TODOS.md，這次照原設計做，之後再改。
✅ 這次的範圍不變，手機頁照設計圖做，不用多一行字
✅ 問題有記錄在 TODOS.md，不會被忘掉，之後隨時可以補
❌ 上線那一版讀螢幕軟體翻頁時不會唸，要等下一次才修好

State: approved
Actual answer: A) Apply this change (user, D7)
Accepted scope: the phone's `role="status"` panel gains a changing line 「第 n／4 頁：<page title>」; the dots are `aria-hidden`. e2e in host-controls.spec.ts checks the line follows the host. Mockup: ~/.gstack/projects/critical-answer/designs/how-to-play-screen-20261104/d7-phone-status.png (local only).
History: none

Approval readiness: PASS — S1 (D1), F1 (D2), F2 (D3), F3 (D4), F4 (D5), F5 (carried from D9), F6 (D6), X1 (D7); all answered by the user on 2026-11-04. Sections 2 (code quality) and 4 (performance): no issues found; a page turn is one STATE broadcast. The owl voice line (D11) is spoken by the screen's own browser TTS, so it needs no room eventSeq.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | Codex (in eng review) | Independent 2nd opinion | 1 | issues_found | 1 P2 (X1), fixed via D7 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 7 decisions (D1–D7), 0 open |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 2/10 → 9/10, 7 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** the outside design voices (Codex and a Claude subagent) were not offered this run, so there is no outside coverage. The image generator had no OpenAI API key, so the mockups were drawn by hand.
- **VERDICT:** DESIGN + ENG CLEARED — ready to implement.

NO UNRESOLVED DECISIONS
