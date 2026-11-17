---
bump: patch
---
### Changed
- `npm run canary:live` reports `CANARY BROKEN` when a round checked no question: every answering step was skipped by the host (`skipped:`) or was a card (`passed:`). The round prints `ROUND r<n> FAIL verified nothing`, which the Canary workflow copies into its issue comment. (#316)

### Added
- Design for a read-only canary bank key, so the live canary could play a chosen bank without the owner key (`docs/designs/canary-bank.md`, #317). Not built yet.
