---
bump: minor
---
### Added
- 手動控制停頓 (manual pacing): the host page header has a 「自動｜⏸ 手動」 switch between the room code and 「⚙ 更多」, usable at any time. In 手動 the pauses the room used to time itself wait for the host: the 擲先攻 rolls and the order, the reveal after 公布答案, the crit and kill dice, a boss miss, the boss's phase card, a fork's 15 seconds and its door opening, and the start of the podium. The host page shows 「⏸ 停在這裡：…」 with what comes next, and 「▶ 下一步」 (keyboard `1` or Enter) moves on. At a fork the step is the same as time running out. The answer countdown still runs. Switching back to 自動 runs the held pause again from its start. The mode is saved with the room. Guide in `docs/hosting.md`, design in `docs/designs/manual-pacing.md`.

### Changed
- Every text on the phones, the host page, the narration and the rules now writes 叉路 and 叉路口 with 「叉」, as the big-screen title already did.
