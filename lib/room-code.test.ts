import { describe, it, expect, beforeEach, vi } from "vitest";
import { generateRoomCode, getOrCreateTeamId, getOrCreateTeamKey } from "./room-code";
import { TEAM_KEY_RE } from "./protocol";

// The only test that needs a browser API: a Map-backed localStorage is enough.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  clear: () => store.clear(),
});

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateRoomCode", () => {
  it("produces a 4-character code from the room-code alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[BCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    }
  });
});

describe("getOrCreateTeamId", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns a stored id on repeat calls without minting a new one", () => {
    const first = getOrCreateTeamId();
    const second = getOrCreateTeamId();
    expect(second).toBe(first);
  });

  it("mints a valid UUID v4 when secure-context crypto.randomUUID is available", () => {
    const id = getOrCreateTeamId();
    expect(id).toMatch(UUID_V4_RE);
  });

  it(
    "falls back to crypto.getRandomValues and still produces a valid UUID v4 " +
      "when crypto.randomUUID is unavailable — the insecure-context case that " +
      "broke JOIN entirely when a phone connects over http://<lan-ip> (see " +
      "docs/designs/critical-answer-party-game.md playtest notes)",
    () => {
      const originalRandomUUID = crypto.randomUUID;
      // @ts-expect-error simulating an insecure context, where this is undefined
      crypto.randomUUID = undefined;
      try {
        const id = getOrCreateTeamId();
        expect(id).toMatch(UUID_V4_RE);
      } finally {
        crypto.randomUUID = originalRandomUUID;
      }
    },
  );

  it("the insecure-context fallback still satisfies the server's UUID validation regex", () => {
    const originalRandomUUID = crypto.randomUUID;
    // @ts-expect-error simulating an insecure context
    crypto.randomUUID = undefined;
    try {
      const id = getOrCreateTeamId();
      const serverSideUuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(id).toMatch(serverSideUuidRe);
    } finally {
      crypto.randomUUID = originalRandomUUID;
    }
  });

  it("persists the fallback-generated id across repeat calls too", () => {
    const originalRandomUUID = crypto.randomUUID;
    // @ts-expect-error simulating an insecure context
    crypto.randomUUID = undefined;
    try {
      const first = getOrCreateTeamId();
      const second = getOrCreateTeamId();
      expect(second).toBe(first);
    } finally {
      crypto.randomUUID = originalRandomUUID;
    }
  });
});

describe("getOrCreateTeamKey", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("mints a key the server accepts, and keeps it across calls (a reconnect must prove the same key)", () => {
    const first = getOrCreateTeamKey();
    expect(first).toMatch(TEAM_KEY_RE);
    expect(getOrCreateTeamKey()).toBe(first);
  });

  it("is not the team id (the id is public, the key is not)", () => {
    expect(getOrCreateTeamKey()).not.toBe(getOrCreateTeamId());
  });

  it("differs between browsers", () => {
    const a = getOrCreateTeamKey();
    localStorage.clear();
    expect(getOrCreateTeamKey()).not.toBe(a);
  });
});
