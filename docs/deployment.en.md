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
3. **Allowed frontend URLs**: replace `ALLOWED_ORIGINS` in `wrangler.jsonc` with your own Vercel URL (comma-separated; full URLs are recommended). `*` can stand for one name segment of a URL, for example `https://你的專案-*.vercel.app` (your project name) covers preview URLs; but anyone who opens a Vercel project whose name starts the same way is allowed too, so use it only when you need preview URLs.
4. **Deploy the Worker**: `npx wrangler deploy`. The first deploy applies the two migrations in `wrangler.jsonc`, creating the two Durable Objects `Room` and `BankStoreDO`. Note the `*.workers.dev` URL it prints.
5. **Worker secrets**: `npx wrangler secret put OWNER_KEY` (for bank editing and the owner key; a random value of ≥32 bytes). To use the owner's AI narration, also run `npx wrangler secret put ANTHROPIC_API_KEY`.
6. **Vercel**: import this repo and set the environment variable `NEXT_PUBLIC_PARTYKIT_HOST` to the Worker URL from step 4, without `https://` (for example `critical-answer.<你的子網域>.workers.dev`, with your subdomain). If it is not set, the frontend connects to `localhost:1999`.
7. **Auto-deploy (optional)**: follow [auto-deploy](#auto-deploy) above to connect Workers Builds to GitHub.

## Settings at a glance

| Name | Where | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_PARTYKIT_HOST` | Vercel environment variable | Yes | The Worker's URL (without the protocol). `npm run dev` sets it to `localhost:8787` automatically |
| `ALLOWED_ORIGINS` | `vars` in `wrangler.jsonc` | Yes | Frontend URLs allowed to connect. Local development uses `.dev.vars` (copy `.dev.vars.example`; the content is `*`) |
| `R2_PUBLIC_BASE_URL` | `vars` in `wrangler.jsonc` | For image questions | The R2 bucket's public URL |
| `OWNER_KEY` | Worker secret | For bank editing | Password for the bank editor and the owner key |
| `ANTHROPIC_API_KEY` | Worker secret | Optional | The owner's AI narration key |
| `ROOM_IDLE_MS`, `ROOM_EXPIRE_MS` | Worker variable | Optional | How long a room may go without action before it rests and before it is wiped (milliseconds; default 2 hours and 24 hours; see the [hosting guide](hosting.en.md#known-limits)) |

## Keys for AI narration

For how the host picks AI narration in the lobby, see the [hosting guide](hosting.en.md#ai-narration).

To test the owner key locally, put `ANTHROPIC_API_KEY=sk-ant-...` in `.env` at the **project root** (`wrangler dev` reads this file, not `.env.local`), then restart `npm run dev:worker`.

The host's key is kept only in the room's memory: it is never written to a snapshot, never logged, and never sent back to any screen; the host page shows only its last 4 characters (see [SECURITY.en.md](../SECURITY.en.md)). After a server restart it must be pasted again. The owner key is read only on the server (the Worker); do not give it a `NEXT_PUBLIC_` prefix, or it ends up in the browser. Narration uses `claude-haiku-4-5`, and the end-of-game epilogue uses `claude-sonnet-5-5`. Each narration line waits at most 3 seconds (15 seconds for the epilogue); on a timeout, an error or unusable content, a scripted line is used instead. After 3 failures in a row, or when the key is refused (401/403), the whole room switches to scripted lines. Team names typed by players go into the prompt only as data; questions and answers never go into the prompt.

> **Cost**: opening a room needs no login, but AI narration turns on only with the host's own key or the owner key, and each room has a line limit. Set a spending limit for the owner's `ANTHROPIC_API_KEY` in the Anthropic Console; the program has no site-wide total limit.

## Image upload (R2)

Image upload first needs an R2 bucket named `critical-answer-images` in Cloudflare. Turn on its r2.dev public read by hand in the dashboard, then replace `R2_PUBLIC_BASE_URL` in [wrangler.jsonc](../wrangler.jsonc) with the URL Cloudflare gives you. This step is not part of `wrangler deploy`; see [docs/designs/image-question-type.md](designs/image-question-type.md).

## Deploy order

Workers Builds does not wait for CI, and it is not guaranteed to finish before Vercel: when the frontend needs a new room protocol, run `npx wrangler deploy` locally before merging. Do not roll the Worker back to a version before v0.31.3.0 (see the [development guide](development.en.md#saving-and-rollback)); for the bank's rollback floor, see the [question bank guide](question-bank.en.md#how-to-recover-when-the-bank-is-stuck).
