[繁體中文](SECURITY.md) | English

# Reporting security problems

If you find a security vulnerability, please report it privately. Do not open a public issue.

Go to this repo's **Security** tab, click **Report a vulnerability**, and write what you found and how to reproduce it. Only the maintainers can see the report.

The live game is at https://critical-answer.vercel.app , and the Worker is at `critical-answer.aiko-studio.workers.dev`. Please do not run load tests or automated scanners against them.

## The host's Anthropic API key

- The key lives only in that room's memory (Durable Object). It is not written into room snapshots, not written to logs, and not sent to any screen; the host page shows only the last 4 characters.
- The server first checks the key with `GET /v1/models` and turns it on only if that passes. When Anthropic rejects it (401/403), the key is dropped at once and narration falls back to scripted lines.
- A room checks at most 3 new keys a minute and 10 over its life (a server restart does not reset the count). Past that it sends no check, and the host page says the key could not be checked, without saying whether the key works, so whoever opens a room cannot use it to test stolen keys in bulk. A mistyped key, and a resend of the key in use, do not count.
- "Remember this computer" (「記住這台電腦」) stores the key only in the host's own browser (localStorage). If it is not ticked, nothing is stored.
- When the room changes host (the host was away too long), the previous host's key and usage are cleared together.
- Each room has a line limit (300 by default). Site owners should set a spending limit in the Anthropic Console for the server's `ANTHROPIC_API_KEY`.
