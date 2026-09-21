// The question bank: one monster per room, several questions per room, one boss.
// Source of truth is data/question-bank.json. Only party/ (the server) imports
// this file; the browser only ever gets PublicQuestion, which has no answer.

import bankJson from "../data/question-bank.json";
import type { Difficulty, RoomTemplate } from "./game-state";
import type { PublicQuestion } from "./protocol";
import type { SpriteKind } from "./sprite-kind";

export interface BankQuestion {
  id: string;
  text: string;
  answer: string;
}
export interface BankMonster {
  name: string;
  sprite: SpriteKind;
  /** CSS hue-rotate degrees, so one sprite can play several monsters. */
  hue: number;
}
export interface Bank {
  rooms: { monster: BankMonster; baseDifficulty: Difficulty; questions: BankQuestion[] }[];
  boss: { monster: BankMonster; maxHp: number; questions: BankQuestion[] };
}

const SPRITES: SpriteKind[] = ["slime", "ghost", "dragon"];
const fail = (why: string): never => {
  throw new Error(`Invalid question bank: ${why}`);
};

function parseMonster(raw: unknown, where: string): BankMonster {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m.name !== "string" || !m.name.trim()) fail(`${where} monster has no name`);
  if (!SPRITES.includes(m!.sprite as SpriteKind)) fail(`${where} monster has unknown sprite ${String(m!.sprite)}`);
  return { name: m!.name as string, sprite: m!.sprite as SpriteKind, hue: typeof m!.hue === "number" ? m!.hue : 0 };
}

function parseQuestions(raw: unknown, where: string, seen: Set<string>): BankQuestion[] {
  if (!Array.isArray(raw) || raw.length === 0) fail(`${where} has no questions`);
  return (raw as Record<string, unknown>[]).map((r) => {
    const { id, text, answer } = r;
    if (typeof id !== "string" || !id) fail(`${where} has a question without an id`);
    if (seen.has(id as string)) fail(`duplicate question id ${String(id)}`);
    seen.add(id as string);
    if (typeof text !== "string" || !text.trim()) fail(`question ${String(id)} has empty text`);
    if (typeof answer !== "string" || !answer.trim()) fail(`question ${String(id)} has an empty answer`);
    return { id: id as string, text: text as string, answer: answer as string };
  });
}

/** Validate untrusted JSON into a Bank. Throws (loudly, at startup) on the first problem. */
export function parseBank(raw: unknown): Bank {
  const b = raw as Record<string, unknown> | null;
  if (!b || typeof b !== "object") fail("not an object");
  if (!Array.isArray(b!.rooms) || b!.rooms.length === 0) fail("no rooms");
  const seen = new Set<string>();
  const rooms = (b!.rooms as Record<string, unknown>[]).map((r, i) => {
    const d = r.baseDifficulty;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > 5) fail(`room ${i} has difficulty ${String(d)}`);
    return {
      monster: parseMonster(r.monster, `room ${i}`),
      baseDifficulty: d as Difficulty,
      questions: parseQuestions(r.questions, `room ${i}`, seen),
    };
  });
  const boss = b!.boss as Record<string, unknown> | null;
  if (!boss) fail("no boss");
  if (typeof boss!.maxHp !== "number" || boss!.maxHp < 1) fail("boss has no hp");
  return {
    rooms,
    boss: {
      monster: parseMonster(boss!.monster, "boss"),
      maxHp: boss!.maxHp as number,
      questions: parseQuestions(boss!.questions, "boss", seen),
    },
  };
}

export const BANK: Bank = parseBank(bankJson);

export function roomTemplates(bank: Bank): RoomTemplate[] {
  return bank.rooms.map((r) => ({ baseDifficulty: r.baseDifficulty, questionIds: r.questions.map((q) => q.id) }));
}

export function bossQuestionIds(bank: Bank): string[] {
  return bank.boss.questions.map((q) => q.id);
}

export function findQuestion(bank: Bank, id: string) {
  for (const [roomIndex, r] of bank.rooms.entries()) {
    const q = r.questions.find((x) => x.id === id);
    if (q) return { ...q, roomIndex, boss: false as const, monster: r.monster, baseDifficulty: r.baseDifficulty };
  }
  const q = bank.boss.questions.find((x) => x.id === id);
  return q ? { ...q, roomIndex: -1, boss: true as const, monster: bank.boss.monster, baseDifficulty: 5 as Difficulty } : undefined;
}

/** The part of a question every screen may see. `difficulty` is the team's current one (flee lowers it). */
export function publicQuestion(bank: Bank, id: string, difficulty: number): PublicQuestion | null {
  const q = findQuestion(bank, id);
  if (!q) return null;
  return {
    id: q.id,
    text: q.text,
    difficulty: q.boss ? 5 : difficulty,
    boss: q.boss,
    monster: { name: q.monster.name, sprite: q.monster.sprite, hue: q.monster.hue },
  };
}
