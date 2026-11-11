## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /autoplan
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

## Testing

Run: `npm run test` (vitest, unit) · `npm run e2e` (playwright, e2e — **CI only**: GitHub CI runs it on every pull request and every push to main, in three parallel shards; do not run it locally, it overloads the machine) · `npm run check:bundle` (fails if any question/answer text leaks into the browser bundle — see `scripts/check-bundle.sh`) · `npx tsc --noEmit -p .` and `npx tsc --noEmit -p worker` · `npm run lint`.

**`npm run check:bundle` is not optional.** It caught a real regression (2026-09-23, v0.6.0.1). A client component imported `lib/question-bank.ts`. That import put the top-level parsed `BANK` constant into the public JS of the page. `BANK` is the whole bank, with every answer. The leak bypassed `OWNER_KEY` entirely.

CI runs `check:bundle` on every push. Run it locally before you ship too. Running only `vitest` and `playwright` is not enough.

Only server-only code may import the parsed `BANK` data or `data/question-bank.json`. The server-only files are:

- `worker/`
- `lib/bank-store.ts`
- `lib/room/dungeon-room.ts`
- `lib/question-bank-data.ts`

Client components (for example `app/bank-editor/page.tsx`) may import only the pure logic and types from `lib/question-bank.ts`.

## Bilingual docs

`README.md`, `SECURITY.md` and every `docs/*.md` except `docs/going-public.md` are Traditional Chinese (Taiwan) with an English twin `X.en.md`. A PR that changes one language changes the other in the same PR. Both open with the switch line (`繁體中文 | [English](X.en.md)` / `[繁體中文](X.md) | English`) and keep the same headings, level by level. English docs link to English twins. A new guide in `docs/` needs its twin too. `npm run check:docs` enforces the pairing, the switch line, the heading levels, and every link and anchor. It does not check that a translation is up to date, or that an English doc links to English twins (`rules.en.md`, not `rules.md`). `TODOS.md`, `CHANGELOG.md`, `DESIGN.md`, `docs/designs/` and this file stay in one language.

## Versions and changelog

Every PR bumps its own version. It changes `VERSION`, the `package.json` / `package-lock.json` version (VERSION's first three parts) and adds a `## [<version>] - <date>` section at the top of `CHANGELOG.md`; a feature bumps the second part, a fix the third or fourth. `/ship` Step 12 does this (policy `.gstack/ship-policy.json`: `bump: ask`, `queue_mode: claim-at-open`, no `changelog_fragments`). Once a PR's CI is green, it merges with `gh pr merge <n> --auto --squash --match-head-commit <sha>`: the ruleset's required check `check` waits for `static` and every e2e shard. Two open PRs that bump to the same version conflict in `VERSION` and `CHANGELOG.md` once the first merges; rerun `/ship` on the other (it merges `main` and bumps again). CI enforces it on every PR: the `static` job runs `scripts/check-version.ts`, which fails when, compared with its merge base on `origin/<base>`, `VERSION` did not go up, `CHANGELOG.md`'s first section is not that version, or the package versions are not VERSION's first three parts; a `dependabot[bot]` PR needs no bump. Up to v0.58.0.0 PRs added `changelog.d/` fragments and a release PR folded them; there is no `changelog.d/` any more.

## Health Stack

- typecheck: npx tsc --noEmit -p . && npx tsc --noEmit -p worker
- lint: npx eslint
- test: npm test

`/health` uses exactly these. Dead code (knip) and shell lint (shellcheck) are not set up yet (TODOS.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
