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
| `npm run e2e` | Playwright end-to-end tests (starts its own servers on ports 3101 and 1996; normally left to GitHub CI, because it is too heavy for a local machine. CI splits the tests into three groups that run in parallel) |
| `npm run check:bundle` | After a build, checks that no questions or answers got into the browser bundle |
| `npm run check:docs` | Checks the relative links and anchors in README, SECURITY.md and the `docs/` guides, and that each Chinese doc has its English twin |
| `npm run test:watch` | Tests in watch mode |
| `npm run lint` | ESLint |
| `npm run build` | Builds the front end |

## Tests

The end-to-end tests (`npm run e2e`) run only on GitHub CI: on every PR and every push to `main`, in three parallel groups. They are too heavy for a local machine; do not run them locally. `npm run check:bundle` must always run; it stops answers from leaking into the browser bundle. `npm run check:docs` checks that the relative links and `#` anchors in README, SECURITY.md and every `.md` at the top level of `docs/` (not `docs/designs/`) still resolve.

**Bilingual docs**: README, SECURITY.md and the guides in `docs/` (except `going-public.md`) each have an English twin `X.en.md`. A PR that changes one language changes the other in the same PR. Both open with the language switch line, keep the same number and levels of headings, and the English docs link to English docs. `npm run check:docs` fails on a missing twin, an English doc with no Chinese doc to pair with, a wrong switch line or headings whose levels differ. It does not check that a translation is up to date, or that an English doc links to English twins (`rules.en.md`, not `rules.md`).

> When there is a `.env` in the project root, **the test servers turn AI on by default**. The Playwright end-to-end tests always turn it off, so they never call the real API.

## Saving and rollback

**Rooms are saved**: before each message it sends out, a room first saves itself into Durable Object storage (game state, question decks, host and team keys, the question bank, the epilogue and the page it is turned to, the podium reveal's start time and lines, the next narration line the host has queued, and the time of the first game start and the hours the host extended it; the question bank is stored as a separate record and written only when it changes). After the server is killed, redeployed or recycled, the room restores itself: scores, whose turn it is and who the host is are all kept. After a restart every team counts as offline until its phone rejoins (while no team is online, it is nobody's turn). When the save format is not recognized (a version mismatch, or an old save from before the boss phases shipped), the save is dropped and the screen shows 「遊戲已重置」 (Game reset). Do not roll the Worker back to a version before v0.31.3.0: older versions cannot read the new saves, and every room in progress will be reset. Not saved: the connection list, the pairing code for switching phones, and the narration log (it is only a download for the host). Local `wrangler dev` works the same way and stores it in `.wrangler/`.

## Versions and releases

Version numbers have four parts (for example `0.16.1.0`): MAJOR.MINOR.PATCH.MICRO. A pull request does not change `VERSION` or `CHANGELOG.md`; it adds one short file in [changelog.d/](../changelog.d/README.md) that describes the change and must open with `bump:` front matter naming the part it raises: `major` for a milestone or an incompatible change (for example a 1.0 release, or old saves or banks that can no longer be read); `minor` for a new feature, something new players or the host can see; `patch` for a fix or improvement with no new feature and 50 or more changed lines; `micro` for a small fix, copy, docs or config change under 50 lines. So two open pull requests never conflict on the version, and once CI is green (the required check `check`), GitHub merges the pull request on its own. After the merge to `main`, [.github/workflows/stamp.yml](../.github/workflows/stamp.yml) runs [scripts/stamp-release.ts](../scripts/stamp-release.ts): it folds the files, in path order, into one new CHANGELOG section, raises the part named by the highest `bump` by exactly 1 and resets every part after it to 0 (`0.58.3.2` can only become `1.0.0.0`, `0.59.0.0`, `0.58.4.0` or `0.58.3.3`), changes `VERSION` and the `package.json` and `package-lock.json` version, deletes the files and pushes that commit to `main`. That push is made as a dedicated GitHub App, not with GitHub Actions' own permissions, so no other workflow (including one a pull request adds) can push to `main`. Set it up once: (1) in GitHub's Settings → Developer settings → GitHub Apps, create an app whose only permission is Repository contents: Read and write, with no webhook; (2) install it on this repo; (3) in the repo's Settings → Environments, create an environment named `stamp` whose deployment branches allow only `main`, and add the variable `STAMP_APP_ID` (the App ID) and the secret `STAMP_APP_PRIVATE_KEY` (the app's private key) to it; (4) in Settings → Rules, add only this app to the bypass list of the `main` rule. The key lives in an environment only `main` can use, so a pull request's workflows cannot read it. Commits the app pushes run CI as usual. The rules are in [.gstack/ship-policy.json](../.gstack/ship-policy.json). CI checks every pull request: the `static` job runs [scripts/check-fragment.ts](../scripts/check-fragment.ts), which compares the pull request with its merge base on `origin/<base>` and fails when it changes `VERSION`, `CHANGELOG.md`, or the `package.json` or `package-lock.json` version, or adds no `changelog.d/*.md` file (`README.md` does not count), or adds one that is empty, has a `## [` version heading, or has no valid `bump:`; a Dependabot pull request needs no `changelog.d/` file. When the version becomes `X.Y.0.0` (the second part or higher changed, meaning there is a new feature), [.github/workflows/release.yml](../.github/workflows/release.yml) runs because `VERSION` changed and tags it `vX.Y.0.0` and publishes a GitHub Release whose notes are every CHANGELOG section from the previous release up to this version (assembled by [scripts/release-notes.ts](../scripts/release-notes.ts)). Small fixes and hotfixes in the last two parts are not released on their own; they go into the next release. To release one on its own, go to Actions → Release → Run workflow, which releases the version currently on `main`. When an `X.Y.0.0` release failed, re-run that Release run (it keeps its commit) instead of Run workflow, because `main` may already have moved to a newer version. If the repo has no `v` tag yet, the workflow fails outright (otherwise the notes would be the whole CHANGELOG); release the earlier versions first. Up to v0.57.0.0 the version only moved when someone opened a release pull request by hand (`gstack-release-stamp open`), so files piled up; there are no release pull requests any more.

## Project structure

```
app/                     Next.js pages: home, /room/[code]/host, /play, /screen, /bank-editor (question bank editor), the error screens (error.tsx, global-error.tsx), and the home-screen manifests (site-wide manifest.ts and each room's /room/[code]/manifest.webmanifest, built by lib/web-manifest.ts)
components/              Shared pixel components (pixel.tsx), error screen (error-screen.tsx), big-screen stage (stage.tsx), big-screen live map (map-strip.tsx), multiple-choice option grid (mc-option.tsx), d20 and the big-screen dice roll (warrior roll, multiple-choice crit die, fill-in persuasion check and the boss finishing blow's 4d20, d20.tsx), first-character hint for fill-in questions (Mage and persuasion check, mage-hint.tsx), QR (qr.tsx), and the parts split out of the host page: AI narration settings (host-ai.tsx), the 「地城主旁白」 (dungeon master's narration) panel above the judge buttons (narration-panel.tsx), the "⚙ More" drawer (more-drawer.tsx), the "pick the next question" list (question-picker.tsx), and the per-field judging of multi-field music questions (field-judge.tsx), the rows for late teams waiting to join (late-teams.tsx)
data/question-bank.json  Bundled fallback question bank (new rooms use it when BankStore cannot be reached; the editor shows it read-only when the stored bank cannot be read)
lib/game-state.ts        Game state machine: rooms, question decks, boss, scoring (pure functions, fully tested)
lib/protocol.ts          Message formats and validation between host / player / server
lib/question-bank.ts     Question bank types, validation, public questions (without answers)
lib/bank-store.ts        BankStore: Durable Object storage layer for the question bank, version check (pure-function logic)
lib/bank-api.ts          HTTP handling for /api/bank and /api/game-logs (OWNER_KEY check, CORS, 409 conflict), platform independent
lib/game-log.ts          Game log: when a game ends, builds one record from the game state and stores it in BankStoreDO; the download reads the newest 1000 games
lib/narration/           Narration: events, scripted lines, LLM, circuit breaker, runner, audience-reaction tally (crowd.ts), browser TTS playback decisions (tts.ts)
lib/pixel-art.ts         Pixel characters and scenes drawn in code
lib/turn-info.ts         Works out from the public state whose turn it is and which monster they face
lib/map-layout.ts        Live map layout: positions of rooms, tokens, fog, boss room (pure functions)
lib/use-room-socket.ts   Connection hook shared by the three room pages (message parsing, server restart detection, no reconnects while asleep, first-connection timeout)
lib/join-rejection.ts    The reason line a phone shows when joining is refused (pure function)
lib/stored.ts            localStorage reads and writes that never throw (also work in private mode)
lib/use-wake-lock.ts     Keeps the screen awake on the host page and the big screen
lib/report-client-error.ts、client-error-api.ts  Front-end crash reports (sendBeacon) and handling for /api/client-error (origin check, 4 KB limit, writes one log line)
lib/bank-image-api.ts    /api/bank/image image upload (file type and size checks; returns 409 when the bank cannot be read, 503 when it cannot be reached)
worker/index.ts          Cloudflare Worker: the Room and BankStoreDO Durable Objects, the /api/bank, /api/game-logs and /api/client-error routes, entry rules
lib/room/                Room logic (dungeon-room.ts) and the two small interfaces it needs (io.ts), platform independent
lib/gate.ts、origin.ts   Worker entry rules
e2e/                     Playwright end-to-end tests
scripts/                 playtest.sh (LAN playtest), check-bundle.sh, pregate-runner.sh (local test runner for gstack pregate, runs only unit tests; see .gstack/pregate.json), check-docs.ts (checks links and anchors in README and the docs/ guides, and the Chinese/English twin pairing), balance-sim.ts (class balance simulation: `node scripts/balance-sim.ts [games]` prints each class's average score and win share)
public/fonts/            Bundled fonts
public/icon-192.png、icon-512.png  Home-screen icons (the slime)
DESIGN.md                Pixel design system
docs/designs/            Design docs and decision records (including question-bank-editor.md)
docs/going-public.md     Checklist before making the repo public
TODOS.md                 Known issues and deferred work
```
