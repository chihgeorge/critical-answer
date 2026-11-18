---
bump: patch
---
### Changed
- The owner's reply checks (Traditional Chinese, no questions left in the reply text) now run as a fixed-rule Stop hook script, `scripts/stop-lint.mts`, instead of three model-judged prompt hooks that kept blocking on vague "not enough evidence" verdicts.
