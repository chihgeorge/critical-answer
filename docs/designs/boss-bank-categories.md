# Boss bank by category and difficulty (bank editor)

Status: shipped with this PR. Reviewed with /autoplan (CEO, design, eng); the owner picked the chip style, the row tag
and the difficulty sort (later dropped: boss phases list and deal in bank order, see Order).

## Problem

A buzzer boss phase can hold about 70 songs, each with a 類別. The editor listed a phase 10 per page in bank order, so
checking one category meant paging through all of them.

## What the editor does

- **Order.** A boss phase lists its questions in bank order, the order a game deals them. (Shipped first easiest
  first; the owner switched the game to pure bank order on 2026-11-20, so the editor followed. Difficulty only orders a
  phase under 首領題隨機順序, via `byDifficulty` in `lib/game-state.ts`.) 第 N 題 (rows, search hits, toasts) is the
  bank position (`listNumber` in `lib/bank-editor-list.ts`).
- **Chips.** A 「難度」 row on every boss phase and a 「類別」 row on a buzzer phase whose questions have categories.
  Small `px-btn` toggles (white, picked `--turn` with ✓, `aria-pressed`) in a labelled `role="group"`. Categories in
  first-seen order, 未分類 last. Each count follows the other row's pick; the picked chip counts the shown list, the
  same number as the pager. A row whose one chip holds every question is hidden.
- **Categories** follow the game's rule, now one function (`bankCategoryOf` in `lib/question-bank.ts`, used by the
  room): once any question has a category, every timing question is 卡點題. A note says so under the row.
- **Fixed list.** A pick takes the matching ids in their order then and opens page 1. Edits under the filter neither
  hide nor move a row; an added or copied question joins the list. ↑ / ↓ are off under a filter, with one line saying
  why.
- **↑ / ↓** move a question one bank place, across difficulties (the plain `shiftQuestion`).
- **Resets.** A search, save-error or undo jump to a hidden question resets the phase to 全部 with 「已回到「全部」，才看
  得到那一題」. An emptied filter loosens category first, then difficulty. Filters live in the page per phase index and
  reset on a new load or a phase count change; they survive tab switches.
- **Row tag** 「動漫・難度 3」 on each collapsed boss row (only the difficulty where there is no category row).
- The difficulty hint now reads its default from `DEFAULT_BOSS_DIFFICULTY` (it said 5).

Pure logic: `lib/bank-editor-categories.ts` (tests in `lib/bank-editor-categories.test.ts`). No bank format or Worker
change.

## Not in scope

- The difficulty pools (one difficulty each, no categories).
- Showing the shuffled or fresh-first deal order.
- A ⚠ on chips, pre-filling a new question from the picked chips, persisting filters, renaming a category in bulk.
