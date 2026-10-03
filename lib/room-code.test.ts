import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { freshAttempt, freshHostPath, generateRoomCode, getHostToken, getOrCreateTeamId, getOrCreateTeamKey, isFreshRoomHash, MAX_FRESH_ATTEMPTS, newHostToken, settledHash } from "./room-code";
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

describe("fresh room links", () => {
  it("only a link marked new=1 is a fresh room", () => {
    expect(isFreshRoomHash("#k=abc&new=1")).toBe(true);
    expect(isFreshRoomHash("#new=1&k=abc")).toBe(true);
    expect(isFreshRoomHash("#k=abc")).toBe(false);
    expect(isFreshRoomHash("")).toBe(false);
    expect(isFreshRoomHash("#k=abc&new=0")).toBe(false);
  });

  it("counts the attempts a link has made, and treats anything that is not a positive whole number as none", () => {
    expect(freshAttempt("#k=abc&new=1")).toBe(1);
    expect(freshAttempt("#k=abc&new=4")).toBe(4);
    for (const bad of ["", "#k=abc", "#new=0", "#new=-1", "#new=1.5", "#new=abc", "#new="]) expect(freshAttempt(bad), bad).toBe(0);
  });

  it("the next attempt's path carries the incremented count, and gives up at the cap", () => {
    const path = freshHostPath("ABCD", "0123456789abcdef", 3);
    expect(freshAttempt(path.slice(path.indexOf("#")))).toBe(3);
    expect(MAX_FRESH_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_FRESH_ATTEMPTS).toBeLessThanOrEqual(10);
  });

  it("settling drops new=1 and keeps the host token", () => {
    expect(settledHash("#k=abc&new=1")).toBe("#k=abc");
    expect(settledHash("#new=1&k=abc")).toBe("#k=abc");
    expect(settledHash("#k=abc")).toBe("#k=abc");
    expect(settledHash("#new=1")).toBe("");
  });

  it("the path the home page opens is fresh, and settling it leaves the plain host link", () => {
    const path = freshHostPath("ABCD", "0123456789abcdef");
    expect(path).toBe("/room/ABCD/host#k=0123456789abcdef&new=1");
    expect(isFreshRoomHash(path.slice(path.indexOf("#")))).toBe(true);
    expect(settledHash(path.slice(path.indexOf("#")))).toBe("#k=0123456789abcdef");
  });
});

describe("newHostToken / getHostToken", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("location", { hash: "" });
  });

  // Not vi.unstubAllGlobals(): that would also drop the module-level localStorage stub.
  afterEach(() => {
    delete (globalThis as { location?: unknown }).location;
  });

  it("mints a fresh 32-hex-char token each time", () => {
    const a = newHostToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newHostToken()).not.toBe(a);
  });

  it("returns null when this browser has no token for the room and the URL carries none", () => {
    expect(getHostToken("ABCD")).toBeNull();
  });

  it("a #k= fragment wins and is remembered, so a later visit without it keeps control", () => {
    vi.stubGlobal("location", { hash: "#k=from-the-link&new=1" });
    expect(getHostToken("ABCD")).toBe("from-the-link");
    vi.stubGlobal("location", { hash: "" });
    expect(getHostToken("ABCD")).toBe("from-the-link");
  });

  it("keeps one token per room", () => {
    vi.stubGlobal("location", { hash: "#k=room-a-token" });
    getHostToken("AAAA");
    vi.stubGlobal("location", { hash: "" });
    expect(getHostToken("BBBB")).toBeNull();
    expect(getHostToken("AAAA")).toBe("room-a-token");
  });

  it("a fresher link replaces an older stored token for the same room", () => {
    vi.stubGlobal("location", { hash: "#k=old" });
    getHostToken("ABCD");
    vi.stubGlobal("location", { hash: "#k=new" });
    expect(getHostToken("ABCD")).toBe("new");
    vi.stubGlobal("location", { hash: "" });
    expect(getHostToken("ABCD")).toBe("new");
  });
});
