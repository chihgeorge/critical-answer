# Late join: a team that arrives after the start

Status: rules set by the owner, 2026-11-09 (TODOS.md 「遊戲開始後，新隊伍可以中途加入」).

## Problem

Once the game started, every new team's JOIN got `game_already_started`. Friends who arrive late could only watch.

## What it does

- A new team's JOIN after the start passes the same checks as in the lobby (join password, team name, one team per
  connection, 8 teams). It is then a **waiting team**: its phone shows 「等主持人讓你們加入…」 and nothing of the
  running game. The host page shows a row 「🚪 <name> 想中途加入」 with 「收這隊」 and 「不收」, under the team rows.
- 「收這隊」 (`HOST_LATE_TEAM`, `admit: true`): the team starts in the first room with a question from the shared
  deck, and goes to the end of `turnOrder`. It rolls no 擲先攻. The owl says 「🚪 <name>中途加入冒險，排在最後一個！」.
- 「不收」 (`admit: false`): the phone gets `team_removed` with detail `not_admitted` and shows
  「主持人這場沒有收你們的隊伍」 with the link home. As after the lobby's 移除, its automatic reconnect does not JOIN
  again; opening the room again from the home page does, and the team waits again.
- Once any team is in the boss room, or the game is over, nobody is let in (`lateJoinOpen` in `lib/game-state.ts`).
  `STATE.late.closed` is then set: the phone shows 「這場快結束了，等下一場」 and the host row loses 「收這隊」. A team
  that JOINs after that point waits the same way.
- 「回到大廳」 moves every team still waiting into the lobby, so "wait for the next game" needs no second JOIN.

## Decisions

| # | Question | Decision | Why |
| --- | --- | --- | --- |
| L1 | Starting score | Both counts start level with the team in last place at that moment: `reward` (decides the winner) and `score` (progress, decides the boss door) are each the lowest any team has. | The owner's rule is "the lowest score on the table". Giving only `reward` would leave the team the only one far from the boss door. No team is in the boss room when a team is let in, so the lowest `score` is always under the threshold. |
| L2 | Class | The waiting screen has the lobby's class picker (`TEAM_PICK_CLASS` works for a waiting team). The host may press 「收這隊」 at any time; the class picked by then is fixed, as at HOST_START. No pick means a plain adventurer. | Nothing waits on the team: the host is never blocked, and no new "pick after joining" state exists. |
| L3 | Where waiting teams live | `lateTeams` in the room, beside `pendingTeams`; sent to everyone as `STATE.late` (names and classes only, like the lobby list). | The game state stays what it was; a waiting team is in no turn order, map or ranking until it is let in. |
| L4 | Restart | Waiting teams are saved (`RoomSnapshot.lateTeams`, optional, no schema bump). | Their keys are saved in `teamKeys` anyway; dropping the list would leave keys without a team, and latecomers would have to type their name again after every deploy. A damaged list is dropped, the rest of the save is kept. |
| L5 | 8-team limit | Playing plus waiting teams count together. | Each waiting team may be let in, or lands in the next lobby. |
| L6 | When 「收這隊」 is refused (`late_closed`) | During the intro and 擲先攻 (the team would roll with everyone; the host page shows the rows once they are over), while a fork's door opens (STATE shows the game from before), and once the boss fight has begun. | Each is short or final. 「不收」 always works. |
| L7 | 改判答對 | Letting a team in closes an open undo, like 🧪 給藥水. | The undo judges from the game before the 答錯, which has no such team. |
| L8 | Team handoff | The waiting screen keeps the 「換了手機？」 code input. A waiting phone that claims a team stops waiting: its waiting team is dropped, and that team's other phones get `team_removed`. | Before this feature a new phone reached that input on the `game_already_started` screen, which no JOIN shows any more (docs/designs/team-handoff.md). |
| L10 | A waiting team's phone | Bound to its team, but not playing: reactions, 擲先攻 rolls and answers from it are refused (`playingTeam`, `handleReact`). | Before this feature every bound phone in a game was a game team. |
| L11 | Titles | A late team's boss entry is never `earned` (`Team.late`), so it cannot take ⚡ 閃電突擊 with the few turns it played. Its other counts are its own. The game log still records its real turns. | It starts with a score it did not answer for. |
| L12 | Refused mid-game | Every refusal screen shown while a game runs keeps the 「換了手機？」 input, not only the ones with `handoff`. | A replacement phone that types its team's own name gets `duplicate_name`, and a full room gives `room_full`, before the phone could wait. |
| L9 | No phone connected at 「收這隊」 | The team is added offline, so its turn is skipped until a phone comes back. | Same rule as any offline team. |

## What does not change

The shared deck (`deal`), the map, the podium, the other titles, the narration and the big screen's team list all read
`game.teams`, so one more team needs no change there. Manual pacing (docs/designs/manual-pacing.md) is untouched:
letting a team in arms no timer. Reconnects and `teamKey` work as before for both waiting and playing teams.

## Not in scope

- A waiting row on the host page during the intro and 擲先攻, and on the big screen.
- A rollback to a Worker from before this feature while teams wait: their saved keys would name no team there.
- Keeping a refused team out for good: after 「不收」 a fresh JOIN waits again, and junk JOINs can hold free slots
  of the 8, as in the lobby. The join password is the gate. The waiting rows carry no online mark.
- 「不收」 on the host page once the game is over: the rows show only while the game is played; in the next lobby
  the team has the usual 「移除」.

## Tests

`lib/room/late-join.test.ts` (waiting, the JOIN checks, 收 / 不收, score, turn order, first room, the boss cut-off,
8 teams, the intro, reconnect, handoff, restart), `lib/join-rejection.test.ts`, `e2e/late-join.spec.ts`.
