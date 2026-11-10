---
bump: minor
---
### Added
- 中途加入 (late join): a team that joins after the game started is no longer turned away. Its phone shows 「等主持人讓你們加入…」 and may pick a class meanwhile; the host page shows 「🚪 <隊名> 想中途加入」 with 「收這隊」 and 「不收」 under the team rows. A team let in starts in the first room, goes last in the turn order (no 擲先攻), and starts level with the team in last place: the lowest 飽足感 (reward) and the lowest progress any team has. 「不收」 tells the phone 「主持人這場沒有收你們的隊伍」. Once any team is in the boss room nobody is let in: waiting phones show 「這場快結束了，等下一場」, and 「回到大廳」 puts them in the next lobby. Waiting teams count toward the 8-team limit and survive a server restart. Guides in `docs/rules.md` and `docs/hosting.md`, design in `docs/designs/late-join.md`.

### Changed
- A new phone that opens the room after the start now finds the 「換了手機？輸入主持人給的配對碼」 input on the waiting screen, not on a refusal screen.
