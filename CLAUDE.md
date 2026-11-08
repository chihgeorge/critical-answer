## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
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

Run: `npm run test` (vitest, unit) · `npm run e2e` (playwright, e2e — **CI only**: GitHub CI runs it on every pull request and every push to main, in two parallel shards; do not run it locally, it overloads the machine) · `npm run check:bundle` (fails if any question/answer text leaks into the browser bundle — see `scripts/check-bundle.sh`) · `npx tsc --noEmit -p .` and `npx tsc --noEmit -p worker` · `npm run lint`.

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

A PR never edits `VERSION`, the `package.json` version or `CHANGELOG.md`. It adds `changelog.d/<branch-slug>.md` (format in `changelog.d/README.md`; a feature opens with `bump: minor` front matter). The policy is `.gstack/ship-policy.json` (`changelog_fragments` + `merge: direct`), so `/ship` writes the fragment and no version. Once a PR's CI is green, it merges with `gh pr merge <n> --auto --squash --match-head-commit <sha>`: the ruleset's required check `check` waits for `static` and every e2e shard. Only a release PR (`gstack-release-stamp open`) moves the version and folds the fragments. It lands with `gstack-ship-queue land --pr <n> --pin <head>`, not auto-merge: land refuses when `main` moved past the release, so a fragment merged meanwhile is never left out of the version it ships in. CI enforces it on every PR: the `static` job runs `scripts/check-fragment.ts`, which fails when the PR (compared with its merge base on `origin/<base>`) changes `VERSION`, `CHANGELOG.md`, or the `package.json` / `package-lock.json` version, or adds no non-empty `changelog.d/*.md` (not `README.md`) or one with a `## [` version heading. A `release/*` head branch skips the check; a `dependabot[bot]` PR needs no fragment.

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
