import { describe, it, expect, vi, afterEach } from "vitest";
import {
  claimScreenAutoReload,
  forgetStored,
  joinPasswordFor,
  readStored,
  rememberJoinPassword,
  SCREEN_ERROR_RELOAD_GAP_MS,
  writeStored,
} from "./stored";

afterEach(() => vi.unstubAllGlobals());

describe("readStored / writeStored", () => {
  it("round-trips a value, and reads null for a key that was never written", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    writeStored("k", "v");
    expect(readStored("k")).toBe("v");
    expect(readStored("missing")).toBeNull();
  });

  it("never throws when storage is blocked (private browsing): reads null, writes are dropped", () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });
    expect(readStored("k")).toBeNull();
    expect(() => writeStored("k", "v")).not.toThrow();
  });
});

// Value: protects=the join password rides sessionStorage per room, never the URL, and blocked storage never breaks
// joining; fails_when=the key ignores the code's case, an empty password is kept, or a throw escapes;
// why_new=no test (coverage pass 2026-11-16); seam=none
describe("rememberJoinPassword / joinPasswordFor / forgetStored", () => {
  it("keeps one password per room code, whatever its case, and an empty one forgets it", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    rememberJoinPassword("abcd", "芝麻開門");
    expect(joinPasswordFor("ABCD")).toBe("芝麻開門");
    expect(joinPasswordFor("WXYZ")).toBe("");
    rememberJoinPassword("ABCD", "");
    expect(joinPasswordFor("abcd")).toBe("");
  });

  it("never throws when storage is blocked", () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.stubGlobal("sessionStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
    vi.stubGlobal("localStorage", { removeItem: blocked });
    expect(() => rememberJoinPassword("ABCD", "x")).not.toThrow();
    expect(joinPasswordFor("ABCD")).toBe("");
    expect(() => forgetStored("k")).not.toThrow();
  });
});

// Value: protects=a crashed big screen recovers by itself, but never reloads in a loop (audit 2026-11-16 #4);
// fails_when=host or phone pages auto-reload, the one-per-minute gap breaks, or blocked storage allows a loop;
// why_new=e2e cannot crash the screen on purpose; seam=claimScreenAutoReload is all ErrorScreen decides with.
describe("claimScreenAutoReload", () => {
  it("only the big screen, at most once per gap, and never with blocked storage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(claimScreenAutoReload("/room/ABCD/host", 1000)).toBe(false);
    expect(claimScreenAutoReload("/room/ABCD/play", 1000)).toBe(false);
    expect(claimScreenAutoReload("/room/ABCD/screen", 1000)).toBe(true);
    expect(claimScreenAutoReload("/room/ABCD/screen/", 1000 + SCREEN_ERROR_RELOAD_GAP_MS - 1)).toBe(false);
    expect(claimScreenAutoReload("/room/ABCD/screen", 1000 + SCREEN_ERROR_RELOAD_GAP_MS)).toBe(true);
    expect(claimScreenAutoReload("/room/ABCD/screen", 1000 - SCREEN_ERROR_RELOAD_GAP_MS)).toBe(true); // the clock jumped back
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.stubGlobal("sessionStorage", { getItem: blocked, setItem: blocked });
    expect(claimScreenAutoReload("/room/ABCD/screen", 10 * SCREEN_ERROR_RELOAD_GAP_MS)).toBe(false);
  });
});
