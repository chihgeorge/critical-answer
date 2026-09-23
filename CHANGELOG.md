# Changelog

All notable changes to Critical Answer are documented here.

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
