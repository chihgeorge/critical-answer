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

`Panel` (cream, lav, turn), `PixelButton` (ok, retry, flee, primary), `LabelChip` (`tone="tag"`: the live map's cream-on-`--k` team tag, 12px), `Sprite` (slime, slime-lost, slime-king, ghost, ghost-cry, dragon, owl, hero, crown, heart, torch, campfire, door, cloud, zz), `SceneBackground` (stone, moss, crimson), `HomeBackground` (the home page's dungeon corridor, seen in perspective, sized to the viewport so its pixels stay square, with flickering torch sprites on its side walls), `ScoreMeter` (15 cells), `TurnRibbon`, `Nameplate`, `DialogueBox` (owl portrait, `…` loader, and one or more lines typed in order: the result line, then a line about the next team, with a 2.2 s reading pause between them; the ▼ shows only while another line is still to come, so it means "the owl has more to say").

Also: `components/map-strip.tsx` (the big screen's live map: rooms, team pawns with one-character tags, fog clouds, the boss door that opens into the boss room; geometry from `lib/map-layout.ts`, see `docs/designs/live-map.md`), `components/mc-option.tsx` (`McOption`, one A–D multiple-choice tile on `/screen` and `/play`, `.px-opt` in `app/globals.css`; looks `plain`, `sel`, `lock`, `ok`, `bad`, `dim`, see `docs/designs/phone-answering.md` D5–D14), `components/d20.tsx` (`D20`, the warrior's die face on `/play`, and `RollOverlay`, the big screen's dimmed 2 s roll whose die tumbles with the two-frame `.px-roll-tumble` and lands on the room's value; reduced motion shows the value at once, see `docs/designs/class-abilities.md`), `components/mage-hint.tsx` (`MageHint`, the mage's 「🔮 第一個字：…」 bar on a fill-in question, in `#c9b3ff`, on `/play`, the host page and `/screen`), `components/error-screen.tsx` (`ErrorScreen`, the cream `Panel` with 「畫面出錯了」 and an `ok` 「重新載入」 button that `app/error.tsx` and `app/global-error.tsx` show instead of a blank page), `components/stage.tsx` (the scaled big-screen stage) and `components/qr.tsx` (QR in the panel colors; give it an `alt`).

Text input (`.px-input` in `app/globals.css`): same hard 4px outline as panels/buttons, cream face; used by the bank editor's forms.

Sprites are drawn in `lib/pixel-art.ts`. Scale them by whole numbers only, so pixels stay square. `TEAM_LOOKS` gives eight team looks (three hat shapes over eight colors) because a room holds up to 8 teams.

## Rules

- Big screen (`/screen`): a fixed **960×540** stage (every approved mockup is this size), scaled with `transform: scale()` and letterboxed outside 16:9. 1920×1080 is exactly 2x and 4K exactly 4x, so pixels stay square. (An earlier note said 1920×1080; decision 6A was revised on 2026-09-20.)
- Judge buttons live in the thumb zone. `PixelButton.ok` is 78px tall.
- Motion is two-frame `steps()` only. `prefers-reduced-motion` stops blinking, typing, hopping and cloud drift. One exception: when a map pawn changes room, the room it lands in keeps its single `--turn2` outline flash, so no team moves unseen (live map D13).
- A question's answer is never shown while it's still in play (the host judges by ear). One exception:
  a mage's fill-in hint shows the answer's first letter or number on every screen (`MageHint`, issue #106 D4). Once a
  team answers CORRECTLY, the answer (and optional explanation media) is shown to `/screen` and `/play`
  — this is a shared-screen, in-person party game, so everyone in the room already sees the reveal
  together; it is not a competitive-integrity boundary. See `docs/designs/question-media-content.md`'s
  D2/D3 (2026-09-23, revised the earlier blanket rule). **Note (D7, impl change):** the reveal is
  carried on `STATE` with a `reveal: AnswerReveal | null` field, not a separate `ANSWER_REVEALED`
  broadcast; it stays on screen until the host presses 「下一題」 via `HOST_NEXT` (see `lib/protocol.ts`).
  `HOST_NEXT` carries the STATE's eventId, and the room ignores any `HOST_NEXT` with a mismatched eventId (a stale second-device tap).
  Exception: a `multipleChoice` question is judged by the team's lock, not by the host, and a correct
  lock's reveal closes on its own 8–15 s later (`docs/designs/phone-answering.md` D10, E2–E4).
