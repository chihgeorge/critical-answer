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

Run: `npm run test` (vitest, unit) · `npm run e2e` (playwright, e2e) · `npm run check:bundle` (fails if any question/answer text leaks into the browser bundle — see `scripts/check-bundle.sh`) · `npx tsc --noEmit -p .` and `npx tsc --noEmit -p worker` · `npm run lint`.

**`npm run check:bundle` is not optional.** It caught a real regression (2026-09-23, v0.6.0.1): a client component importing `lib/question-bank.ts` pulled its top-level parsed `BANK` constant — the whole bank, every answer included — into that page's public JS, bypassing `OWNER_KEY` entirely. CI runs this on every push; run it locally before shipping too, not just `vitest`/`playwright`. Only server-only code (`worker/`, `lib/bank-store.ts`, `lib/room/dungeon-room.ts`, `lib/question-bank-data.ts`) may import the actual parsed `BANK` data or `data/question-bank.json`; client components (`app/bank-editor/page.tsx`) may only import the pure logic/types from `lib/question-bank.ts`.
