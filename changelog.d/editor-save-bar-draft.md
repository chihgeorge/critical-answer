---
bump: minor
---
### Added
- Question bank editor: the save button sits in a save bar fixed to the bottom of the screen, which says whether there are unsaved changes; a tab with unsaved changes shows a 「●」.
- Question bank editor: a refused save opens the tab and page of the problem, outlines the question in red and shows the message above the save button and on the question; 「下一個 ▸」 walks through every problem, and a fixed one disappears without saving again.
- Question bank editor: unsaved edits are kept as a draft in the browser (never the owner key). The next load of the same bank offers 「還原草稿」 or 「捨棄」, and warns first when the bank was saved elsewhere after the draft started.

### Changed
- Question bank editor: messages name the group, number and start of a question (「難度 2 第 12 題「…」」, or 「（空白題）」), never an internal id or an upload key. Empty fill-in answers and boss phases with no questions are caught before the server, and a server refusal is shown in Chinese with the question's place.
- Question bank editor on a phone: the 「題目」/「詳解」 labels no longer wrap into a vertical column, the media buttons are one row that scrolls sideways, the correct option has a big radio and a green outline, and answer fields and their buttons wrap. The owner key box is labeled 「站長金鑰」 and shrinks to one row once a bank is loaded; the remaining English messages are in Chinese.
