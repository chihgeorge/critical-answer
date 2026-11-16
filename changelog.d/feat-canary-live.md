---
bump: patch
---
### Added
- **After a deploy, one command plays a real game on the live site.** `npm run canary:live` opens a room as a host, puts it on a big screen, joins two phone teams, answers one question, checks that the big screen and the other phone update, passes the turn and ends the game. It prints one line per step and page with timings and console errors, then `CANARY HEALTHY` or `CANARY BROKEN`, and exits non-zero when broken. `--rounds N` plays more games, and `--base URL` points it at a preview or local site. See the post-deploy check in the deployment guide.
