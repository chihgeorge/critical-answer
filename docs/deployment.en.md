[繁體中文](deployment.md) | English

# Deployment guide

> **Nobody has followed these steps on a brand-new account yet.** The "first deploy" below was put together from the current config files; if you get stuck following it, please open an issue. The verification work is tracked in [TODOS.md](../TODOS.md).

The frontend (Next.js) is on Vercel, and the room server (Cloudflare Worker + Durable Objects) is on Cloudflare. Each side deploys from `main` automatically.

## This repo's live version

**Live version**: the frontend is at <https://critical-answer.vercel.app>, and the room server is on Cloudflare (`https://critical-answer.aiko-studio.workers.dev`). Merging into `main` deploys automatically (see [auto-deploy](#auto-deploy) below). Room state is persisted, so a redeploy does not wipe games in progress; it only makes connections reconnect briefly.

## Auto-deploy

Merging into `main` deploys automatically. Both sides use the platform's own Git integration, and GitHub holds no deploy secrets: Cloudflare Workers Builds runs `wrangler deploy` from `main` (room server), and Vercel deploys the frontend from `main`. Workers Builds is set up in the Cloudflare dashboard (Workers & Pages → `critical-answer` → Settings → Build → connect the GitHub repo, with `main` as the production branch). It does not wait for the GitHub Actions checks to finish, and it is not guaranteed to finish before Vercel. If a change needs the Worker live first (for example, the frontend reads a new protocol field), run `wrangler deploy` locally before merging. `OWNER_KEY` and `ANTHROPIC_API_KEY` are stored on the Worker; deploys do not touch them.

## First deploy to your own account

1. **Cloudflare login**: `npx wrangler login`. To use a different Worker name, change `name` in [wrangler.jsonc](../wrangler.jsonc).
2. **R2 bucket for images**: `npx wrangler r2 bucket create critical-answer-images`, then follow [image upload (R2)](#image-upload-r2) below to turn on public read and fill in `R2_PUBLIC_BASE_URL`. Create it even if you use no image questions; `wrangler deploy` needs this binding.
3. **Allowed frontend URLs**: replace `ALLOWED_ORIGINS` in `wrangler.jsonc` with your own Vercel URL (comma-separated; full URLs are recommended). `*` can stand for one name segment of a URL, for example `https://your-project-*.vercel.app` covers preview URLs; but anyone who opens a Vercel project whose name starts the same way is allowed too, so use it only when you need preview URLs.
4. **Deploy the Worker**: `npx wrangler deploy`. The first deploy applies the two migrations in `wrangler.jsonc`, creating the two Durable Objects `Room` and `BankStoreDO`. Note the `*.workers.dev` URL it prints.
5. **Worker secrets**: `npx wrangler secret put OWNER_KEY` (for bank editing and the owner key; a random value of ≥32 bytes). To use the owner's AI narration, also run `npx wrangler secret put ANTHROPIC_API_KEY`.
6. **Vercel**: import this repo and set the environment variable `NEXT_PUBLIC_PARTYKIT_HOST` to the Worker URL from step 4, without `https://` (for example `critical-answer.<your-subdomain>.workers.dev`, with your subdomain). If it is not set, the frontend connects to `localhost:1999`.
7. **Auto-deploy (optional)**: follow [auto-deploy](#auto-deploy) above to connect Workers Builds to GitHub.

## Settings at a glance

| Name | Where | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_PARTYKIT_HOST` | Vercel environment variable | Yes | The Worker's URL (without the protocol). `npm run dev` sets it to `localhost:8787` automatically |
| `ALLOWED_ORIGINS` | `vars` in `wrangler.jsonc` | Yes | Frontend URLs allowed to connect. Local development uses `.dev.vars` (copy `.dev.vars.example`; the content is `*`) |
| `R2_PUBLIC_BASE_URL` | `vars` in `wrangler.jsonc` | For image questions | The R2 bucket's public URL |
| `OWNER_KEY` | Worker secret | For bank editing | Password for the bank editor and the owner key |
| `ANTHROPIC_API_KEY` | Worker secret | Optional | The owner's AI narration key |
| `ROOM_IDLE_MS`, `ROOM_EXPIRE_MS` | Worker variable | Optional | How long a room may go without action before it rests, and how long after its first game start it is wiped (milliseconds; default 2 hours and 6 hours, which the host can extend to 24 hours; see the [hosting guide](hosting.en.md#known-limits)) |

## Keys for AI narration

For how the host picks AI narration in the lobby, see the [hosting guide](hosting.en.md#ai-narration).

To test the owner key locally, put `ANTHROPIC_API_KEY=sk-ant-...` in `.env` at the **project root** (`wrangler dev` reads this file, not `.env.local`), then restart `npm run dev:worker`.

The host's key is kept only in the room's memory: it is never written to a snapshot, never logged, and never sent back to any screen; the host page shows only its last 4 characters (see [SECURITY.en.md](../SECURITY.en.md)). After a server restart it must be pasted again. The owner key is read only on the server (the Worker); do not give it a `NEXT_PUBLIC_` prefix, or it ends up in the browser. Narration uses `claude-haiku-4-5`, and the end-of-game epilogue uses `claude-sonnet-5-5`. Each narration line waits at most 3 seconds (15 seconds for the epilogue); on a timeout, an error or unusable content, a scripted line is used instead. After 3 failures in a row the whole room switches to scripted lines, then tries the AI once a minute and switches back when it answers; when the key is refused (401/403), the room stays on scripted lines until a new key is applied. Team names typed by players, and the boss phase names and rules from the bank, go into the prompt only as data; questions, answers, options and explanations never go into the prompt.

> **Cost**: opening a room needs no login, but AI narration turns on only with the host's own key or the owner key, and each room has a line limit. Set a spending limit for the owner's `ANTHROPIC_API_KEY` in the Anthropic Console; the program has no site-wide total limit.

## Image upload (R2)

Image upload first needs an R2 bucket named `critical-answer-images` in Cloudflare. Turn on its r2.dev public read by hand in the dashboard, then replace `R2_PUBLIC_BASE_URL` in [wrangler.jsonc](../wrangler.jsonc) with the URL Cloudflare gives you. This step is not part of `wrangler deploy`; see [docs/designs/image-question-type.md](designs/image-question-type.md).

The same bucket also holds the video and audio uploaded to the bank (up to 25 MB per file, see [docs/designs/uploaded-media.md](designs/uploaded-media.md)); no new binding or setting is needed. The r2.dev address is rate-limited, so for a real event connect a custom domain to the bucket and set `R2_PUBLIC_BASE_URL` to it.

## Deploy order

Workers Builds does not wait for CI, and it is not guaranteed to finish before Vercel: when the frontend needs a new room protocol, run `npx wrangler deploy` locally before merging. Do not roll the Worker back to a version before v0.31.3.0 (see the [development guide](development.en.md#saving-and-rollback)); for the bank's rollback floor, see the [question bank guide](question-bank.en.md#how-to-recover-when-the-bank-is-stuck).

## Post-deploy check

After a deploy, run `npm run canary:live`. It plays one real game on the live site with four headless Chromium contexts that share no storage: the host, the big screen and two phones. The host opens a room from the home page's 主持遊戲 (no owner key), the big screen opens the host page's screen link, teams `CANARY-1` and `CANARY-2` join and pick the chef, and the host starts the game and rolls initiative for everyone. The team on turn answers correctly from the answer on the host page; the script checks that the big screen and the other phone show the answer, then the host serves the dish and presses 下一題, the script checks that the big screen moves to the next team, and the host ends the game with 結束冒險 in ⚙ 更多. Each step prints `STEP r<round> <step> ok|FAIL ms=<ms>`, each page prints `PAGE r<round> <page> status=<code> ms=<load ms> errs=[...]` (errs are that page's console errors and page errors), and the last line is `CANARY HEALTHY` or `CANARY BROKEN`; when it is not healthy the exit code is not 0. A round takes about 25 seconds.

You do not have to run it yourself: after each `chore: release vX` commit is deployed, the GitHub Actions workflow [.github/workflows/canary.yml](../.github/workflows/canary.yml) runs `npm run -s canary:live -- --rounds 3`. It starts when Vercel reports the production deployment as successful, waits for the Workers Builds check on the same commit to succeed (up to 15 minutes), then plays three rounds. Other commits do not run it. Only one runs at a time, and its output is saved as the artifact `canary-log`. When it fails, the run fails (GitHub emails you), and it comments on the open issue labelled `canary` with the version and the failing lines, or opens one if none is open. It needs no secret. To run it again by hand, use Actions → Canary → Run workflow, which tests the live site at once without waiting for a deploy.

- `--rounds N`: play N rounds, each in a new room (default 1).
- `--turns N`: play N turns per round (default 1). From turn 2 on, step names get `-t<turn>`, for example `answer-correctly-t3`; each extra turn adds 60 seconds to the round's time limit.
- `--boss`: after the game starts, the host sends `CANARY-1` to the boss room with 送王房 in ⚙ 更多, so its turns play boss questions from then on.
- `--base URL` or the `CANARY_BASE_URL` environment variable: test a preview URL or local dev (for example `http://localhost:3000`) instead of the live site.
- `CANARY_SHOTS=<folder>` environment variable: the first failed step saves a screenshot of each of the four pages there.

The room is not deleted, and the host has no button to close one: once the game is over its connections rest after 2 idle hours, and it is cleared 6 hours after the first game start (see the [hosting guide](hosting.en.md#known-limits)). The script does not open the bank editor and uses no key. It makes no sound: Chromium runs with `--mute-audio`, and narration goes to a silent speechSynthesis where each line still ends a moment later, so the narration queue moves on as usual.

Each turn picks its next move from what the pages show, so every question type gets through:

- Answered right: multiple choice (the phone taps the option and locks it, the host presses 公布答案), sort (the phone orders the rows to the host page's order with the ☰ handles' arrow keys, then locks), fill-in (the persuasion check first, then the host's 答對！), image and video questions, memory questions (the host presses ⏭ 直接出題 instead of waiting for the clip), buzzer questions (the phone presses 搶答！, the host judges it right), and music questions with fields (the host marks every field right and submits). On a buzzer song the host presses 播放 first; when the big screen reports it cannot play it, the host presses 🎤 現場放歌，開放搶答 instead, so a broken big-screen player does not fail the step, but the step prints `note="answered: ..."` to say the big screen could not play it. At a fork it takes the left door; at the fortune teller it picks the first fate.
- Skipped by the host: a timing question cannot be tapped on purpose, so the host presses 沒人答對，換下一題; a buzzer song that has not opened 10 seconds after 播放 (with no 播放 button, 10 seconds after the phones show 等音樂開始…) is skipped the same way. The step prints `ok` with `note="skipped: ..."` and does not count as broken.
- Mystery room and fortune teller cards have no question and print `note="passed: ..."`. When the boss falls and the game ends, the remaining turns and 結束冒險 are skipped.
- A wrong answer on the host page, or a question not done within 60 seconds, makes the step `FAIL`.
- When every turn of a round was skipped or a card, the round verified no question: it prints `ROUND r<round> FAIL verified nothing: ...` and the run is `CANARY BROKEN`. When the default bank has timing or buzzer songs, one turn may be skipped, so add `--turns 2` or more.

It carries no key, so it only plays the site's default bank: a host needs the owner key to pick another bank, so there is no bank option. The live check meets sort, memory, music and buzzer questions only when the event bank is the default bank. A boss buzzer phase is never the first phase, and `--boss` only reaches the first phase, so try buzzer, timing and field questions locally. A round gets about 150 seconds (plus the extra turns); past that it skips the remaining steps but still ends the game.

To try a given bank locally, use the test `E2E_OWNER_KEY` from `playwright.config.ts` (not the live owner key; never use that one here):

```bash
KEY=$(sed -n 's/.*E2E_OWNER_KEY = "\(.*\)";/\1/p' playwright.config.ts)
npx wrangler dev --port 1996 --persist-to .wrangler/canary --var 'ALLOWED_ORIGINS:*' --var ANTHROPIC_API_KEY: --var OWNER_KEY:$KEY
# another terminal
NEXT_PUBLIC_PARTYKIT_HOST=localhost:1996 npx next dev -p 3000
# a third terminal: put a bank JSON into the local default bank (version comes from the current one)
V=$(curl -s -H "Authorization: Bearer $KEY" localhost:1996/api/bank | jq .version)
jq -n --slurpfile b local-banks/my-bank.json --argjson v "$V" '{bank: $b[0], version: $v}' \
  | curl -s -X PUT -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' --data @- localhost:1996/api/bank
npm run -s canary:live -- --base http://localhost:3000 --turns 10 --boss
```

Uploaded images and media files in the bank are not on the local stack, so the big screen fails to load them and logs errors in `errs`; YouTube and text questions give the cleanest run.
