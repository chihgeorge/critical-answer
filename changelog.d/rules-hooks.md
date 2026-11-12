---
bump: patch
---
### Added
- `.claude/rules.md` holds the owner's rules for Claude Code sessions in this repo, in three groups: auto-blocked, AI-checked and guidance only.
- `.claude/settings.json` hooks: a PreToolUse hook (`scripts/rules-guard.mts`) blocks commands and file writes that match a section A rule (local e2e, bare `git stash`, claude-in-chrome tools, permissions edits, personal info in committed files, `VERSION`/`CHANGELOG.md` edits) and says which rule and why; three Stop prompt hooks send a reply back once when it is not in Traditional Chinese, asks a question without AskUserQuestion, or asks more than one thing.
