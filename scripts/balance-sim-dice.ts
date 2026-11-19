// A record of the class-dice analysis (2026-11-17), written against lib v0.83.1.1, before class dice: today's lib has the
// tiers (mageCast, prayerRoll, the answer die) and no mageHint / mageEliminate, so this no longer runs. Run
// scripts/balance-sim.ts, which plays the shipped rules.
// Class balance for the d20 skill tiers (design: 職業技能改成擲骰, approved 2026-11-09), ported onto today's
// scripts/balance-sim.ts (same game model, knobs and player policies; read its header). RULES=today plays lib's rules
// as they are and reproduces balance-sim.ts; RULES=dice adds a rules layer for the approved tiers around lib:
// 1 大失敗 / 2–6 小失敗 / 7–19 成功 / 20 大成功 (Cfg.small), 3 uses for every active class.
// shortcut: the rules layer patches reward, uses and removed options after the lib call. Once lib/ has the tiers, delete
// the layer and run balance-sim.ts.
// Run: RULES=today|dice node scripts/balance-sim-dice.ts [games]. CFG='{"chefMul":[0.1,0.8,1.35,2]}' overrides any Cfg
// field; LABEL names the SUMMARY line. New knob: WEAK (chance a letter-count hint cracks an unknown fill-in, 0.1).
// Dice layer, per class (the approved table):
// - Mage: a skill die on cast (a held potion takes it). MC removes 0 / 1 / min(2, wrong−1) / every wrong option; fill-in
//   gives nothing / the letter count (WEAK) / the first char (HINT) / the answer; sort nothing / the last item / the
//   first item (both SORTHINT) / the order. A small failure gives the use back; 7+ pays ×magePay on a correct answer.
// - Cleric: a prayer die (potion takes it). Retry on 7+; a 20 costs no use; 1 and 2–6 cost the use and do nothing.
// - Thief: reads the answer die (the crit die; a fill-in rolls one, never with a potion). 1: no sneak; 2–6: no sneak, use
//   back; 7–19: lib's sneak; 20: lib's sneak + crit (×2, boss −3).
// - Chef: no passive. On a correct turn answer (never the buzzer phase, events or the kill) the answer die sets
//   ×chefMul of the reward.
// - Warrior: hits on warTarget+ (no potion); a 1 takes the question's whole reward (not below 0); a 20 pays war20 in all.
// Not modelled (as balance-sim.ts): memory questions, the host's potions, 抓包與神諭, late teams, offline phones. Also: a
// mage casting again on a question after a 1, the boss-room cleric's 2 s auto-resolve (timing only).
import { registerHooks } from "node:module";
import type * as GT from "../lib/game-state";
// lib/ imports without ".ts" (Next and vitest resolve that; plain node does not): retry a relative import as ".ts".
registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".") && !spec.endsWith(".ts")) return next(spec + ".ts", ctx); throw e; }
  },
});
// The two casts lib v0.83.1.1 had (see the header).
type OldMage = { mageHint: (...a: unknown[]) => GT.GameState; mageEliminate: (...a: unknown[]) => GT.GameState };
const G: typeof GT & OldMage = await import(new URL("../lib/game-state.ts", import.meta.url).href);
const TC: typeof import("../lib/tap-clock") = await import(new URL("../lib/tap-clock.ts", import.meta.url).href);
type C = GT.ClassId | undefined;
type Four = [number, number, number, number];
const env = (k: string, d: number) => Number(process.env[k] ?? d);
const R = () => Math.random();
const dice = { n: 0, one: 0, twenty: 0 };
const d20 = () => { const v = 1 + Math.floor(R() * 20); dice.n++; if (v === 1) dice.one++; if (v === 20) dice.twenty++; return v; };
// Chance a team knows the answer, difficulty 1–5.
const KNOW = [0.75, 0.6, 0.45, 0.35, 0.25];
const TEXT = env("TEXT", 0.5), TEXTK = env("TEXTK", 0.7), HINT = env("HINT", 0.3), EVENTS = process.env.EVENTS !== "0";
const SORT = env("SORT", 0.2), SORTK = env("SORTK", 0.6), SORTHINT = env("SORTHINT", 0.4), SORTFIX = env("SORTFIX", 0.4);
const GUESSB = env("GUESSB", 0), GUESSOK = env("GUESSOK", 0.25), WEAK = env("WEAK", 0.1);
const TAP = env("TAP", 0.1), TAPSD = env("TAPSD", 300), TAPAT = 30_000;
const gauss = () => Math.sqrt(-2 * Math.log(1 - R())) * Math.cos(2 * Math.PI * R());
const THRESH = env("THRESH", 15), HP1 = env("HP1", 5), HP2 = env("HP2", 3), HIT = env("HIT", 10), KB = env("KB", 0.5);
const DICE = process.env.RULES === "dice";
// Lowest room difficulty an ability is used on (always once a team is in the boss room). With 3 uses a thief sneaks from 2.
const MAGE_MIN = env("MAGE_MIN", 2), WAR_MIN = env("WAR_MIN", 2), THIEF_MIN = env("THIEF_MIN", DICE ? 2 : 3);

/** Every Four is indexed by tier: [1, small failure, success, 20]. */
interface Cfg {
  small: number;
  /** Uses per game for every active class; nBy overrides it per class. */
  n: number;
  nBy?: Partial<Record<GT.ClassId, number>>;
  mageMC: Four; mageText: Four; mageSort: Four; mageRefund: Four; magePay: number;
  clericRetry: Four; clericCost: Four;
  thiefRefund: Four;
  /** warPay: the share of the reward a warrior's hit below 20 pays (1 = the whole reward). */
  warTarget: number; war1: number; war20: number; warPay: number;
  /** A warrior's hit below 20 pays by the die: linear from warLo at warTarget to warPay at 19, or warSteps
   * ([[highest roll, share], …], ascending). Absent: warPay flat. */
  warLo?: number; warSteps?: [number, number][];
  chefMul: Four;
}
const APPROVED: Cfg = {
  small: 6, n: 3,
  mageMC: [0, 1, 2, 3], mageText: [0, WEAK, HINT, 1], mageSort: [0, SORTHINT, SORTHINT, 1], mageRefund: [0, 1, 0, 0], magePay: 1.2,
  clericRetry: [0, 0, 1, 1], clericCost: [1, 1, 1, 0],
  thiefRefund: [0, 1, 0, 0],
  warTarget: 7, war1: 1, war20: 2, warPay: 1,
  chefMul: [0.1, 0.8, 1.3, 2],
};
const cfg: Cfg = { ...APPROVED, ...JSON.parse(process.env.CFG ?? "{}") };
const warShare = (v: number) =>
  cfg.warSteps ? cfg.warSteps.find(([top]) => v <= top)![1]
  : cfg.warLo !== undefined ? cfg.warLo + ((cfg.warPay - cfg.warLo) * (v - cfg.warTarget)) / (19 - cfg.warTarget)
  : cfg.warPay;
const tier = (v: number) => (v === 1 ? 0 : v <= cfg.small ? 1 : v <= 19 ? 2 : 3);
if ([1, 2, cfg.small, cfg.small + 1, 19, 20].map(tier).join("") !== "011223") throw new Error("tier boundaries");
const skill = new Map<string, number[]>();
const note = (c: string, k: number) => { const a = skill.get(c) ?? [0, 0, 0, 0]; a[k]++; skill.set(c, a); };

const rooms: GT.RoomTemplate[] = [1, 2, 2, 3, 4, 4, 5, 5].map((d) => ({ baseDifficulty: d as GT.Difficulty, reward: d * 10 }));
const pools = [1, 2, 3, 4, 5].map((p) => Array.from({ length: 80 }, (_, j) => `p${p}-${j}`));
const boss = Array.from({ length: 160 }, (_, j) => `b${j}`);
const songs = Array.from({ length: 80 }, (_, j) => `s${j}`);

function play(classes: C[], maxTurns = 600) {
  const teams = classes.map((c, i) => ({ id: `T${i}`, name: `T${i}`, ...(c ? { classId: c } : {}) }));
  const later = HP2 > 0 ? [{ maxHp: HP2, questionIds: songs, buzzer: true as const }] : [];
  let g = G.createGame(teams, rooms, pools, boss, { bossThreshold: THRESH }, HP1, R, HIT, {}, later);
  const patch = (id: string, f: (t: GT.Team) => Partial<GT.Team>) => { g = { ...g, teams: g.teams.map((t) => (t.id === id ? { ...t, ...f(t) } : t)) }; };
  const pay = (id: string, delta: number) => { if (delta) patch(id, (t) => ({ reward: Math.max(0, t.reward + delta) })); };
  const refund = (id: string, n: number) => { if (n) patch(id, (t) => ({ abilityUses: t.abilityUses + n })); };
  if (DICE) g = { ...g, teams: g.teams.map((t) => (t.classId && t.classId !== "chef" ? { ...t, abilityUses: cfg.nBy?.[t.classId] ?? cfg.n } : t)) };
  const latent = new Map<string, { known: boolean; hintable: boolean; h: number }>();
  // A team knows a buzz song for good too, so a skipped song that comes back is not re-rolled.
  const songKnown = new Map<string, boolean>();
  const knowsSong = (id: string, q: string) => { const k = `${id}|${q}`; if (!songKnown.has(k)) songKnown.set(k, R() < KB); return songKnown.get(k)!; };
  const kinds = new Map<string, "text" | "sort" | "mc" | "tap">();
  const kindOf = (q: string, buzz = false) => {
    if (!kinds.has(q)) { const r = R(); kinds.set(q, buzz ? (r < TAP ? "tap" : "text") : r < TEXT ? "text" : r < TEXT + SORT ? "sort" : "mc"); }
    return kinds.get(q)!;
  };
  // Dice mage: the chance its hint cracks an unknown question, per question; the team:question pairs a spell landed on;
  // the team:question pairs it already cast on.
  const given = new Map<string, number>();
  const spelled = new Set<string>(), cast = new Set<string>();
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
    if (G.atFork(team())) {
      const side = () => (R() < 0.5 ? "left" : "right") as GT.ForkSide;
      const r = G.chooseFork(G.startForkChoice(g, id, 0, side()), id, side(), R);
      g = r.game.fortune ? G.endFortune(G.resolveFortune(r.game, G.FORTUNE_EFFECTS[Math.floor(R() * G.FORTUNE_EFFECTS.length)], false, R)) : r.game;
      // The dice chef has no share on event satiety.
      if (DICE && r.result?.chefBonus) pay(id, -r.result.chefBonus);
      if (r.record.door === "mystery") continue;
    }
    const afterMonster = team().fork?.phase === "monster";
    const inBoss = G.isInBossPhase(g, id);
    const q = inBoss ? g.boss.currentQuestionId : team().currentQuestionId;
    const d = inBoss ? 5 : team().currentDifficulty;
    const kind = kindOf(q), text = kind === "text", sort = kind === "sort", opts = sort ? 24 : 4; // 4! orders of a sort
    const key = `${id}:${q}`;
    if (!latent.has(key)) latent.set(key, { known: R() < KNOW[d - 1] * (text ? TEXTK : sort ? SORTK : 1), hintable: R() < (sort ? SORTHINT : HINT), h: R() });
    const L = latent.get(key)!;
    const settle = (r: { game: GT.GameState; outcome: GT.AnswerOutcome }, ok: boolean) => {
      g = r.game;
      if (ok && EVENTS && !afterMonster && G.eventEligible(g, r.outcome) && R() < G.EVENT_CHANCE) g = G.enterFork(g, id);
    };
    // A held potion (a fortune's) goes on the next check, the crit die of an answer the team knows, or a dice mage's or
    // cleric's skill die.
    const potionRoll = () => { if (!team().item) return d20(); g = G.spendPotion(G.drinkPotion(g, id), id); return Math.max(d20(), d20()); };
    // A correct answer. `die`: the crit die (multipleChoice, sort); a fill-in has none, and a dice thief or chef rolls one.
    const right = (die?: number) => {
      const t0 = team();
      const answerDie = () => (die ??= d20());
      if (DICE && t0.classId === "thief" && t0.sneakArmed) {
        const k = tier(answerDie());
        note("thief", k);
        if (k <= 1) { patch(id, () => ({ sneakArmed: undefined })); refund(id, cfg.thiefRefund[k]); }
      }
      const chefK: number = DICE && t0.classId === "chef" ? tier(answerDie()) : -1;
      // A fill-in answer die has no crit effect, except a thief's 20 tier (×2, boss −3), which is lib's sneak + crit.
      const thief20 = DICE && t0.classId === "thief" && t0.sneakArmed && die === 20;
      const r = G.answerQuestion(g, id, q, true, "retry", R, text ? (thief20 ? 20 : undefined) : die);
      settle(r, true);
      const o = r.outcome;
      if (!("reward" in o)) return;
      if (spelled.has(key)) pay(id, Math.round(o.reward * cfg.magePay) - o.reward);
      if (chefK >= 0) { note("chef", chefK); const plain = o.reward - (o.dishBonus ?? 0); pay(id, Math.round(plain * cfg.chefMul[chefK]!) - o.reward); }
    };
    if (text && !g.checks?.[G.checkKey(q, id)]) {
      const v = potionRoll();
      g = G.recordCheck(g, id, q, v, "ab");
      if (v === 20) { right(); continue; }
    }
    const hinted = () => g.checks?.[G.checkKey(q, id)]?.hint !== undefined || g.mageHints?.[q] !== undefined;
    const knows = () => L.known || ((text || sort) && L.hintable && hinted()) || L.h < (given.get(q) ?? 0);
    const gone = () => g.eliminated[q] ?? [];
    const abilityOk = (min: number) => inBoss || g.teams.some((x) => x.inBoss) || d >= min;
    const t = team();
    if (t.abilityUses > 0) {
      if (t.classId === "mage" && abilityOk(MAGE_MIN) && !knows()) {
        if (!DICE) {
          if (text && !hinted()) g = G.mageHint(g, id, q, "ab");
          else if (sort && !hinted()) g = G.mageHint(g, id, q, "first", true);
          else if (kind === "mc" && gone().length === 0) g = G.mageEliminate(g, id, q, 0, 4, R);
        } else if (!cast.has(key) && (kind === "mc" ? gone().length === 0 : !hinted() && !given.has(q))) {
          cast.add(key);
          g = G.spendAbility(g, id, "mage");
          const k = tier(potionRoll());
          note("mage", k);
          refund(id, cfg.mageRefund[k]);
          if (k >= 2) spelled.add(key);
          if (kind !== "mc") given.set(q, (text ? cfg.mageText : cfg.mageSort)[k]);
          else {
            // Option 0 is the right one. Below a 20, one wrong option always stays (mageEliminate's cap).
            const wrong = [1, 2, 3].filter((i) => !gone().includes(i));
            const cut = wrong.slice(0, cfg.mageMC[k] >= 3 ? 3 : Math.min(cfg.mageMC[k], wrong.length - 1));
            if (cut.length) g = { ...g, eliminated: { ...g.eliminated, [q]: [...gone(), ...cut] } };
          }
        }
      }
      if (t.classId === "thief" && !t.sneakArmed && abilityOk(THIEF_MIN) && knows()) g = G.sneakRoll(G.startSneak(g, id), id, G.SKILL_SUCCESS).game;
      // The warrior rolls when stuck, and on multipleChoice only when the roll beats a guess.
      const target = DICE ? cfg.warTarget : G.WARRIOR_TARGET;
      if (t.classId === "warrior" && abilityOk(WAR_MIN) && !knows() && (text || (21 - target) / 20 > 1 / (opts - gone().length))) {
        const v = d20();
        if (!DICE) { settle(G.warriorRoll(G.spendAbility(g, id, "warrior"), id, q, v, R), v >= target); continue; }
        const k = tier(v), ok = v >= target;
        note("warrior", k);
        const base = inBoss ? g.boss.hitReward : g.rooms[t.roomIndex].reward;
        g = G.spendAbility(g, id, "warrior");
        // A 20 is a crit on any question kind (+50% and a boss heart from lib), topped up to war20 in all.
        settle(G.answerQuestion(g, id, q, ok, "retry", R, v === 20 ? 20 : text ? undefined : v, undefined, undefined, !ok), ok);
        if (v === 20) pay(id, Math.round(base * (cfg.war20 - 1.5)));
        if (v === 1) pay(id, -Math.round(base * cfg.war1));
        if (ok && v !== 20) pay(id, Math.round(base * warShare(v)) - base);
        continue;
      }
    }
    // Option 0 is the right one; a wrong pick is the first wrong option still shown.
    if (knows() || (!text && R() < 1 / (opts - gone().length))) {
      // Roll first: potionRoll spends the potion on g, and the call must see that g.
      const crit = text ? undefined : knows() ? potionRoll() : d20();
      right(crit);
      continue;
    }
    const cleric = t.classId === "cleric" && team().abilityUses > 0;
    if (!text) g = G.recordWrongLock(g, id, q, Array.from({ length: opts - 1 }, (_, i) => i + 1).find((i) => !gone().includes(i))!);
    else if (cleric && G.canPrayBeforeJudge(g, id)) g = G.recordTextWrong(g, id, q);
    if (sort && R() < SORTFIX) L.known = true;
    // A prayer keeps the turn: multipleChoice retries with a wrong tile gone; a fill-in it cannot crack flees to a new one.
    if (cleric && G.canPray(g, id)) {
      if (!DICE) g = G.pray(g, id);
      else {
        const k = tier(potionRoll());
        note("cleric", k);
        if (cfg.clericRetry[k]) g = G.pray(g, id);
        // lib's pray took one use; a failed prayer took none.
        refund(id, (cfg.clericRetry[k] ? 1 : 0) - cfg.clericCost[k]);
      }
    }
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
const win = (k: string) => (100 * stats.get(k)!.wins) / stats.get(k)!.n;
console.log(`games=${N} unfinished=${unfinished} rules=${DICE ? "dice" : "today"} cfg=${process.env.CFG ?? "{}"}`);
for (const k of CLASSES) {
  const s = stats.get(k)!, sk = skill.get(k);
  console.log(k.padEnd(8), "win%", win(k).toFixed(1).padStart(5), "avg", (s.sum / s.n).toFixed(1).padStart(6), "left", (s.left / s.n).toFixed(2), "turns", (s.turns / s.n).toFixed(1),
    // Skill dice per team per game, and how many came up 1, a small failure and 20.
    sk ? `skillDice ${(sk.reduce((a, b) => a + b) / s.n).toFixed(2)} ones ${(sk[0] / s.n).toFixed(3)} small ${(sk[1] / s.n).toFixed(2)} twenties ${(sk[3] / s.n).toFixed(3)}` : "");
}
console.log(`dice per game ${(dice.n / N).toFixed(1)}: ones ${(dice.one / N).toFixed(2)}, twenties ${(dice.twenty / N).toFixed(2)} (the kill's 4d20 not counted)`);
const five = CLASSES.filter((k) => k !== "none");
console.log("SUMMARY", (process.env.LABEL ?? (DICE ? "dice" : "today")).padEnd(24), CLASSES.map((k) => `${k} ${win(k).toFixed(1)}`).join("  "), " band24.2-30.2", five.every((k) => win(k) >= 24.2 && win(k) <= 30.2) ? "OK" : "OUT");
