---
bump: patch
---
### Fixed
- The big screen's narration no longer shows its next line before the voice has finished the one before it on the 叉路, 神秘房 and 占卜 screens and on the end screen: like the turn screen, each line waits for the voice, or for its safety timeout when a voice hangs. A line also stays up at least as long as it does with no voice (typed, then the reading pause), so a voice that ends or fails every line at once (some TVs) never flashes the lines past. With 🔊 off or no voice, the lines keep their usual pace.
