// HOST_SET_BANK / HOST_BANKS (docs/designs/multi-bank.md): a host picks the next game's bank in the lobby.
import { describe, it, expect, vi } from "vitest";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO, RoomStorage } from "./io";
import type { Bank } from "../question-bank";
import { BANK } from "../question-bank-data";
import { BANK_KEY } from "./snapshot";
import { parseClientMessage } from "../protocol";

it("parses HOST_SET_BANK with a short string id only", () => {
  expect(parseClientMessage({ type: "HOST_SET_BANK", bankId: "party" })).toEqual({ type: "HOST_SET_BANK", bankId: "party" });
  expect(parseClientMessage({ type: "HOST_SET_BANK", bankId: 3 })).toBeNull();
  expect(parseClientMessage({ type: "HOST_SET_BANK", bankId: "" })).toBeNull();
  expect(parseClientMessage({ type: "HOST_SET_BANK", bankId: "x".repeat(65) })).toBeNull();
});

const OWNER_KEY = "owner-key-0123456789abcdef0123456789";
const TOKEN = "host-token-0123456789abcdef";
const TEAM = "00000000-0000-0000-0000-000000000001";
const PARTY: Bank = {
  pools: { 1: [{ kind: "text", id: "p-q1", content: { kind: "text", value: "派對題？" }, answer: "派對答案" }], 2: [], 3: [], 4: [], 5: [] },
  rooms: [{ monster: "slime-soft", difficulty: 1, reward: 10 }],
  boss: { monster: "dragon", hitReward: 10, phases: [{ name: "", rule: "", maxHp: 10, questions: [{ kind: "text", id: "p-b1", content: { kind: "text", value: "魔王？" }, answer: "魔王答案" }] }] },
};
const BANKS = [
  { id: "default", name: "預設題庫" },
  { id: "party", name: "派對" },
];

const conn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn & { send: ReturnType<typeof vi.fn> };
const sent = (c: { send: ReturnType<typeof vi.fn> }) => c.send.mock.calls.map(([m]) => JSON.parse(m as string));
const lastBanks = (c: { send: ReturnType<typeof vi.fn> }) => sent(c).filter((m) => m.type === "HOST_BANKS").at(-1);
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(loadBank = vi.fn(async (id: string) => (id === "party" ? PARTY : BANK))) {
  const data = new Map<string, unknown>();
  const storage: RoomStorage = { get: async (k) => structuredClone(data.get(k)), put: (k, v) => void data.set(k, structuredClone(v)) };
  const io = { broadcast: vi.fn(), env: { OWNER_KEY }, storage, listBanks: vi.fn(async () => BANKS), loadBank } as unknown as RoomIO;
  const room = new DungeonRoom(io, () => 0);
  const host = conn("host");
  const send = (c: Conn, msg: object) => room.onMessage(JSON.stringify(msg), c);
  send(host, { type: "HOST_CLAIM", token: TOKEN });
  const prove = () => send(host, { type: "HOST_AI_KEY", source: "owner", ownerKey: OWNER_KEY });
  return { room, host, send, prove, data, io, loadBank };
}

describe("HOST_SET_BANK", () => {
  it("offers only the default bank until a host proves OWNER_KEY, then the owner's banks", async () => {
    const { host, prove } = setup();
    expect(lastBanks(host)).toEqual({ type: "HOST_BANKS", banks: [BANKS[0]], selected: BANKS[0] });
    prove();
    await flush();
    expect(lastBanks(host)).toEqual({ type: "HOST_BANKS", banks: BANKS, selected: BANKS[0] });
  });

  it("refuses a custom bank to a host without OWNER_KEY, on the server", async () => {
    const { room, host, send, loadBank } = setup();
    send(host, { type: "HOST_AI_KEY", source: "owner", ownerKey: "wrong" });
    send(host, { type: "HOST_SET_BANK", bankId: "party" });
    await flush();
    expect(loadBank).not.toHaveBeenCalled();
    expect(sent(host).at(-1)).toEqual({ type: "ERROR", error: "invalid_action", detail: "owner_only" });
    expect((room as unknown as { bank: Bank }).bank).toBe(BANK);
  });

  it("plays the picked bank: saved in the room, its answers filtered from narration, shown to the host", async () => {
    const { room, host, send, prove, data } = setup();
    prove();
    send(host, { type: "HOST_SET_BANK", bankId: "party" });
    await flush();
    expect((room as unknown as { bank: Bank }).bank).toBe(PARTY);
    expect((room as unknown as { bankAnswers: string[] }).bankAnswers).toContain("派對答案");
    expect(lastBanks(host)).toEqual({ type: "HOST_BANKS", banks: BANKS, selected: BANKS[1] });
    expect(data.get(BANK_KEY)).toEqual(PARTY);
    expect((data.get("snapshot") as { bankChoice?: unknown } | undefined)?.bankChoice ?? (await findChoice(data))).toEqual(BANKS[1]);
  });

  it("restores the pick after a restart, and a reset goes back to the default", async () => {
    const { host, send, prove, data, io } = setup();
    prove();
    send(host, { type: "HOST_SET_BANK", bankId: "party" });
    await flush();
    const again = new DungeonRoom(io, () => 0);
    expect(await again.restore()).toBe("restored");
    expect((again as unknown as { bank: Bank }).bank).toEqual(PARTY);
    const h2 = conn("h2");
    again.onMessage(JSON.stringify({ type: "HOST_CLAIM", token: TOKEN }), h2);
    expect(lastBanks(h2)).toEqual({ type: "HOST_BANKS", banks: [BANKS[0]], selected: BANKS[1] });
    expect(data.size).toBeGreaterThan(0);
  });

  it("drops a bank that arrives after a newer pick", async () => {
    let release!: (b: Bank) => void;
    const slow = vi.fn((id: string) => (id === "party" ? new Promise<Bank>((r) => (release = r)) : Promise.resolve(BANK)));
    const { room, host, send, prove } = setup(slow);
    prove();
    send(host, { type: "HOST_SET_BANK", bankId: "party" });
    send(host, { type: "HOST_SET_BANK", bankId: "default" });
    await flush();
    release(PARTY);
    await flush();
    expect((room as unknown as { bank: Bank }).bank).toBe(BANK);
    expect(lastBanks(host).selected).toEqual(BANKS[0]);
  });

  it("holds 開始遊戲 while a bank loads, and refuses a switch mid-game", async () => {
    let release!: (b: Bank) => void;
    const slow = vi.fn(() => new Promise<Bank>((r) => (release = r)));
    const { room, host, send, prove } = setup(slow);
    send(conn("phone"), { type: "JOIN", teamId: TEAM, teamKey: "team-key-0123456789abcdef", teamName: "A" });
    prove();
    send(host, { type: "HOST_SET_BANK", bankId: "party" });
    send(host, { type: "HOST_START" });
    expect(sent(host).at(-1)).toEqual({ type: "ERROR", error: "invalid_action", detail: "bank_loading" });
    await flush();
    release(PARTY);
    await flush();
    send(host, { type: "HOST_START" });
    expect(room.game).not.toBeNull();
    send(host, { type: "HOST_SET_BANK", bankId: "default" });
    expect(sent(host).at(-1)).toEqual({ type: "ERROR", error: "game_already_started" });
  });

  it("tells the host when the bank cannot be loaded, and keeps the one it had", async () => {
    const { room, host, send, prove } = setup(vi.fn(async () => Promise.reject(new Error("gone"))));
    prove();
    send(host, { type: "HOST_SET_BANK", bankId: "party" });
    await flush();
    expect(sent(host).some((m) => m.type === "ERROR" && m.detail === "bank_unavailable")).toBe(true);
    expect((room as unknown as { bank: Bank }).bank).toBe(BANK);
    expect(lastBanks(host).loading).toBeUndefined();
  });
});

/** The snapshot key is internal: find the saved value that carries a bankChoice. */
async function findChoice(data: Map<string, unknown>) {
  for (const v of data.values()) if (v && typeof v === "object" && "bankChoice" in v) return (v as { bankChoice: unknown }).bankChoice;
  return undefined;
}
