[繁體中文](hosting.md) | English

# Hosting guide

What the host needs to know on the day of the event: opening a room, running the game, and how to recover when something goes wrong. For the rules themselves, see the [full rules](rules.en.md).

## Opening a room and the lobby

The host presses 「主持遊戲」 (host a game) on the home page and lands on the host page (`/room/<code>/host`). The big-screen URL is at the very top of the host page; open it on a TV or projector (`/room/<code>/screen`).
Each team joins by entering a team name and the 4-character room code on a phone, or by scanning the QR code in the lobby. A team name cannot match a team that has already joined; names that differ only in upper/lower case or full-width/half-width characters count as the same name. While waiting, the phones show every team that has joined. In the host page's lobby, each team has 「改名」 (rename; same rules as joining) and 「移除」 (remove): a removed phone shows 「主持人把你們的隊伍移除了」 (the host removed your team), it is not added back by reconnecting on its own, and it can join again only by going back to the home page and opening the room again. The host presses 「開始遊戲」 (start game).

While waiting for people, the middle of the big screen is a campfire; as each team joins, its character runs in to stand around the fire. The room code and the join QR code are here too.

## How-to-play slides

Above 「開始遊戲」 is 「開始前播放玩法說明」 (show how to play before starting). It is checked by default in a new room, and unchecked by default after 「回到大廳，再玩一場」 (back to the lobby, play again). When it is checked, the big screen first shows 4 pages of explanation (taking turns, answering on the phone, what happens on a wrong answer, how to win), and the host page has speaker notes for each page. Press 「下一頁 ▶」 (next page) (or keyboard → / Enter; ← goes back a page) to turn pages; on page 4, the first question, the opening sound and the narration come only after 「開始冒險 ▶」 (start adventure). While the slides play, the phones show 「看大螢幕 👀」 (look at the big screen) and the current page number; when the big screen's voice is on, it reads the owl's line. See [docs/designs/how-to-play.md](designs/how-to-play.md).

## The big screen

**Live map**: during the game, the top of the big screen is a dungeon map strip (it replaces the old team cards). Each team is a small token marked with the first character of its name, and moves into the next room on a correct answer; after the leading team there is fog, so you cannot see how many rooms are left. The boss room starts as a closed door; it opens when the first team goes in, showing the boss and its health bar. The token of the team whose turn it is has a ▼ above it; offline teams show 「zz」. The map shows no scores. Design in [docs/designs/live-map.md](designs/live-map.md).

**Dungeon master (narration)**: after each judgment, the owl wizard first says the result, then calls the next team; it also makes a special announcement when a team enters the boss room. Teams whose turn it is not see on their phones whose turn it is, which monster they face, their own reward points and the same narration line. When the game ends, the big screen shows the podium right away (when the boss is defeated, once the finishing blow's 4 dice have stopped), followed by an epilogue. Narration uses scripted lines by default; with an API key it can be written live by Claude instead (see [AI narration](#ai-narration) below). In the bottom-right corner of the big screen is a voice switch (it reads the narration aloud with the browser's built-in Web Speech API). It is off by default, and its state is saved on that device; browsers without the speech API do not show this button. Next to it is a 「🎵 音樂」 (music) switch: when it is on, the big screen plays background music synthesized by the program, and judgments have sound effects too (the music lowers on its own while the narration is read aloud). It is also off by default and saved on that device.

**Screen stays awake**: while the host page and the big screen are open, they ask the screen to stay on (Screen Wake Lock), and ask again after you switch away and come back. If the browser does not support it, refuses on low battery, or the page is not on HTTPS (for example an `http://` URL in a LAN test game), the screen sleeps as usual.

## AI narration

By default the narration is scripted: no key, no cost. In the lobby's 「AI 旁白」 (AI narration) area the host picks one of:

- **No AI**: scripted narration (default).
- **Use my own Anthropic API key**: paste your own key and press 「驗證並使用」 (verify and use). The server first calls Anthropic once to confirm the key is valid, and only then turns it on. The key is saved in this browser (localStorage) only if you check 「記住這台電腦」 (remember this computer); otherwise you must paste it again after a reload. Use a dedicated key, and set a spending limit in the Anthropic Console.
- **Owner key**: enter the site owner's `OWNER_KEY` to use the server's own `ANTHROPIC_API_KEY` instead. This works only when both are set on the server.

Each room allows at most 300 AI narration lines by default (the host can change this, up to 5000). When they run out, the host is asked whether to raise the limit or switch back to scripted lines.

The host's key is kept only in the room's memory: it is never written to a snapshot, never logged, and never sent back to any screen; the host page shows only its last 4 characters (see [SECURITY.en.md](../SECURITY.en.md)). After a server restart it must be pasted again. The owner key is read only on the server (the Worker); do not give it a `NEXT_PUBLIC_` prefix, or it ends up in the browser. Narration uses `claude-haiku-4-5`, and the end-of-game epilogue uses `claude-sonnet-5-5`. Each narration line waits at most 3 seconds (15 seconds for the epilogue); on a timeout, an error or unusable content, a scripted line is used instead. After 3 failures in a row, or when the key is refused (401/403), the whole room switches to scripted lines. Team names typed by players go into the prompt only as data; questions and answers never go into the prompt.

> **Cost**: AI narration turns on only with the host's own key or the owner key, and each room has a line limit; for the owner key's spending limit, see the [deployment guide](deployment.en.md#keys-for-ai-narration).

The host page's `⚙ 更多` (more) has director notes (for example 「用武俠口吻」 (in a wuxia tone)), rewriting the current narration, 「下一句這樣說」 (say this next: queue a line of at most 40 characters, which the next narration says as its second sentence; see [docs/designs/host-next-line.md](designs/host-next-line.md)), and a narration log download (each line's event, the scores at the time, source, latency and fallback reason; it is lost after a server restart).

For the owner key and server-side settings, see the [deployment guide](deployment.en.md#keys-for-ai-narration).

## When things go wrong

**Disconnect notice**: when a phone or the big screen disconnects, it shows 「連線中斷，重新連線中…」 (connection lost, reconnecting…). When a phone reconnects, it tells the team whether it was skipped while offline, or how many questions were judged in that time.

**Cannot connect, or refused to join**: if a phone, the big screen or the host page has not connected within 10 seconds of its first try, it shows 「連不上伺服器：請檢查網路，或稍後再試。」 (cannot reach the server: check the network, or try again later) and a 「重試」 (retry) button. When the room refuses a phone, the phone gives the reason in one sentence (the game has already started, the team name cannot be used, the team name is already taken, the room is full, the team data saved in the browser does not match, the password is wrong or required, the team was removed by the host), with a link: password problems go back to the password entry, everything else to the home page.

**Moving a team to a new phone**: after the game starts, if a phone runs out of battery, or the team switched browsers or used a private tab, each team on the host page has 「交給新手機」 (hand to a new phone). Pressing it shows a 4-character pairing code (if the team is still online, the host is asked to confirm first). The new phone opens the room URL, enters the pairing code on the refusal screen at 「換了手機？輸入主持人給的配對碼：」 (changed phones? enter the pairing code from the host:), and presses 「接手隊伍」 (take over team); it then rejoins as this team, with its scores and turn intact. A pairing code works only once and is valid for 5 minutes; pressing the button again gives a new code. After 5 wrong entries in the room, every pairing code still valid is cancelled, and the host must press the button again. The old phone can still play for the team if it comes back. Design in [docs/designs/team-handoff.md](designs/team-handoff.md).

**When the page breaks**: when a page crashes, it shows 「畫面出錯了」 (something went wrong on screen) and a 「重新載入」 (reload) button instead of a blank white page; reloading goes back to the game, with scores and progress intact. Each crash sends a one-line report to the Worker (`POST /api/client-error`); in the Worker log it is JSON like `{"event":"client_error",…}`.

## Known limits

- **Unused rooms rest, then are forgotten**: when a room has had no state-changing action for 2 hours (joining, starting, judging, notes and so on; downloading the narration log does not count), it closes every connection with close code 4001, and the game progress is kept. All three screens show 「房間休息中」 (room is resting) and **no longer reconnect on their own**; press 「重新連線」 (reconnect) to rejoin the same game. This keeps a TV left on from being billed all night (the Cloudflare free plan has 13,000 GB-s per day; one room open for a full 24 hours uses about 83%). After 24 hours with no action, the room is wiped and its code released; screens still connected get close code 4002 and show 「房間已過期」 (room expired), and reconnecting leads to a brand-new empty lobby. Automatic reconnects do not count as actions, so a TV left on does not keep a room from ever resting. The times can be changed with the environment variables `ROOM_IDLE_MS` and `ROOM_EXPIRE_MS` (milliseconds). If a room created with 「主持遊戲」 on the home page happens to hit a code still used by someone else, the host page switches to a new code on its own; opening a link to an existing room never changes the code.
- **Host identity rests on a key**: when a room is created, the browser makes a key and puts it in the URL's `#k=`. The first device to claim the room with it becomes the host, and the same key can later take over from another device. The only protection is this key plus the 4-letter room code, so **do not give the host URL to players**.
- **Team identity**: team IDs are public (every state broadcast carries them), so each team also has a secret key kept only in its own browser, which it must show when reconnecting. Someone who gets a team ID still cannot pose as that team. Rooms have no password by default: anyone who knows the 4-character code can join (at most 8 teams and at most 60 connections per room). The host can set a **join password** in the lobby; after that, new teams must enter the password to join, and teams that already joined do not need it to reconnect. Set a password for a public URL.
- Monster art: the first two rooms are a slime and a ghost; rooms 3–5 each have their own monster (lost slime, crybaby ghost, gatekeeper slime king); rooms 6–8 reuse the earlier art in a new color (grumpy ghost, lava slime king, frost crybaby); the boss is a little black dragon.
- At most 8 teams. With many teams and many rooms, the big screen's live map folds the earlier rooms into the entrance cell at the far left so the map fits on screen; this has not been tested with real people yet.
- Only a simple single-session use is supported at a time; there is no design for several games running in parallel.
