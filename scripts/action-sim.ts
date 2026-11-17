// Issue #301 design sim (design branch only): the same 4-team games as scripts/balance-sim.ts, plus a turn action choice.
// Run: taskpolicy -b node --no-warnings scripts/action-sim.ts <mode> [games]   (prints one JSON object)
// Modes: plans (base/A/B/C, everyone sensible) · pol-A · pol-B · pol-C (one focus team on a fixed policy, the other three
// sensible) · sens-A (strike ×/penalty grid) · sens-camp (紮營 reward) · sens-C (throw count × share).
// The actions are not in lib yet, so this script plays them on the state lib returns:
// - A 出擊姿態: before a fresh question 🔥 強攻 (difficulty +1, ×strike reward, a miss costs strikeCost); any turn outside
//   the boss room 🏕️ 紮營 (camps a game, not twice in a row, not once a team is in the boss room).
// - B 主動探索: no random forks. Any turn outside the boss room and the last room ❓ 探索 (keys a game): the ❓ door now.
// - C 丟題: after the question shows 🎯 丟給別隊 (throws a game, difficulty 2+): a waiting team answers it once, no
//   ability. Right: it gets throwGain of the room reward, the thrower does 逃跑・同房. Wrong: the thrower beats the monster
//   at throwPay of its reward (progress as usual).
// Team skill: each team's KNOW × (1 + s), s uniform in ±SKILL; strong s > SKILL/3, weak s < −SKILL/3.
// The focus team is a random seat each game (turn order follows the seat), so the first-mover edge averages out.
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
const R = () => Math.random();
const d20 = () => 1 + Math.floor(R() * 20);
const KNOW = [0.75, 0.6, 0.45, 0.35, 0.25];
// Event-bank defaults (balance-sim's 2026-11-13 line).
const TEXT = 0.1, TEXTK = 0.7, HINT = 0.3, SORT = 0.25, SORTK = 0.6, SORTHINT = 0.4, SORTFIX = 0.4;
const TAP = 0.03, TAPSD = 300, TAPAT = 30_000;
const gauss = () => Math.sqrt(-2 * Math.log(1 - R())) * Math.cos(2 * Math.PI * R());
const THRESH = 15, HP1 = 5, HP2 = 20, HIT = 10, KB = 0.5;
const MAGE_MIN = 2, WAR_MIN = 2, THIEF_MIN = 2, WEAK = 0.1, SKILL = 0.2;
const rooms: GT.RoomTemplate[] = [1, 2, 2, 3, 4, 4, 5, 5].map((d) => ({ baseDifficulty: d as GT.Difficulty, reward: d * 10 }));
const pools = [1, 2, 3, 4, 5].map((p) => Array.from({ length: 80 }, (_, j) => `p${p}-${j}`));
const boss = Array.from({ length: 160 }, (_, j) => `b${j}`);
const songs = Array.from({ length: 80 }, (_, j) => `s${j}`);
const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const patch = (g: GT.GameState, id: string, p: (t: GT.Team) => Partial<GT.Team>): GT.GameState => ({ ...g, teams: g.teams.map((t) => (t.id === id ? { ...t, ...p(t) } : t)) });
const addReward = (g: GT.GameState, id: string, n: number) => patch(g, id, (t) => ({ reward: Math.max(0, t.reward + Math.round(n)) }));

interface Cfg {
  name: string; design: "base" | "A" | "B" | "C";
  /** The focus team's policy ("sensible" = the plan's sensible policy, as the others play). */
  focus: string;
  /** Only two seats may take the new actions (the other two never do): the users' win share shows the edge (fair 50). */
  mix?: boolean;
  strike: number; strikeCost: number; camps: number; campReward: "skill" | "potion" | "satiety";
  keys: number; throws: number; throwGain: number; throwPay: number;
}
const DEF: Omit<Cfg, "name" | "design" | "focus"> = { strike: 1.3, strikeCost: 10, camps: 2, campReward: "skill", keys: 2, throws: 2, throwGain: 0.5, throwPay: 0.5 };
let cfg: Cfg;
let picks: Record<string, number> = {};
const pick = (who: string, k: string) => { picks[`${who}.${k}`] = (picks[`${who}.${k}`] ?? 0) + 1; };

function play(classes: C[], focusSeat: number, maxTurns = 900) {
  const teams = classes.map((c, i) => ({ id: `T${i}`, name: `T${i}`, ...(c ? { classId: c } : {}) }));
  const sk = Object.fromEntries(teams.map((t) => [t.id, (2 * R() - 1) * SKILL]));
  const skill = Object.fromEntries(teams.map((t) => [t.id, 1 + sk[t.id]]));
  const later = [{ maxHp: HP2, questionIds: songs, buzzer: true as const }];
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
  const focusId = `T${focusSeat}`;
  const policy = (tid: string) => (cfg.mix ? (tid === "T0" || tid === "T1" ? "sensible" : "never") : tid === focusId ? cfg.focus : "sensible");
  const who = (tid: string) => (tid === focusId ? "focus" : "other");
  const camps: Record<string, number> = {}, keys: Record<string, number> = {}, throws: Record<string, number> = {}, offers: Record<string, number> = {};
  const lastCamp: Record<string, boolean> = {}, strikeQ: Record<string, string | undefined> = {}, stuck: Record<string, number> = {};
  let acts = 0;
  const snaps: number[][] = [];
  const leaderGap = (id: string) => Math.max(...g.teams.map((x) => x.reward)) - g.teams.find((x) => x.id === id)!.reward;
  for (let turn = 0; turn < maxTurns && g.phase === "playing"; turn++) {
    snaps.push(g.teams.map((t) => t.reward));
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
    const P = policy(id), W = who(id);
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

    // ---- A: 紮營 any turn, 強攻 before a fresh question ----
    if (cfg.design === "A" && !inBoss && P !== "never") {
      pick(W, "offer");
      const t = team();
      const active = !!t.classId && t.classId !== "chef";
      const canCamp = (camps[id] ?? 0) < cfg.camps && !lastCamp[id] && !anyBoss && !(cfg.campReward === "potion" && t.item);
      const sensibleCamp = cfg.campReward === "satiety"
        ? t.roomIndex <= 2 // a fixed reward beats an early room's expected 7–12: bank it early
        : (active && t.abilityUses === 0 && t.roomIndex < 6) || (!active && !t.item && t.roomIndex <= 2 && R() < 0.3);
      const wantCamp = canCamp && (P === "sensible" ? sensibleCamp : P === "campEarly" ? true : P === "campLate" ? t.roomIndex >= 5 : false);
      if (wantCamp) {
        pick(W, "camp"); camps[id] = (camps[id] ?? 0) + 1; lastCamp[id] = true;
        if (cfg.campReward === "satiety") g = addReward(g, id, 15);
        else if (cfg.campReward === "skill" && active && t.abilityUses < G.ABILITY_USES) g = patch(g, id, (x) => ({ abilityUses: x.abilityUses + 1 }));
        else if (!t.item) g = G.giveItem(g, id);
        g = G.advanceTurn(g);
        continue;
      }
      lastCamp[id] = false;
      let strike = false;
      if (fresh && d < 5) {
        const p0 = Math.min(0.95, KNOW[d - 1] * skill[id]), p1 = Math.min(0.95, KNOW[d] * skill[id]);
        const ev0 = p0 * roomR, ev1 = p1 * roomR * cfg.strike - (1 - p1) * cfg.strikeCost + p1 * 3;
        const behind = leaderGap(id) >= 30;
        strike = P === "sensible" ? ev1 > ev0 || (behind && t.roomIndex >= 3) : P === "alwaysStrike" ? true : P === "strikeBehind" ? behind : false;
      }
      if (strike) { pick(W, "strike"); strikeQ[id] = q; d = d + 1; g = patch(g, id, () => ({ currentDifficulty: d as GT.Difficulty })); }
      else pick(W, "fight");
    }
    // ---- B: 探索 ----
    if (cfg.design === "B" && P !== "never" && !inBoss && !anyBoss && team().roomIndex < rooms.length - 1) {
      pick(W, "offer");
      const has = (keys[id] ?? 0) < cfg.keys;
      const want = has && (P === "sensible" ? (stuck[id] ?? 0) >= 2 || (d >= 4 && fresh && R() < 0.3) : P === "firstStuck" ? (stuck[id] ?? 0) >= 2 : P === "asap");
      if (want) {
        pick(W, "explore"); keys[id] = (keys[id] ?? 0) + 1; stuck[id] = 0;
        g = G.startForkChoice(G.enterFork(g, id), id, 0, "left");
        const r = G.chooseFork(g, id, "right", R);
        g = r.game.fortune ? G.endFortune(G.resolveFortune(r.game, G.FORTUNE_EFFECTS[Math.floor(R() * G.FORTUNE_EFFECTS.length)], false, R)) : r.game;
        continue;
      }
      pick(W, "fight");
    }

    const kind = kindOf(q), text = kind === "text", sort = kind === "sort", opts = sort ? 24 : 4;
    const L = latentOf(id, q, d, kind);
    const roomBefore = team().roomIndex;
    const settle = (r: { game: GT.GameState; outcome: GT.AnswerOutcome }, ok: boolean) => {
      const before = team().reward;
      g = r.game;
      if (strikeQ[id] === q) {
        if (ok) g = addReward(g, id, (team().reward - before) * (cfg.strike - 1));
        else g = addReward(g, id, -cfg.strikeCost);
        if (ok || r.outcome.type !== "incorrect-retry") strikeQ[id] = undefined;
      }
      if (ok && cfg.design !== "B" && !afterMonster && G.eventEligible(g, r.outcome) && R() < G.EVENT_CHANCE) g = G.enterFork(g, id);
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

    // ---- C: 丟題 after the question shows ----
    if (cfg.design === "C" && P !== "never" && !inBoss && !anyBoss && d >= 2) {
      pick(W, "offer");
      offers[id] = (offers[id] ?? 0) + 1;
      const targets = g.teams.filter((x) => x.id !== id && !x.inBoss && x.online);
      const has = (throws[id] ?? 0) < cfg.throws && targets.length > 0;
      const want = has && (P === "hard" ? !knows() && d >= 4 : P === "asap" ? true : !knows());
      if (want) {
        pick(W, "throw"); throws[id] = (throws[id] ?? 0) + 1;
        const tgt = P === "atLeader" ? [...targets].sort((a, b) => b.reward - a.reward)[0] : [...targets].sort((a, b) => a.reward - b.reward)[0];
        const tl = latentOf(tgt.id, q, d, kind);
        if (tl.known || (!text && R() < 1 / opts)) {
          pick(W, "throwBack");
          g = addReward(g, tgt.id, roomR * cfg.throwGain);
          settle(G.answerQuestion(g, id, q, false, "flee", R), false);
        } else {
          const before = team().reward;
          settle(G.answerQuestion(g, id, q, true, "retry", R, 10), true);
          g = addReward(g, id, -(team().reward - before) * (1 - cfg.throwPay));
        }
        continue;
      }
      pick(W, "answer");
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
  return { g, acts, snaps, sk };
}

type Acc = { n: number; win: number; sum: number; sq: number };
const acc = (): Acc => ({ n: 0, win: 0, sum: 0, sq: 0 });
const add = (a: Acc, win: number, score: number) => { a.n++; a.win += win; a.sum += score; a.sq += score * score; };
const out = (a: Acc) => {
  const mean = a.sum / Math.max(1, a.n);
  return { n: a.n, win: +((100 * a.win) / Math.max(1, a.n)).toFixed(1), mean: +mean.toFixed(1), sd: +Math.sqrt(Math.max(0, a.sq / Math.max(1, a.n) - mean * mean)).toFixed(1) };
};

function run(c: Cfg, N: number) {
  cfg = c; picks = {};
  const CLASSES: (GT.ClassId | "none")[] = ["mage", "cleric", "warrior", "thief", "chef", "none"];
  const F = { all: acc(), strong: acc(), average: acc(), weak: acc(), class: acc(), none: acc() };
  let sd = 0, gap = 0, winner = 0, rounds = 0, turns = 0, steps = 0, comeback = 0, leaderWins = 0, mixWins = 0, unfinished = 0;
  const share = (rs: number[], k: number) => (rs[k] === Math.max(...rs) ? 1 / rs.filter((x) => x === Math.max(...rs)).length : 0);
  for (let i = 0; i < N; i++) {
    const lineup = shuffle([...CLASSES]).slice(0, 4);
    const seat = Math.floor(R() * 4);
    const { g, acts, snaps, sk } = play(lineup.map((x) => (x === "none" ? undefined : x)), seat);
    if (g.phase !== "finished") unfinished++;
    const rs = g.teams.map((t) => t.reward), mean = rs.reduce((a, b) => a + b, 0) / 4;
    sd += Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / 4);
    gap += Math.max(...rs) - Math.min(...rs); winner += Math.max(...rs);
    rounds += g.round ?? 0; turns += acts; steps += snaps.length;
    const half = snaps[Math.floor(snaps.length / 2)];
    const hiH = Math.max(...half), loH = Math.min(...half);
    // Ties at the halfway point share the credit.
    const lead = half.map((v, k) => (v === hiH ? k : -1)).filter((k) => k >= 0), last = half.map((v, k) => (v === loH ? k : -1)).filter((k) => k >= 0);
    leaderWins += lead.reduce((a, k) => a + share(rs, k), 0) / lead.length;
    comeback += last.reduce((a, k) => a + share(rs, k), 0) / last.length;
    if (c.mix) mixWins += share(rs, 0) + share(rs, 1);
    const w = share(rs, seat), s = sk[`T${seat}`], sc = rs[seat];
    add(F.all, w, sc);
    add(s > SKILL / 3 ? F.strong : s < -SKILL / 3 ? F.weak : F.average, w, sc);
    add(lineup[seat] === "none" ? F.none : F.class, w, sc);
  }
  const rate = (wh: string) => {
    const o = picks[`${wh}.offer`] ?? 0;
    return Object.fromEntries(Object.entries(picks).filter(([k]) => k.startsWith(wh + ".") && !k.endsWith(".offer")).map(([k, v]) => [k.split(".")[1], { perGame: +(v / N).toFixed(2), pctOfOffers: o ? +((100 * v) / o).toFixed(1) : 0 }]));
  };
  const r1 = (x: number) => +(x / N).toFixed(1);
  return {
    name: c.name, design: c.design, focus: c.focus, params: { strike: c.strike, strikeCost: c.strikeCost, camps: c.camps, campReward: c.campReward, keys: c.keys, throws: c.throws, throwGain: c.throwGain, throwPay: c.throwPay }, games: N, unfinished,
    focusTeam: Object.fromEntries(Object.entries(F).map(([k, a]) => [k, out(a)])),
    game: { sd: r1(sd), gap: r1(gap), winner: r1(winner), rounds: r1(rounds), turns: r1(turns), steps: r1(steps), comebackPct: +((100 * comeback) / N).toFixed(1), halfLeaderWinsPct: +((100 * leaderWins) / N).toFixed(1) },
    ...(c.mix ? { mixUsersWinPct: +((100 * mixWins) / N).toFixed(1) } : {}),
    picks: { focus: rate("focus"), others: rate("other") },
  };
}

const mode = process.argv[2] ?? "plans", N = Number(process.argv[3] ?? 4000);
const mk = (name: string, design: Cfg["design"], focus: string, o: Partial<Cfg> = {}): Cfg => ({ ...DEF, name, design, focus, ...o });
const configs: Cfg[] = {
  plans: [mk("base", "base", "sensible"), mk("A", "A", "sensible"), mk("B", "B", "sensible"), mk("C", "C", "sensible")],
  "pol-A": ["never", "alwaysStrike", "strikeBehind", "campEarly", "campLate", "sensible"].map((p) => mk(`A:${p}`, "A", p)),
  "pol-B": ["never", "firstStuck", "asap", "sensible"].map((p) => mk(`B:${p}`, "B", p)),
  "pol-C": ["never", "hard", "asap", "atLeader", "sensible"].map((p) => mk(`C:${p}`, "C", p)),
  "sens-A": [1.2, 1.3, 1.5].flatMap((s) => [0, 5, 10, 15].map((p) => mk(`A ×${s} −${p}`, "A", "sensible", { strike: s, strikeCost: p, mix: true }))),
  "sens-camp": (["skill", "potion", "satiety"] as const).map((r) => mk(`A camp=${r}`, "A", "sensible", { campReward: r, mix: true })),
  "sens-C": [1, 2].flatMap((n) => [0.3, 0.5].map((p) => mk(`C throws=${n} pay=${p}`, "C", "sensible", { throws: n, throwPay: p, mix: true }))),
}[mode]!;
if (!configs) throw new Error(`unknown mode ${mode}`);
console.log(JSON.stringify({ mode, games: N, results: configs.map((c) => run(c, N)) }));
