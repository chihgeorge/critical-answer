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

## Output style

The owner reads replies on a phone and has ADHD. In every session, without being asked, follow the i-have-adhd rules (the plugin `.claude/settings.json` enables; its `/i-have-adhd` holds the full text) and reply in Traditional Chinese (Taiwan):

1. Lead with the answer or the next action.
2. Number multi-step work, one action per step.
3. End with one concrete next step.
4. Finish the current issue before raising another.
5. Restate where things stand each turn.
6. Give time in minutes, never "a bit".
7. Say what now works after a change.
8. Errors: where, why, the fix. No drama.
9. Lists hold at most 5 items.
10. No preamble, no recap, no closing pleasantries.

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

A PR never edits `VERSION`, the `package.json` version or `CHANGELOG.md`. It adds `changelog.d/<branch-slug>.md` that opens with `bump:` front matter naming the version part it raises; the parts are MAJOR.MINOR.PATCH.MICRO: `major` for a milestone or an incompatible change (1.0, saves or banks old code can no longer read), `minor` for a new feature players or the host can see, `patch` for a fix or improvement with no feature and 50+ changed lines, `micro` for a change under 50 lines (small fix, copy, docs, config). Format in `changelog.d/README.md`. The policy is `.gstack/ship-policy.json` (`changelog_fragments`), so `/ship` writes the fragment and no version. Once a PR's CI is green, it merges with `gh pr merge <n> --auto --squash --match-head-commit <sha>`: the ruleset's required check `check` waits for `static` and every e2e shard. After the merge, `.github/workflows/stamp.yml` runs `scripts/stamp-release.ts` on main: it folds the fragments into one CHANGELOG section, raises the highest `bump:` by exactly one part (the parts after it reset to 0), sets `VERSION` and the package versions, deletes the fragments and pushes the release commit to main as a dedicated stamp GitHub App (id and key in the main-only `stamp` environment; that app is the only bypass actor on main's ruleset, never GitHub Actions itself, which would let any workflow push to main); CI runs on that commit, and an `X.Y.0.0` version gets its GitHub Release through `release.yml`. Setup steps in `docs/development.md`. CI enforces the PR side: the `static` job runs `scripts/check-fragment.ts`, which fails when the PR (compared with its merge base on `origin/<base>`) changes `VERSION`, `CHANGELOG.md`, or the `package.json` / `package-lock.json` version, or adds no `changelog.d/*.md` (not `README.md`), or adds one that is empty, has a `## [` version heading, or has no valid `bump:`, or deletes or edits another PR's unreleased fragment. A `dependabot[bot]` PR needs no fragment. Up to v0.57.0.0 the version only moved when someone opened a release PR by hand (`gstack-release-stamp open`), which is why entries piled up; there are no release PRs any more.

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
