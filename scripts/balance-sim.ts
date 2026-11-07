// Class balance: plays many 4-team games through lib/game-state.ts and prints each class's average reward and win
// share (fair is 25%). Run: node scripts/balance-sim.ts [games]. Each answer is right when the team knows it (KNOW, per
// difficulty) or guesses among the options left; every question is multipleChoice, like data/question-bank.json.
// Ability use is a fixed policy (below), so the numbers compare classes, not players.
import { registerHooks } from "node:module";
import type * as GT from "../lib/game-state";
// lib/ imports without ".ts" (Next and vitest resolve that; plain node does not): retry a relative import as ".ts".
registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".") && !spec.endsWith(".ts")) return next(spec + ".ts", ctx); throw e; }
  },
});
const G: typeof GT = await import(new URL("../lib/game-state.ts", import.meta.url).href);
type C = GT.ClassId | undefined;
const R = () => Math.random();
const d20 = () => 1 + Math.floor(R() * 20);
// Chance a team knows the answer, difficulty 1–5.
const KNOW = [0.75, 0.6, 0.45, 0.35, 0.25];
const rooms: GT.RoomTemplate[] = [1, 2, 2, 3, 4, 4, 5, 5].map((d) => ({ baseDifficulty: d as GT.Difficulty, reward: d * 10 }));
const pools = [12, 16, 12, 12, 12].map((n, i) => Array.from({ length: n }, (_, j) => `p${i}-${j}`));
const boss = Array.from({ length: 20 }, (_, j) => `b${j}`);
function play(classes: C[], maxTurns = 400) {
  const teams = classes.map((c, i) => ({ id: `T${i}`, name: `T${i}`, ...(c ? { classId: c } : {}) }));
  let g = G.createGame(teams, rooms, pools, boss, { bossThreshold: 15 }, 5, R, 10);
  const gone: Record<string, number> = {}; // wrong/removed options per team+question
  for (let turn = 0; turn < maxTurns && g.phase === "playing"; turn++) {
    const id = G.currentTurnTeamId(g)!; const t = g.teams.find((x) => x.id === id)!;
    const inBoss = G.isInBossPhase(g, id); const q = inBoss ? g.boss.currentQuestionId : t.currentQuestionId;
    const d = inBoss ? 5 : t.currentDifficulty; const key = id + q;
    const pOf = () => { const k = KNOW[d - 1]; return k + (1 - k) / (4 - (gone[key] ?? 0)); };
    // Policy: abilities go on difficulty 4+ and the boss; the warrior rolls only when the odds beat answering.
    const hard = d >= 4 || inBoss;
    try {
      if (t.classId === "thief" && t.abilityUses > 0 && hard && !t.sneakArmed) g = G.armSneak(g, id);
      if (t.classId === "mage" && t.abilityUses > 0 && hard && (gone[key] ?? 0) === 0) { g = G.mageEliminate(g, id, q, 0, 4, R); gone[key] = 2; }
      if (t.classId === "warrior" && t.abilityUses > 0 && hard && pOf() < 0.45) {
        g = G.spendAbility(g, id, "warrior"); const v = d20();
        g = G.warriorRoll(g, id, q, v, R, true).game; continue;
      }
    } catch { /* ability refused: answer normally */ }
    if (R() < pOf()) { g = G.answerQuestion(g, id, q, true, "retry", R, d20()).game; continue; }
    // wrong
    gone[key] = Math.min(2, (gone[key] ?? 0) + 1);
    if (t.classId === "cleric" && t.abilityUses > 0) {
      try {
        g = G.recordWrongLock(g, id, q, 0); g = G.pray(g, id);
        g = G.answerQuestion(g, id, q, false, "retry", R).game;
        const q2 = G.isInBossPhase(g, id) ? g.boss.currentQuestionId : g.teams.find((x) => x.id === id)!.currentQuestionId;
        if (G.currentTurnTeamId(g) === id && g.phase === "playing") {
          const ok = R() < (q2 === q ? pOf() : KNOW[d - 1] + (1 - KNOW[d - 1]) / 4);
          g = G.answerQuestion(g, id, q2, ok, "retry", R, ok ? d20() : undefined).game;
        }
        continue;
      } catch { /* fall through */ }
    }
    if (g.pendingWrong) g = G.answerQuestion(g, id, q, false, "retry", R).game;
    else g = G.answerQuestion(g, id, q, false, inBoss || (gone[key] ?? 0) < 2 ? "retry" : "flee", R).game;
  }
  return g;
}
const N = Number(process.argv[2] ?? 4000);
const CLASSES: (GT.ClassId | "none")[] = ["mage", "cleric", "warrior", "thief", "chef", "none"];
const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const stats = new Map<string, { sum: number; wins: number; n: number }>();
let unfinished = 0;
for (let i = 0; i < N; i++) {
  // 4 teams: shuffle 4 of the 6 options, so every class meets every other.
  const lineup = shuffle([...CLASSES]).slice(0, 4);
  const g = play(lineup.map((c) => (c === "none" ? undefined : c)));
  if (g.phase !== "finished") unfinished++;
  const max = Math.max(...g.teams.map((t) => t.reward));
  g.teams.forEach((t, k) => {
    const name = lineup[k]; const s = stats.get(name) ?? { sum: 0, wins: 0, n: 0 };
    s.sum += t.reward; s.n++; if (t.reward === max) s.wins += 1 / g.teams.filter((x) => x.reward === max).length;
    stats.set(name, s);
  });
}
console.log(`games=${N} unfinished=${unfinished}`);
for (const [k, s] of [...stats].sort((a, b) => b[1].wins / b[1].n - a[1].wins / a[1].n))
  console.log(k.padEnd(8), "avg", (s.sum / s.n).toFixed(1).padStart(6), "win%", ((100 * s.wins) / s.n).toFixed(1).padStart(5), "(fair 25.0)");
