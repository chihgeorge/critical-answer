# Changelog

All notable changes to Critical Answer are documented here.

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
