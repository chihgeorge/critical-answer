// HOST_BANK_CHECK (docs/designs/bank-health-check.md): the host checks the room's bank in the lobby.
import { describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import type { Bank } from "../question-bank";
import type { MediaBatch, MediaResults } from "../bank-health";
import { parseClientMessage } from "../protocol";

const TOKEN = "host-token-0123456789abcdef";
const TEAM = "00000000-0000-0000-0000-000000000001";
const VIDEO = "dQw4w9WgXcQ";
const bankWith = (videoId: string): Bank => ({
  pools: { 1: [{ kind: "text", id: "q1", content: { kind: "youtube", value: videoId }, prompt: "猜歌名", answer: "秘密答案" }], 2: [], 3: [], 4: [], 5: [] },
  rooms: [{ monster: "slime-soft", difficulty: 1, reward: 10 }],
  boss: { monster: "dragon", hitReward: 10, phases: [{ name: "", rule: "", maxHp: 10, questions: [{ kind: "text", id: "b1", content: { kind: "text", value: "魔王？" }, answer: "魔王答案" }] }] },
});

const conn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: ReturnType<typeof vi.fn> };
const sent = (c: { send: ReturnType<typeof vi.fn> }) => c.send.mock.calls.map(([m]) => JSON.parse(m as string));
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { loadBank?: (id: string) => Promise<Bank>; checkMedia?: (b: MediaBatch) => Promise<MediaResults> } = {}) {
  const loadBank = vi.fn(opts.loadBank ?? (async () => bankWith(VIDEO)));
  const checkMedia = vi.fn(opts.checkMedia ?? (async (b: MediaBatch) => ({ youtube: Object.fromEntries(b.youtube.map((id) => [id, "private" as const])), files: {} })));
  const io = { broadcast: vi.fn(), env: {}, loadBank, checkMedia } as unknown as RoomIO;
  const room = new DungeonRoom(io, () => 0);
  const host = conn("host");
  const send = (c: Conn, msg: object) => room.onMessage(JSON.stringify(msg), c);
  send(host, { type: "HOST_CLAIM", token: TOKEN });
  return { room, host, send, loadBank, checkMedia };
}
const health = (c: { send: ReturnType<typeof vi.fn> }) => sent(c).filter((m) => m.type === "HOST_BANK_HEALTH");
const lastError = (c: { send: ReturnType<typeof vi.fn> }) => sent(c).filter((m) => m.type === "ERROR").at(-1);

it("parses HOST_BANK_CHECK", () => {
  expect(parseClientMessage({ type: "HOST_BANK_CHECK", extra: 1 })).toEqual({ type: "HOST_BANK_CHECK" });
});

describe("HOST_BANK_CHECK", () => {
  it("reloads the room's bank, checks it, and answers the asking host only, with no answer or video id", async () => {
    const { host, send, loadBank, room } = setup();
    const phone = conn("phone");
    send(phone, { type: "JOIN", teamId: TEAM, teamKey: "team-key-0123456789abcdef", teamName: "A" });
    send(host, { type: "HOST_BANK_CHECK" });
    await flush();
    await flush();
    expect(loadBank).toHaveBeenCalledWith("default");
    expect((room as unknown as { bank: Bank }).bank.pools[1][0].content.value).toBe(VIDEO); // the reloaded copy
    const [msg] = health(host);
    expect(msg).toMatchObject({ questions: 2, unchecked: 0, reloaded: true });
    expect(msg.rows).toEqual([expect.objectContaining({ level: "red", questionId: "q1", where: "難度 1", label: "猜歌名" })]);
    const text = JSON.stringify(msg);
    expect(text).not.toContain("秘密答案");
    expect(text).not.toContain(VIDEO);
    expect(sent(phone).some((m) => m.type === "HOST_BANK_HEALTH")).toBe(false);
  });

  it("refuses a player, a started game, and a second check while one runs", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { host, send } = setup({ checkMedia: async () => (await gate, { youtube: {}, files: {} }) });
    const phone = conn("phone");
    send(phone, { type: "HOST_BANK_CHECK" });
    expect(lastError(phone)).toMatchObject({ error: "not_host" });
    send(host, { type: "HOST_BANK_CHECK" });
    await flush();
    send(host, { type: "HOST_BANK_CHECK" });
    expect(lastError(host)).toMatchObject({ detail: "check_running" });
    release();
    await flush();
    await flush();
    expect(health(host)).toHaveLength(1);
    // A failed lookup batch reads as unknown: yellow, never green.
    expect(health(host)[0].rows[0]).toMatchObject({ level: "yellow", questionId: "q1" });

    send(phone, { type: "JOIN", teamId: TEAM, teamKey: "team-key-0123456789abcdef", teamName: "A" });
    send(host, { type: "HOST_START" });
    send(host, { type: "HOST_BANK_CHECK" });
    expect(lastError(host)).toMatchObject({ error: "game_already_started" });
  });

  it("answers check_stale, not rows, when the bank changes mid-check", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { host, send } = setup({ checkMedia: async () => (await gate, { youtube: {}, files: {} }) });
    send(host, { type: "HOST_BANK_CHECK" });
    await flush();
    send(host, { type: "HOST_SET_BANK", bankId: "default" });
    release();
    await flush();
    await flush();
    expect(health(host)).toHaveLength(0);
    expect(lastError(host)).toMatchObject({ detail: "check_stale" });
  });

  it("checks the room's own copy when the reload fails, and frees the check for the next press", async () => {
    let fail = true;
    const { host, send } = setup({
      loadBank: async () => {
        if (fail) throw new Error("gone");
        return bankWith(VIDEO);
      },
    });
    send(host, { type: "HOST_BANK_CHECK" });
    await flush();
    await flush();
    expect(sent(host).filter((m) => m.type === "ERROR").map((m) => m.detail)).toEqual(["bank_unavailable"]);
    expect(health(host)).toEqual([expect.objectContaining({ reloaded: false })]);
    fail = false;
    send(host, { type: "HOST_BANK_CHECK" });
    await flush();
    await flush();
    expect(health(host).at(-1)).toMatchObject({ reloaded: true });
  });

  it("reads a lookup batch that throws, or never answers, as unknown", async () => {
    const thrown = setup({ checkMedia: async () => Promise.reject(new Error("rpc")) });
    thrown.send(thrown.host, { type: "HOST_BANK_CHECK" });
    await flush();
    await flush();
    expect(health(thrown.host)[0].rows[0]).toMatchObject({ level: "yellow", questionId: "q1" });

    vi.useFakeTimers();
    try {
      const hung = setup({ checkMedia: () => new Promise<MediaResults>(() => {}) });
      hung.send(hung.host, { type: "HOST_BANK_CHECK" });
      await vi.advanceTimersByTimeAsync(40_000);
      expect(health(hung.host)[0].rows[0]).toMatchObject({ level: "yellow", questionId: "q1" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing when the game starts mid-check", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { host, send } = setup({ checkMedia: async () => (await gate, { youtube: {}, files: {} }) });
    send(conn("phone"), { type: "JOIN", teamId: TEAM, teamKey: "team-key-0123456789abcdef", teamName: "A" });
    send(host, { type: "HOST_BANK_CHECK" });
    await flush();
    send(host, { type: "HOST_START" });
    release();
    await flush();
    await flush();
    expect(health(host)).toHaveLength(0);
    expect(sent(host).some((m) => m.type === "ERROR" && String(m.detail).startsWith("check_"))).toBe(false);
  });

  it("checks the room's copy of a custom bank when the host has not proved OWNER_KEY", async () => {
    const { host, send, loadBank, room } = setup();
    (room as unknown as { bankChoice: { id: string; name: string } }).bankChoice = { id: "party", name: "派對" };
    send(host, { type: "HOST_BANK_CHECK" });
    await flush();
    await flush();
    expect(loadBank).not.toHaveBeenCalled();
    expect(health(host)[0]).toMatchObject({ reloaded: false });
  });
});
