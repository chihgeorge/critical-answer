---
bump: micro
---
### Fixed
- 上線後的 canary 不再發出聲音：無頭 Chromium 改用靜音的 speechSynthesis（每句照樣在片刻後結束，旁白佇列照常前進），並加上 `--mute-audio`，在 macOS 上不會再把大螢幕旁白念出來。
