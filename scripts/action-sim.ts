// Issue #301 design sim (design branch only): the same 4-team games as scripts/balance-sim.ts, plus a turn action choice.
// Run: DESIGN=base|A|B|C taskpolicy -b node --no-warnings scripts/action-sim.ts [games].
// The actions are not in lib yet, so this script plays them on the state lib returns:
// - A 出擊姿態: before a fresh question 🔥 強攻 (difficulty +1, ×STRIKE reward, a miss costs STRIKE_COST); any turn outside
//   the boss room 🏕️ 紮營 (CAMPS a game, not twice in a row: no question, +1 ability use, or a potion with no class/full uses).
// - B 主動探索: no random forks. Any turn outside the boss room and the last room ❓ 探索 (KEYS a game): the ❓ door now.
// - C 丟題: after the question shows 🎯 丟給別隊 (THROWS a game): a waiting team answers it once, no ability. Right: it
//   gets THROW_GAIN of the room reward, the thrower does 逃跑・同房. Wrong: the thrower beats the monster at THROW_PAY.
// Team skill: each team's KNOW × (1 + s), s uniform in ±SKILL, so a spread has something to show.
// Prints: win share by class, score spread (sd and top−bottom gap per game), game length (rounds, team turns), pick rates.
import { registerHooks } from "node:module";
import type * as GT from "../lib/game-state";
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
const DESIGN = process.env.DESIGN ?? "base", MIX = process.env.MIX === "1";
const KNOW = [0.75, 0.6, 0.45, 0.35, 0.25];
// Event-bank defaults (balance-sim's 2026-11-13 line).
const TEXT = env("TEXT", 0.1), TEXTK = env("TEXTK", 0.7), HINT = env("HINT", 0.3), EVENTS = process.env.EVENTS !== "0" && DESIGN !== "B";
const SORT = env("SORT", 0.25), SORTK = env("SORTK", 0.6), SORTHINT = env("SORTHINT", 0.4), SORTFIX = env("SORTFIX", 0.4);
const TAP = env("TAP", 0.03), TAPSD = env("TAPSD", 300), TAPAT = 30_000;
const gauss = () => Math.sqrt(-2 * Math.log(1 - R())) * Math.cos(2 * Math.PI * R());
const THRESH = env("THRESH", 15), HP1 = env("HP1", 5), HP2 = env("HP2", 20), HIT = env("HIT", 10), KB = env("KB", 0.5);
const MAGE_MIN = 2, WAR_MIN = 2, THIEF_MIN = 2, WEAK = 0.1, SKILL = env("SKILL", 0.2);
const STRIKE = env("STRIKE", 1.5), STRIKE_COST = env("STRIKE_COST", 5), CAMPS = env("CAMPS", 2);
const KEYS = env("KEYS", 2), THROWS = env("THROWS", 2), THROW_GAIN = env("THROW_GAIN", 0.5), THROW_PAY = env("THROW_PAY", 0.5), THROW_PROG = env("THROW_PROG", 1);
const rooms: GT.RoomTemplate[] = [1, 2, 2, 3, 4, 4, 5, 5].map((d) => ({ baseDifficulty: d as GT.Difficulty, reward: d * 10 }));
const pools = [1, 2, 3, 4, 5].map((p) => Array.from({ length: 80 }, (_, j) => `p${p}-${j}`));
const boss = Array.from({ length: 160 }, (_, j) => `b${j}`);
const songs = Array.from({ length: 80 }, (_, j) => `s${j}`);
const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const patch = (g: GT.GameState, id: string, p: (t: GT.Team) => Partial<GT.Team>): GT.GameState => ({ ...g, teams: g.teams.map((t) => (t.id === id ? { ...t, ...p(t) } : t)) });
const addReward = (g: GT.GameState, id: string, n: number) => patch(g, id, (t) => ({ reward: Math.max(0, t.reward + Math.round(n)) }));

const picks: Record<string, number> = {};
const pick = (k: string) => { picks[k] = (picks[k] ?? 0) + 1; };

function play(classes: C[], maxTurns = 800) {
  const teams = classes.map((c, i) => ({ id: `T${i}`, name: `T${i}`, ...(c ? { classId: c } : {}) }));
  const skill = Object.fromEntries(teams.map((t) => [t.id, 1 + (2 * R() - 1) * SKILL]));
  const later = HP2 > 0 ? [{ maxHp: HP2, questionIds: songs, buzzer: true as const }] : [];
  let g = G.createGame(teams, rooms, pools, boss, { bossThreshold: THRESH }, HP1, R, HIT, {}, later);
  const latent = new Map<string, { known: boolean; hintable: boolean; weak: boolean }>();
  const songKnown = new Map<string, boolean>();
  const knowsSong = (id: string, q: string) => { const k = `${id}|${q}`; if (!songKnown.has(k)) songKnown.set(k, R() < Math.min(0.95, KB * skill[id])); return songKnown.get(k)!; };
  const kinds = new Map<string, "text" | "sort" | "mc" | "tap">();
  const kindOf = (q: string, buzz = false) => {
    if (!kinds.has(q)) { const r = R(); kinds.set(q, buzz ? (r < TAP ? "tap" : "text") : r < TEXT ? "text" : r < TEXT + SORT ? "sort" : "mc"); }
    return kinds.get(q)!;
  };
  const latentOf = (tid: string, q: string, d: number, kind: string) => {
    const key = `${tid}:${q}`;
    if (!latent.has(key)) latent.set(key, { known: R() < Math.min(0.95, KNOW[d - 1] * skill[tid]) * (kind === "text" ? TEXTK : kind === "sort" ? SORTK : 1), hintable: R() < (kind === "sort" ? SORTHINT : HINT), weak: R() < WEAK });
    return latent.get(key)!;
  };
  // Per-team action state.
  const camps: Record<string, number> = {}, keys: Record<string, number> = {}, throws: Record<string, number> = {};
  const lastCamp: Record<string, boolean> = {}, strikeQ: Record<string, string | undefined> = {}, stuck: Record<string, number> = {};
  let acts = 0;
  // MIX=1: only T0 and T1 may take the new actions, so their win share against T2 and T3 shows any edge (fair 50%).
  const may = (tid: string) => !MIX || tid === "T0" || tid === "T1";
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
      const buzzers = shuffle(g.teams.filter((t) => !t.stunned || stunOk)).filter((t) => knowsSong(t.id, bq));
      if (buzzers.length) g = G.answerQuestion(G.buzzIn(g, buzzers[0].id, bq, true), buzzers[0].id, bq, true, "retry", R).game;
      else g = G.skipBuzz(g);
      continue;
    }
    const id = G.currentTurnTeamId(g)!;
    const team = () => g.teams.find((x) => x.id === id)!;
    acts++;
    if (G.atFork(team())) {
      const side = () => (R() < 0.5 ? "left" : "right") as GT.ForkSide;
      const r = G.chooseFork(G.startForkChoice(g, id, 0, side()), id, side(), R);
      g = r.game.fortune ? G.endFortune(G.resolveFortune(r.game, G.FORTUNE_EFFECTS[Math.floor(R() * G.FORTUNE_EFFECTS.length)], false, R)) : r.game;
      if (r.record.door === "mystery") continue;
    }
    const afterMonster = team().fork?.phase === "monster";
    const inBoss = G.isInBossPhase(g, id);
    const anyBoss = g.teams.some((x) => x.inBoss);
    const q = inBoss ? g.boss.currentQuestionId : team().currentQuestionId;
    let d = inBoss ? 5 : team().currentDifficulty;
    const fresh = !latent.has(`${id}:${q}`);
    const roomR = rooms[team().roomIndex].reward;

    // ---- Pre-question actions (A, B) ----
    if (DESIGN === "A" && !inBoss && may(id)) {
      pick("A.offer");
      const t = team();
      const active = t.classId && t.classId !== "chef";
      const canCamp = (camps[id] ?? 0) < CAMPS && !lastCamp[id] && !anyBoss;
      // Camp: an active class out of uses with rooms still ahead, or a classless team without a potion early on.
      const wantCamp = canCamp && ((active && t.abilityUses === 0 && t.roomIndex < 6) || (!active && !t.item && t.roomIndex <= 2 && R() < 0.3));
      if (wantCamp) {
        pick("A.camp"); camps[id] = (camps[id] ?? 0) + 1; lastCamp[id] = true;
        g = active && t.abilityUses < G.ABILITY_USES ? patch(g, id, (x) => ({ abilityUses: x.abilityUses + 1 })) : t.item ? g : G.giveItem(g, id);
        g = G.advanceTurn(g);
        continue;
      }
      lastCamp[id] = false;
      if (fresh && d < 5) {
        // A blind call: expected reward of each stance with this team's skill, the strike also brings +1 progress;
        // a team behind the leader by 30+ gambles.
        const p0 = Math.min(0.95, KNOW[d - 1] * skill[id]), p1 = Math.min(0.95, KNOW[d] * skill[id]);
        const ev0 = p0 * roomR, ev1 = p1 * roomR * STRIKE - (1 - p1) * STRIKE_COST + p1 * 3;
        const behind = Math.max(...g.teams.map((x) => x.reward)) - t.reward >= 30;
        if (ev1 > ev0 || (behind && t.roomIndex >= 3)) {
          pick("A.strike"); strikeQ[id] = q; d = d + 1;
          g = patch(g, id, () => ({ currentDifficulty: d as GT.Difficulty }));
        } else pick("A.normal");
      } else pick("A.normal");
    }
    if (DESIGN === "B" && may(id) && !inBoss && !anyBoss && team().roomIndex < rooms.length - 1) {
      pick("B.offer");
      // Explore when stuck in a room two turns or more, or (blind) in a hard room with a coin flip.
      const want = (keys[id] ?? 0) < KEYS && ((stuck[id] ?? 0) >= 2 || (d >= 4 && fresh && R() < 0.3));
      if (want) {
        pick("B.explore"); keys[id] = (keys[id] ?? 0) + 1; stuck[id] = 0;
        g = G.startForkChoice(G.enterFork(g, id), id, 0, "left");
        const r = G.chooseFork(g, id, "right", R);
        g = r.game.fortune ? G.endFortune(G.resolveFortune(r.game, G.FORTUNE_EFFECTS[Math.floor(R() * G.FORTUNE_EFFECTS.length)], false, R)) : r.game;
        continue;
      }
      pick("B.fight");
    }

    const kind = kindOf(q), text = kind === "text", sort = kind === "sort", opts = sort ? 24 : 4;
    const L = latentOf(id, q, d, kind);
    const roomBefore = team().roomIndex;
    const settle = (r: { game: GT.GameState; outcome: GT.AnswerOutcome }, ok: boolean) => {
      const before = team().reward;
      g = r.game;
      if (strikeQ[id] === q) {
        if (ok) g = addReward(g, id, (team().reward - before) * (STRIKE - 1));
        else g = addReward(g, id, -STRIKE_COST);
        if (ok || r.outcome.type !== "incorrect-retry") strikeQ[id] = undefined;
      }
      if (ok && EVENTS && !afterMonster && G.eventEligible(g, r.outcome) && R() < G.EVENT_CHANCE) g = G.enterFork(g, id);
      stuck[id] = team().roomIndex === roomBefore && !team().inBoss ? (stuck[id] ?? 0) + 1 : 0;
    };
    const potionRoll = () => { if (!team().item) return d20(); g = G.spendPotion(G.drinkPotion(g, id), id); return Math.max(d20(), d20()); };
    const answerDie = () => (team().classId === "chef" || team().sneakArmed ? d20() : undefined);
    const rightText = () => settle(G.answerQuestion(g, id, q, true, "retry", R, undefined, undefined, undefined, false, answerDie()), true);
    if (text && !g.checks?.[G.checkKey(q, id)]) {
      const v = potionRoll();
      g = G.recordCheck(g, id, q, v, "ab");
      if (v === 20) { rightText(); continue; }
    }
    const hinted = () => g.checks?.[G.checkKey(q, id)]?.hint !== undefined || g.mageHints?.[q] !== undefined;
    const hintKind = () => g.mageHintKinds?.[q];
    const knows = () => L.known || hintKind() === "whole" || ((text || sort) && hinted() && (hintKind() === "count" ? L.weak : L.hintable));
    const gone = () => g.eliminated[q] ?? [];

    // ---- C: after the question shows, throw it at a waiting team ----
    if (DESIGN === "C" && may(id) && !inBoss && !anyBoss) {
      pick("C.offer");
      const targets = g.teams.filter((x) => x.id !== id && !x.inBoss && x.online);
      if (!knows() && (throws[id] ?? 0) < THROWS && targets.length && d >= 2) {
        pick("C.throw"); throws[id] = (throws[id] ?? 0) + 1;
        // Throw at the team least likely to know it (players read the room by score; lowest reward is a fair proxy).
        const tgt = [...targets].sort((a, b) => a.reward - b.reward)[0];
        const tl = latentOf(tgt.id, q, d, kind);
        const tRight = tl.known || (!text && R() < 1 / opts);
        if (tRight) {
          pick("C.throwBack");
          g = addReward(g, tgt.id, roomR * THROW_GAIN);
          settle(G.answerQuestion(g, id, q, false, "flee", R), false);
        } else {
          const before = team().reward;
          const r = G.answerQuestion(g, id, q, true, "retry", R, 10);
          settle(r, true);
          g = addReward(g, id, -(team().reward - before) * (1 - THROW_PAY));
          // THROW_PROG=0: the beaten monster gives no progress points (the room still advances).
          if (!THROW_PROG && !team().inBoss) g = patch(g, id, (x) => ({ score: Math.max(0, x.score - d) }));
        }
        continue;
      }
      pick("C.answer");
    }

    const abilityOk = (min: number) => inBoss || anyBoss || d >= min;
    const t = team();
    if (t.abilityUses > 0) {
      if (t.classId === "mage" && abilityOk(MAGE_MIN) && !knows() && !g.mageCasts?.[G.checkKey(q, id)]) {
        const target: GT.MageTarget | null = text && !hinted() ? { kind: "text", answer: "ab" } : sort && !hinted() ? { kind: "sort", items: ["first", "b", "c", "d"] } : kind === "mc" && gone().length === 0 ? { kind: "multipleChoice", correctIndex: 0, optionCount: 4 } : null;
        if (target) { g = G.spendAbility(g, id, "mage"); g = G.mageCast(g, id, q, target, potionRoll(), R); }
      }
      if (t.classId === "thief" && !t.sneakArmed && abilityOk(THIEF_MIN) && knows()) g = G.armSneak(g, id);
      if (t.classId === "warrior" && abilityOk(WAR_MIN) && !knows() && (text || (21 - G.WARRIOR_TARGET) / 20 > 1 / (opts - gone().length))) {
        const v = d20();
        settle(G.warriorRoll(G.spendAbility(g, id, "warrior"), id, q, v, R, !text), v >= G.WARRIOR_TARGET);
        continue;
      }
    }
    if (knows() || (!text && R() < 1 / (opts - gone().length))) {
      if (text) { rightText(); continue; }
      const crit = knows() ? potionRoll() : d20();
      settle(G.answerQuestion(g, id, q, true, "retry", R, crit), true);
      continue;
    }
    const cleric = t.classId === "cleric" && team().abilityUses > 0;
    if (!text) g = G.recordWrongLock(g, id, q, Array.from({ length: opts - 1 }, (_, i) => i + 1).find((i) => !gone().includes(i))!);
    else if (cleric && G.canPrayBeforeJudge(g, id)) g = G.recordTextWrong(g, id, q);
    if (sort && R() < SORTFIX) L.known = true;
    if (cleric && G.canPray(g, id)) g = G.prayerRoll(G.pray(g, id), id, potionRoll());
    const flee = text || (!inBoss && !g.pendingWrong?.prayed && gone().length >= 2);
    settle(G.answerQuestion(g, id, q, false, flee ? (inBoss || R() < 0.5 ? "flee" : "switch") : "retry", R), false);
  }
  return { g, acts };
}

const N = Number(process.argv[2] ?? 4000);
const CLASSES: (GT.ClassId | "none")[] = ["mage", "cleric", "warrior", "thief", "chef", "none"];
const stats = new Map<string, { sum: number; wins: number; n: number }>();
let mixWins = 0, unfinished = 0, sdSum = 0, gapSum = 0, roundSum = 0, actSum = 0, winSum = 0;
for (let i = 0; i < N; i++) {
  const lineup = shuffle([...CLASSES]).slice(0, 4);
  const { g, acts } = play(lineup.map((c) => (c === "none" ? undefined : c)));
  if (g.phase !== "finished") unfinished++;
  const rs = g.teams.map((t) => t.reward), mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  sdSum += Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
  gapSum += Math.max(...rs) - Math.min(...rs);
  winSum += Math.max(...rs);
  roundSum += g.round ?? 0; actSum += acts;
  const max = Math.max(...rs);
  mixWins += g.teams.filter((t, k) => k < 2 && t.reward === max).length / g.teams.filter((t) => t.reward === max).length;
  g.teams.forEach((t, k) => {
    const s = stats.get(lineup[k]) ?? { sum: 0, wins: 0, n: 0 };
    s.sum += t.reward; s.n++;
    if (t.reward === max) s.wins += 1 / g.teams.filter((x) => x.reward === max).length;
    stats.set(lineup[k], s);
  });
}
const f = (x: number) => x.toFixed(1);
console.log(`DESIGN=${DESIGN} games=${N} unfinished=${unfinished} | spread sd ${f(sdSum / N)} gap ${f(gapSum / N)} winner ${f(winSum / N)} | rounds ${f(roundSum / N)} turns ${f(actSum / N)}`);
if (MIX) console.log(`MIX: action-users win ${f((100 * mixWins) / N)}% (fair 50)`);
console.log("win%", [...stats].sort((a, b) => b[1].wins / b[1].n - a[1].wins / a[1].n).map(([k, s]) => `${k} ${f((100 * s.wins) / s.n)}`).join("  "));
const offers = Object.keys(picks).filter((k) => k.endsWith(".offer"));
for (const o of offers) {
  const p = o.split(".")[0];
  console.log(`picks per offer (${p}):`, Object.entries(picks).filter(([k]) => k.startsWith(p + ".") && k !== o).map(([k, v]) => `${k.split(".")[1]} ${f((100 * v) / picks[o])}%`).join("  "), `| per game ${f(picks[o] / N)} offers`);
}
