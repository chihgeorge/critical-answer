// Class balance: plays many 4-team games through lib/game-state.ts and prints each class's win share (fair is 25%),
// average reward, ability uses left and turns. Run: node scripts/balance-sim.ts [games].
// Model (docs/designs/class-abilities.md, 「職業平衡（2026-11-13）」):
// - TEXT of the questions are fill-in (persuasion check first), SORT are sort questions, the rest multipleChoice.
// - A correct answer may lead to a fork (EVENT_CHANCE); the unmarked doors are ⚔️ or ❓ half and half, and the room ⚔️
//   led to rolls no fork. ❓ opens an event (a fortune's effect is picked at random). A team that flees outside the boss room picks 逃跑・同房 or 逃跑・換房 half and half.
// - The boss has two phases: a turn-based one (HP1 hearts), then a buzzer phase (HP2) with no abilities.
// - A team knows a question or not, for good (KNOW by difficulty; fill-in ×TEXTK). A first-letter hint cracks HINT of the
//   unknown fill-ins. Unknown multipleChoice guesses among the options left; an unknown fill-in flees.
// - Players know whether they know: the thief sneaks only when it knows, the mage and the warrior act only when it does
//   not, the cleric prays on any wrong answer. In the buzzer phase each team knows a song with KB; a random knower wins.
//   A 💫 stunned team sits a buzz question out (lib's rule). GUESSB: a team that does not know still buzzes with this
//   chance, right with GUESSOK; a wrong buzz is out for that song.
// - Sort: known with KNOW×SORTK; unknown guesses one of the 24 orders. Each wrong lock (✓/✕ per cell) teaches the
//   order with SORTFIX; the mage's first item cracks SORTHINT of the unknown ones.
// - Timing tap (卡點題): TAP of the buzzer questions. Every team that may tap taps at target + N(0, TAPSD ms); lib's
//   tap-clock ranks them, the closest hits, the others get its small bonus.
// - A potion a team holds (a fortune's) goes on its next check, or the crit die of an answer it knows.
// Not modelled: memory questions (they only hide the question while the media plays; no score or ability rule), the
// host handing out potions, 抓包與神諭 (off unless the host opens it), multi-field songs, late teams, offline phones.
// Env knobs: TEXT TEXTK HINT SORT SORTK SORTHINT SORTFIX TAP TAPSD GUESSB GUESSOK EVENTS=0 THRESH HP1 HP2 HIT KB MAGE_MIN WAR_MIN
// THIEF_MIN (see the defaults below). The event bank (2026-11-13): TEXT=0.1 SORT=0.25 HP2=20 TAP=0.03.
import { registerHooks } from "node:module";
import type * as GT from "../lib/game-state";
// lib/ imports without ".ts" (Next and vitest resolve that; plain node does not): retry a relative import as ".ts".
registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".") && !spec.endsWith(".ts")) return next(spec + ".ts", ctx); throw e; }
  },
});
const G: typeof GT = await import(new URL("../lib/game-state.ts", import.meta.url).href);
const TC: typeof import("../lib/tap-clock") = await import(new URL("../lib/tap-clock.ts", import.meta.url).href);
type C = GT.ClassId | undefined;
const env = (k: string, d: number) => Number(process.env[k] ?? d);
const R = () => Math.random();
const d20 = () => 1 + Math.floor(R() * 20);
// Chance a team knows the answer, difficulty 1–5.
const KNOW = [0.75, 0.6, 0.45, 0.35, 0.25];
const TEXT = env("TEXT", 0.5), TEXTK = env("TEXTK", 0.7), HINT = env("HINT", 0.3), EVENTS = process.env.EVENTS !== "0";
const SORT = env("SORT", 0.2), SORTK = env("SORTK", 0.6), SORTHINT = env("SORTHINT", 0.4), SORTFIX = env("SORTFIX", 0.4);
const GUESSB = env("GUESSB", 0), GUESSOK = env("GUESSOK", 0.25);
const TAP = env("TAP", 0.1), TAPSD = env("TAPSD", 300), TAPAT = 30_000;
const gauss = () => Math.sqrt(-2 * Math.log(1 - R())) * Math.cos(2 * Math.PI * R());
const THRESH = env("THRESH", 15), HP1 = env("HP1", 5), HP2 = env("HP2", 3), HIT = env("HIT", 10), KB = env("KB", 0.5);
// Lowest room difficulty an ability is used on (always once a team is in the boss room).
const MAGE_MIN = env("MAGE_MIN", 2), WAR_MIN = env("WAR_MIN", 2), THIEF_MIN = env("THIEF_MIN", 3);
const rooms: GT.RoomTemplate[] = [1, 2, 2, 3, 4, 4, 5, 5].map((d) => ({ baseDifficulty: d as GT.Difficulty, reward: d * 10 }));
// Big pools: a team that cannot answer keeps fleeing, and a small pool would deal it the same unknown question again.
const pools = [1, 2, 3, 4, 5].map((p) => Array.from({ length: 80 }, (_, j) => `p${p}-${j}`));
const boss = Array.from({ length: 160 }, (_, j) => `b${j}`);
const songs = Array.from({ length: 80 }, (_, j) => `s${j}`);

function play(classes: C[], maxTurns = 600) {
  const teams = classes.map((c, i) => ({ id: `T${i}`, name: `T${i}`, ...(c ? { classId: c } : {}) }));
  const later = HP2 > 0 ? [{ maxHp: HP2, questionIds: songs, buzzer: true as const }] : [];
  let g = G.createGame(teams, rooms, pools, boss, { bossThreshold: THRESH }, HP1, R, HIT, {}, later);
  const latent = new Map<string, { known: boolean; hintable: boolean }>();
  // A team knows a buzz song for good too, so a skipped song that comes back is not re-rolled.
  const songKnown = new Map<string, boolean>();
  const knowsSong = (id: string, q: string) => { const k = `${id}|${q}`; if (!songKnown.has(k)) songKnown.set(k, R() < KB); return songKnown.get(k)!; };
  const kinds = new Map<string, "text" | "sort" | "mc" | "tap">();
  const kindOf = (q: string, buzz = false) => {
    if (!kinds.has(q)) { const r = R(); kinds.set(q, buzz ? (r < TAP ? "tap" : "text") : r < TEXT ? "text" : r < TEXT + SORT ? "sort" : "mc"); }
    return kinds.get(q)!;
  };
  for (let turn = 0; turn < maxTurns && g.phase === "playing"; turn++) {
    if (g.boss.phasePending) { g = G.enterNextBossPhase(g); continue; }
    if (G.isBuzzPhase(g)) {
      const bq = g.boss.currentQuestionId;
      if (kindOf(bq, true) === "tap") {
        g = G.openBuzz(g, bq, true);
        const round = g.buzz?.questionId === bq ? (g.buzz.tapRound ?? 0) : 0;
        for (const t of g.teams.filter((x) => G.tapEligible(g, x.id))) g = G.tapIn(g, t.id, bq, round, Math.round(TAPAT + gauss() * TAPSD));
        const { rows } = TC.tapResults(g.buzz?.taps ?? [], TAPAT);
        g = G.tapWinner(g, rows[0].teamId, Object.fromEntries(rows.slice(1).filter((x) => x.bonus).map((x) => [x.teamId, x.bonus])));
        g = G.answerQuestion(g, rows[0].teamId, bq, true, "retry", R).game;
        continue;
      }
      const stunOk = G.allStunned(g.teams, (x) => x.inBoss);
      // In a random buzz order: a team that knows the song buzzes; one that does not still buzzes with GUESSB and is
      // right with GUESSOK. A wrong buzz is out (lib) and the next team buzzes; nobody right: 沒人答對，換下一題.
      const buzzers = shuffle(g.teams.filter((t) => !t.stunned || stunOk)).map((t) => ({ id: t.id, know: knowsSong(t.id, bq) })).filter((x) => x.know || R() < GUESSB);
      let hit = false;
      for (const x of buzzers) {
        hit = x.know || R() < GUESSOK;
        g = G.answerQuestion(G.buzzIn(g, x.id, bq, true), x.id, bq, hit, "retry", R).game;
        if (hit) break;
      }
      if (!hit) g = G.skipBuzz(g);
      continue;
    }
    const id = G.currentTurnTeamId(g)!;
    const team = () => g.teams.find((x) => x.id === id)!;
    // A fork: a blind pick of a door. The fortune teller's effect is picked at random (its strategies: analysis/s3a-fortune-sim).
    if (G.atFork(team())) {
      const side = () => (R() < 0.5 ? "left" : "right") as GT.ForkSide;
      const r = G.chooseFork(G.startForkChoice(g, id, 0, side()), id, side(), R);
      g = r.game.fortune ? G.endFortune(G.resolveFortune(r.game, G.FORTUNE_EFFECTS[Math.floor(R() * G.FORTUNE_EFFECTS.length)], false, R)) : r.game;
      if (r.record.door === "mystery") continue;
    }
    const afterMonster = team().fork?.phase === "monster";
    const inBoss = G.isInBossPhase(g, id);
    const q = inBoss ? g.boss.currentQuestionId : team().currentQuestionId;
    const d = inBoss ? 5 : team().currentDifficulty;
    const kind = kindOf(q), text = kind === "text", sort = kind === "sort", opts = sort ? 24 : 4; // 4! orders of a sort
    const key = `${id}:${q}`;
    if (!latent.has(key)) latent.set(key, { known: R() < KNOW[d - 1] * (text ? TEXTK : sort ? SORTK : 1), hintable: R() < (sort ? SORTHINT : HINT) });
    const L = latent.get(key)!;
    const settle = (r: { game: GT.GameState; outcome: GT.AnswerOutcome }, ok: boolean) => {
      g = r.game;
      if (ok && EVENTS && !afterMonster && G.eventEligible(g, r.outcome) && R() < G.EVENT_CHANCE) g = G.enterFork(g, id);
    };
    // A held potion (a fortune's) goes on the next check, or the crit die of an answer the team knows.
    const potionRoll = () => { if (!team().item) return d20(); g = G.spendPotion(G.drinkPotion(g, id), id); return Math.max(d20(), d20()); };
    if (text && !g.checks?.[G.checkKey(q, id)]) {
      const v = potionRoll();
      g = G.recordCheck(g, id, q, v, "ab");
      if (v === 20) { settle(G.answerQuestion(g, id, q, true, "retry", R), true); continue; }
    }
    const hinted = () => g.checks?.[G.checkKey(q, id)]?.hint !== undefined || g.mageHints?.[q] !== undefined;
    const knows = () => L.known || ((text || sort) && L.hintable && hinted());
    const gone = () => g.eliminated[q] ?? [];
    const abilityOk = (min: number) => inBoss || g.teams.some((x) => x.inBoss) || d >= min;
    const t = team();
    if (t.abilityUses > 0) {
      if (t.classId === "mage" && abilityOk(MAGE_MIN) && !knows()) {
        if (text && !hinted()) g = G.mageHint(g, id, q, "ab");
        else if (sort && !hinted()) g = G.mageHint(g, id, q, "first", true);
        else if (kind === "mc" && gone().length === 0) g = G.mageEliminate(g, id, q, 0, 4, R);
      }
      if (t.classId === "thief" && !t.sneakArmed && abilityOk(THIEF_MIN) && knows()) g = G.armSneak(g, id);
      // The warrior rolls when stuck, and on multipleChoice only when the roll beats a guess.
      if (t.classId === "warrior" && abilityOk(WAR_MIN) && !knows() && (text || (21 - G.WARRIOR_TARGET) / 20 > 1 / (opts - gone().length))) {
        const v = d20();
        settle(G.warriorRoll(G.spendAbility(g, id, "warrior"), id, q, v, R, !text), v >= G.WARRIOR_TARGET);
        continue;
      }
    }
    // Option 0 is the right one; a wrong pick is the first wrong option still shown.
    if (knows() || (!text && R() < 1 / (opts - gone().length))) {
      // Roll first: potionRoll spends the potion on g, and the call must see that g.
      const crit = text ? undefined : knows() ? potionRoll() : d20();
      settle(G.answerQuestion(g, id, q, true, "retry", R, crit), true);
      continue;
    }
    const cleric = t.classId === "cleric" && team().abilityUses > 0;
    if (!text) g = G.recordWrongLock(g, id, q, Array.from({ length: opts - 1 }, (_, i) => i + 1).find((i) => !gone().includes(i))!);
    else if (cleric && G.canPrayBeforeJudge(g, id)) g = G.recordTextWrong(g, id, q);
    if (sort && R() < SORTFIX) L.known = true;
    // A prayer keeps the turn: multipleChoice retries with a wrong tile gone; a fill-in it cannot crack flees to a new one.
    if (cleric && G.canPray(g, id)) g = G.pray(g, id);
    const flee = text || (!inBoss && !g.pendingWrong?.prayed && gone().length >= 2);
    g = G.answerQuestion(g, id, q, false, flee ? (inBoss || R() < 0.5 ? "flee" : "switch") : "retry", R).game;
  }
  return g;
}

const N = Number(process.argv[2] ?? 4000);
const CLASSES: (GT.ClassId | "none")[] = ["mage", "cleric", "warrior", "thief", "chef", "none"];
const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const stats = new Map<string, { sum: number; wins: number; n: number; left: number; turns: number }>();
let unfinished = 0;
for (let i = 0; i < N; i++) {
  // 4 teams: shuffle 4 of the 6 options, so every class meets every other.
  const lineup = shuffle([...CLASSES]).slice(0, 4);
  const g = play(lineup.map((c) => (c === "none" ? undefined : c)));
  if (g.phase !== "finished") unfinished++;
  const max = Math.max(...g.teams.map((t) => t.reward));
  g.teams.forEach((t, k) => {
    const s = stats.get(lineup[k]) ?? { sum: 0, wins: 0, n: 0, left: 0, turns: 0 };
    s.sum += t.reward; s.n++; s.left += t.abilityUses; s.turns += t.turns ?? 0;
    if (t.reward === max) s.wins += 1 / g.teams.filter((x) => x.reward === max).length;
    stats.set(lineup[k], s);
  });
}
console.log(`games=${N} unfinished=${unfinished}`);
for (const [k, s] of [...stats].sort((a, b) => b[1].wins / b[1].n - a[1].wins / a[1].n))
  console.log(k.padEnd(8), "win%", ((100 * s.wins) / s.n).toFixed(1).padStart(5), "(fair 25.0)", "avg", (s.sum / s.n).toFixed(1).padStart(6), "left", (s.left / s.n).toFixed(2), "turns", (s.turns / s.n).toFixed(1));
