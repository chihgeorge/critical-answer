### Changed
- AI narration repeats itself less: the prompt carries the room's last 8 AI lines and asks the model not to reuse those sentences or their pet phrases, to word each line differently, and to use at most one exclamation mark per line. The list is kept per room and forgotten on a server restart.
