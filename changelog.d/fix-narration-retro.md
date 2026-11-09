### Fixed
- Narration: the AI line that names the next team always plays last as the handoff, even when the AI writes one line too few or too many. A middle line never calls the next team, so the owl no longer says 「輪到X」 twice on a boss hit, and never drops the handoff on an ordinary turn. If no AI line names the next team, the scripted handoff plays.
- Narration: every AI result, atmosphere and handoff line is held to 22 characters in code, not just in the prompt. A longer line is cut at a sentence break when that fits and keeps every team it named; otherwise that one slot uses the scripted line (the other AI lines still play). The host's queued line keeps its 50-character limit.
- The scripted result lines for a correct answer, a wrong answer and a flee grow from 5 to 10 each, so six teams hear the same line less often.
- Fixed the idiom 「磨牙霍霍」 → 「磨刀霍霍」 in a handoff line.
