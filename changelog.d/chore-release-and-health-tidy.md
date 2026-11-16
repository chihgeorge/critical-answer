---
bump: patch
---
### Changed
- **A changelog note can no longer cut the GitHub Release notes short.** CI now refuses any `## ` line in a `changelog.d/` note, not only a `## [x]` version heading, and asks for `### ` instead. Before, a `## Notes` line made the release notes drop it and everything after it in that version.
- **Release commits show the release app as their author.** The automatic release commit now uses the GitHub App's own bot name and user id, so GitHub shows its avatar and links to it. If that lookup fails, the commit keeps the old fixed name and the run prints a warning.
- **The health check also looks for unused code and shell script mistakes.** `npx knip` finds unused files and exports, and `shellcheck -S warning scripts/*.sh` checks the shell scripts. Two unused exported types were removed so knip starts clean.
