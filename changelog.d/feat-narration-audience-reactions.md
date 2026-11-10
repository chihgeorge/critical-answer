---
bump: minor
---
### Added
- The narrator mentions the audience: when at least two different waiting teams react during one team's turn, with at least 3 taps in all and at least 2 of the same reaction, the next judged narration adds a middle line about the team that tapped it most, for example 「藍莓在後面噓聲四起……」. Never on two judgments in a row, never on the game's last line, and a line the host queued takes its place. Scripted narration draws from 8 lines per reaction (each 22 characters or fewer), none naming the team on turn or hinting at the result; the AI prompt gets a short rule (no hint that the reaction is about a right or wrong answer) and the reacting team and mood as quoted data, nothing about the question. Reactions still score nothing, are not saved and never change whose turn it is. Design in `docs/designs/audience-reactions.md`.
