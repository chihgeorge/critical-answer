---
bump: minor
---
### Added
- The host page shows the big screen link as a QR code. Press 「顯示大螢幕 QR」 under the link and scan it with the device that drives the TV or projector, so nobody has to type the 36-character key with a TV remote. The QR holds the room's screen key and is for the big screen only, so it stays closed until you ask for it.

### Changed
- The room now listens only to a big screen that was opened with the host page's link or QR. A page opened with only the room code at `/room/<code>/screen` still shows the whole game, but the room ignores what it reports. It cannot start a video question's answer countdown, mark narration lines as read, raise the host's 「影片無法播放」 warning, or take one of the two places a full room keeps for big screens. Before, anyone with the room code could do all four from their phone.

### Fixed
- A big screen whose connection dropped just as a question video ended now tells the room again after it reconnects, so that question's answer countdown still starts.
