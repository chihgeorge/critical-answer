### Fixed
- A player can no longer find the answer to a music question by looking up its video on YouTube. The room used to send every YouTube question's video id to every phone and to any page opened at `/room/<code>/screen`. It now sends the id only to the host page and to a big screen opened with the big screen link on the host page, which carries a new per-room screen key (`#k=…`).

### Changed
- Open the big screen with the full link shown on the host page. A big screen opened with only the room code still shows the game, but in place of a question video it says 「請用主持人頁上的大螢幕網址開啟，才會播放影片」. The link stays the same when the host page reloads and after a server restart; 回到大廳 keeps it too, and a room that expired and was opened again gets a new one.
