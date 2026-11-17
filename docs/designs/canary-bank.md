# Canary bank key: the live canary plays a chosen bank without the owner key

Issue #317. Today `npm run canary:live` carries no key, so a host it opens can only play the default bank
(multi-bank.md D4: a custom bank needs a host that proved OWNER_KEY). The event plays a custom bank, so a healthy live
canary says nothing about that bank's question types. The owner chose a read-only bank entry for the canary. This is
the design; nothing is built until the owner says go.

## What the credential can and cannot do

The one fact that drives the design: **picking a bank for a game is reading it**. Every host page gets the question
and the answer of each question in play (`host-question`, `host-answer`; that is how the canary answers correctly).
So any credential that can pick a bank can read that bank's answers by playing it. There is no "pick but not read".
The design therefore limits *which* banks the credential reaches, and keeps it away from everything else.

| Can | Cannot |
|---|---|
| Prove itself in a room it hosts, then pick a bank from an allow-list the owner set | Pick any bank outside the allow-list |
| See the names of the allowed banks only (`HOST_BANKS`) | See the names of the other banks |
| Run 檢查題庫 (HOST_BANK_CHECK) on an allowed bank, like any host on the bank in play | Use the server's Anthropic key (HOST_AI_KEY source "owner" still needs OWNER_KEY) |
| | Call any `/api/bank*` endpoint (read, save, create, rename, delete, upload, media sweep) or `/api/game-logs`: they check OWNER_KEY only |
| | Open the bank editor |

It is a separate secret, not a derived or weaker form of OWNER_KEY, so holding it says nothing about OWNER_KEY.

## Mechanism

### Worker secrets (Cloudflare only)

- `CANARY_KEY`: at least 32 random bytes, `npx wrangler secret put CANARY_KEY`. Absent means the feature is off: every
  canary proof is refused (`canary_unavailable`). Deleting the secret turns it off at once; putting a new value rotates it.
- `CANARY_BANKS`: the allow-list, bank ids separated by commas (`npx wrangler secret put CANARY_BANKS`). A secret, not
  a `wrangler.toml` var, so the ids stay out of the public repo. An id that no longer exists is ignored. `default` is
  always allowed (any host may pick it anyway).
- Neither goes into GitHub, into `wrangler.toml`, or into any committed file. Same rule as OWNER_KEY and
  ANTHROPIC_API_KEY (docs/deployment.md).

### Room (lib/room/dungeon-room.ts)

- New client message `HOST_CANARY_KEY {key}`, host only. The room compares it with `env.CANARY_KEY` by
  `tokensEqual` (constant time, as for OWNER_KEY). A right key sets `canaryProven` (in memory, like `ownerProven`,
  cleared on reset/expiry) and sends `HOST_BANKS` again.
- A `CANARY_KEY` that is empty or shorter than 32 characters refuses every proof (`canary_unavailable`), so a
  misconfigured secret never matches an empty guess (`tokensEqual("", "")` is true).
- Wrong guesses count against the same per-room budget as OWNER_KEY (`OWNER_GUESS_MAX`), so a second key does not
  double the guesses a room gets. The guard that stops OWNER_KEY guesses keeps reading `ownerProven` only: a
  canary-proven room still gets at most 10 OWNER_KEY guesses.
- `sendBanks`: an owner-proven host sees every bank as now; a canary-proven host sees `default` plus the allowed
  banks that exist; anyone else sees `default`.
- `handleSetBank` and the reload in `handleBankCheck`: a custom bank is allowed when `ownerProven`, or when
  `canaryProven` and the id is in `CANARY_BANKS`. The check stays in the handler, not in the menu (the existing
  comment: every host page gets the answers of the bank in play).
- Nothing else reads `canaryProven`. HOST_AI_KEY, the editor API and the media endpoints do not change.

### Script (scripts/canary-live.ts)

- New flag `--bank <name>`: after creating the room the host sends `HOST_CANARY_KEY`, waits for the bank in
  `HOST_BANKS`, picks it in the lobby's 題庫 select, then plays as now. Without `--bank` nothing changes.
- The key comes from the environment only (`CANARY_KEY`), never a flag, so it stays out of shell history and `ps`.
  `parseArgs` keeps refusing `--owner-key`; `--bank` without `CANARY_KEY` set is an argument error.
- With `--bank`, the report never prints bank text: every step error (the round-level catch included) keeps only its
  kind ("timed out waiting for the answer on the big screen"), not Playwright's message (which quotes the expected
  answer); the `answered:` note drops any question text; each page's `errs` prints only a count; and `CANARY_SHOTS`
  is refused, since the host page on a screenshot shows the answer. A custom bank's log may then be pasted into an
  issue without leaking answers.

### Where the canary runs with a custom bank

Locally, on the owner's machine, with `CANARY_KEY` in the shell environment (for example from a git-ignored file):
`CANARY_KEY=... taskpolicy -b npm run -s canary:live -- --bank <name>`. The GitHub Actions canary keeps playing the
default bank with no secret. Reasons: the repo is public, its workflow artifacts (`canary-log`) can be downloaded by
any signed-in GitHub user, and a GitHub secret would put an answer-reading credential in GitHub. This is decision D1.

## Leak analysis

- **Browser bundle.** Nothing new reaches the client: the host page only adds a message type. The script runs on
  node and imports no bank data. `npm run check:bundle` stays the guard for `BANK` and `data/question-bank.json`.
- **Answers stay server-side.** The bank is loaded by the room Durable Object from BankStore, as for an owner pick;
  the canary's host page gets answers question by question, exactly what any host of that bank gets. The room keeps
  its copy under its own BANK_KEY until it expires (6 hours), as every room does.
- **Who can read a custom bank's answers with this.** Anyone holding `CANARY_KEY` can read every bank in
  `CANARY_BANKS` by hosting games with it. That is the price of the feature and cannot be designed away (see the
  first section). Keep the holders to the owner's machine, keep the allow-list short, and rotate or delete the
  secret after the event if the event bank was on it.
- **Brute force.** 32+ random bytes, compared in constant time, 10 tries per room shared with OWNER_KEY. A new room
  is free to open, as it is for OWNER_KEY today; the key length is what makes guessing hopeless.
- **Logs.** The script's redaction above (errors, page errors, screenshots); the Worker logs bank ids, never bank
  text (unchanged).

## Tests (when built)

- Room: a canary-proven host may pick an allowed bank and is refused (`owner_only`) for another one; `HOST_BANKS`
  lists only allowed banks; a wrong key counts toward `OWNER_GUESS_MAX`; no `CANARY_KEY` means `canary_unavailable`;
  the canary key given as an owner key (HOST_AI_KEY source "owner") is `wrong_owner_key`; reset forgets the proof.
- Room: a short or empty `CANARY_KEY` refuses every proof; a canary-proven room still stops OWNER_KEY guesses at 10.
- Worker: every `/api/bank*` route and `/api/game-logs` answer 403 to `Authorization: Bearer <CANARY_KEY>`.
- Script: `parseArgs` takes `--bank`, needs `CANARY_KEY` with it, still refuses `--owner-key`; the redaction drops
  answer text from a failed step.

## Decisions for the owner

- **D1. Where the custom-bank canary runs.** Recommended: locally only, GitHub Actions stays on the default bank with
  no secret. Alternative: also in Actions with a `CANARY_KEY` GitHub secret; then the public `canary-log` artifact must
  go (or be redacted further), and the credential lives in GitHub.
- **D2. Which bank goes on the allow-list.** (a) The event bank itself: the canary tests the real questions, and the
  key reads its answers. (b) A "canary bank" with harmless sample questions of every type the event bank uses: the key
  reads nothing secret, and the event bank's own content is covered by 檢查題庫 instead. Recommended: (b), adding the
  event bank only if a type cannot be mirrored.
- **D3. Where the allow-list lives.** Recommended: the `CANARY_BANKS` Worker secret (no UI, changed with wrangler).
  Alternative: a "canary may play" checkbox per bank in the editor (more code: store index field, editor UI, tests).

## Not in scope

- Letting the canary edit, save, delete or upload anything.
- Any change to the default-bank canary in GitHub Actions (unless D1 says otherwise).
- Per-holder keys or expiry dates on the key: there is one canary, run by the owner.
