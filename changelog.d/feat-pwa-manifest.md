---
bump: minor
---
### Added
- Players can add the phone page to their home screen. Opened from the icon, it runs full screen with no address bar, so it is harder to close by mistake. The site now has a web app manifest with the slime icon at 192px and 512px. An icon added from a room's phone page opens straight back into that room. On an iPhone the icon does not share data with Safari, so a team that joined in Safari counts as a new phone there; the hosting guide says how to recover. There is no service worker and no offline cache, so a phone always loads the current version.
