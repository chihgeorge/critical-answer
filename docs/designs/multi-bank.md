# Multi-bank: the owner stores named banks, the host picks one

TODOS.md 「主持人開房時可以用自己的題庫」. Approach chosen by the owner: the owner stores several named banks in the
existing BankStore; a host picks one in the lobby. Host upload/paste of a bank is out of scope.

## Storage (lib/bank-store.ts)

- One BankStore Durable Object holds every bank (`BANK_DO_NAME` unchanged).
- The default bank (id `default`, 「預設題庫」) keeps the keys every earlier deploy used: `bank` and `legacyBank`.
  Its seed, unreadable and outdated behaviour is unchanged, and callers without an id get it. It cannot be renamed
  or deleted. An upgrade therefore reads the same stored bank and loses nothing.
- A custom bank lives at `bank:<uuid>` (same `{bank, version, format}` shape), its backup at `legacyBank:<uuid>`.
  The index `banks` lists `[{id, name}]` of custom banks only, in creation order.
- Names: trimmed, 1-30 characters, unique (the default's name included). At most 20 custom banks.
- `createBank(name, copyFrom?)`: a copy of a readable bank, or `BLANK_BANK` (the least that saves: one room with one
  sample question, a boss with one). The bank is written before the index, so a failure between the two leaves an
  unlisted record, never a listed bank with nothing stored.
- `deleteBank(id)`: index first, then the records, then the bank's files join the cleanup queue. A failure between
  them can only leak files, never delete one in use. An unreadable bank's files come from its raw stored value.
- Versions and the 409 conflict are per bank.

## Media cleanup

- The in-use set is the union of every bank's files. Cleanup is deferred while any bank is unreadable or outdated.
- A save may reference a file another bank uses (not only files in its own bank or in the queue).
- The queue moved from `pendingImageDeletes` to `pendingMediaDeletes`. Code from before multi-bank reads only the
  default bank; after a rollback it would delete files only a custom bank uses. It never sees the new key, so the
  worst case is a leak. The old key is still read and merged, so a rollback's uploads are cleaned after a roll
  forward. Accepted by the owner 2026-11-11; follow-up in TODOS.md.
- Known limit carried over: the cleanup delay counts from a room's first game start, not from when its lobby copied
  the bank (the `shortcut:` in worker/index.ts). Deleting a custom bank uses the same delay as a save's orphans.

## API (lib/bank-api.ts, OWNER_KEY everywhere)

- `GET/PUT /api/bank?id=<id>`: missing id is the default bank, as before. Unknown id: 404.
- `/api/banks`: GET list, POST `{name, copyFrom?}`, PATCH `?id=` `{name}`, DELETE `?id=`. Store refusals are 400.
- `BANK_NOT_FOUND` lives in bank-api.ts: bank-api.ts must not import bank-store.ts at runtime, because
  bank-image-api.ts (imported by the editor page) imports bank-api.ts, and bank-store.ts imports the bundled bank.
  `npm run check:bundle` caught exactly this during development.

## Room (lib/room/dungeon-room.ts)

- RoomIO gains `listBanks()` and `loadBank(id)`; the worker wires them to BankStoreDO RPC and refuses an unreadable
  bank (the fallback is not the bank the host picked).
- `HOST_BANKS {banks, selected, loading?}`: host-only, names only. Before a host proves OWNER_KEY, `banks` is the
  default alone.
- D4 (owner decision): a custom bank needs a host that proved OWNER_KEY, reusing the HOST_AI_KEY source "owner"
  check (`ownerProven`, in memory; the page resends its key after HOST_OK). Enforced in `handleSetBank`, not only by
  the menu: every host page gets the answers of the bank in play. A server without ANTHROPIC_API_KEY still proves
  the owner key (the AI part then answers `owner_unavailable`).
- `HOST_SET_BANK {bankId}`: lobby only. A generation counter (`bankGen`, also bumped by reset) drops a bank that
  arrives after a newer pick or an expired room. The bank, its answer list for narration filtering, and
  `bankChoice` change together; `playedQuestionIds` is cleared (ids from another bank). `HOST_START` is refused while
  a bank loads. The room's copy is saved under the room's BANK_KEY as before, and `bankChoice` in the snapshot.
- Reset (expiry) goes back to the default bank and forgets the owner proof.

## UI

- Host lobby (D1): 「題庫：」 select above 「開始遊戲」, default 「預設題庫」; 開始遊戲 disabled while loading. A
  selected bank missing from the list (deleted, or not offered to this host) is still shown by name.
- Editor: bank select, 「＋ 空白題庫」 (D3), 「＋ 複製預設題庫」, 改名, 刪除 with a browser confirm 「刪了不能復原」 (D2).
  Requests lock the editor like a save; the shown bank id changes only when a load lands, so a save goes to the
  bank it loaded. Switching with unsaved edits asks first.

## Not in scope

- Host upload or paste of a bank (the original TODO's wording); content review of custom bank text before it reaches
  the AI prompt (owner-written only, so the existing TODO stays as is).
- A trash/undo for deleted banks.
