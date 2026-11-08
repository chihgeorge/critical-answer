# Changelog

All notable changes to Critical Answer are documented here.

## [0.53.0.0] - 2026-11-08

### Added
- Event rooms. When a correct answer walks a team into its next room, there is a 25% chance the room holds an event instead of a monster. There is no draw on entering the boss room or the last room, or on leaving an event room. The team's phone shows one button, and pressing it is the team's whole turn: the big screen acts the event out, and the host presses 下一題 to pass the turn. The six events, drawn evenly: a chest with a delicious dish (+20 satiety) or a terrible one (−10, never below 0); a spring (one more class ability use, or +10 for a chef or a team with no class); a skull idol (curse: the next correct answer pays half its base reward); a fairy (blessing: the next correct answer pays an extra half); and a fortune teller whose lot is 大吉 (+25), 中吉 (the spring) or 凶 (the curse). The curse or blessing lasts until the team's next correct answer, and the big screen and the phone show it over the team's question. After 15 seconds without a press, the host page offers 「替{隊名}按」. Scripted and AI narration set the scene without spoiling it and read the outcome. The game record lists each team's events. A room restart keeps a drawn event; nothing is redrawn.

## [0.52.0.1] - 2026-11-08

### Fixed
- When 5 to 8 teams roll a podium tie-break together, every die now stays on the big screen. Each name under a die is cut to the die's width, so 8 teams with long names no longer push the outer dice off the stage. The result bar now says 「點數最高的 N 隊上台」 instead of listing every team and roll again; with 8 teams that list ran to 2–4 lines. When a tie on the podium has to roll again, it says 「同點的重擲！」. A tie of 4 teams or fewer looks the same as before.
- A tie-break result no longer says 「同點的重擲」 when the tied teams are all below third place. Nobody rerolls there, so the big screen promised a roll that never came.
- When the host presses 結束冒險 while the big screen is still reading the last narration, the podium waits for it. The first place call starts 1 second after the screen reports the last line read, or after 20 seconds at most if no screen reports. While it waits, the big screen keeps that narration up instead of 「…」 and goes on from the line it had reached, rather than typing it again from the top. Before, the reveal started 4 seconds after 結束冒險, and the first call cut the narration off.

## [0.52.0.0] - 2026-11-08

**Deploy note:** deploy the room server (`wrangler deploy`) before the website. Until it is, a game started from the new host page starts as before, in lobby order.

### Added
- 擲先攻 (initiative roll) at the start of every game. After the stone doors open, each team presses 「🎲 擲骰」 on its phone to roll a d20, and the big screen shows every team's die in a row, with a countdown. The highest roll goes first; tied teams are rerolled by the room until the tie is broken, and the big screen shows each reroll. A team that has not rolled after 15 seconds is rolled for. An offline team gets the same 15 seconds, so a phone that locked during the intro can still come back and roll. The host page has 「🎲 全部代擲」 to roll for everyone left at once. The order holds on the big screen for about 4 seconds, then the first team plays. The opening narration introduces the teams in this order. The order and the rolls survive a server restart. The doors and page 1 of the how-to-play picture no longer name the first team, because it is not known yet.

## [0.51.0.1] - 2026-11-08

**Deploy note:** deploy the room server (`wrangler deploy`) before the website. A new host page talking to an old room server never sees its key confirmed, so 記住這台電腦 saves nothing until the server is updated. No migration.

### Fixed
- The host now keeps seeing why a key was refused. A refused key's error (`invalid_key`, `wrong_owner_key`, `owner_unavailable`, `check_failed`) went out once; the next AI narration's status had no error and replaced it. The room now keeps the last key's error and sends it with every AI status until the host sends another key. A newer failure of the key in use (AI stopped, or the key refused mid-game) replaces it.
- With the owner key already in use, a wrong OWNER_KEY counted as applied on the host page. With 記住這台電腦 ticked it was saved in the browser and resent after every reconnect. The page guessed from what the status looked like, so a narration's status, a reconnect, or an own key with the same last 4 characters could also make a refused key count. Each key the host sends now carries an id, and the room's status names the id of the key in use; the page saves a key only when its own id comes back.

## [0.51.0.0] - 2026-11-08

### Changed
- The five classes are closer to even. In a simulation of 4 teams with random classes, the thief used to win 35–46% of games, while the warrior and the mage did no better than a team with no class. Now every class wins 21–32% at low, normal and high accuracy (a team with no class: about 14%).
  - Thief: a correct answer after 偷襲 gives 1.5× the reward points (was 2×), rounded half up. The boss still loses 2 hearts.
  - Warrior: 4 rolls per game (was 2), and 6 or higher on the d20 counts as correct (was 12).
  - Mage: 4 uses per game (was 2).
  - The cleric and the chef are unchanged.

## [0.50.0.0] - 2026-11-08

### Changed
- Narration tells the first team into the boss room from the teams that come after. The first team still gets the door-opening lines. The 2nd and later teams get new 「加入戰局」 lines, because on the big screen the door is already open. Teams the host sent with 送去魔王 count in the order. The line for a team that walks in after phase 2 has started no longer says it pushed the door open. The AI narration prompt now says whether this team opened the door or is the Nth team to join the fight. The line that hands the turn to a team in the boss room no longer says the boss 「擋在最後一道門前」.

## [0.49.0.0] - 2026-11-08

**Deploy note:** deploy the room server (`wrangler deploy`) before the website. Until it is, the bank editor's download link returns 404. No migration: the records live in the existing bank Durable Object.

### Added
- Every finished game leaves a record, for tuning the boss HP and the boss-entry score: how many rounds each team took to reach the boss room, how many rounds the boss fight took, the boss's HP per phase and the HP left, each team's class and score, the entry score, the rewards, and the start and end time. No question or answer text. It is stored next to the question bank and also printed to the Worker log. A failed store never stops the game. A game ended before anyone answered is not recorded, the download has the newest 1000 games, and a game already running at deploy time is marked `partial`.
- In the bank editor, 「⬇ 下載對局紀錄（JSON）」 under 「載入題庫」 downloads the newest games' records (owner key only, `GET /api/game-logs`).

## [0.48.0.1] - 2026-11-08

### Fixed
- In the bank editor, an edit made right after the bank appeared could be lost. If the owner key was typed before the page was ready, the page also loaded the bank on its own. That load could land first, and the 載入題庫 click's load then replaced the edit. The questions are now locked while a load or a save is in flight. This was why the bank-editor multiple-choice test failed now and then in CI (on main, after #150).

## [0.48.0.0] - 2026-11-08

### Added
- The host can turn a mistaken 答錯 on a fill-in question into 答對. After 答錯 (also 答錯・重答, 答錯・逃跑, or a cleric's wait and the 重答 or 逃跑 after it), a white button 「↩ 剛才的〇〇改判答對」 appears under the judge buttons, with key 0 as its shortcut. Pressing it ends the turn exactly as if the host had judged it right: score, reward, class abilities, the dish and the narration all follow the correct path. The button stays until the game's next move; a phone going offline or coming back does not close it. A 祈禱, a multiple-choice or sort question and a warrior's roll cannot be changed. The button waits half a second before it takes a press, so a double tap on 答錯 cannot land on it.

## [0.47.0.1] - 2026-11-08

### Added
- Two e2e tests for the cleric in the boss room. After a wrong lock the phone offers 祈禱 and 不用. 祈禱 spends a use and gives the team a new boss question in the same turn. 不用 spends nothing, and the boss moves on to a new question.
- A lint rule rejects reading `e.target` or `event.target` inside a function passed to a `set*`, `update*` or `onUpdate` updater in `app/`, `components/` and `lib/`. React can run that updater after the input was reset, so the typed value is lost (the bug fixed in 0.44.0.1). The rule checks names only: a destructured `target` or an alias gets past it.

### Fixed
- A bank-editor read-only test could end while an older load was still inside its route handler. Its `route.fetch` then threw "Test ended", and the next spec file did not run (CI on PR #146). The test now waits for every route handler before it ends.

## [0.47.0.0] - 2026-11-08

### Added
- The big screen opens the game with stone doors: 冒險開始！ and the first team's name, then the doors part to show the first room (about 2 seconds).
- The first time the boss room comes up, a 首領出現！ alarm banner sweeps across the big screen with the boss's name (about 2.5 seconds), with a siren when 🎵 music is on.
- With the computer's reduce-motion setting on, each transition shows one still frame instead. A big screen opened or reconnected mid-game never replays either one. The question and narration underneath carry on as usual.

## [0.46.0.0] - 2026-11-08

**Deploy note:** deploy the room server (`wrangler deploy`) before the website. Then reload every phone, big screen, host page and bank-editor tab before you save or play a bank with a sort question. An old tab does not know sort questions. A bank without a sort question is still saved at format 3, so a rollback reads it as before. After a sort question is saved, rolling the room server back makes it load the bundled bank instead and resets the rooms that are running.

### Added
- A new question type, 排序題 (sort question). The team gets four items in a shuffled order. On the phone, they drag each row by its ☰ handle (or move it with the arrow keys) into the order the question asks for, then lock. The host taps 公布答案 and the room judges it. Only a fully correct order counts.
- After a wrong lock, the phone and the big screen mark each place ✓ or ✕ and never show the answer. The team may 重答 from the same order or flee, as for a multiple-choice question.
- When the answer is right, the big screen shows the correct order, numbered 1 to 4. The host page shows the locked order and the answer.
- Classes work on sort questions as on multiple choice. The warrior's 20 counts as correct, a correct answer can crit, the cleric can pray, and the chef adds its share. The mage shows the first item to everyone (「🔮 第 1 個：…」), once per question.
- The bank editor can write sort questions: four items, entered in the correct order. It refuses an empty or repeated item.

## [0.45.0.0] - 2026-11-07

**Deploy note:** deploy the room server (`wrangler deploy`) before the website, then reload the host page, the big screen and the phones. An old room server refuses the new class, so a phone that taps 🍳 廚師 before the room server is updated gets nothing. Do not roll the room server back to an older version while a game with a chef is running: the older version cannot read that room and starts it over.

### Added
- A 5th class, 🍳 廚師. It has no button: every time the team scores, it gets 15% more, rounded, at least +1. The 15% is on the whole score, after the thief's sneak, a critical hit and the boss's 4d20.
- The big screen's dish card shows the chef's share, for example 「+23 飽足感（🍳 廚師 +3）」. The phone's correct-answer line shows 「答對了！＋23 分（廚師 +3）」.
- On the phone's class picker the chef card spans both columns. The phone and the host page show 「被動」 for a chef instead of the uses left.
- `node scripts/balance-sim.ts [games]` plays many 4-team games and prints each class's average score and win share.

## [0.44.0.1] - 2026-11-07

### Fixed
- In the bank editor, a question's 題幹 (prompt), a fill-in answer, a multiple-choice option or a new question type could now and then be lost right after typing, and the save then went out without it. The editor now keeps what was typed. This was also why three bank-editor tests failed now and then in CI.

## [0.44.0.0] - 2026-11-07

**Deploy note:** no reseed is needed. Deploy the room server and the website. The live bank was saved before this change, so it keeps its own monsters: to turn the draw on, open /bank-editor, tick 「每場隨機抽怪」 and save. If you roll back the room server after saving, the older server drops the setting on its next save.

### Added
- A bank can draw its monsters fresh each game. With 「每場隨機抽怪」 ticked in the bank editor, every room gets a different room monster (no repeat until all 20 have appeared) and the boss is any of the 3 bosses. Over many games, each monster comes up about as often as the others.
- The default bank has the draw on.

### Changed
- With the draw on, the bank editor greys out the room and boss monster pickers, because the game does not use them.

## [0.43.0.1] - 2026-11-07

### Changed
- New tests check that a page meeting a monster it does not know still draws a slime and serves the slime's dish. They also check that every monster keeps its own dish picture. Test-only; the game itself is unchanged.

## [0.43.0.0] - 2026-11-07

**Deploy note:** no reseed is needed. Deploy the room server (`wrangler deploy`) and the website, then reload the big screen and the phones. Until both are deployed, the end screen shows the full podium at once, as before. Do not deploy during an event.

### Added
- Before the final scores, the narrator calls the podium from third place to first, and the big screen shows each team as it is called. The scores, the crown and the epilogue come up only after first place.
- First the narrator names 「本場大成功王」, the team that rolled the most natural 20s, with its own card on the big screen. Nobody rolled a 20? This part is skipped.
- With AI narration on, the AI writes the calls; with it off, or when an AI line would give away a higher place, the calls are scripted.
- A tie that changes the top three is settled with d20 rolls, shown on the big screen just before the place it decides. Teams that roll the same number roll again.
- After a boss kill, the reveal starts once the boss is cooked and served.

### Changed
- Tied teams no longer share first place. The tie-break dice decide the podium.
- Phones show the places about 1 second after the big screen, so a phone never gives away first place. Until then they show 「冒險結束！看大螢幕 📺」.

### Fixed
- A big screen that reloads or reconnects during the reveal picks up at the current place instead of starting over. A room server that restarts keeps the reveal's timing.
- Under reduced motion, the big screen shows the final podium at once.

## [0.42.0.0] - 2026-11-07

**Deploy note:** no reseed is needed. Before you save a bank that uses one of the new monsters, wait until both the room server and the website have finished deploying, then reload the host page, the big screen and the phones. A page opened before the deploy does not know the new monsters.

### Added
- 17 new room monsters to pick in the bank editor, each with its own picture and dish: 碎碎蘑菇, 倒掛蝙蝠, 喀啦骷髏兵, 寶箱怪, 毛毛蜘蛛, 慢吞吞蝸牛, 鬼火精, 小石魔像, 地底水母, 沼澤胖蛙, 蠟燭精, 尖叫曼德拉草, 浮游眼球, 鐵殼螃蟹, 骰子怪, 南瓜頭 and 刺刺仙人掌. With the 3 existing ones, there are now 20.
- 2 new bosses: 深海大王烏賊 (cooked into 大王烤魷魚) and 不死火鳥 (cooked into 不死鳥烤全雞).

### Changed
- The default bank's 8 rooms now meet 8 different monsters.

### Fixed
- A page that meets a monster it does not know draws a slime instead of showing 「畫面出錯了」.

## [0.41.0.0] - 2026-11-07

**Deploy note:** deploy the room server (`wrangler deploy`) before the website, then reload the host page, the big screen and the phones. Edits now name a line and a revision, so an old website's edits are refused until it is reloaded. Do not deploy during an event.

### Added
- A 「地城主旁白」 panel sits right above the host's judge buttons. Collapsed, it is one row with a summary such as 「3 句・念到第 2 句」; opened, it lists every line the big screen will say for the next team.
- The host can rewrite any line the big screen has not read yet. Tap 「改」 on that line, type, and press Enter or 「換上大螢幕」. The big screen and the phones pick up the new text from that line on, and the voice reads it.
- The big screen tells the host how far it has read. Lines already read show 「✓ 已念完」 and can no longer be changed; the line being read shows 「▶ 念到這」.
- While the AI narration is being written, the panel shows 「旁白生成中…」.
- If a line was read or replaced while the host was typing, the draft is kept with a red note, and 「改排進下一句」 queues it for the next narration instead.

### Changed
- 「下一句這樣說」 moved from ⚙ 更多 into the narration panel.
- The big screen speaks one line at a time, and moves on even if the browser never reports that a line finished.

### Removed
- 導演筆記 is gone from ⚙ 更多, and the AI prompt no longer has a notes section.
- 「改寫旁白」 is gone from ⚙ 更多; the narration panel replaces it.

## [0.40.0.0] - 2026-11-07

**Deploy note:** back up the live bank first (`curl` in docs/question-bank.md, rescue item 4), before this merges: after the deploy, the server no longer hands out the old bank. Then deploy the room server (`wrangler deploy`) and the website, reload the bank editor, the host page, the big screen and the phones, and save the bank once in the editor (or convert the backup and save it). Rooms in play when the server restarts are reset. Do not deploy during an event.

### Added
- A monster catalog: each room and the boss now pick their monster from a list (軟趴趴史萊姆, 害羞幽靈, 愛哭幽靈 for rooms, 深淵小黑龍 for the boss). The bank editor shows a picker with each monster's sprite and dish instead of name, sprite, colour and dish fields.
- A monster met again looks a little different each time it is defeated. It gets a new colour, a hat (crown, party hat, flower, headband, bow or pirate hat) and a matching title before its name, such as 「戴王冠的軟趴趴史萊姆」. The first meeting is plain, and the boss never changes. A team keeps the look it walked into the room with, whatever other teams defeat meanwhile.

### Changed
- Banks are now format 3, and a room or the boss names its monster by catalog id. The editor refuses a monster that is not in the catalog, a room monster on the boss or the boss in a room.
- A stored bank in an older format no longer goes read-only. The editor shows a yellow notice with its format, loads the default bank, and saving replaces the old one. The server keeps a copy of the old bank, and holds the old bank's pictures for 14 days before deleting them.
- A dish now comes from the catalog with its monster, so the editor has no dish fields.
- If the bank editor opens while the room server is still the old version, it says so in red and does not let you save.

## [0.39.0.0] - 2026-11-07

**Deploy note:** deploy the room server (`wrangler deploy`) before the website, then reload the host page, the big screen and the phones. This release adds a new host message (🍲 上菜) and makes 下一題 wait for it. A host page from before it only sends 下一題, so it gets stuck on a reveal with a dish until it is reloaded. Do not deploy during an event.

### Added
- After a correct answer, the big screen shows the monster the team just defeated, and its dish waits for the host. The host's button reads 「🍲 上菜」: the monster goes into the pot, bubbles 「咕嘟咕嘟」, vanishes in a puff of smoke with 「砰！」, and 1.6 s later the dish appears with its card. The button reads 「🍲 上菜中…」 until the cooking is over, then 「下一題」.
- Each kind of monster has its own pixel dish, drawn in the monster's colour.
- A short cooking sound (two bubbles and a 砰) plays with it, and a playing video pauses when the host serves.
- When the boss falls, the end screen cooks the boss first. Only 冒險結束 and 最後一擊 show until the big dish is served, and the podium, the winner and the epilogue appear about 4.6 s later. Phones say 「冒險結束！看大螢幕 📺」 until then.
- Phones show 「🍲 今晚的菜：{dish}」 once the dish is served.

### Changed
- The narration no longer names the dish before it is served. The big screen says 「上菜！」, then reads the dish line aloud once it appears.
- The ribbon over the stage names the team that eats the dish: 「🍲 {team}」.
- With reduced motion turned on, the big screen skips the frames and shows the dish at once, and the end screen goes straight to the podium. A screen or phone that reloads or reconnects also skips the cooking and goes straight to the dish or the podium.

### Fixed
- The bundle leak check now also reads each question's text content and 題幹, not only the old text field, and no longer crashes on a question with no content.

## [0.38.0.0] - 2026-11-07

**Deploy note:** deploy the room server (`wrangler deploy`) before the website, then reload the big screen and the host page. This release adds a new host message (▶ ⏸ ⟲) and a new field in the room state. A host page from before it shows no play buttons, and an old big screen cannot play the video. Do not deploy during an event.

### Added
- YouTube questions now play on the big screen under the host's control: ▶ ⏸ ⟲ on the host page start, pause and restart the video. Each question can set a start and end time (for example 1:05 to 1:20), so only that part plays.
- Music questions: tick 「只放聲音」 and the big screen covers the video with a pixel music card that reads 「聽歌猜題」. Its equalizer moves while the song plays, and the card shows how long the clip is. The title and the picture stay off the big screen and the phones while the question is open.
- An image or YouTube question can have a short 題幹 (up to 200 characters) above the video, for example 「這首歌的歌手是誰？」.
- Phones no longer play the video. They show the 題幹 and 「看大螢幕 ▶」 or 「聽大螢幕 🎵」, so the sound does not echo from every phone.
- When a team answers, the video pauses. The answer reveal keeps the same video beside the dish card, and the host can play it again.
- The background music goes quiet and the narration stops while a video plays, then the music comes back when it pauses or ends.
- If the video cannot load (blocked, removed, no network), the big screen says 「影片無法播放」, and pressing ▶ again tries once more. Until someone taps the big screen, it says 「👆 點一下大螢幕 才能播放聲音」, because browsers block sound before a tap.
- The bank editor has fields for the 題幹, the start and end times and 「只放聲音」, plus a 「▶ 試聽片段」 preview. It refuses to save a time it cannot read or an end before the start.

### Changed
- The question-bank and hosting guides (Chinese and English) explain video and music questions, the time format and the ▶ ⏸ ⟲ controls.

## [0.37.0.0] - 2026-11-06

**Deploy note:** reload the big screen after this release deploys. A big screen from before this release draws the kill's four dice as a single warrior roll for that one beat. Do not deploy during an event. A restart inside the 4 s kill beat drops the kill, and the team answers the final blow again.

### Added
- The killing blow on the boss now rolls its 4d20 kill bonus on the big screen first. Four dice tumble and land one by one, half a second apart, while the total adds up below them: 「9 + 14 + 3 + 17 = 43 分」. A thief's sneak attack shows the doubling: 「43 × 2 = 86 分」. The points are added and the podium appears only after the dice land, about 4 s later.
- Phones show a 「?」 die and 「最後一擊！擲 4d20 擊殺獎勵，看大螢幕 ▶」 during the roll. The host page says 「大螢幕擲 4d20 擊殺獎勵後結算」.

### Changed
- The rules guide now says the kill bonus dice roll on the big screen before the points are added, and the hosting guide says the podium waits for them.
- The README's "install it with an AI" step no longer points the AI at AGENTS.md. It points at CLAUDE.md.

## [0.36.0.0] - 2026-11-06

### Added
- The README, SECURITY.md and the five guides in `docs/` now have English versions (`README.en.md`, `docs/rules.en.md` and so on). The first line of every doc switches between 繁體中文 and English.
- CI now checks that each Chinese doc has its English version, that both open with the switch line and have the same headings, and that no English doc is left without a Chinese one.

### Fixed
- The room-lifecycle end-to-end test no longer fails at random. Its idle time was as short as one beat of a correct answer's reveal, so the room could close before the judgment arrived.

## [0.35.2.0] - 2026-11-06

### Changed
- The README now fits on one screen. It covers what you need, how to install it yourself or hand the install to an AI, how to let phones join, and a table of who does what on the day. A screenshot shows the host page, big screen and a phone side by side.
- The rest moved into five guides under `docs/`: full rules, a hosting guide, a deployment guide for your own Vercel and Cloudflare accounts, a question-bank guide and a development guide.
- The bank editor's read-only warning now points to the question-bank guide's 「題庫卡住時怎麼救」 section.
- The docs now say Node.js 22.18 or later is needed.

### Added
- CI now checks that every relative link and `#` anchor in the README, SECURITY.md and the `docs/` guides still resolves.

## [0.35.1.0] - 2026-11-06

**Deploy note:** reload open phones after this release deploys to see the new check label. Phones from 0.35.0.0 keep working without a reload.

### Fixed
- A natural 20 on a persuasion check now wins even when the room restarts during the 2 s roll. Before, the restart dropped the win and the team had to answer normally. The room now gives the win once that team is on turn again, after any judgment, reveal or phase card in progress has finished.
- A passed check with no hint now says why. The phone shows 「過了！提示法師已經給了」 when the mage already gave the first character, and 「過了！答案太短，沒有提示」 only when the answer is too short. Before, both cases showed the short-answer line.
- The room now refuses a team id that contains a colon, so two teams' checks can never share one record.

## [0.35.0.0] - 2026-11-06

**Deploy note:** reload every open phone and big screen after this release deploys. A phone from before this release has no 擲骰說服 button, so the room refuses its fill-in answers until the page is reloaded.

### Added
- A fill-in question now starts with a persuasion check. Before typing, the team presses 擲骰說服 on the phone and rolls a d20 plus its class bonus (thief +4, cleric +3, mage +2, no class +1, warrior +0). The big screen shows the roll against the monster's DC: 8, 10, 12, 14 or 16 by difficulty, and 16 for the boss.
- A pass gives the team the first character of the answer. A natural 20 wins the question outright. A natural 1 fails, and a right answer on that question pays only half its base reward.
- The big screen has sounds for a passed and a failed check, and the narrator has lines for a 20 and a 1 on a check.
- The bank editor warns when a difficulty or the boss has no fill-in question, because those rooms then never roll a check.
- How-to-play page 2 explains the check.

### Changed
- A team must roll its check before it can type an answer or use the warrior's roll on a fill-in question. A mage's hint is not offered once the check has shown the first character.

## [0.34.0.0] - 2026-11-06

**Deploy note:** reload every open big screen after this release deploys. A big screen from before this release has no sound for the new 20 and 1 results, and it can show a correct answer's crit die as a warrior roll that missed.

### Added
- A correct multiple-choice answer now rolls a d20 crit die. After the host reveals a right answer, the big screen shows the die for 2 s. On a 20 (大成功) the team gets half its reward again, and in the boss room the boss loses one more heart. On a 1 (大失敗) the answer still counts, with a fumble line and sound. The 4d20 boss-kill bonus does not change.
- The die has sounds on the big screen: a roll, a rising run for a 20 and a slide down for a 1.
- The scripted narrator has its own lines for a 20 and a 1, and the AI narrator is told about them.
- A warrior's 20 on a multiple-choice question is a crit too: it pays half again, and the big screen and the phone say 大成功.
- How-to-play page 2 explains the crit die.

### Changed
- A correct multiple-choice answer now takes about 4 s before it is scored: 2 s for the reveal, then 2 s for the die. The phone shows the number it rolled.
- A team whose phone closes during the die keeps its right answer. It shows offline once the die lands.

## [0.33.2.0] - 2026-11-06

### Fixed
- When the host enters an AI key the room refuses, the AI panel now keeps showing why (for example 這把 key 無效). Before, the panel could clear the message right away. This happened when the key was sent before the room had answered the page, or together with a new AI limit, so the host saw no reason for the refusal.
- A key entered before the room answered no longer resets a restored room's AI limit to the default.

## [0.33.1.0] - 2026-11-05

### Changed
- The README now opens with a one-screen guide. It says what the game is, how to run it at an event (host page, big screen, phones), how to run it locally and deploy, and which tests to run. The full original guide is still there, folded under 細節.

## [0.33.0.0] - 2026-11-05

**Deploy note:** reload every open host page after this release deploys, and do not merge it during an event. A host page from before this release has no 公布答案 button, so a multiple-choice lock would wait until the page is reloaded.

### Added
- The host now reveals every multiple-choice answer. When a team locks its option, the host page shows a green 公布答案 button (key 1). The big screen pauses 2 s, then shows the result. A multiple-choice question now runs at the same pace as a fill-in one.

### Changed
- A correct multiple-choice answer, and a warrior's successful roll on one, stay on the big screen until the host presses 下一題. Before, the screen moved on by itself after about 8 s.
- While a lock waits, the host's 答對 / 答錯 buttons are disabled, and the lock line names the team that locked.
- A team that locks and then puts its phone down (the phone sleeps) keeps its turn and its lock. It shows offline once the answer is revealed.

## [0.32.0.0] - 2026-11-05

### Added
- A team whose phone died or changed browser can get back into a running game. On the host page, every team row has a 交給新手機 button. It shows a 4-digit pairing code. On the new phone, open the room address and type the code under 「換了手機？輸入主持人給的配對碼：」, then press 接手隊伍. The phone plays as that team again, with its score and turn.
- A code works once and lasts 5 minutes. Pressing the button again replaces the team's old code. After 5 wrong codes in the room, every open code stops working, and the host presses the button again.
- If the team's old phone is still online, the host is asked to confirm first.

### Fixed
- When every team's phone is offline, the host page still lists the teams with their 交給新手機 buttons. Before, the host page went blank until a phone came back.

## [0.31.4.0] - 2026-11-05

### Fixed
- An AI key or AI limit the host sets before the room has accepted the host page (right after opening it, or while it reconnects) now goes through once the room accepts it. Before, the room refused it and the host saw `not_host`.
- Changing the join password while a new AI key is being checked no longer puts the old key back.

## [0.31.3.0] - 2026-11-05

**Rollback floor:** do not roll the Worker back below v0.31.3.0. Older Workers cannot read the rooms this one saves, so every live room would reset to a new game.

### Changed
- A room saves its question bank once, under its own storage key, instead of inside every save of the game. A room saved before this release still restores with its bank.
- The host page's QR code for joining the lobby waits until the page knows its own address, so it never points at the wrong place.

### Removed
- The branch choice (「冒險出現岔路」) is gone from the room and the narration too. The phone buttons were already removed on 2026-11-04.
- Support for very old saves and for Workers from before boss phases. A save from before boss phases is now discarded and the room starts fresh, instead of crashing on the first boss question.

## [0.31.2.0] - 2026-11-05

### Changed
- CI now runs the end-to-end tests in two parallel halves, so a pull request no longer runs into the 15-minute limit. The required `check` status passes only when the static checks and both halves passed.
- Slower or duplicate end-to-end tests are gone or shorter. The 10-second "can't reach the server" wait uses a fake clock, the "no reconnect by itself" wait runs once instead of on every page, and tests already covered by unit tests were removed.
- A committed `test.only` now fails CI instead of quietly running a few tests.

## [0.31.1.0] - 2026-11-05

### Fixed
- Two teams can no longer join the lobby with the same name. The second phone sees 「這個隊名已經有人用了，請換一個名字」. Names that differ only by letter case or full-width letters also count as the same name. Before this fix, the epilogue dropped one of the two teams and gave its dishes to the other.
- When the host page cannot reach the server at all, it now shows 「連不上伺服器」 with a 重試 button, like the phones and the big screen do, instead of 「重新連線中…」 forever.
- On the big screen, music that was turned off no longer starts again on the next key press.
- In ⚙ 更多, the 改寫第一句旁白 box now follows a new narration line, so 送出 never puts an older line back on the big screen.
- A phone with blocked browser storage (some private modes) can now join a room.
- The question-bank editor refuses to save a question id longer than 64 characters, because phones could never answer that question.
- 下載旁白紀錄 works in Safari.

## [0.31.0.0] - 2026-11-05

### Changed
- Attack narration now fits each team's class. A mage team casts spells (火球、冰箭、閃電), a warrior team swings a sword or an axe, a cleric team calls down holy light, and a thief team throws knives or strikes from the shadows. This holds for both the AI narrator and the scripted lines for correct answers and boss hits.
- A team that picked no class hears neutral attack lines that name no weapon.
- Ordinary hits never use the words 偷襲 or 祈禱, so nobody thinks a thief's or cleric's ability fired when it did not.

## [0.30.0.0] - 2026-11-05

### Added
- Before the first question, the big screen can play a four-page 「怎麼玩？」 intro: taking turns, answering on the phone, what to do after a wrong answer, and how to win. Each page has a picture, a big line of text and the owl's line. With 語音 on, the screen reads the owl's line aloud.
- The host turns the pages with 「下一頁 ▶」 and 「◀ 上一頁」, or with the right arrow key or Enter and the left arrow key. Each page shows a script hint for the host. 「開始冒險 ▶」 on the last page deals the first question.
- During the intro, the phones show 「看大螢幕 👀」 and the page the host is on.
- The lobby has a 「開始前播放玩法說明」 checkbox. It is checked in a new room and unchecked after 「回到大廳，再玩一場」, since the same group has already heard the rules.

## [0.29.0.3] - 2026-11-04

### Changed
- The plan now includes a how-to-play intro, with text and pictures, that players see before the game starts. It also includes a shorter README.

## [0.29.0.2] - 2026-11-04

### Changed
- The older design plans under `docs/designs/` that list `npm run e2e` in their Verify steps now open with a note that those steps run only in GitHub CI, so nobody follows them and runs Playwright locally.

## [0.29.0.1] - 2026-11-04

### Changed
- The Playwright end-to-end tests now run only in GitHub CI, on every pull request and every push to main. The local pre-ship check (`scripts/pregate-runner.sh`) runs only the unit tests, so shipping no longer overloads the developer's machine.

## [0.29.0.0] - 2026-11-04

### Added
- After a game, the host page has 「回到大廳，再玩一場」. It takes the phones, the host page and the big screen back to the lobby with the same teams, so nobody joins again. Names, classes, the join password, the AI narration settings and the director notes stay. Scores and progress start from zero, and teams can still change class in the lobby.
- The next game deals the questions whose answers the last game showed only after every other question has been used, so the same group does not get a question they already know the answer to.

## [0.28.0.0] - 2026-11-04

### Added
- The host can end the game early. In ⚙ 更多, tap 「結束冒險」, then 「確定結束？」. The game ends at once and teams are ranked by their current score. The big screen shows the podium and the epilogue as usual. The 最後一擊 line is left out, and the epilogue does not say anyone slew the boss.
- Before the game starts, each team in the host's list has 「改名」 and 「移除」 buttons. Renaming uses the same rules as joining and refuses a name another team already has.
- A removed team's phone shows 「主持人把你們的隊伍移除了」 and a link home. The phone does not rejoin by itself, even after it reconnects. Opening the room from the home page again joins as a new team.

## [0.27.1.0] - 2026-11-04

### Added
- The bank editor has a 「← 回首頁」 link at the top. With unsaved edits it asks 「還沒儲存的修改會不見，確定回首頁？」 first, and with nothing unsaved it goes straight home.
- With unsaved edits in the bank editor, reloading the page, closing the tab or pressing back now asks first. So does pressing 載入題庫, which used to replace the edits without a word.

### Changed
- The big-screen URL now sits at the top of the host page, so the host no longer has to open ⚙ 更多 to find it. It still opens in a new tab.

### Removed
- Phones no longer show 「冒險出現岔路，你們要怎麼做？」. It will come back once the way the game plays is settled.

## [0.27.0.0] - 2026-10-31

### Added
- Defeated monsters are now cooked. When a team answers right and beats a monster, the big screen shows a small 「🍲 今晚的菜」 card under the answer: the dish's name, which part of the monster it uses, how it was cooked, a one-line review, and 「+N 飽足感」. Killing the boss serves 今晚的大菜.
- When the bank has any dishes, scores are called 飽足感 instead of 獎勵分 on the phones, the host page and the podium. The narrator mentions each dish, and the epilogue is a feast that says what each team ate and who ate the most.
- The default bank gives every monster a dish, each made from the monster itself (for example, the slime's outer membrane becomes 史萊姆寒天涼拌).
- In the bank editor's 房間 tab, each room's monster and the boss have four boxes for a dish: 部位, 做法, 菜名 and 評語. Leave all four empty for no dish. Saving with only some filled in says which box is missing.
- A dish whose name contains a question's answer still appears on the big screen, but the narrator never says it.

## [0.26.0.0] - 2026-10-31

### Added
- The big screen and the host's phone now stay on during a game. Before, they could go dark after a minute or two untouched, in the middle of a turn. When the page comes back to the front, it asks to stay on again. A browser that cannot do this, or refuses on low battery, works as before.
- When the page crashes, it now shows 「畫面出錯了」 with a 重新載入 button, instead of a blank white page. Reloading takes you back into the game, and scores and progress are kept.
- Each crash now sends a short report to the server log, so a crash at a party no longer goes unnoticed.

## [0.25.0.0] - 2026-10-31

### Added
- The host can now line up what the narrator says next. In ⚙ 更多, under 「下一句這樣說（最多 40 字）」, type a line and press 排進下一句. The next narration's second line says it on the big screen. The AI may add a few words around it, and with no AI the line is said as typed.
- The drawer shows 「已排入：…」 with a 取消 button until the line is said. Queuing another line replaces the one waiting.
- A queued line survives a server restart. It is dropped when the game ends without saying it, and the section is hidden after the game ends.
- If the line contains a question's answer, it is still shown on the big screen as typed, but the AI never sees it.

### Fixed
- The live AI narration checks now test each narration line on its own, as the game does. Before, they failed on every multi-line narration.

## [0.24.1.0] - 2026-10-31

### Added
- A phone or big screen that cannot reach the server says so after 10 seconds: 「連不上伺服器：請檢查網路，或稍後再試。」 with a 重試 button. Before, the phone sat on 「連線中…」 and the big screen on an empty lobby, with no sign anything was wrong. If a retry also fails, the notice comes back after another 10 seconds.
- A phone the room turns away now says why, with a link back to the home page:
  - 「遊戲已經開始了，新隊伍不能再加入」 when the game has already started.
  - 「隊伍名稱不能用，請換一個名字」 when the team name is empty or unusable.
  - 「房間已滿（最多 8 隊）」 when the room is full.
  - 「加入失敗，請換一個瀏覽器再加入」 when the browser's saved team data no longer matches the room.

### Changed
- A phone turned away while a game is running no longer shows that game as if it were a team in it. It shows only the reason.

## [0.24.0.0] - 2026-10-30

### Added
- A cleric team can now pray on a fill-in question. When the host presses 答錯, the turn waits: the team's phone shows 「答錯了！要怎麼辦？」 with three buttons, 祈禱 (再答一次・剩 N 次), 重答 (換下一隊) and 逃跑 (換一題). The host page shows the same three buttons (keys 2 / 3 / 4) and can choose for the team. Whoever presses first wins.
- 祈禱 spends one of the cleric's 2 uses and gives the same team a fresh try at the same question, with an empty answer box. 重答 and 逃跑 spend nothing. A prayed try cannot pray again.
- The boss room works the same way: 祈禱 and 重答 keep the shared question, and only 逃跑 deals a new one.

### Changed
- While a cleric can still pray, the host page judges its fill-in answers with 答對！(1) and a single 答錯 (2) that waits for the team's choice, instead of 答錯・重答 / 答錯・逃跑.
- The host's buttons and keys ignore presses for half a second after the wait appears, and after a prayer, so a double-tap of 答錯 or 祈禱 never lands on the next button.
- The cleric's lobby card now reads 「答錯後，這回合再答一次」.

## [0.23.0.0] - 2026-10-30

### Added
- A mage team can now use its ability on a fill-in question. 看答案第一個字 shows the answer's first letter or number, as 「🔮 第一個字：{hint}」, on the team's phone, the host page and the big screen. It spends one of the mage's 2 uses, and works once per question.
- The hint skips leading spaces, quotes and punctuation, so 〈萬家福〉 gives 萬.
- On an answer with only one letter or number, pressing the button turns it into 「這題答案太短，不能看第一個字」, and no use is spent.

### Changed
- The mage's lobby card now reads 「選擇題刪 2 個錯的選項；填空題看答案第一個字」.

## [0.22.0.0] - 2026-10-30

### Added
- Spoken questions are now fill-in questions (填空題). On its turn, the team types one answer on its phone, up to 40 characters, and presses 送出. The phone then shows 「已送出：{answer}・等主持人判」.
- The host page shows 「隊伍答：{answer}」 under the question, or 「（還沒送出）」 before anything is sent. The big screen shows 「⚔️ {team}：{answer}」 so the whole room sees what was answered.
- The host still judges with 答對 / 答錯, and can judge before anything is sent, so a team whose phone has trouble can still answer aloud.
- A send the room never confirms gives the box back after 3 seconds, with the text kept and the hint 「沒送出，再按一次，或直接唸給主持人聽」.

### Changed
- Once a team has sent its answer, the turn stays with it until the host judges, even if the phone goes to sleep or drops offline.
- After sending, the team can no longer roll the warrior's d20 or arm the thief's Sneak Attack on that question.
- A typed answer keeps its quotes (Don't Stop stays as typed). Control characters, direction-override characters and answers with nothing visible are dropped, and the 送出 button stays off for an answer that would be dropped.
- A send that arrives after the host already judged that attempt is ignored, so it never lands on the team's retry.
- The question-bank editor calls this question type 填空 instead of 問答.

## [0.21.0.0] - 2026-10-30

### Added
- The host picks who pays for AI narration in the lobby's 「AI 旁白」 panel: 不用 AI (scripted lines, free, the default), 用我自己的 Anthropic API key, or 站長金鑰. A pasted key is checked with Anthropic before the room uses it, and the host sees only its last 4 characters.
- 「記住這台電腦」 keeps the host's key in that browser only, so a reload or a room restart picks it up again. Without the tick, nothing is stored.
- Each room has a limit on AI narration lines, 300 by default and up to 5000. The host sees 已用 N / 上限 and can change the limit. When it runs out, the host is asked to raise it or carry on with scripted lines. Players and the big screen see no difference.
- The host can switch keys or forget the key from 「⚙ 更多」 during a game. If Anthropic refuses the key, or AI stops after repeated failures (for example no credit left), the host page says so. Pasting a key again brings AI back.

### Changed
- AI narration no longer turns on by itself because the server has a key. A room uses the server's key only for someone who enters `OWNER_KEY`, so an open room can no longer spend the owner's credit.
- The host's key lives only in the room's memory. It is never saved, logged or sent to any screen. After a server restart the host page sends it again.

## [0.20.0.0] - 2026-10-30

### Added
- 法師 (mage): on a multiple-choice turn the team presses 「🔮 刪掉 2 個錯的選項」, twice per game. Two wrong options turn grey for everyone, on the phones and the big screen, with no 「✕ 答錯」 label so they read differently from a real wrong lock. When only one wrong option is left it removes one. The correct option is never removed.
- 牧師 (cleric): after a wrong lock on a multiple-choice turn, the phone shows 「✝️ 祈禱：這回合再答一次」 above 重答 / 逃跑. Praying keeps the turn, so the team answers again right away, once per turn. In the boss room a wrong lock waits for 祈禱 / 不用 instead of the 2-second miss beat. Praying brings a new boss question and keeps the turn.
- 盜賊 (thief), Sneak Attack: press 「🗝️ 偷襲：這題答對加倍」 before answering. A correct answer doubles the reward, and in the boss room it takes 2 HP and doubles the hit reward and the kill bonus. A wrong answer uses it up. The big screen hangs a red 「🗝️ 偷襲！這題答對加倍」 chip over the monster until the answer is judged, and the host row shows 🗝️×2.
- The big screen tells other teams when a cleric is deciding (「牧師祈禱中」) and after it prays (「祈禱了！這回合再答一次」).

### Changed
- All four classes can be picked in the lobby. The 「下次更新」 lock is gone.
- The thief's ability is Sneak Attack instead of peeking at the answer's first letter, which only helped on spoken questions.

### Fixed
- A thief that armed Sneak Attack and was then sent to the boss room by the host, before its answer was judged, gets the use back instead of carrying the bonus into the boss room.
- A cleric cannot get a second prayer in the same turn by reloading its phone.

## [0.19.0.0] - 2026-10-29

### Added
- Teams can pick a class in the lobby. The phone shows four class cards plus 「不選（普通冒險者）」. Only 戰士 (warrior) works in this version; 法師, 牧師 and 盜賊 show locked as 「下次更新」. The host's lobby and team rows show each team's class.
- A warrior team can roll a d20 instead of answering, twice per game. The 擲骰代替答題 button sits under 鎖定答案, and on text turns too. A 12 or higher counts as a correct answer; lower counts as wrong.
- The big screen shows the roll: the scene dims, a big d20 tumbles and lands on the room's number, then reads 命中！ or 差一點. With reduced motion turned on, the die shows its number at once.
- During the 2-second roll, the phone reads 「擲出 N！看大螢幕 ▶」, the team card counts down the uses left (「⚔️ 戰士・剩 1 次」), and the host sees 「{隊名}擲出了骰子…」 and cannot judge until the roll lands.
- A roll's use is spent the moment the room rolls. A team that drops out or reloads during the 2 seconds keeps the roll spent, so it cannot throw a bad roll away and try again.
- The room refuses a class that is not built yet, even when a phone sends it directly.
- `docs/designs/class-abilities.md` covers all four classes, with the design and engineering review decisions. This release ships the warrior. Mage, cleric and thief come in a later update.

## [0.18.0.3] - 2026-10-29

### Added
- `TODOS.md` has a P3 idea to cap a room at 6 hours from creation. Today a room lasts 24 hours, and activity keeps pushing that back.

## [0.18.0.2] - 2026-10-29

### Fixed
- The e2e test for the picture's place on the phone now passes in CI. The 0.18.0.1 fix had the wrong cause. In e2e the picture points at the real image bucket, where the test's upload does not exist, so the picture fails to load and hides itself. The test measured the picture, which read no position once it was hidden. It now measures the picture's frame, which keeps its place whether or not the picture loads.

## [0.18.0.1] - 2026-10-29

### Added
- `TODOS.md` has a P3 idea for a mobile version of the player page: compare a PWA, a Capacitor wrapper, and a native app before publishing to the App Store or Google Play.

### Changed
- The two P3 ideas for turn actions and team classes in `TODOS.md` moved out of the Completed section, where they had been added by mistake.

### Fixed
- The e2e test for the picture's place on the phone no longer fails at random in CI. It measured the picture while the turn change was remounting it, so it read a position of 0. It now retries until the picture has a layout position.

## [0.18.0.0] - 2026-10-29

### Added
- The answering team's phone now shows the question, not just the options. On a multiple-choice turn it sits in a dark strip at the top of the answer panel, and it stays there after a wrong lock, through 重答, and in the boss room until the boss brings a new question.
- After a correct lock, the team's phone keeps the question it just answered above the green tile.
- On a host-judged text turn (the team answers aloud), the answering phone shows the question too. Waiting phones do not.
- Screen readers hear the question as a heading, and the options as a group named after it (or 「選項」 for a picture question).

### Changed
- On a picture or YouTube turn, the media now sits right under the 輪到我們了！ ribbon on the answering phone, with the team cards below it. Waiting phones keep the cards on top.
- When the game ends, the team's own 答對了 panel gives way to 遊戲結束, so the result is near the top of the screen.

## [0.17.0.1] - 2026-10-28

### Added
- `TODOS.md` has three new P3 ideas for a dungeon-cooking style: monsters drop ingredients from their own bodies and become a dish, points are renamed 「飽足感」 (fullness), the dungeon art turns warm and lived-in, and the narration speaks like a food show or a biologist. They borrow only the theme, never another work's characters or art.

## [0.17.0.0] - 2026-10-28

### Added
- Every new feature version (`X.Y.0.0`) merged to `main` now becomes a Git tag and a GitHub Release automatically. The release notes are every CHANGELOG section since the previous release, so hotfixes in between are listed too.
- A hotfix can get its own release by hand: Actions → Release → Run workflow releases the version currently on `main`.
- The README explains the versioning rule under 版本與 Release.

## [0.16.1.2] - 2026-10-28

### Added
- Dependabot's minor and patch PRs now merge themselves once CI's `check` passes, so dependency updates stop piling up. Major updates still wait for the maintainer. Dependabot waits 5 days after a release before proposing it; security fixes are not delayed.
- `SECURITY.md` explains how to report a vulnerability privately, and the README links to it.

## [0.16.1.1] - 2026-10-28

### Changed
- The repository is now public. `docs/going-public.md` marks every pre-public and post-public step as done: webhooks checked, CI artifacts deleted, fork pull requests need the owner's approval to run CI, a ruleset protects `main`, and secret scanning with push protection is on.

## [0.16.1.0] - 2026-10-28

### Added
- The project is now MIT licensed, so anyone can use, change and redeploy it. The README ends with a 授權 section.
- `docs/going-public.md` lists what was checked before the repository goes public (no secrets anywhere in the history, CI and deploy behaviour on outside pull requests, personal data) and the settings the owner still has to change.

### Changed
- `wrangler.jsonc` now tells a fork to put its own R2 bucket URL and its own frontend origins there before deploying.
- The design docs refer to local mockups by `~/` paths instead of a full home-folder path.

## [0.16.0.0] - 2026-10-28

### Added
- A boss fight can now have phases, each with its own name, rule, HP bar and questions. In the bank editor's boss tab, 「新增階段」 adds one. From phase 2 on a phase needs a name and a rule: the editor marks the empty field and won't save until it is filled. Deleting a phase that has questions asks 「刪除第 N 階段和它的 M 題？」 first.
- When a phase's bar empties, the big screen shows the answer as usual and the boss does not fall. On 下一題 a phase card opens: 「還沒結束！」, the new phase's name and rule. The boss flashes to a new colour and its hearts refill one by one. A phase that runs out of questions moves on the same way. After a wrong answer, the card waits until the retry line has been read.
- The phones show the same card, then keep the phase's rule on screen during its boss turns. The host page shows 「第 n/N 階段・下一階段：…」 or 「最後階段」, so only the host knows how many phases are left.
- The narration never says the boss fell when only a phase's bar emptied, and the card has its own line and sound. A team that walks into the boss room from phase 2 on hears which phase is under way.

### Changed
- The bank format number goes from 1 to 2. Banks saved before this release load as a boss with one phase. An older Worker or editor treats a format-2 bank as unreadable and refuses to save it, rather than drop its phases. Deploy the Worker and the site together.
- A boss phase's HP must be a whole number from 1 to 20 to save (the big screen draws one heart per HP).
- The boss tab no longer warns when there are fewer than HP + 10 questions.

## [0.15.4.0] - 2026-10-28

### Fixed
- With the question picker or the ⚙ 更多 drawer open, the keys 1, 2, 3 and Enter no longer judge the turn hidden behind it or close an answer reveal. Before, pressing Enter on a picker row while an answer was on show moved to the next question instead of picking.
- When the host page goes back to the lobby while the question picker is open, the picker no longer pops back up by itself once the next game starts.
- A host page that reloads or reconnects mid-game still gets every later change to the question picker.

### Changed
- The host page receives the question picker, which carries the whole bank, only when something in it changed. Before, it came again with every update, including each option a team tapped on its phone.
- In the question picker, questions that can't be picked are greyed in the game's own colours, and the reason (已公布, 正在答, 已排給…) is easier to read. The 指定下一題, 指定 and 取消 buttons are taller and easier to tap on a phone.

## [0.15.3.0] - 2026-10-28

### Added
- The host can pick a team's next question. Each team's row on the host page has 「指定下一題」, which lists the questions at the difficulty of that team's next room, with their answers. Questions whose answer was already revealed, that another team is answering, or that are already picked for someone else can't be chosen. The team gets the pick the next time it is dealt a question of that difficulty, usually when it answers right and moves to the next room. A retry keeps the same question, so the pick waits. Tap 取消 to drop a pick.
- While any team is in the boss room, the host page also has 「首領房下一題」: the boss's next question change uses the host's pick instead of the next one in order.

## [0.15.2.4] - 2026-10-28

### Changed
- `local-banks/` (local question-bank drafts, which hold answers) is now in `.gitignore`, so a draft can't be committed by accident.
- The ordering-question and multi-phase-boss backlog items now say the bank format number (`BANK_FORMAT`) must go up, and the host-picks-the-question item no longer points at backlog items that don't exist.

## [0.15.2.3] - 2026-10-28

### Changed
- TODOS.md has three new backlog items: the host picks which bank question comes next, an ordering question type, and a boss fight split into phases with their own questions.

## [0.15.2.2] - 2026-10-28

### Fixed
- The big-screen lobby now fits 8 teams. From 5 teams on, each side of the campfire stacks its teams in two rows, with the hero beside its name, so no name hides under the room-code panel or the 地城主 tag of the dialogue box. A name too long for its nameplate ends in "…" instead of running into the next team.
- At 4 or fewer teams, the first name no longer sits under the 地城主 tag.

## [0.15.2.0] - 2026-10-28

### Added
- When the saved question bank can't be read by the deployed version (usually after rolling back to an older one), the bank editor now says so the moment it loads: a red notice explains that the questions shown are the defaults, that your bank is still saved, and that nothing can be saved until a version that reads it is deployed. The save button is disabled.
- README has a new 「題庫卡住時怎麼救」 section: how to get the bank readable again, which versions are safe to roll back to, and what to do if the stored data itself is damaged.

### Changed
- Image uploads are refused while the saved bank can't be read (409), since no save could keep them. They are also refused while the bank store can't be reached (503), instead of failing with an unexplained error.

## [0.15.1.3] - 2026-10-28

### Fixed
- Clicking 🎵 twice quickly on the big screen no longer starts two music loops, one of which could never be stopped. Turning music off while it is still starting no longer throws an error and leaves music and sound effects stuck off.
- When the big screen tab comes back from the background, the music no longer plays every note it missed at once. Those notes are skipped and the song carries on from where it is.

## [0.15.1.2] - 2026-10-28

### Changed
- The big-screen URL in the host's ⚙ 更多 panel is now a link that opens the big screen in a new tab, so a host whose laptop drives the TV no longer has to copy it. The host page stays where it is.

## [0.15.1.1] - 2026-10-28

### Fixed
- A host key press (1/2/3) right as the turn moved on could judge the previous team's turn, which the room then rejected with a raw error. `HOST_JUDGE` now carries the eventId of the STATE the host judged from, and the room silently drops an older one, the same way it already treats a stale 下一題. The host page's keyboard listener is now registered in a layout effect, so it already has the new turn when that turn is drawn.
- The host lobby's 目前密碼 line now changes only when the room confirms the new join password, and every open host page gets the update. Before, it changed as soon as 設定 was pressed, so it could show a password the room never received.

## [0.15.1.0] - 2026-10-27

### Added
- Optional join password for rooms. The host sets it in the lobby (the 加入密碼 panel). A new team then has to enter it in the home page's join form, and a phone that arrives without it, or with the wrong one, sees a message and a link back to the form. The password goes from the join form to the game page in sessionStorage, never in the URL. Teams that have already joined rejoin with their team key alone. The password is saved with the room, so it still applies after a restart. The game is publicly deployed, so this item (a P1 before a public deploy) is now done.

## [0.15.0.2] - 2026-10-27

### Added
- The stored question bank now records a format number (`BANK_FORMAT` in `lib/bank-store.ts`). Code that finds a newer format treats the stored bank as unreadable, so it refuses to save over it. Before this change, a newer format that only added fields would still parse in older code, and the next save would drop those fields. When you change the bank format in a way older code would lose data, increase `BANK_FORMAT` by 1. Only v0.15.0.2 and later check the number: once the format has been raised, do not roll back below v0.15.0.2, because older versions will still save over a newer bank.

## [0.15.0.1] - 2026-10-26

### Changed
- Dependabot no longer opens TypeScript 7+ or ESLint 10+ upgrade PRs. Both fail CI lint because `eslint-config-next` is not ready for them yet (typescript-eslint rejects TS 6.1 and later, eslint-plugin-react crashes on ESLint 10). TypeScript 6.0 upgrades still come through. TODOS.md says to remove the rule once upstream catches up.

## [0.15.0.0] - 2026-10-26

### Changed
- In the boss room, a wrong multiple-choice answer always brings a new boss question, so the next team never gets a question with options already crossed out. The team no longer chooses 重答 or 逃跑 there: the red option shows for 2 seconds, then the boss swaps the question and the turn moves on. The phone shows 「首領要換題了 ▶」, the big screen 「X答錯了！首領換一題……」 and the host 「答錯！首領換一題…」.
- The narrator says the boss brought a new question instead of offering the team another try.
- The default boss bank has 20 questions instead of 8, because every hit and every miss now uses one up. When a boss bank runs out, it repeats questions whose answers were already shown.

### Added
- The bank editor's 首領 tab suggests at least boss HP + 10 questions when the boss bank is smaller. A bank saved in the editor keeps its own boss questions, so a saved bank does not get the 12 new ones on its own.

### Fixed
- After a restart in the middle of a boss miss, the room still swaps the question on its own.
- A broken saved game whose waiting wrong answer names no team, or a question the team no longer faces, no longer freezes the room.

## [0.14.0.0] - 2026-10-26

### Changed
- Questions now live in five pools by difficulty (1 to 5) instead of inside rooms. Each room has a difficulty and deals from that pool, and rooms with the same difficulty share one pool. If a pool has no questions, the team gets one from the nearest lower pool, then a higher one. If every question in it is held by another team, the team gets a free one from the nearest pool (the lower one on a tie). When every answer left in a pool has already been shown, a question nobody has seen comes from the nearest pool before any repeat. A correct answer scores the difficulty of the pool the question came from. The big screen shows that difficulty too.
- Each game shuffles the options of every multiple-choice question, so the right answer is not always in the same spot. The phones, the host page and the big screen all show the same order.
- The default bank has 8 rooms (difficulty 1, 2, 2, 3, 4, 4, 5, 5 and reward 10, 20, 20, 30, 40, 40, 50, 50) and 72 questions: 12 in each pool except 16 at difficulty 2, plus 8 for the boss. 20 of the questions and 3 of the monsters are new.
- A bank saved before this version still loads. Each room's questions move into the pool of that room's difficulty.

### Added
- The question-bank editor has tabs: 房間 (each room's difficulty and reward, and the boss hit reward), one tab for each pool from 1 to 5, and 首領.
- The editor will not save a bank where a room's pool has no questions, for example 「第 8 房是難度 5，但難度 5 題庫沒有題目」.

### Removed
- A room saved by an older version cannot be resumed after a server restart. A game in progress during the deploy starts over.
- Once the bank editor saves in this version, older versions cannot read the stored bank. Rolling back below 0.14.0.0 then runs games on the default questions and refuses saves, but keeps the stored bank, so rolling forward again brings it back.

## [0.13.1.0] - 2026-10-25

### Fixed
- When the server cannot read the stored question bank (for example after rolling back below a newer bank format), saving in the bank editor is refused with an error instead of replacing every custom question with the default bank. The stored bank is kept as it is.
- In the same state, image cleanup waits and retries later instead of deleting images by the default bank, so pictures the stored bank still uses are not lost.
- Do not roll back below this version once a newer bank format has been saved.

## [0.13.0.0] - 2026-10-25

### Changed
- The winner is the team with the most reward points, and teams tied on reward share the win. Landing the final blow on the boss ends the game but no longer wins it by itself.
- Beating a room's monster pays that room's reward: 10, 20, 20, 30 and 40 for rooms 1 to 5. Each boss hit pays 10, and the final blow also pays a 4d20 roll (4 to 80). A flee costs no reward.
- Progress points (the difficulty of each question answered right) still decide when a team enters the boss room at 15, but only the host page shows them, as `9/15`, next to each team's reward.
- The phone shows the team's reward points (for example `120 獎勵分`) instead of `x / 15` and the progress bar. The big screen still shows no scores during play.
- The end screen ranks teams by reward and adds a 「最後一擊：隊名」 line for the team that killed the boss.
- A correct answer shows the reward it paid (for example ＋20), not the question's difficulty.

### Added
- The host can send a team straight into the boss room from 更多 → 送王房, before it reaches 15 progress. The first tap changes the button to 確定送？; a second tap within 3 seconds sends the team. It cannot be undone.
- A question bank can set each room's `reward` and the boss's `hitReward`. Banks that leave them out (including every bank saved before this version) get difficulty × 10 per room and 10 per boss hit.

### Removed
- A room saved by an older version cannot be resumed after a server restart. A game in progress during the deploy starts over.

## [0.12.0.0] - 2026-10-25

### Changed
- The default question bank is now 52 four-option multiple-choice questions: 12 in room 1, 8 in each of rooms 2 to 5, and 8 for the boss. They mix Taiwan general knowledge, 2026 news, pop culture and history, and get harder room by room. Every question is answered on the teams' phones and judged by the game, so the host never has to press 答對. The old text questions and the 6 sample multiple-choice questions are gone.
- Room 1 has 12 questions, so even with 8 teams there, a team that flees always gets a question nobody else is holding.
- No question's text names another question's answer, and no two questions share a question or an answer, so a reveal on the big screen never gives another team a free answer.
- A bank already saved in the question-bank editor stays as it is. The new default bank is used only where no bank has been saved yet.

## [0.11.1.0] - 2026-10-25

### Fixed
- In the question-bank editor, when two loads overlap, only the newest one counts. An older load that finishes late no longer overwrites the bank on screen, wipes it with "Owner key rejected.", or shows "Could not reach the server." over a load that worked.
- 載入題庫 stays 載入中… until the newest load is back, even if an older one finishes first.

### Changed
- In the question-bank editor, 儲存全部變更 cannot be pressed while a load is in progress, and 載入題庫 cannot be pressed while a save is in progress.

## [0.11.0.0] - 2026-10-25

### Added
- Teams answer multiple-choice questions on their own phones. A team taps an option, then 鎖定答案. The big screen shows the lock, holds it for 2 seconds, then reveals the result. The host no longer presses 答對 for these questions.
- A wrong lock turns only the picked option red on the big screen. The right answer stays hidden. The team then chooses 重答 (the wrong option is greyed out on its next try) or 逃跑 (a different question).
- After a correct multiple-choice answer, the game moves on to the next turn by itself, 8 to 15 seconds after the reveal, depending on how long the narration is. 下一題 on the host page still moves on at once.
- When a team has not locked an answer for 15 seconds, or has not chosen 重答 or 逃跑 15 seconds after a wrong lock, the host page offers 替{隊名}選・重答 / 逃跑, and keys 2 and 3 press them.
- When a lock gets no answer from the room within 3 seconds, the phone shows 沒送出，再按一次 and the team can lock again.
- Room 1 of the bundled question bank has 6 sample multiple-choice questions.

### Changed
- A multiple-choice question can have at most 4 options, the number of tiles on the big screen. The editor stops adding options at 4. A saved bank with more still loads and plays, but cannot be saved until those questions are cut down to 4.
- Long option text on the big screen wraps to two lines and ends with "…" instead of spilling out of its tile.
- A question a team fled after a wrong lock is not dealt again, because its wrong option was already shown to the room.

## [0.10.0.1] - 2026-10-24

### Changed
- The rooms on the big-screen map no longer show room numbers. When the map is too long to fit and the first rooms fold together, that folded block still shows "…".

## [0.10.0.0] - 2026-10-23

### Added
- The big screen shows a live dungeon map in place of the team cards. Each team is a pawn with a short name tag, moving from room to room as it answers. Rooms past the furthest team are fog. The boss room stays a closed door until the first team walks in, then opens with the boss and its HP bar. The team whose turn it is has a ▼ over its pawn, and offline teams show "zz".
- A pawn that moves hops into its new room (or charges into the boss room), and that room flashes once. Reloading the screen does not replay it. With reduced motion turned on, only the room flash stays.

### Changed
- Once any team is in the boss room, every other team joins the fight on its next correct answer, whatever its score.
- Joining the boss room no longer uses up a question from the next room, and no longer offers a branch choice for a room the team will never enter.
- A very long team name is cut short with "…" in the turn ribbon on the big screen, so the map always fits on screen.
- A room that was in progress when this version deploys starts over, and phones show the existing "game reset" notice.

## [0.9.15.1] - 2026-10-07

### Fixed
- The big screen's background music plays its bass line in time with the melody. Before, you heard only the melody for about 16 seconds, then every bass note of the loop at once.

## [0.9.15.0] - 2026-10-07

### Fixed
- The scripted end-of-game epilogue now shows team names exactly as typed. Before, a team named something like `{score}隊` got its name replaced by a number, and a name containing `$'` or `$&` was garbled.

### Changed
- About 170 fewer lines of code, with the game behaving the same. Narration errors are one error type with a reason, the room pages read the server's STATE message directly, the question-bank save returns a version conflict instead of throwing it, and several one-use helpers and unused options are gone.
- `npm run dev` starts the room server and Next.js with plain `sh`. Stopping it (Ctrl-C, or Next.js exiting on its own) also stops the room server, so port 8787 is not left taken.

### Removed
- The `concurrently` dev dependency. `npm run dev` no longer prefixes or colors each server's output.

### Added
- An e2e test that a big screen opened after the game ends shows the epilogue but does not read it aloud again, and a unit test that team names stay verbatim in every epilogue template.

## [0.9.14.10] - 2026-10-03

### Changed
- Two open items in TODOS.md pointed to `party/index.ts`, which no longer exists. They now point to `lib/room/dungeon-room.ts`.
- The comment in `scripts/check-bundle.sh` now names the current rule (server-only code may import the bank). It also states the scope of the check. Questions saved in the bank editor stay on the server and never go into the build.

## [0.9.14.9] - 2026-10-03

### Changed
- The `check:bundle` rule in CLAUDE.md is easier for agents to read. It now uses short sentences, no semicolons, and a list of the server-only files that may import the question bank. The rule itself did not change.

## [0.9.14.8] - 2026-10-03

### Changed
- The README now matches what is live. It covers the host keyboard keys, the campfire lobby, boss-room narration, background music and sound effects, disconnect notices, question media and explanations, automatic cleanup of unsaved images, and the room-expired notice. It also says Node 22 is required, and that the game runs on Vercel and Cloudflare with automatic deploys. A new cost note explains that AI narration has no call limit, so production needs an Anthropic spend limit.
- TODOS.md cleaned up: the localStorage item is marked done, and the ESLint 10 / TypeScript 7 blockers were rechecked (still blocked). Newly recorded: frontend e2e coverage, the 5 lint-tool advisories with no upstream fix, adding dead-code and shell checks to `/health`, and why the room still fetches the bank on every wake.
- `/health` has a fixed tool list in CLAUDE.md. The first baseline is 10/10 on the 3 categories it can check (types, lint, tests).

## [0.9.14.7] - 2026-10-03

### Added
- Unit tests for the 「伺服器重新啟動，遊戲已重置」 notice. The room-message parsing and the restart check behind it moved into a small `readRoomMessage` function that the shared room connection calls, so it can be tested without a browser. Before this, no test covered the notice at all. No behavior change.

## [0.9.14.6] - 2026-10-03

### Changed
- The end-of-game epilogue is now written by Claude Sonnet 5.5 instead of Claude Sonnet 5, at the same price. Thinking is switched off with `between_tools`, which is how this model does it (the old `disabled` setting is rejected by Sonnet 5.5). Narration during the game is unchanged (Claude Haiku 4.5). If the new model fails or is slow, the epilogue still falls back to the built-in one.

## [0.9.14.5] - 2026-10-03

### Security
- First `/cso` security audit (static, partial coverage within its time budget). One supported finding, medium: anyone can open a room, become its host and keep triggering paid AI narration calls, since there is no cap on how many a room makes. Decision for now: cap spend with an Anthropic account spend limit instead of changing the game; a per-room narration budget is recorded as a TODO with the trigger for doing it.
- Confirmed during the audit: question text and answers never go into the AI narration prompt, the question-bank API fails closed without the owner key, and the room server only routes the room binding. The prompt-moderation TODO drops to P4.
## [0.9.14.4] - 2026-10-03

### Changed
- Patch upgrades: Next.js 16.3.6 → 16.3.8 (and `eslint-config-next` with it), wrangler 4.137 → 4.147, vitest 5.0.1 → 5.0.3, and the latest Cloudflare Workers types. No game behavior changes.

### Fixed
- `npm audit` drops from 8 findings to 5. The 3 fixed ones came in through wrangler's bundled `undici` (now 7.29.1). The 5 left are one chain inside the lint tooling (`eslint-config-next` → `fast-glob@3.3.1` → `micromatch` → `braces`), where even the newest `braces` has no fixed release yet. It only touches lint runs over the project's own files, never the deployed app.

## [0.9.14.3] - 2026-10-03

### Changed
- CI now runs on a pinned Ubuntu 24.04 runner instead of `ubuntu-latest`, which GitHub switches to Ubuntu 26 on 2026-10-19. Moving to 26 is a deliberate step later (see TODOS.md), not a surprise red build.
- The Node version is pinned to 22 in a new `.nvmrc`, and CI reads it from there, so CI and Cloudflare's Worker build use the same version.

### Fixed
- The full unit test suite now also passes on Node 26. One bank-image upload test built its fake request in a way Node 26 rejects.

## [0.9.14.2] - 2026-10-02

### Added
- Test coverage for two things the host can do from the ⚙ 更多 drawer: saving the director notes, and downloading the narration transcript (the downloaded file must contain the saved notes and a real narration line).
- Unit tests for the browser-storage helper and for how a browser remembers a room's host token (a `#k=` link wins and is kept, one token per room, a newer link replaces an older one). No game behavior changed.

## [0.9.14.1] - 2026-10-01

### Fixed
- A flaky end-to-end test of the bank editor no longer fails the CI check on slow runners. Every save in the test now waits for the request to finish before reloading the page, so a reload can't cancel a save that is still in flight. Test-only; the editor itself is unchanged.

## [0.9.14.0] - 2026-10-01

### Changed
- Internal cleanup with no change to how the game plays: the host, phone and big-screen pages now share one room-connection hook instead of three copies, and duplicated logic in the narration picker, turn order, room server, music player and bank editor was folded together. About 200 fewer lines.
- A phone now sends its JOIN once per connection. It used to send a second, redundant one right after connecting.

### Removed
- Unused pieces: the `vite` runtime dependency, `next.config.ts` (a dev-only LAN origin the playtest flow never used), the `typecheck:worker` script, and the separate R2 image-cleanup wrapper (the bank store already logs a failed delete).

## [0.9.13.1] - 2026-10-01

### Changed
- The room server (Cloudflare Worker) now deploys through Cloudflare's own GitHub connection (Workers Builds) on every merge to `main`, the same way Vercel deploys the frontend. No deploy secret is stored in GitHub any more.

### Removed
- The GitHub Actions `deploy-worker` job. Without repository secrets it skipped every deploy while still showing green, which left the live Worker at v0.9.0.0 while `main` reached v0.9.13.0.

## [0.9.13.0] - 2026-09-29

### Added
- Rooms 3 to 5 now have their own monsters instead of recoloured copies: a blue lost slime with a question mark over its head, a crying ghost, and a crowned slime king standing guard with a spear. The live question bank keeps its current monsters until it's re-seeded, since the bank editor doesn't offer a monster picker yet.

## [0.9.12.0] - 2026-09-29

### Added
- The big screen's lobby has a flickering campfire in the middle, and each team's adventurer runs in to gather around it as the team joins. With five or more teams the characters shrink and long names are shortened, so all eight fit.

## [0.9.11.0] - 2026-09-29

### Added
- When a team's answer takes it into the boss room, the narrator now says so. With AI narration on, it also calls back the choices the team made at the forks on the way; the scripted fallback just announces the entrance.

## [0.9.10.0] - 2026-09-29

### Added
- The host can judge from a laptop keyboard: 1 for correct, 2 for wrong (retry), 3 for wrong (flee), and 1 or Enter for 下一題 while the answer is on show. The buttons show the key on devices with a mouse. The keys do nothing while typing in the notes box or when combined with Ctrl/⌘/Alt.

## [0.9.9.0] - 2026-09-29

### Added
- Phones and the big screen now say 「連線中斷，重新連線中…」 while their connection is down, instead of just freezing. When a phone reconnects, it tells the team if its turn was skipped while it was offline, or how many answers were judged in the meantime.

## [0.9.8.0] - 2026-09-29

### Added
- Sound effects on the big screen: a fanfare when the game starts, a chime for a correct answer, a buzz for a wrong one, a swoop when a team flees, a thud when the boss is hit and a victory run when it falls. Like the music, they're generated in the browser and play when the 🎵 music toggle is on.

## [0.9.7.0] - 2026-09-29

### Fixed
- On browsers that load their voices a moment after the page opens, the first narration after turning the big screen's voice on could be silently skipped. It's now read out as soon as the voice is ready.

## [0.9.6.0] - 2026-09-29

### Fixed
- When a room had been idle long enough to be deleted, the host page, phones and big screen still said "resting, your progress is saved". They now say the room has expired and the last game is gone; reconnecting opens a fresh room.
- A phone or computer that kept reconnecting on its own in the background (a flaky network, the system waking it) kept the room from ever resting. Only reconnects a person asks for (opening or reloading the page, or tapping 重新連線) count as activity now.

## [0.9.5.0] - 2026-09-29

### Added
- The big screen can play background music: an 8-bit dungeon loop, generated in the browser, so there are no music files to download or license. Turn it on with the 🎵 button next to the voice toggle; the setting is remembered. The music gets quieter whenever the narrator is speaking.

## [0.9.4.0] - 2026-09-29

### Fixed
- If the big screen reconnected in the few seconds between the boss falling and the epilogue arriving, the epilogue appeared on screen but was never read aloud. It's now read aloud; reloading a finished game still doesn't repeat it.

## [0.9.3.0] - 2026-09-29

### Fixed
- An image uploaded in the bank editor but never saved (tab closed, browser crash, a save that hit a conflict) used to stay in storage forever. It's now deleted after the same wait as any other image the bank stopped using; an image that does get saved is kept.

## [0.9.2.0] - 2026-09-29

### Fixed
- When two narrations were being written at once and the older one finished last, it replaced the newer line on every screen, and a phone that reconnected afterwards was shown the out-of-date line. The older line is now dropped.

## [0.9.1.0] - 2026-09-29

### Changed
- The home page has a new backdrop: you're standing in a dungeon corridor, with brick walls running off into the dark, a beamed ceiling hung with chains and cobwebs, flickering torches on both walls, and an iron-banded door at the far end. A skull, bones, a treasure chest and a barrel lie on the floor. Like the rest of the art, it's drawn in code, so the page doesn't download any images.
- The home backdrop now keeps its pixels square at any screen size, instead of stretching one fixed grid to fill the window.

### Fixed
- Replacing or removing a question's image in the bank editor while a game was running deleted that image straight away, so the running game's question or explanation image vanished. Removed images now stay available until every game that could still be using them has ended (a room's 24-hour expiry plus an hour), and one that's put back in the meantime is never deleted.

## [0.9.0.0] - 2026-09-24

### Added
- A question (or multiple-choice question) can now show its prompt as text, an uploaded image, or a YouTube video — the same slot, not three separate question types. The standalone "image question" type is gone; images are just one of the three ways any question can look.
- Any question can also carry an optional "詳解" (detailed explanation) — its own text/image/video, independent of the question's own content — shown to everyone right after a team answers correctly.
- When a team answers correctly, the correct answer (and its explanation, if there is one) now appears on the big screen and every phone, not just the host's own screen — since everyone at the party already watches the shared screen together, there was nothing being protected by keeping it host-only.
- The host decides when the room moves on: after a correct answer, the big screen and every phone show the answer in place of the next question until the host presses 「下一題」, so an explanation video can play as long as the room wants. A phone that reconnects mid-reveal still sees it, and the answer that wins the game shows on the podium screen. With two host devices, a late 「下一題」 tap from one can't close a newer reveal the room hasn't seen yet.
- The host's own screen shows a YouTube question as 「影片題（看大螢幕）」 instead of a thumbnail-sized video that YouTube refuses to play.
- A question whose answer was already shown this way won't come back around for a team who hasn't faced it yet, even after a room or boss question pool reshuffles.
- The host's own screen now shows a small preview of a question's image or video too, so judging doesn't mean squinting at the big screen from across the room.

### Fixed
- The bank editor's image-upload button could collide between two image questions in the same room, sending an upload to the wrong question's slot.
- Switching a question between 問答/選擇 in the bank editor silently discarded its explanation.
- The boss could ask the question whose answer was still on screen right after a team got it right, handing the next team a free hit. Fleeing the last unanswered boss question now keeps it (and the teams' picks) instead of rotating to one whose answer everyone has seen.
- A room could re-show an already-revealed question while one that had only been fled was still unanswered.
- Pasting a YouTube link from a phone's share button (`watch?feature=share&v=…`) or a `/live/` link is now recognized.
- Switching an image slot to another media type while its upload was still in flight could let the finished upload overwrite what you switched to; the media tabs now wait for the upload.
- Clicking a media-type tab that was already selected in the bank editor asked to discard — and, on confirm, actually discarded — content that hadn't changed at all.
- A game already in progress when this version deployed would have had every correctly-answered question wrongly rejected after the next server restart, due to a missing field on old saves. Fixed before it shipped.

## [0.8.0.0] - 2026-09-23

### Added
- Narration now runs longer: events where the story moves on to another team get 3 lines instead of 2 (what just happened, a bit of atmosphere, then who's up next), and events that end there (a boss kill, the last judged event) get 2 instead of 1. Same per-line length as before, just more of it.

### Fixed
- **Data safety:** a saved room's narration field changed shape in this release, but the version marker that tells the server "this old save is unreadable" wasn't bumped to match — every room mid-game at deploy time would have had its progress silently wiped on the next restart. Fixed before it shipped.
- A narration line the AI wrote that got rejected (too long, contained markup) could, in rare cases, cause a later valid line to land in the wrong spot on screen — e.g. the "who's up next" line appearing where the atmosphere line should be. Fixed.

## [0.7.3.0] - 2026-09-23

### Changed
- Dev-tooling upgrades, no user-facing change: React/react-dom 19.2.4 → 19.3.0, Vitest 4.1.11 → 5.0.1 (with Vite and `@types/node` bumped to match), `concurrently` 9.2.4 → 10.0.5. ESLint 10 and TypeScript 7 were attempted and reverted — both broke on `eslint-config-next`'s bundled plugins not yet supporting them; revisit once upstream catches up.

## [0.7.2.0] - 2026-09-23

### Fixed
- Patched a critical and two high-severity dependency vulnerabilities (Next.js unauthenticated RCE on Windows-hosted servers, Next.js unauthenticated RCE in the AVIF image-optimization path, a postcss XSS/path-traversal chain) by bumping Next.js 16.2.4 → 16.3.6. Neither RCE's precondition applies to this app today, but the fix was free.
- Replaced a deprecated partyserver API (`lobby.party`) in the Worker's room-vs-other-bindings security gate with its typed replacement (`lobby.className`), pre-empting a behavior change partyserver's own deprecation notice says is coming in its next major version.

## [0.7.1.0] - 2026-09-23

### Added
- The homepage now links to the question-bank editor (previously reachable only by typing `/bank-editor` directly).

### Fixed
- The question-bank editor's multiple-choice questions had their question-text field squeezed down to about 20px wide by a CSS conflict with the type dropdown next to it — present and editable, but effectively invisible. Fixed; the field now takes up its proper share of the row.

## [0.7.0.0] - 2026-09-22

### Added
- The big screen can now narrate the game out loud using the browser's built-in text-to-speech: narration lines and turn-transition prompts, plus the ending epilogue. Off by default — a toggle button (bottom-right of the screen) turns it on, and the choice is remembered on that device. Prefers a Traditional Chinese (Taiwan) voice when one is available; the toggle is hidden entirely on browsers without speech support.

## [0.6.0.1] - 2026-09-23

### Fixed
- **Security:** the whole question bank — every question and answer — was shipping inside the question-bank editor page's public JavaScript file, readable by anyone who opened it, regardless of the owner key. Fixed by moving the bank data out of the file the editor page imports; the editor's own code never needed the actual answers to begin with.

## [0.6.0.0] - 2026-09-23

### Added
- Questions can now include an uploaded picture: authors pick "圖片" in the question-bank editor, choose an image file, and write the answer — same as a text question, but with a picture to look at.
- Teams and the big screen both show the question's picture, sized to fit without cropping. If a picture ever fails to load, it just quietly disappears — the question text and judging keep working either way.

### Changed
- Uploaded pictures are stored in Cloudflare's object storage and served from a stable, long-lived URL. Removing or replacing a picture (deleting its question, swapping the image, or switching a question away from the picture type) cleans up the old file automatically.

## [0.5.0.0] - 2026-09-22

### Added
- Questions can now be multiple choice: authors pick this in the question-bank editor, add options, and mark the correct one. Text questions still work exactly as before.
- Teams see the options on their own phone during their turn and can tap one — and change their mind and re-tap right up until the host judges the answer.
- The host sees which option a team currently has picked, highlighted next to the question, before deciding correct or incorrect. The host still makes the final call either way — a team's tap is never auto-scored.

### Changed
- The question-bank editor now shows a "問答"/"選擇" (text/multiple choice) switcher per question, with dynamic add/remove for options and a radio to mark the correct one. Switching a question's type clears its old content rather than trying to convert it.

## [0.4.0.0] - 2026-09-22

### Added
- A question-bank editor at `/bank-editor`, gated by an owner key: load the whole question bank, add, edit, or delete questions per room and the boss, and save. Text questions only for now.
- The question bank now lives in its own cloud storage (a Durable Object) instead of only the file bundled into the app, so it can be edited without a redeploy. If that storage is ever unreachable, new games fall back to the bundled bank automatically — a game is never blocked from starting.
- Saves are conflict-checked: if the bank changed since you loaded it (another tab, another device), your save is rejected with a clear message instead of silently overwriting someone else's edit.

### Fixed
- The size limit on saving the bank now checks the actual data sent, not just a header a request could lie about or omit.

## [0.3.0.0] - 2026-09-22

### Added
- Teams now hit a DM-style branching choice each time they clear a room: two fixed options ("fight" / "negotiate") appear right on their own phone, don't block the game for anyone else, and can be answered whenever — even after the team has moved on to a later room.

### Fixed
- A rare corrupted save (from before this feature existed, or otherwise malformed) could crash a room on restart instead of just discarding the bad entry.

## [0.2.0.0] - 2026-09-22

### Added
- Rooms nobody is using now rest and are eventually forgotten. Two hours with no real activity (someone joining, starting, judging, taking notes) closes every connection and shows a "resting" notice with a reconnect button — the game itself stays saved. Twenty-four hours with no activity forgets the room entirely and frees its 4-letter code for reuse.
- Creating a room whose code happens to already belong to someone else's room no longer fails silently — the host page automatically tries a new code, up to five times, before showing an error.

### Fixed
- A room watched only on the big screen, with nobody ever actually playing, now still eventually rests — closing a gap where an unattended TV could keep a room (and its Cloudflare usage) alive indefinitely.
- A rare timing window during room cleanup could let a connection arriving at exactly the wrong moment write stale data back into storage that was being cleared; that window is now closed.
- The room's own wake-up alarm could be silently lost if the server was recycled at just the wrong moment; the fix waits for the alarm to be durably scheduled before considering the check complete.
- At very short idle/expiry settings (used by the automated tests, not real play), the room's saved "last active" time could round away enough precision to make a just-active room look idle; the rounding now scales with the configured duration instead of always rounding to the minute.
- A rare case where the host's browser lost its saved key at exactly the wrong moment could leave the screen stuck with no error message; it now shows the normal error instead.

### Changed
- The README now explains the resting/forgetting behavior and its Cloudflare usage protection.
