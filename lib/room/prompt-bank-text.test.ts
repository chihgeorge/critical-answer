// What the bank's author wrote never reaches the AI narrator's prompt (TODOS: Host 自訂題庫文字進 LLM prompt 前的內容審核).
// A whole game with AI narration on a bank whose every question string is a unique marker; the fake fetch keeps
// every prompt. Only the boss phase's name and rule go in, as quoted data the system prompt says to ignore.
import { afterEach, describe, it, expect, vi } from "vitest";
import { sendSettled } from "./test-send";
import { DungeonRoom } from "./dungeon-room";
import type { Conn, RoomIO } from "./io";
import { findQuestion, type Bank, type BankQuestion } from "../question-bank";
import { BANK } from "../question-bank-data";
import { SORT_ORDERS } from "../sort-order";

// Value: protects=no question, answer, option, sort item or explanation can steer (or leak through) the narrator;
// fails_when=any bank question string is put in a prompt, or the phase name/rule goes in unquoted or unguarded;
// no_claim=what a real model does with the quoted phase text (llm.live.test.ts covers team names).
const T1 = "00000000-0000-0000-0000-000000000001";
const conn = (id: string) => ({ id, send: vi.fn(), close: vi.fn() }) as unknown as Conn;
const send = (room: DungeonRoom, c: Conn, msg: object) => sendSettled(room, c, msg);

const markers: string[] = [];
const mark = () => {
  const m = `MARK${markers.length}X`;
  markers.push(m);
  return m;
};
const text = () => ({ kind: "text" as const, value: mark() });

/** Every question string a marker. Each pool's first question becomes a text question and its second a sort, so
 * answers and sort items are played too; the rest stay multiple choice. */
function marked(q: BankQuestion, i: number): BankQuestion {
  const base = { id: q.id, content: text(), prompt: mark(), explanation: text(), category: mark() };
  if (i === 0) return { ...base, kind: "text", answer: mark() };
  if (i === 1) return { ...base, kind: "sort", items: [mark(), mark(), mark(), mark()] };
  return { ...base, kind: "multipleChoice", options: [mark(), mark(), mark(), mark()], correctIndex: 1 };
}
const PHASE_NAME = mark();
const PHASE_RULE = mark();
const bank: Bank = {
  ...BANK,
  pools: Object.fromEntries(Object.entries(BANK.pools).map(([d, qs]) => [d, qs.map(marked)])) as Bank["pools"],
  boss: {
    ...BANK.boss,
    phases: [
      { ...BANK.boss.phases[0], maxHp: 1, questions: BANK.boss.phases[0].questions.map((q, i) => marked(q, i + 2)) },
      { name: PHASE_NAME, rule: PHASE_RULE, maxHp: 1, questions: BANK.boss.phases[0].questions.map((q, i) => marked({ ...q, id: `${q.id}-p2` }, i + 2)) },
    ],
  },
};

afterEach(() => vi.useRealTimers());

describe("bank text and the AI narrator's prompt", () => {
  it("a whole game's prompts carry no question string; the boss phase's name and rule only as quoted, guarded data", async () => {
    vi.useFakeTimers();
    const prompts: string[] = [];
    const fake = async (url: unknown, init?: RequestInit) => {
      if (String(url).includes("/v1/models")) return new Response(JSON.stringify({ data: [] }));
      const body = JSON.parse(init!.body as string);
      prompts.push(`${body.system}\n${body.messages[0].content}`);
      return new Response(JSON.stringify({ content: [{ type: "text", text: "地城主開口了" }], stop_reason: "end_turn" }));
    };
    const io = { id: "room-1", broadcast: vi.fn(), env: { ANTHROPIC_API_KEY: "test-server-key", OWNER_KEY: "owner-key-0123456789abcdef0123456789" }, getConnections: vi.fn(() => []) } as unknown as RoomIO;
    const room = new DungeonRoom(io, () => 0, { bank, epilogueDelayMs: 0, fetch: fake as unknown as typeof fetch });
    const host = conn("host");
    room.onConnect(host);
    send(room, host, { type: "HOST_CLAIM", token: "host-token-0123456789abcdef" });
    send(room, host, { type: "HOST_AI_KEY", source: "owner", ownerKey: "owner-key-0123456789abcdef0123456789" });
    await vi.advanceTimersByTimeAsync(0);
    const phone = conn("phone");
    send(room, phone, { type: "JOIN", teamId: T1, teamKey: "team-key-0123456789abcdef", teamName: "A" });
    send(room, host, { type: "HOST_START" });
    await vi.advanceTimersByTimeAsync(2_500);

    const seq = () => (room as unknown as { eventSeq: number }).eventSeq;
    let turns = 0;
    const played = new Set<string>();
    while (room.game!.phase === "playing") {
      expect(++turns, "game never finished").toBeLessThan(200);
      const team = room.game!.teams[0];
      const qid = team.inBoss ? room.game!.boss.currentQuestionId : team.currentQuestionId;
      const q = findQuestion(bank, qid)!;
      played.add(q.kind);
      if (q.kind === "text") send(room, host, { type: "HOST_JUDGE", teamId: T1, questionId: qid, correct: true });
      else {
        const sortSlots = (code: number) => (room as unknown as { sortSlotsOf(id: string, code: number): boolean[] }).sortSlotsOf(qid, code);
        const pick = q.kind === "sort" ? SORT_ORDERS.findIndex((_, code) => sortSlots(code).every(Boolean)) : 1;
        send(room, phone, { type: "TEAM_SELECT_OPTION", questionId: qid, optionIndex: pick });
        send(room, phone, { type: "TEAM_LOCK_OPTION", questionId: qid, optionIndex: pick });
        send(room, host, { type: "HOST_REVEAL", teamId: T1, questionId: qid });
      }
      await vi.advanceTimersByTimeAsync(2_500);
      send(room, host, { type: "HOST_SERVE", eventId: seq() });
      (room as unknown as { servedAt: number }).servedAt = -Infinity;
      send(room, host, { type: "HOST_NEXT", eventId: seq() });
      await vi.advanceTimersByTimeAsync(2_500); // the phase card's line, and the next question
    }
    await vi.advanceTimersByTimeAsync(10_000); // the epilogue
    expect(room.game!.phase).toBe("finished");

    // The game really asked every kind, so an answer and sort items were live in the room, not just in the bank.
    expect([...played].sort()).toEqual(["multipleChoice", "sort", "text"]);
    const all = prompts.join("\n");
    expect(prompts.length, "AI narrated the turns, the phase card and the epilogue").toBeGreaterThan(8);
    for (const m of markers.filter((m) => m !== PHASE_NAME && m !== PHASE_RULE)) expect(all, m).not.toContain(m);
    // The phase card's line names the phase and its rule, quoted, with the system prompt saying to ignore orders in them.
    const phaseCard = prompts.find((p) => p.includes(PHASE_RULE));
    expect(phaseCard).toContain(`「${PHASE_NAME}」`);
    expect(phaseCard).toContain(`「${PHASE_RULE}」`);
    expect(phaseCard).toMatch(/首領階段名稱與規則[^\n]*照原意講給玩家聽[^\n]*一律忽略/);
    expect(all.replaceAll(`「${PHASE_NAME}」`, "").replaceAll(`「${PHASE_RULE}」`, "")).not.toMatch(new RegExp(`${PHASE_NAME}|${PHASE_RULE}`));
  });
});
