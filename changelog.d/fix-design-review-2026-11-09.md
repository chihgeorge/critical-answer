### Fixed
- Host page on a narrow phone (360px): a team's row no longer cuts the team name to two characters. The name and scores take the first row, and 指定下一題, 給藥水 and 交給新手機 fit the second.
- Host page: the manual-pacing panel 「⏸ 停在這裡：…」 no longer leaves one character alone on the last line. What comes next drops to its own line whole. 「大螢幕正在揭曉：…」 and the fork card break the same way, and the 「替…選・重答」 / 「逃跑」 buttons keep the action on one line.
- Host page: the 地城主旁白 row shows its whole summary (「3 句・念到第 2 句」) instead of cutting it off, and the question picker's 關閉 button no longer breaks into two lines under a long title.
- Host and player pages: the turn ribbon is a little smaller on a phone, so the boss fight's 「首領戰　輪到：」 no longer leaves room for only one character of the team name.
- Big screen: the result bar under the dice (擲先攻's order, the boss kill's sum, the warrior's and crit rolls) has space at its sides, so the text no longer touches the outline.

### Security
- The room now drops any WebSocket message over 4096 bytes before reading it. The largest real message is about 2.5 KB, so players and hosts are not affected. A dropped message gets no reply and the connection stays open, the same as a message over the rate limit.
