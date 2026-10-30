// Host-owned AI keys and the per-room narration budget (issue #102). Every fetch here is a fake:
// these tests prove what the room sends and when, not that a real Anthropic key works.
import { describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import { BANK } from "../question-bank-data";
import { asTextBank } from "../text-bank";

// Host-judged questions, so a test can judge an answer itself (the bundled bank is answered on the phones).
const bank = asTextBank(BANK);

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const TEAM_KEY = "team-key-0123456789abcdef";
const TOKEN = "host-token-0123456789abcdef";
const HOST_KEY = "sk-ant-test-HOSTKEY-0123456789abcdefWXYZ";
const OTHER_KEY = "sk-ant-test-OTHERKEY-0123456789abcdefQRST";
const ENV_KEY = "sk-ant-env-OWNERS-0123456789abcdefENVK";
const OWNER_KEY = "owner-key-0123456789abcdef0123456789";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (b: object, status = 200) => new Response(JSON.stringify(b), { status });
const line = (text: string) => json({ content: [{ type: "text", text }], stop_reason: "end_turn" });

type Call = { url: string; apiKey: string };

function memoryStorage() {
  const data = new Map<string, unknown>();
  const storage: RoomStorage & { data: Map<string, unknown> } = {
    data,
    get: async (k) => structuredClone(data.get(k)),
    put: (k, v) => void data.set(k, structuredClone(v)),
  };
  return storage;
}

function makeConn(id: string) {
  return { id, send: vi.fn(), close: vi.fn() } as unknown as Conn & { send: ReturnType<typeof vi.fn> };
}

/**
 * A room with a fake fetch. `models` answers the key check (GET /v1/models); `messages` answers each
 * narration call. Every request is recorded in `calls`, with the key it carried.
 */
function setup(
  opts: {
    env?: Record<string, string>;
    models?: (key: string) => Response | Promise<Response>;
    messages?: (key: string) => Response | Promise<Response>;
    storage?: RoomStorage;
    /** Leave the host unconnected, for a test that restores the room first (anything sent would save over the snapshot). */
    noClaim?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  const fake = async (url: unknown, init?: RequestInit) => {
    const apiKey = (init!.headers as Record<string, string>)["x-api-key"];
    calls.push({ url: String(url), apiKey });
    if (String(url).includes("/v1/models")) return (opts.models ?? (() => json({ data: [] })))(apiKey);
    return (opts.messages ?? (() => line("地城主開口了")))(apiKey);
  };
  const io = { broadcast: vi.fn(), env: opts.env ?? {}, storage: opts.storage } as unknown as RoomIO & { broadcast: ReturnType<typeof vi.fn> };
  const room = new DungeonRoom(io, () => 0, { bank, holdMs: 200, epilogueDelayMs: 0, epilogueHoldMs: 200, fetch: fake as unknown as typeof fetch });
  const host = makeConn("host");
  if (!opts.noClaim) {
    room.onConnect(host);
    room.onMessage(JSON.stringify({ type: "HOST_CLAIM", token: TOKEN }), host);
  }
  const send = (msg: object, conn: Conn = host) => room.onMessage(JSON.stringify(msg), conn);
  const sent = (conn: Conn & { send: ReturnType<typeof vi.fn> } = host) => conn.send.mock.calls.map((c) => JSON.parse(c[0]));
  const status = () => sent().findLast((m) => m.type === "HOST_AI_STATUS");
  const narrationCalls = () => calls.filter((c) => c.url.includes("/v1/messages"));
  const transcript = () => {
    send({ type: "HOST_GET_TRANSCRIPT" });
    return sent().findLast((m) => m.type === "TRANSCRIPT").entries as { provider?: string }[];
  };
  const useKey = async (key = HOST_KEY) => {
    send({ type: "HOST_AI_KEY", source: "own", provider: "anthropic", key });
    await sleep(0);
  };
  /** Both teams' phones join (or, after a restart, come back online). */
  const joinTeams = () =>
    [T1, T2].forEach((id, i) => room.onMessage(JSON.stringify({ type: "JOIN", teamId: id, teamKey: TEAM_KEY, teamName: `隊${i}` }), makeConn(`p${i}`)));
  const start = async () => {
    joinTeams();
    send({ type: "HOST_START" });
    await sleep(20);
  };
  /** One judged answer, and time for its narration to settle. */
  const judge = async () => {
    const g = room.game!;
    const teamId = g.turnOrder[g.currentTurnIndex];
    const t = g.teams.find((x) => x.id === teamId)!;
    send({ type: "HOST_NEXT", eventId: (room as unknown as { eventSeq: number }).eventSeq });
    send({ type: "HOST_JUDGE", teamId, questionId: t.inBoss ? g.boss.currentQuestionId : t.currentQuestionId, correct: true });
    await sleep(20);
  };
  return { room, io, host, calls, send, sent, status, narrationCalls, transcript, useKey, joinTeams, start, judge };
}

describe("who pays for AI narration", () => {
  it("AC1: a room whose host gave no key never calls Anthropic, even with a server key configured", async () => {
    const r = setup({ env: { ANTHROPIC_API_KEY: ENV_KEY, OWNER_KEY } });
    await r.start();
    await r.judge();
    expect(r.calls).toEqual([]);
    expect(r.status()).toMatchObject({ source: "none", keyMissing: false });
  });

  it("AC2: after the host's key is checked, every narration carries the host's key, not the server's", async () => {
    const r = setup({ env: { ANTHROPIC_API_KEY: ENV_KEY } });
    await r.useKey();
    expect(r.calls).toEqual([{ url: "https://api.anthropic.com/v1/models?limit=1", apiKey: HOST_KEY }]);
    await r.start();
    await r.judge();
    expect(r.narrationCalls().length).toBe(2);
    expect(r.narrationCalls().every((c) => c.apiKey === HOST_KEY)).toBe(true);
  });

  it("AC3/AC4: the key never appears in the save, the transcript, any message or the console; the host sees its last 4 characters", async () => {
    const logs: string[] = [];
    const spies = (["log", "warn", "error", "info"] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a) => void logs.push(a.map(String).join(" "))));
    const storage = memoryStorage();
    // One refusal mid-game too, so the error paths are covered.
    let n = 0;
    const r = setup({ storage, messages: () => (++n === 2 ? json({}, 401) : line("一句旁白")) });
    await r.useKey();
    await r.start();
    await r.judge();
    await r.judge();
    const everything = [
      JSON.stringify([...storage.data.values()]),
      JSON.stringify(r.transcript()),
      ...r.io.broadcast.mock.calls.map((c) => c[0]),
      ...r.host.send.mock.calls.map((c) => c[0]),
      ...logs,
    ].join("\n");
    spies.forEach((s) => s.mockRestore());
    expect(everything).not.toContain(HOST_KEY);
    expect(everything).not.toContain(HOST_KEY.slice(0, -4));
    expect(r.sent().find((m) => m.type === "HOST_AI_STATUS" && m.source === "own").keyHint).toBe("…WXYZ");
  });

  it("owner source: the server's key, for whoever knows OWNER_KEY, and no hint of it", () => {
    const r = setup({ env: { ANTHROPIC_API_KEY: ENV_KEY, OWNER_KEY } });
    r.send({ type: "HOST_AI_KEY", source: "owner", ownerKey: OWNER_KEY });
    expect(r.status()).toEqual({ type: "HOST_AI_STATUS", source: "owner", provider: "anthropic", keyHint: null, keyMissing: false, used: 0, limit: 300, exhausted: false });
    expect(r.calls).toEqual([]); // nothing to check: the owner vouches for their own key
  });
});

describe("refusals (AC8, AC10a)", () => {
  it.each([
    ["a key in the wrong format, without any fetch", { source: "own", provider: "anthropic", key: "not-a-key" }, {}, "invalid_key", 0],
    ["a key the provider refuses (401)", { source: "own", provider: "anthropic", key: HOST_KEY }, { models: () => json({}, 401) }, "invalid_key", 1],
    ["a check that cannot reach the provider", { source: "own", provider: "anthropic", key: HOST_KEY }, { models: () => Promise.reject(new TypeError("network down")) }, "check_failed", 1],
    ["a check that fails (500)", { source: "own", provider: "anthropic", key: HOST_KEY }, { models: () => json({}, 500) }, "check_failed", 1],
    ["a wrong owner key", { source: "owner", ownerKey: "guess" }, { env: { ANTHROPIC_API_KEY: ENV_KEY, OWNER_KEY } }, "wrong_owner_key", 0],
    ["owner mode on a server without OWNER_KEY", { source: "owner", ownerKey: OWNER_KEY }, { env: { ANTHROPIC_API_KEY: ENV_KEY } }, "owner_unavailable", 0],
    ["owner mode on a server without its own key", { source: "owner", ownerKey: OWNER_KEY }, { env: { OWNER_KEY } }, "owner_unavailable", 0],
  ] as const)("AC8: %s", async (_name, msg, opts, error, fetches) => {
    const r = setup(opts);
    r.send({ type: "HOST_AI_KEY", ...msg });
    await sleep(0);
    expect(r.status()).toMatchObject({ source: "none", error });
    expect(r.calls).toHaveLength(fetches);
  });

  it("AC8/AC10a: a non-host cannot set a key or a limit", () => {
    const r = setup();
    const stranger = makeConn("stranger");
    r.room.onConnect(stranger);
    r.send({ type: "HOST_AI_KEY", source: "own", provider: "anthropic", key: HOST_KEY }, stranger);
    r.send({ type: "HOST_AI_LIMIT", limit: 10 }, stranger);
    expect(r.sent(stranger).filter((m) => m.type === "ERROR").map((m) => m.error)).toEqual(["not_host", "not_host"]);
    expect(r.calls).toEqual([]);
  });

  it("AC8: a limit of 0, 5001 or 1.5 is refused as a bad message", () => {
    const r = setup();
    for (const limit of [0, 5001, 1.5]) r.send({ type: "HOST_AI_LIMIT", limit });
    expect(r.sent().filter((m) => m.type === "ERROR").map((m) => m.detail)).toEqual(["bad_message", "bad_message", "bad_message"]);
    expect(r.status().limit).toBe(300);
  });

  it("AC10a: a second key sent while the first is still being checked wins, and the first never shows", async () => {
    let releaseFirst!: () => void;
    const r = setup({ models: (key) => (key === HOST_KEY ? new Promise((res) => (releaseFirst = () => res(json({}, 401)))) : json({ data: [] })) });
    r.send({ type: "HOST_AI_KEY", source: "own", provider: "anthropic", key: HOST_KEY });
    await r.useKey(OTHER_KEY);
    releaseFirst();
    await sleep(0);
    const statuses = r.sent().filter((m) => m.type === "HOST_AI_STATUS");
    expect(statuses.some((m) => m.error)).toBe(false);
    expect(r.status()).toMatchObject({ source: "own", keyHint: "…QRST" });
  });
});

describe("the per-room budget", () => {
  it("AC5/AC6: three LLM lines at a limit of 3, then scripted lines with no sign of it on any screen, until the host raises it", async () => {
    const r = setup();
    await r.useKey();
    r.send({ type: "HOST_AI_LIMIT", limit: 3 });
    await r.start();
    await r.judge();
    await r.judge();
    expect(r.narrationCalls()).toHaveLength(3);
    await r.judge();
    expect(r.narrationCalls()).toHaveLength(3);
    expect(r.status()).toMatchObject({ used: 3, limit: 3, exhausted: true });
    expect(r.transcript().at(-1)).toMatchObject({ provider: "scripted" });
    // Players and the TV get broadcasts only, and none of them mention AI.
    expect(r.io.broadcast.mock.calls.every((c) => !c[0].includes("HOST_AI"))).toBe(true);

    r.send({ type: "HOST_AI_LIMIT", limit: 6 });
    await r.judge();
    expect(r.narrationCalls()).toHaveLength(4);
    expect(r.status()).toMatchObject({ used: 4, limit: 6, exhausted: false });
  });

  it("AC10a: a limit below what is already used takes effect at once", async () => {
    const r = setup();
    await r.useKey();
    await r.start();
    await r.judge();
    await r.judge();
    r.send({ type: "HOST_AI_LIMIT", limit: 1 });
    expect(r.status()).toMatchObject({ used: 3, limit: 1, exhausted: true });
    await r.judge();
    expect(r.narrationCalls()).toHaveLength(3);
  });

  it("a room that expires hands its code to the next host with no key and a fresh budget", async () => {
    const r = setup();
    await r.useKey();
    await r.start();
    (r.room as unknown as { reset(): void }).reset();
    const next = makeConn("next-host");
    r.room.onConnect(next);
    r.room.onMessage(JSON.stringify({ type: "HOST_CLAIM", token: "another-token-0123456789abc" }), next);
    expect(r.sent(next).findLast((m) => m.type === "HOST_AI_STATUS")).toMatchObject({ source: "none", keyHint: null, used: 0, limit: 300 });
  });
});

describe("restarts and key changes", () => {
  it("AC7/D3: after a restart the budget is kept, the key is not, and AI resumes once the host page resends it", async () => {
    const storage = memoryStorage();
    const a = setup({ storage });
    await a.useKey();
    a.send({ type: "HOST_AI_LIMIT", limit: 50 });
    await a.start();
    await a.judge();

    const b = setup({ storage, noClaim: true });
    expect(await b.room.restore()).toBe("restored");
    b.room.onConnect(b.host);
    b.room.onMessage(JSON.stringify({ type: "HOST_CLAIM", token: TOKEN }), b.host);
    expect(b.status()).toMatchObject({ source: "own", keyMissing: true, keyHint: null, used: 2, limit: 50 });
    b.joinTeams();
    await b.judge();
    expect(b.narrationCalls()).toHaveLength(0);
    await b.useKey();
    await b.judge();
    expect(b.narrationCalls().map((c) => c.apiKey)).toEqual([HOST_KEY]);
  });

  it("D7: the save says aiNarration:false even with AI on, so a reverted server never switches its own key on", async () => {
    const storage = memoryStorage();
    const r = setup({ storage });
    await r.useKey();
    await r.start();
    expect(storage.data.get("room")).toMatchObject({ aiNarration: false, aiWanted: true, aiSource: "own" });
  });

  it("D2: after a 401 mid-game, a new key the host pastes brings AI back", async () => {
    const r = setup({ messages: (key) => (key === HOST_KEY ? json({}, 401) : line("新的旁白")) });
    await r.useKey();
    await r.start();
    expect(r.status()).toMatchObject({ keyMissing: true, error: "invalid_key" });
    await r.useKey(OTHER_KEY);
    expect(r.status().error).toBeUndefined();
    await r.judge();
    expect(r.narrationCalls().at(-1)!.apiKey).toBe(OTHER_KEY);
  });

  it("D4: three failures in a row tell the host AI stopped", async () => {
    const r = setup({ messages: () => json({ error: { message: "credit balance too low" } }, 400) });
    await r.useKey();
    await r.start();
    await r.judge();
    await r.judge();
    expect(r.status()).toMatchObject({ source: "own", keyMissing: false, error: "ai_stopped" });
  });

  it("D4: after AI stopped, pasting the same key again (once credit is topped up) brings AI back", async () => {
    let broke = true;
    const r = setup({ messages: () => (broke ? json({ error: { message: "credit balance too low" } }, 400) : line("又能說話了")) });
    await r.useKey();
    await r.start();
    await r.judge();
    await r.judge();
    expect(r.status().error).toBe("ai_stopped");
    broke = false;
    await r.useKey();
    expect(r.status().error).toBeUndefined();
    const before = r.narrationCalls().length;
    await r.judge();
    expect(r.narrationCalls().length).toBe(before + 1);
  });

  it("D6: the host page resending the same key makes no new check; a bad new key leaves the old one in use", async () => {
    const r = setup({ models: (key) => (key === OTHER_KEY ? json({}, 401) : json({ data: [] })) });
    await r.useKey();
    await r.useKey();
    expect(r.calls.filter((c) => c.url.includes("/v1/models"))).toHaveLength(1);
    await r.useKey(OTHER_KEY);
    expect(r.status()).toMatchObject({ keyHint: "…WXYZ", error: "invalid_key" });
    await r.start();
    expect(r.narrationCalls().map((c) => c.apiKey)).toEqual([HOST_KEY]);
  });

  it("D8: a late 401 from a key the host already replaced does not drop the new key or stop AI", async () => {
    let refuseOld!: () => void;
    const r = setup({ messages: (key) => (key === HOST_KEY ? new Promise((res) => (refuseOld = () => res(json({}, 401)))) : line("新的旁白")) });
    await r.useKey();
    await r.start(); // its narration is still waiting on the old key
    await r.useKey(OTHER_KEY);
    refuseOld();
    await sleep(20);
    expect(r.status()).toMatchObject({ keyHint: "…QRST", keyMissing: false });
    expect(r.status().error).toBeUndefined();
    await r.judge();
    expect(r.narrationCalls().at(-1)!.apiKey).toBe(OTHER_KEY);
  });

  it("forgetting the key goes back to scripted lines at once", async () => {
    const r = setup();
    await r.useKey();
    await r.start();
    r.send({ type: "HOST_AI_KEY", source: "none" });
    await r.judge();
    expect(r.narrationCalls()).toHaveLength(1);
    expect(r.status()).toMatchObject({ source: "none", keyHint: null, keyMissing: false });
  });
});
