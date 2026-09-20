# Design system: Critical Answer (致命答題)

Cute pixel dungeon. Approved in `docs/designs/critical-answer-iteration-2.md` (design review, 2026-09-19).
Everything is drawn in code or CSS. No image assets.

## Tokens (`app/globals.css`)

| Token | Value | Use |
|-------|-------|-----|
| `--k` | `#2a1533` | 4px outline, chip background |
| `--ink` | `#3a2245` | text on panels |
| `--cream` / `--cream2` | `#fff4dc` / `#f1dcb6` | panel face / bottom bevel |
| `--lav` / `--lav2` | `#e9defa` / `#cdbdf0` | narration and nameplate panels |
| `--turn` / `--turn2` | `#fff0a8` / `#f4c94a` | the team whose turn it is |
| `--ok` | `#6fd36a` | correct, score cells |
| `--danger` | `#ff6b6b` | ribbon, boss |
| `--warn` | `#ffcf4a` | retry button |
| `--orange` | `#e8862a` | **only** on the dark chip or large shapes |

Small orange text on cream is 2.4:1 and fails. Small labels (第 N 題, 難度) use `LabelChip`, which is orange on `--k` (6.3:1).

## Type

- Chinese and body: **俐方體11號 (Cubic 11)**, `public/fonts/Cubic_11.woff2`, SIL OFL. Taiwan glyph forms.
- Digits and scores: **Press Start 2P**, class `px-num`.
- Both are bundled so LAN play works with no internet.

## Components (`components/pixel.tsx`)

`Panel` (cream, lav, turn), `PixelButton` (ok, retry, flee, primary), `LabelChip`, `Sprite` (slime, ghost, dragon, owl, hero, crown, heart, torch), `SceneBackground` (stone, moss, crimson), `ScoreMeter` (15 cells), `TurnRibbon`, `Nameplate`, `DialogueBox` (owl portrait, `…` loader, one typewriter line).

Sprites are drawn in `lib/pixel-art.ts`. Scale them by whole numbers only, so pixels stay square. `TEAM_LOOKS` gives eight team looks (three hat shapes over eight colors) because a room holds up to 8 teams.

## Rules

- Big screen (`/screen`): fixed 1920×1080 stage, scaled with `transform: scale()`, letterboxed outside 16:9.
- Judge buttons live in the thumb zone. `PixelButton.ok` is 78px tall.
- Motion is two-frame `steps()` only. `prefers-reduced-motion` stops blinking, typing and hopping.
- Never show an answer on `/screen` or `/play`.
