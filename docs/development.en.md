[繁體中文](development.md) | English

# Development guide

Tech stack, commands, tests, versions, and what each file does.

## Tech stack

- [Next.js](https://nextjs.org/) 16 + React 19 + Tailwind CSS 4 + TypeScript
- [Cloudflare Workers](https://workers.cloudflare.com/) + Durable Objects ([`partyserver`](https://github.com/cloudflare/partykit/tree/main/packages/partyserver)): the room and WebSocket connection layer, one Durable Object per room code ([worker/index.ts](../worker/index.ts)). The game logic is in [lib/room/dungeon-room.ts](../lib/room/dungeon-room.ts) and does not depend on any platform
- All pixel graphics are drawn in code. The fonts (俐方體11號 / Cubic 11 and Press Start 2P, both SIL OFL) are in `public/fonts/`, so the game works without internet access. See [DESIGN.md](../DESIGN.md) for the design rules
- Anthropic Messages API (optional): AI narration, called only on the server
- Vitest: unit tests; Playwright: end-to-end tests

## Running locally

Requires Node.js 22.18 or later (`.nvmrc`; CI and the Cloudflare build also use 22). `node scripts/*.ts` relies on Node's built-in type stripping, which is on by default only from 22.18.

```bash
npm install
npm run dev
```

`npm run dev` starts both Next.js (`http://localhost:3000`) and the room server (`wrangler dev`, `localhost:8787`, the same code that runs on Cloudflare). Locally it binds only to localhost; to let phones join, use the LAN playtest below.

### Let phones join (LAN playtest)

Phones cannot reach your computer's `localhost`, so you need the LAN IP. One command does it; the phones and the computer must be on the same Wi-Fi:

```bash
sh scripts/playtest.sh start    # builds the production version, starts it, and prints the URL at the end
sh scripts/playtest.sh status
sh scripts/playtest.sh stop
```

It finds the LAN IP on its own and uses two ports, 3100 (web) and 1998 (room server). On stop it kills every program that holds these two ports (it does not check whether they belong to this project), so do not use these two ports for anything else. If the phones cannot open the page, check whether the macOS firewall blocks incoming connections to node. (The same commands are also available as `npm run playtest` / `npm run playtest:stop`.)

## Common commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the front end and the room server together (`wrangler dev`) |
| `npm run dev:next` / `npm run dev:worker` | Starts them separately |
| `npm run playtest` / `npm run playtest:stop` | Builds the production version and starts / stops it on the LAN (see [Let phones join](#let-phones-join-lan-playtest) above) |
| `npm test` | Runs the unit tests (without the tests that call Claude) |
| `ANTHROPIC_API_KEY=... npm run test:live` | Runs the LLM narration smoke test with a real key (costs a few cents) |
| `npm run e2e` | Playwright end-to-end tests (starts its own servers on ports 3101 and 1996; normally left to GitHub CI, because it is too heavy for a local machine. CI splits the tests into two groups that run in parallel) |
| `npm run check:bundle` | After a build, checks that no questions or answers got into the browser bundle |
| `npm run check:docs` | Checks the relative links and anchors in README, SECURITY.md and the `docs/` guides, and that each Chinese doc has its English twin |
| `npm run test:watch` | Tests in watch mode |
| `npm run lint` | ESLint |
| `npm run build` | Builds the front end |

## Tests

The end-to-end tests (`npm run e2e`) run only on GitHub CI: on every PR and every push to `main`, in two parallel groups. They are too heavy for a local machine; do not run them locally. `npm run check:bundle` must always run; it stops answers from leaking into the browser bundle. `npm run check:docs` checks that the relative links and `#` anchors in README, SECURITY.md and every `.md` at the top level of `docs/` (not `docs/designs/`) still resolve.

**Bilingual docs**: README, SECURITY.md and the guides in `docs/` (except `going-public.md`) each have an English twin `X.en.md`. A PR that changes one language changes the other in the same PR. Both open with the language switch line, keep the same number and levels of headings, and the English docs link to English docs. `npm run check:docs` fails on a missing twin, an English doc with no Chinese doc to pair with, a wrong switch line or headings whose levels differ. It does not check that a translation is up to date, or that an English doc links to English twins (`rules.en.md`, not `rules.md`).

> When there is a `.env` in the project root, **the test servers turn AI on by default**. The Playwright end-to-end tests always turn it off, so they never call the real API.

## Saving and rollback

**Rooms are saved**: before each message it sends out, a room first saves itself into Durable Object storage (game state, question decks, host and team keys, the question bank, the epilogue, and the next narration line the host has queued; the question bank is stored as a separate record and written only when it changes). After the server is killed, redeployed or recycled, the room restores itself: scores, whose turn it is and who the host is are all kept. After a restart every team counts as offline until its phone rejoins (while no team is online, it is nobody's turn). When the save format is not recognized (a version mismatch, or an old save from before the boss phases shipped), the save is dropped and the screen shows 「遊戲已重置」 (Game reset). Do not roll the Worker back to a version before v0.31.3.0: older versions cannot read the new saves, and every room in progress will be reset. Not saved: the connection list, the pairing code for switching phones, and the narration log (it is only a download for the host). Local `wrangler dev` works the same way and stores it in `.wrangler/`.

## Versions and releases

Version numbers have four parts (for example `0.16.1.0`). `/ship` picks the number from the change and writes it into `VERSION` and `CHANGELOG.md`. When a version merged into `main` is `X.Y.0.0` (the second part or higher changed, meaning there is a new feature), [.github/workflows/release.yml](../.github/workflows/release.yml) tags it `vX.Y.0.0` and publishes a GitHub Release whose notes are every CHANGELOG section from the previous release up to this version (assembled by [scripts/release-notes.ts](../scripts/release-notes.ts)). Small fixes and hotfixes in the last two parts are not released on their own; they go into the next release. To release one on its own, go to Actions → Release → Run workflow, which releases the version currently on `main`. If the repo has no `v` tag yet, the workflow fails outright (otherwise the notes would be the whole CHANGELOG); release the earlier versions first.

## Project structure

```
app/                     Next.js pages: home, /room/[code]/host, /play, /screen, /bank-editor (question bank editor), and the error screens (error.tsx, global-error.tsx)
components/              Shared pixel components (pixel.tsx), error screen (error-screen.tsx), big-screen stage (stage.tsx), big-screen live map (map-strip.tsx), multiple-choice option grid (mc-option.tsx), d20 and the big-screen dice roll (warrior roll, multiple-choice crit die, fill-in persuasion check and the boss finishing blow's 4d20, d20.tsx), first-character hint for fill-in questions (Mage and persuasion check, mage-hint.tsx), QR (qr.tsx), and the parts split out of the host page: AI narration settings (host-ai.tsx), the 「地城主旁白」 (dungeon master's narration) panel above the judge buttons (narration-panel.tsx), the "⚙ More" drawer (more-drawer.tsx), and the "pick the next question" list (question-picker.tsx)
data/question-bank.json  Bundled fallback question bank (new rooms use it when BankStore cannot be reached; the editor shows it read-only when the stored bank cannot be read)
lib/game-state.ts        Game state machine: rooms, question decks, boss, scoring (pure functions, fully tested)
lib/protocol.ts          Message formats and validation between host / player / server
lib/question-bank.ts     Question bank types, validation, public questions (without answers)
lib/bank-store.ts        BankStore: Durable Object storage layer for the question bank, version check (pure-function logic)
lib/bank-api.ts          HTTP handling for /api/bank (OWNER_KEY check, CORS, 409 conflict), platform independent
lib/narration/           Narration: events, scripted lines, LLM, circuit breaker, runner, browser TTS playback decisions (tts.ts)
lib/pixel-art.ts         Pixel characters and scenes drawn in code
lib/turn-info.ts         Works out from the public state whose turn it is and which monster they face
lib/map-layout.ts        Live map layout: positions of rooms, tokens, fog, boss room (pure functions)
lib/use-room-socket.ts   Connection hook shared by the three room pages (message parsing, server restart detection, no reconnects while asleep, first-connection timeout)
lib/join-rejection.ts    The reason line a phone shows when joining is refused (pure function)
lib/stored.ts            localStorage reads and writes that never throw (also work in private mode)
lib/use-wake-lock.ts     Keeps the screen awake on the host page and the big screen
lib/report-client-error.ts、client-error-api.ts  Front-end crash reports (sendBeacon) and handling for /api/client-error (origin check, 4 KB limit, writes one log line)
lib/bank-image-api.ts    /api/bank/image image upload (file type and size checks; returns 409 when the bank cannot be read, 503 when it cannot be reached)
worker/index.ts          Cloudflare Worker: the Room and BankStoreDO Durable Objects, the /api/bank and /api/client-error routes, entry rules
lib/room/                Room logic (dungeon-room.ts) and the two small interfaces it needs (io.ts), platform independent
lib/gate.ts、origin.ts   Worker entry rules
e2e/                     Playwright end-to-end tests
scripts/                 playtest.sh (LAN playtest), check-bundle.sh, pregate-runner.sh (local test runner for gstack pregate, runs only unit tests; see .gstack/pregate.json), check-docs.ts (checks links and anchors in README and the docs/ guides, and the Chinese/English twin pairing), balance-sim.ts (class balance simulation: `node scripts/balance-sim.ts [games]` prints each class's average score and win share)
public/fonts/            Bundled fonts
DESIGN.md                Pixel design system
docs/designs/            Design docs and decision records (including question-bank-editor.md)
docs/going-public.md     Checklist before making the repo public
TODOS.md                 Known issues and deferred work
```
