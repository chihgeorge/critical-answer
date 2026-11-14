---
bump: patch
---
### Changed
- The question bank editor shows each difficulty tab and each boss phase 10 questions at a time. Pager rows above and below the list show 「第 11–20 題，共 34 題」, the previous and next buttons and the page numbers. Each question carries its number in the group, adding a question opens its page, and a save error names the group and the number (for example 「難度 1 第 12 題」).
- A stored YouTube video shows in the editor as its full `https://www.youtube.com/watch?v=…` link. The bank still stores the id, and every paste form still works.

### Fixed
- The editor's question text and text explanation fields wrap long text over several lines in place of one long scrolling line. A pasted line break becomes a space, as before.
- The question type menu keeps its own height in place of stretching to the height of the row.
