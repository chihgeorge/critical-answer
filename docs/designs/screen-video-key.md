# Screen key: a question video's id goes only to the big screen

Status: approved by the owner, 2026-11-09 (security audit, medium finding 1). Extended the same day: the host page
shows the link as a QR, and the room takes the big screen's reports only from a keyed screen (see 「The QR」 and
「Only a keyed screen is a big screen」).

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
  `/room/<code>/screen#s=<key>`, once the room has sent the key (「連線中…」 until then). The key is in the URL
  fragment, like the host token: a browser sends a fragment neither in a request nor in a Referer, so it reaches no
  server log. It is `#s=`, not the host token's `#k=`, so a screen link edited into a host link cannot overwrite the
  stored host token.
- The big screen page (`getScreenKey` in `lib/room-code.ts`) stores the key for this room in the browser and removes
  the fragment from the address bar: a big screen's address bar is projected to the whole room. A reload, or the
  plain `/room/<code>/screen` in the same browser, still has the key.
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
- The room answers every `SCREEN_HELLO` with `SCREEN_KEY { ok }`. A big screen with no key, or a wrong one, still
  shows the whole game; the room ignores what it reports (below). It says 「🔒 這台大螢幕不會播影片題的影片：請用主持人頁上的大螢幕網址開啟」 at the top
  of the lobby, and 「🔒 請用主持人頁上的大螢幕網址開啟，才會播放影片」 where a video would be. A keyed screen that has
  not been sent the id yet (a moment after connecting) shows an empty frame, not the hint.
- An unkeyed screen has no player, so it has no clip error to report, and the room ignores the report if one is
  sent (below): a player who opens `/screen` on a phone cannot raise the host's 「影片無法播放」 warning.

## The QR

The link holds a 36-character UUID: fine to click or paste, too long to type with a TV remote. The host page's big
screen panel has a button, 「顯示大螢幕 QR」, that opens a QR of the same link (`components/qr.tsx`, as for the join
QR). Scan it with the device that drives the TV or projector.

- The QR is closed until the host asks for it, and the text next to it says 「只給大螢幕掃」. The host's phone is in
  the room with the players; a QR that is always open would hand the key to anyone who points a camera at it. The
  link text above it leaves the key out (only the anchor's href has it): a photo of the host's phone can read a UUID.
- The button shows only once the room has sent the key (`HOST_OK`), like the link: 「連線中…」 until then.
- The QR is made in the browser. The key goes to no server.

**No short code.** A 6-character code typed on the big screen would be easier with a remote. It is not built:

- The room would have to trade the code for the key, which is a new message, a new secret with far fewer bits
  (about 31 for 6 characters from a 32-character alphabet, against 122), and so a guess limit and an expiry of its
  own, with a way for the host to make a new code when the old one has expired or been locked by guesses.
- The room code is on the TV, so anyone in the room can send guesses. A limit that locks the code also lets a
  player lock the real TV out, the same trade-off as the join password lock (TODOS.md).
- A device that drives a TV at an event is a laptop or a phone: it can open a link or scan a QR. A smart TV's own
  browser with only a remote is the one case left out; cast or plug a laptop in.

## Only a keyed screen is a big screen

Before, any socket that sent `SCREEN_HELLO` and had joined no team was a big screen: with the room code and devtools
a player could send `SCREEN_CLIP_ENDED` (start a video question's answer countdown early),
`SCREEN_NARRATION_PROGRESS` (lock the host's narration edits, or start the podium reveal early after 結束冒險) or
`SCREEN_CLIP_ERROR` (raise the host's 「影片無法播放」 warning), and two such sockets took the two places a full
room keeps for screens, so the real TV could be pushed out.

Now `isScreen` is `keyedScreens.has(id)`, and not a team's phone or a host page. `screenConns` is gone.

| Message from a big screen | Without the key | With the key |
| --- | --- | --- |
| `SCREEN_HELLO` | answered with `SCREEN_KEY { ok: false }`; nothing else changes | `SCREEN_KEY { ok: true }`, then `SCREEN_VIDEO` |
| `SCREEN_NARRATION_PROGRESS` | ignored, no reply | taken |
| `SCREEN_CLIP_ENDED` | ignored, no reply | taken |
| `SCREEN_CLIP_ERROR` | ignored, no reply | taken |
| A place among the `KEPT_SCREENS` (2) a full room never closes | no: it is a spare socket, closed first | yes, oldest first |

These are all the messages a big screen sends. `SCREEN_HELLO` is still answered without the key: the page needs
`ok: false` to show its 🔒 hint. An ignored report gets no `ERROR`, like a message dropped by the rate limit. A host
page sends none of these messages (it is never a screen, with or without the key), so nothing changes for it. A
later `SCREEN_HELLO` without the key takes the rights away again; a reconnect must prove the key again.

What a big screen without the key does now: it shows the whole game, reads the narration aloud, and plays no
question video (the two 🔒 hints, unchanged). The room does not hear what it has read, so with no keyed screen open:

- the host's narration panel never marks a line as read, and every line stays editable;
- after 結束冒險, the podium reveal waits `END_READ_CAP_MS` (20 s) instead of starting when the last line is read;
- a video question's answer countdown does not start (it already could not: that screen plays no video).

The page still sends its reports without the key; the room drops them. One rule in one place (`isScreen`) is
simpler than a second copy of it in the page.

A reconnect must prove the key again, so a report the page sent while its socket was down is dropped: the socket
library sends its queue before the page's `SCREEN_HELLO`. Narration progress and `SCREEN_CLIP_ERROR` were already
sent again after a reconnect; the page now sends the last `SCREEN_CLIP_ENDED` again too, on the first `STATE`. The
room ignores a repeat and an old question id.

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
- Whoever has the key is a big screen. A player who photographs the open QR, or reads the link on the host's
  laptop, can send the reports above and be sent the video ids, until the room is reset.
- A big screen opened without the key says so only in the lobby and where a video would be. Opened that way in
  the middle of a game (a new device, by the room code), it looks normal and the room does not hear it. The host
  page is not told either. Open it from the host page's link or QR.
- When a keyed screen reconnects it goes to the end of the kept order. With three or more keyed screens in a full
  room, the real TV may be the one closed. A key the host cannot replace during a game is the same limit as above.
- A big screen link from before a room reset has the old key: it shows the hint until it is opened again from the
  host page.
- The host page is not told when no keyed screen is connected. The lobby line on the screen itself is the warning.
  With no keyed screen, a video question's clip never ends, so its answer countdown does not start; ▶ still opens
  buzzing and the host can still judge.
- Deploy order: the web app and the Worker deploy separately. An old big screen tab with the new Worker, or the
  reverse, plays no question video until both are current and the screen is opened again from the host page. A room
  saved before the key gets a new key, so its big screen must be opened again too. Deploy when no game is live.
- Deploy order for the keyed reports: only the Worker changes what is accepted, and the page has sent the key since
  the first version of this design. New Worker with an old web app: a big screen opened by the host page's link is
  keyed and loses nothing (the host page has no QR yet); one opened with only the room code stops being heard, as
  described above. New web app with an old Worker: the QR works, and the old Worker still takes reports from any
  announced socket. A big screen tab from before the key existed sends no key: it keeps showing the game and must be
  opened again from the host page to be heard. Nothing is lost that a reload from the host page does not bring back.

## Tests

`lib/room/youtube-media.test.ts` (「the screen key」): a phone, a screen with no key, a wrong key or an empty key, and a
socket that connects during the reveal never receive the id, in any message, through the question, ▶ ⏸ ⟲, the reveal
and the next question; nothing broadcast holds it; the host and a keyed screen get it before the `STATE`; a reconnect
or a later hello without the key loses it; `SCREEN_KEY` says which. The keyed reports: `lib/room/answer-clock.test.ts`
(`SCREEN_CLIP_ENDED`), `lib/room/boss-buzzer.test.ts` (`SCREEN_CLIP_ERROR`) and `lib/room/dungeon-room.test.ts`
(`SCREEN_NARRATION_PROGRESS`) each send the report after a hello with no key, an empty key and a wrong key and see
nothing change, then with the key and see it taken; `dungeon-room.test.ts` also fills a room and sees two sockets
that announced themselves without the key closed before any keyed screen. `lib/room-code.test.ts`: the `#s=` fragment is
stored, removed from the address bar, and never taken for the host token. `lib/room/persistence.test.ts`: the key survives a restart, and a
snapshot with no key or a damaged one gets a new key that is then kept. `e2e/image-question.spec.ts`: a big screen
opened without the key shows both hints and no player; `e2e/host-drawer.spec.ts`: the link carries the key and the
opened screen's address bar does not; the QR is closed until 「顯示大螢幕 QR」 is pressed. Every e2e spec that opens
a big screen beside a host page opens it with the keyed link (`screenUrl(host)` in `e2e/answer.ts`).
