# Design system: Critical Answer (致命答題)

Cute pixel dungeon. Approved in `docs/designs/critical-answer-iteration-2.md` (design review, 2026-09-19).
Everything is drawn in code or CSS. No image assets. Sound follows the same rule: the big screen's background music and event sound effects are synthesized with the Web Audio API (`lib/bgm.ts`, `lib/sfx.ts`, `lib/bgm-player.ts`), no audio files.

## Tokens (`app/globals.css`)

| Token | Value | Use |
|-------|-------|-----|
| `--k` | `#2a1533` | 4px outline, chip background |
| `--ink` | `#3a2245` | text on panels |
| `--cream` / `--cream2` | `#fff4dc` / `#f1dcb6` | panel face / bottom bevel |
| `--lav` / `--lav2` | `#e9defa` / `#cdbdf0` | narration and nameplate panels, the big screen's 「今晚的菜」 dish card |
| `--turn` / `--turn2` | `#fff0a8` / `#f4c94a` | the team whose turn it is |
| `--ok` | `#6fd36a` | correct, score cells |
| `--ok2` | `#3f9a3b` | a correct tile's or bar's bevel |
| `--danger` | `#ff6b6b` | ribbon, boss |
| `--warn` | `#ffcf4a` | retry button |
| `--orange` | `#e8862a` | **only** on the dark chip or large shapes |
| `--dim-ink` | `#8a7a8f` | text on an eliminated or faded option tile, or on a question the host's picker can't pick |
| `--dim-line` | `#7a6a80` | that tile's or picker row's outline, and the tile's letter chip |
| `--wrong` | `#c94848` | the ✕ 答錯 label and a wrong tile's bevel |

Small orange text on cream is 2.4:1 and fails. Small labels (第 N 題, 難度) use `LabelChip`, which is orange on `--k` (6.3:1).

## Type

- Chinese and body: **俐方體11號 (Cubic 11)**, `public/fonts/Cubic_11.woff2`, SIL OFL. Taiwan glyph forms.
- Digits and scores: **Press Start 2P**, class `px-num`.
- Both are bundled so LAN play works with no internet.

## Components (`components/pixel.tsx`)

`Panel` (cream, lav, turn), `PixelButton` (ok, retry, flee, primary), `LabelChip` (`tone="tag"`: the live map's cream-on-`--k` team tag, 12px), `Sprite` (slime, slime-lost, slime-king, ghost, ghost-cry, dragon, owl, hero, crown, heart, torch, campfire, door, cloud, zz, pot, smoke, and one `dish-*` per monster sprite: jelly, stew, tower, ice, riceball, skewer), `SceneBackground` (stone, moss, crimson), `HomeBackground` (the home page's dungeon corridor, seen in perspective, sized to the viewport so its pixels stay square, with flickering torch sprites on its side walls), `ScoreMeter` (15 cells), `TurnRibbon`, `Nameplate`, `DialogueBox` (owl portrait, `…` loader, and one or more lines typed in order: the result line, then a line about the next team, with a 2.2 s reading pause between them; the ▼ shows only while another line is still to come, so it means "the owl has more to say").

Also: `components/how-to-play.tsx` (`HowToPlay`, the big screen's 4-page how-to-play slideshow: a `LabelChip` 「怎麼玩？ n/4」, a cream `Panel` with a picture built from existing sprites and one line of 34px text, and the owl's `DialogueBox`; pages swap at once and the sprites use `px-hop`, still under reduced motion. `INTRO_PAGE_TEXT` holds each page's topic, text, owl line and the host's script; see `docs/designs/how-to-play.md`), `components/map-strip.tsx` (the big screen's live map: rooms, team pawns with one-character tags, fog clouds, the boss door that opens into the boss room; geometry from `lib/map-layout.ts`, see `docs/designs/live-map.md`), `components/mc-option.tsx` (`McOption`, one A–D multiple-choice tile on `/screen` and `/play`, `.px-opt` in `app/globals.css`; looks `plain`, `sel`, `lock`, `ok`, `bad`, `dim`, see `docs/designs/phone-answering.md` D5–D14), `components/d20.tsx` (`D20`, the warrior's die face on `/play`, and `RollOverlay`, the big screen's dimmed 2 s roll (the warrior's roll, a correct lock's crit die, a fill-in's persuasion check) whose die tumbles with the two-frame `.px-roll-tumble` and lands on the room's value; reduced motion shows the value at once, see `docs/designs/class-abilities.md`; and `KillRollOverlay`, the boss kill's 4 s beat: four 150px dice that land one by one 0.5 s apart over a running-sum bar that turns `--warn` on the final 分 total, a sneak shown as `43 × 2 = 86 分`; reduced motion shows all four at once, see `docs/designs/kill-roll.md`), `components/mage-hint.tsx` (`MageHint`, the mage's 「🔮 第一個字：…」 bar on a fill-in question, in `#c9b3ff`, on `/play`, the host page and `/screen`; it also shows a passed persuasion check's hint on `/play` and `/screen`), `components/error-screen.tsx` (`ErrorScreen`, the cream `Panel` with 「畫面出錯了」 and an `ok` 「重新載入」 button that `app/error.tsx` and `app/global-error.tsx` show instead of a blank page), `components/youtube-player.tsx` (`YoutubePlayer`, the big screen's 384×216 YouTube player on the official IFrame API, driven by the host's ▶ ⏸ ⟲; a music question covers it with `MusicCard`: `--lav`, a pixel note drawn in 4px cells, 聽歌猜題, a five-bar `.px-eq` equalizer that jumps two-frame only while the song plays and stops under reduced motion, and the state in words: 準備中、播放中、暫停、播完、影片無法播放. On a YouTube question the screen's DC chip, sneak chip, `MageHint` and typed answer move to a side column right of the player; the reveal keeps the same player; its dish waits for 🍲 上菜. The host page's three 56px buttons light ▶ or ⏸ for the last command in `--ok` (⟲ lights ▶); see `docs/designs/youtube-questions.md`), `components/cooking.tsx` (🍲 上菜 on the big screen: `useCookStep` and `useFinaleStep` swap hard-cut frames, monster → `pot` (two-frame bubbles) → `smoke` → the monster's `dish-*` sprite where it stood, with `DishCard` in the answer panel's place; reduced motion and a page opened on a served dish show the dish at once; see `docs/designs/monster-cuisine.md`), `components/stage.tsx` (the scaled big-screen stage) and `components/qr.tsx` (QR in the panel colors; give it an `alt`).

Text input (`.px-input` in `app/globals.css`): same hard 4px outline as panels/buttons, cream face; used by the bank editor's forms.

Sprites are drawn in `lib/pixel-art.ts`. Scale them by whole numbers only, so pixels stay square. `TEAM_LOOKS` gives eight team looks (three hat shapes over eight colors) because a room holds up to 8 teams.

## Rules

- Big screen (`/screen`): a fixed **960×540** stage (every approved mockup is this size), scaled with `transform: scale()` and letterboxed outside 16:9. 1920×1080 is exactly 2x and 4K exactly 4x, so pixels stay square. (An earlier note said 1920×1080; decision 6A was revised on 2026-09-20.)
- Judge buttons live in the thumb zone. `PixelButton.ok` is 78px tall.
- Motion is two-frame `steps()` only. `prefers-reduced-motion` stops blinking, typing, hopping and cloud drift. One exception: when a map pawn changes room, the room it lands in keeps its single `--turn2` outline flash, so no team moves unseen (live map D13). The cooking after 🍲 上菜 is hard cuts between frames (monster, pot, smoke, dish), never a slide; the pot's bubbles flick between two canvases like the torches (`docs/designs/monster-cuisine.md`, cooking I8). Reduced motion shows the dish at once.
- After a boss kill seen live, the end screen holds the winner, the podium and the epilogue for about 4.6 s while the boss cooks (cooking R8).
- Then the places are called (`docs/designs/podium-reveal.md`): the title reads 名次揭曉中…, every stand shows a ？ with no name, the score and crown wait. The narrator names the 大成功王 (a `CritKingCard`, if anyone rolled a natural 20), then third, second and first; each call fills its stand with a hard cut. A tie that changes the podium rolls d20s first in `TieRollOverlay` (the `RollOverlay` look, 150px dice, 90px for five or more). At first place the title becomes 奪得榜首 and every score, the crown and the confetti come up at once; the epilogue follows. The room keeps the reveal's clock (`lib/podium.ts`): a screen refreshed mid-reveal picks up at the current beat, one opened after it shows the podium at once, and so does reduced motion. The phone shows 冒險結束！看大螢幕 📺 until one second after the screen's first place.
- A question's answer is never shown while it's still in play (the host judges by ear). One exception:
  a mage's fill-in hint, or a passed persuasion check's, shows the answer's first letter or number on every screen (`MageHint`, issue #106 D4). Once a
  team answers CORRECTLY, the answer (and optional explanation media) is shown to `/screen` and `/play`
  — this is a shared-screen, in-person party game, so everyone in the room already sees the reveal
  together; it is not a competitive-integrity boundary. See `docs/designs/question-media-content.md`'s
  D2/D3 (2026-09-23, revised the earlier blanket rule). **Note (D7, impl change):** the reveal is
  carried on `STATE` with a `reveal: AnswerReveal | null` field, not a separate `ANSWER_REVEALED`
  broadcast; it stays on screen until the host presses 「下一題」 via `HOST_NEXT` (see `lib/protocol.ts`).
  `HOST_NEXT` carries the STATE's eventId, and the room ignores any `HOST_NEXT` with a mismatched eventId (a stale second-device tap).
  A `multipleChoice` question is judged by the team's lock, not by the host's 答對 / 答錯: the lock waits
  for the host's 公布答案, and a correct reveal also stays until 下一題 (`docs/designs/host-reveal.md`, v0.33;
  it replaced the 8–15 s auto-close of `docs/designs/phone-answering.md` D10, E2–E4).
