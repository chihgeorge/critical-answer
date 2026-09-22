# Changelog

All notable changes to Critical Answer are documented here.

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
