# Question-bank editor (v1 slice)

Supersedes: the "owner key / KV or D1" line in `docs/designs/dm-branching-and-question-types.md`
(that doc explicitly deferred this direction). Builds on prior locked decisions
(`~/.gstack/projects/critical-answer/decisions.active.json`, 2026-09-21):
BankStore is a Durable Object, not KV/D1; the editor is owner-only via a key
separate from the per-room host key.

**Revision note:** this doc's first draft (this same review session) proposed
Ajv + JSON Schema and a `text`/`multipleChoice`/`image` kind-discriminated
schema. An outside-voice pass (Claude subagent, Codex unusable on this
account) found two P0s, both verified live before accepting: Ajv's default
`compile()` throws `EvalError: Code generation from strings disallowed for
this context` under `wrangler dev` (confirmed with an isolated probe), and
`multipleChoice` has no game-engine consumer to build against
(`PublicQuestion` in `lib/protocol.ts` has only a `text` field; the whole
judge flow is host-reads-aloud, host-judges — no option rendering, no
option-pick message, no option-judging logic exists). Scope below reflects
the corrected, much smaller v1.

## Problem

The question bank (`data/question-bank.json`, 48 questions across 5 rooms + boss)
is a file bundled into the Worker. Changing a question means editing JSON and
redeploying. The user wants to edit it without touching code.

## Scope this round

**In:** a new `BankStore` Durable Object holding one bank of `text` questions;
owner-key-gated CRUD API; a minimal editor UI (add/edit/delete forms, no
import/export, no preview, no multi-bank).

**Out (deferred):**
- `multipleChoice` and `image` question kinds — no game-engine consumer yet
  for either. Revisit once `PublicQuestion`/the judge flow can actually
  present options or an image.
- Ajv/JSON Schema — dropped entirely (confirmed incompatible with workerd's
  default JIT compile). If a future kind genuinely needs schema-driven
  tooling, re-evaluate with Ajv's standalone precompilation mode specifically
  (build-time codegen), not the default runtime-compile path used here.
- Import/export, multiple banks, live preview — cut by the Step 0 complexity
  check for size, same as the first draft.
- Abuse protection / rate limiting on the owner-key endpoint — mirrors the
  existing accepted decision for other endpoints (v1.0 is friends-only, URL
  not shared).

## Locked architecture decisions

1. **Storage: single `BankStore` Durable Object**, not KV/D1. Outside voice
   raised switching to a single KV entry (no concurrent-writer coordination
   need for a single-owner bank) — the user kept the DO to honor the prior
   confirmed CEO-review decision rather than treat an outside model's fresh
   take as grounds to reopen it.
2. **Schema validation: hand-rolled `parseQuestion()`**, matching the
   codebase's existing `parseBank()`/`parseClientMessage()` style. Ajv is
   dropped — live-tested and confirmed broken on workerd (see Revision note).
   With only one question kind this round, there is no discriminated union to
   validate, just the same shape `BankQuestion` already has (`id`, `text`,
   `answer`).
3. **Owner key: a single fixed `wrangler secret` (`OWNER_KEY`)**, checked by
   reusing `lib/tokens.ts`'s `tokensEqual` (existing constant-time compare —
   not a new one). Not per-room trust-on-first-use like `HOST_CLAIM` — there
   is exactly one owner. Publish instructions for generating the secret must
   require **at least 32 random bytes** (e.g. `openssl rand -base64 32`) —
   the blast radius of a leaked/brute-forced owner key is the entire bank,
   permanently, versus a room host token's single 4-letter-code-bounded room.
4. **Routing: a new `/api/bank/*` fetch route in `worker/index.ts`**,
   deliberately NOT going through `routePartykitRequest`/`lib/gate.ts` — that
   file's own header comment warns a new Durable Object binding is reachable
   at `/parties/<binding>/<id>` unless the whitelist is updated in lockstep.
   A separate route sidesteps that failure class entirely.
5. **No CORS handling** — the editor UI is served same-origin from this same
   Worker, so `/api/bank/*` never receives a cross-origin request. Revisit
   only if the editor UI ever moves to a separate origin (e.g. the Vercel
   frontend calling the Worker directly).
6. **Bank seeding: `BankStore.onStart()` seeds itself from the bundled
   `data/question-bank.json` when its storage is empty** (first boot only),
   mirroring `dungeon-room.ts`'s `restore()` pattern. No manual migration
   script/step to remember at deploy time.
7. **`DungeonRoom.onStart()` fetches and caches the bank from BankStore**,
   falling back to the bundled `data/question-bank.json` if the fetch fails.
   Outside voice flagged that the original design put every live game's
   ability to start on BankStore's availability with no fallback story — an
   editor outage or mid-redeploy window would have blocked new games, not
   just editing. Once a room is built, it keeps its own snapshot's bank and
   never depends on BankStore staying up again.

## Step 0 Scope Challenge

- Existing code reused: `lib/room/dungeon-room.ts`'s DO persist/restore
  pattern (for BankStore itself); `lib/question-bank.ts`'s fail-loud
  validation *style* (mechanism now hand-rolled to match, not Ajv).
- Complexity check **triggered** in the first pass (9+ files, 2 new infra
  pieces). User cut image/R2 to a follow-up PR. The outside-voice pass then
  cut further (no multipleChoice, no schema library), shrinking this to
  roughly the size of `parseBank()` plus a CRUD API plus an editor form.
- TODOS cross-reference: resolves `TODOS.md`'s host-question-bank-editor item.

## NOT in scope (this round)

- **`multipleChoice` question kind** — no game-engine consumer (see Revision
  note). Build it alongside the judging/rendering support it needs, not
  ahead of it.
- **`image` question kind + Cloudflare R2 upload** — same reason, plus no
  consumer either.
- **Ajv / JSON Schema / schema-derived TS types** — confirmed incompatible
  with this runtime in its default mode; not worth reintroducing for a
  single-kind schema anyway.
- **Import/export, multiple banks, live preview** — cut for PR size.
- **Abuse protection / rate limiting on the owner-key endpoint** — mirrors an
  existing accepted decision elsewhere; OWNER_KEY entropy (decision 3) is the
  mitigation for this round.
- **CORS handling** — no cross-origin caller exists yet.

## What already exists (reused / not reused)

- `lib/room/dungeon-room.ts`'s DO storage get/put/restore pattern — reused
  for BankStore's own persist/restore.
- `lib/question-bank.ts`'s `parseBank()` fail-loud validation style — reused
  as the pattern for the new `parseQuestion()` (mechanism, not the Ajv
  detour).
- `lib/tokens.ts`'s `tokensEqual` — reused for the owner-key check, not
  reimplemented.
- `lib/gate.ts`'s whitelist — deliberately NOT reused/extended; BankStore
  gets its own route instead (decision 4).
- `HOST_CLAIM`'s trust-on-first-use — deliberately NOT reused (decision 3);
  fixed wrangler secret instead.

## Failure modes

| Codepath | Failure | Error handling | Silent? |
|---|---|---|---|
| Missing/wrong `Authorization` header | Wrong/no owner key | 403, `tokensEqual` | No |
| BankStore first boot, storage empty | Deploy-ordering gap | Auto-seed from bundled JSON (decision 6) | No |
| BankStore unreachable when a room starts | Editor outage / redeploy window | Room falls back to bundled JSON (decision 7) | No |
| Corrupt stored bank JSON | DO storage corruption | Needs defensive parse in `restore()` (same class of gap fixed in `dungeon-room.ts`'s `branchChoices` backfill) | **Needs verification during implementation — critical gap if missed** |
| Duplicate question id on POST/PUT | User/editor bug | Explicit id-uniqueness check in `parseQuestion()`/CRUD handler, reject | No |
| `/parties/bank/*` guessed directly | Route confusion | 404 — BankStore isn't reachable there at all (decision 4) | No |

## Test coverage diagram

```
CODE PATHS                                                  USER FLOWS
[+] lib/bank-store.ts (new BankStore DO)                    [+] Owner edits a question
  ├── onRequest() — routes GET/POST/PUT/DELETE               ├── [GAP][→E2E] Open editor → owner key prompt →
  │   ├── [GAP] missing/wrong Authorization → 403                    valid key → question list loads
  │   ├── [GAP] valid key, GET /questions → list                ├── [GAP] Add a text question → appears in list
  │   ├── [GAP] valid key, POST → validate + append              ├── [GAP] Edit existing question → save → list updates
  │   ├── [GAP] valid key, PUT → validate + replace by id        └── [GAP] Wrong/no owner key → clear rejection, no list leak
  │   └── [GAP] valid key, DELETE → remove by id               [+] Error states
  └── restore()/persist() — DO storage round-trip                ├── [GAP] parseQuestion() failure → field-level error shown
      └── [GAP] corrupt stored JSON doesn't crash restore()      └── [GAP] Duplicate question id rejected with clear message
[+] lib/question-schema.ts (new, hand-rolled)
  └── parseQuestion()
      ├── [GAP] valid text question passes
      └── [GAP] missing/empty text or answer rejected
[+] lib/room/dungeon-room.ts — onStart() bank fetch
  ├── [GAP] BankStore reachable → uses fresh bank
  └── [GAP] BankStore unreachable → falls back to bundled JSON, room still starts
[+] worker/index.ts — /api/bank/* route
  └── [GAP] tokensEqual-based owner-key check, 403 vs 200

COVERAGE: 0/14 paths tested (0%, not yet implemented) | Code paths: 0/10 | User flows: 0/4
GAPS: 14 (1 E2E)
```

## Worktree parallelization strategy

Sequential implementation. `lib/bank-store.ts` (DO), `lib/question-schema.ts`
(hand-rolled validator), and `worker/index.ts`'s `/api/bank` route are
tightly coupled — splitting to worktrees would only create merge conflicts.
`lib/room/dungeon-room.ts`'s bank-fetch change (decision 7) touches the same
seam and should land in the same PR.

## Implementation Tasks

- [ ] **T1 (P1)** — schema — `lib/question-schema.ts`: hand-rolled
  `parseQuestion()` for `text` kind, matching `parseBank()` style
  - Files: `lib/question-schema.ts`, `lib/question-schema.test.ts`
  - Verify: unit tests, valid/invalid, duplicate-id rejection
- [ ] **T2 (P1)** — storage — `lib/bank-store.ts`: new `BankStore` Durable
  Object, CRUD over T1's schema, auto-seed from bundled JSON on first boot,
  defensive parse in `restore()` against corrupt storage
  - Files: `lib/bank-store.ts`, `lib/bank-store.test.ts`
  - Verify: unit tests (CRUD, seed-once, corrupt-storage restore() safety)
- [ ] **T3 (P1)** — routing/auth — `/api/bank/*` fetch route in
  `worker/index.ts`, `tokensEqual`-based `OWNER_KEY` check, wired to
  BankStore
  - Files: `worker/index.ts`, `wrangler.toml`/`wrangler.jsonc` (new DO
    binding + `OWNER_KEY` secret; publish note: ≥32 random bytes)
  - Verify: unit/integration test, 403 on missing/wrong key, 200 on valid
- [ ] **T4 (P1)** — room bank fetch — `DungeonRoom.onStart()` fetches+caches
  the bank from BankStore, falls back to bundled JSON on failure
  - Files: `lib/room/dungeon-room.ts`, `worker/index.ts` (env wiring)
  - Verify: unit tests for both the fetch-succeeds and fetch-fails paths
- [ ] **T5 (P2)** — frontend — minimal editor UI: owner-key prompt, list,
  add/edit/delete forms for text questions
  - Files: new editor route under `app/`
  - Verify: e2e covering the 4 user flows in the coverage diagram
- [ ] **T6 (P1)** — diagram — add an ASCII flow comment to `lib/bank-store.ts`
  header (this project's convention, per `game-state.ts`)
  - Verify: manual check, diagram matches code

## Completion summary

- Step 0: Scope Challenge — scope reduced twice (image/R2 split to follow-up
  PR in the first pass; multipleChoice + Ajv dropped entirely after outside
  voice)
- Architecture Review: 5 issues found (D1-D4 scoping, BankStore routing,
  bank-migration seeding), all resolved
- Code Quality Review: 1 issue found (schema/type drift — resolved by
  dropping the schema library that caused it)
- Test Review: diagram produced, 14 gaps identified (planning stage, not yet
  implemented)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: pending (see below)
- Failure modes: 1 critical gap flagged (corrupt BankStore storage crashing
  `restore()`)
- Outside voice: ran (Claude subagent, Codex unusable — `gpt-6-astra`
  unsupported on this account). 10 findings, 2 P0s verified live and
  accepted, 6 P1/P2s each resolved via individual cross-model-tension
  AskUserQuestion calls, 1 (DO vs KV) resolved in favor of the prior locked
  decision
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: N/A — no decisions in this round compared a complete option
  against an explicit shortcut with a completeness score
- Unresolved decisions: 0
