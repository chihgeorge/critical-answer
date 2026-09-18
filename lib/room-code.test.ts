import { describe, it, expect, beforeEach } from "vitest";
import { generateRoomCode, getOrCreateTeamId } from "./room-code";

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
