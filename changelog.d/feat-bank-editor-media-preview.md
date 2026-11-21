---
bump: minor
---
### Added
- Bank editor: a saved uploaded image, video or audio file now previews under its slot when the question is open (image thumbnail, native video/audio player that reads only the length until played). A file that can't be read shows a red error line instead of a broken element. The Worker's `/api/bank/image` answers `GET ?key=<uuid>` with a redirect to the file's public R2 address.
