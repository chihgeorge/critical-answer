# Torch-lit dungeon (directions A + B + C)

Status: shipped in one PR (v0.81). Source: the 2026-11-16 art research (local-only, `~/.gstack/projects/<slug>/reports/dungeon-art-research-2026-11-16.md`) and its mockups. The owner chose to do A, B and C together. Direction D (stone frames and wooden option boards on the panels) is a separate PR; this one does not touch panel, option or dialogue box styles.

## What changed

- **A — torchlight.** `drawScene` drops the dithered vignette and bakes stepped light into the canvas: ambient 0.6, a warm pool at each torch and a cool pool in the arch's mouth, quantised into sixths with a one-pixel checker between steps. The question screen's torches hang high (scale 4, beside the question panel, clear of the A–D tiles), so the question and its reveal finally have light sources. `SCENE_TORCHES` is the one table both the torch sprites and the baked light read.
- **B — the room.** Rough stone in four shades, cracks and gaps, a ceiling band, a shadow at the wall's foot, a deep stone arch with a corridor stepping back and a raised portcullis, chains, cobwebs and two skull niches. 叉路 keeps its two doorways (`FORK_ARCH`), now with stone rims and corridors.
- **C — going down.** `roomTheme` goes by depth: stone (rooms 1–2, 入口石牆), moss (3–4, 苔蘚水道, with a water channel and vines), the new `deep` (5 on, 幽暗深淵), crimson for the boss. `floorLabel` names the room on stage in a `LabelChip` in the question panel's chip row, beside 「難度」 (moved there in review: under the ribbon it overlapped the ribbon and the panel). The live map is a black-rock cross-section: reached rooms lit in their own biome's stone, the unreached way solid dark (live map D8 still holds: no slots, nothing that counts rooms). D16's "the fog lightens" is that rock one step lighter. The fog reveal keeps its timing, classes and flash take; the cover is a block of dark rock instead of two clouds.

## Decisions from review (/autoplan, 2026-11-16)

| # | Decision | Why |
|---|----------|-----|
| 1 | Revert switch `DUNGEON_ART` in `lib/pixel-art.ts`, plus `?art=classic` on the big screen's URL (before the `#s=` key) | The event-week merge freeze blocks a redeploy; the event TV may crush the darks |
| 2 | Ambient 0.6, never darker than the old wall under 🌑; tested in `lib/scene-classic.test.ts` | A measurable floor for the TV risk instead of a prose rule |
| 3 | The boss room is darkest by its palette, not a lower ambient | Keeps it above the 🌑 floor; red stays the boss's |
| 4 | High torches through the question and its reveal (same `Playing` component) | No jump at the reveal |
| 5 | The scene and floor chip both come from one `stageRoom` (dish room through its reveal, else boss, else the team's room) | They never disagree at the reveal |
| 6 | The monster's shadow stays the existing DOM hexagon, darker in this look | It already exists; a baked one would double it |
| 7 | Map rooms tinted by each room's own biome | Each room is a place, not the team on turn |
| 8 | Classic pixels pinned by hashes taken on `main` before the change | "false = today exactly" stays true |
| 9 | One PR with the map redesign kept (both CEO voices suggested splitting) | The owner's explicit choice |

## Not done / follow-ups

- Not seen on the event TV or projector. If the darks crush, open the screen with `?art=classic`, or set `DUNGEON_ART = false`.
- Phones and the host page use the torch-lit palette of the team's biome (ambient only, no torch light); `?art=classic` covers the big screen only, and `DUNGEON_ART = false` reverts them too.
- After the event, keep one look and delete the other path (TODOS.md).
