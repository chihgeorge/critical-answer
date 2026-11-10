# Screen key: a question video's id goes only to the big screen

Status: approved by the owner, 2026-11-09 (security audit, medium finding 1).

## Problem

A YouTube question's `videoId` was part of `PublicQuestion`, so every `STATE` carried it to every connection: the
players' phones, and any `/room/<code>/screen` page, which needs no token. The room code is on the TV. A player who
reads the id from their phone's network traffic can open the video on YouTube and read its title, which is the
answer to a music question. The 「只放聲音」 card on the big screen (`components/youtube-player.tsx`) only covers the
picture.

## What it does

- Each room has a **screen key**: `crypto.randomUUID()`, made with the room, saved in the room snapshot
  (`RoomSnapshot.screenKey`), replaced when the room is reset. A snapshot from before the key gets a new one on
  restore, and the next save writes it.
- The host page gets the key in `HOST_OK` (so a reload gets it again) and shows the big screen link as
  `/room/<code>/screen#k=<key>`. The key is in the URL fragment, like the host token: a browser sends a fragment
  neither in a request nor in a Referer, so it reaches no server log.
- The big screen sends it in `SCREEN_HELLO { key }` on every connect. The room compares it with `tokensEqual`
  (constant time, as for `OWNER_KEY` and the host token) and remembers the connection in `keyedScreens`. A reconnect
  must prove it again. The key is never logged.
- `STATE` never carries a question video's id. `PublicQuestion.content` and `AnswerReveal.video` are a
  `HiddenVideo`, `{ kind: "youtube", audioOnly? }`: enough for a phone to say 「🎵 聽大螢幕」 and for the host page to
  show its ▶ ⏸ ⟲. The type has no `videoId` field, so the compiler refuses a `STATE` that would hold one.
- The id goes out in a separate message, `SCREEN_VIDEO { questionId, video }`, sent directly (never broadcast) to the
  host pages and the keyed screens: before every `STATE`, on `HOST_CLAIM`, and on a `SCREEN_HELLO` with the right key.
  It is the video on the big screen now (`shownVideoId()`): the question in play, or the answered question during
  its reveal.
- A big screen with no key, or a wrong one, works as before for everything else. Where the video would be it shows
  「🔒 請用主持人頁上的大螢幕網址開啟，才會播放影片」.

## Why a separate message, not one STATE per role

One `STATE` for everyone stays one `JSON.stringify` and one broadcast, as before. The secret has one way out
(`sendVideo`), the same pattern as `HOST_ANSWER` for the answer, and a path that forgets to call it fails closed: the
screen shows the hint, no id leaks. A per-role copy of `STATE` would need every send path (`broadcast`, `sendTo`,
`onConnect`) to pick the right copy, and a path that picks wrong leaks.

## Every path that could carry the id

| Path | Before | Now |
| --- | --- | --- |
| `STATE.question.content` | `videoId`, `start`, `end` | `HiddenVideo` |
| `STATE.reveal.video` (the answered question's video, D17) | `videoId`, `start`, `end` | `HiddenVideo` |
| `STATE.media` (▶ ⏸ ⟲) | `questionId`, `state`, `seq`, `press`: never the id | unchanged |
| `STATE.clipError`, `SCREEN_CLIP_ENDED`, `SCREEN_CLIP_ERROR` | question ids only | unchanged |
| `STATE.reveal.explanation` of kind `youtube` | `videoId` | unchanged, see below |
| `HOST_PICKS`, `HOST_ANSWER`, `TRANSCRIPT` | host only | unchanged |
| `SCREEN_VIDEO` | did not exist | host pages and keyed screens only |

Not changed, on purpose:

- **A video explanation** (`reveal.explanation`) is another video, sent only with the answer after a correct answer,
  and phones play it. It gives away nothing the reveal has not already shown.
- **Images** go out as a public R2 URL whose path is a random UUID: the URL says nothing about the answer.
- **The host page** gets `SCREEN_VIDEO` too. It already has every answer (`HOST_ANSWER`).

## Limits

- The key keeps the id from a player's own devices. It does not stop someone who can read the big screen's own
  browser (its devtools, or the link on the host's laptop).
- An unkeyed socket can still send `SCREEN_HELLO` and the `SCREEN_*` reports (TODOS.md, 「任何人都能宣告自己是大螢幕」).
  That is a nuisance, not a leak, and is left for after the event.
- A big screen link from before a room reset has the old key: it shows the hint until it is opened again from the
  host page.

## Tests

`lib/room/youtube-media.test.ts` (「the screen key」): a phone, a screen with no key, a wrong key or an empty key, and a
socket that connects during the reveal never receive the id, in any message, through the question, ▶ ⏸ ⟲, the reveal
and the next question; nothing broadcast holds it; the host and a keyed screen get it before the `STATE`; a reconnect
or a later hello without the key loses it. `lib/room/persistence.test.ts`: the key survives a restart, and a
snapshot with no key or a damaged one gets a new key that is then kept. `e2e/image-question.spec.ts`: a big screen
opened without the key shows the hint and no player.
