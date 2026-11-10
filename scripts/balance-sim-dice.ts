// Class balance for the d20 skill tiers (design: 職業技能改成擲骰, 2026-11-09). Same game model as balance-sim.ts
// (two-phase boss, same knobs and player policies), plus a rules layer for the four tiers:
// 1 大失敗 / 小失敗 / 成功 / 20 大成功 (draft 2–5 / 6–19; decided 2–6 / 7–19, Cfg.small). lib/game-state.ts still has the 11/08 rules, so this script applies
// the tier effects around it (it patches reward, ability uses and removed options after the lib call).
// shortcut: the rules layer lives here, not in lib/. Once lib/ has the tiers, move the knobs there and delete the patches.
// Run: RULES=today|draft|rec node scripts/balance-sim-dice.ts [games]      (today reproduces balance-sim.ts)
//      CFG='{"n":3,"chefMul":[0.1,0.5,1.3,1.5]}' overrides any Cfg field of the preset. LABEL=x names the summary line.
// Env knobs of balance-sim.ts still apply. New: WEAK (chance a letter-count hint cracks an unknown fill-in, default 0.1),
// POTION (chance per turn the host hands a team with no potion one, default 0).
// EX (default "1/3,1/3,1/3"): on a multipleChoice question a team does not know, the chance it can rule out 0 / 1 / 2 of
// the wrong options by itself (owner, 2026-11-09). It guesses evenly among the options neither greyed out nor ruled out.
// EX=1,0,0 with SMART=0 is balance-sim.ts's model (a blind guess). SMART=0: a team flees after two greyed options even
// when only the right one is left (balance-sim.ts did; by default it stays and answers).
// Not modelled: sort questions (they play like multipleChoice here), a potion wasted on a wrong answer, the host's
// 改判, a mage that casts again on a question after a 1.
import { registerHooks } from "node:module";
import type * as GT from "../lib/game-state";
registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".") && !spec.endsWith(".ts")) return next(spec + ".ts", ctx); throw e; }
  },
});
const G: typeof GT = await import(new URL("../lib/game-state.ts", import.meta.url).href);
type C = GT.ClassId | undefined;
type Four = [number, number, number, number];
const env = (k: string, d: number) => Number(process.env[k] ?? d);
const R = () => Math.random();
const KNOW = [0.75, 0.6, 0.45, 0.35, 0.25];
const TEXT = env("TEXT", 0.5), TEXTK = env("TEXTK", 0.7), HINT = env("HINT", 0.3), EVENTS = process.env.EVENTS !== "0";
const THRESH = env("THRESH", 15), HP1 = env("HP1", 5), HP2 = env("HP2", 3), HIT = env("HIT", 10), KB = env("KB", 0.5);
const MAGE_MIN = env("MAGE_MIN", 2), WAR_MIN = env("WAR_MIN", 2), THIEF_MIN = env("THIEF_MIN", 3);
const WEAK = env("WEAK", 0.1), POTION = env("POTION", 0), SMART = process.env.SMART !== "0";
const EX = (process.env.EX ?? "1/3,1/3,1/3").split(",").map((x) => { const [a, b] = x.split("/").map(Number); return a / (b ?? 1); });
if (EX.length !== 3 || Math.abs(EX[0] + EX[1] + EX[2] - 1) > 1e-9) throw new Error("EX needs three chances that add up to 1");

/** Every array is indexed by tier: [1, small failure, success, 20]. */
interface Cfg {
  /** The highest roll that is a small failure: 5 in the draft (2–5 / 6–19), 6 as decided 2026-11-09 (2–6 / 7–19). */
  small: number;
  /** Classes that play by the dice tiers; the others play today's rules from lib/. */
  dice: GT.ClassId[];
  /** Ability uses per game: one number for every class, or per class. Absent: lib's (warrior/mage 4, thief/cleric 2). */
  n?: number | Partial<Record<GT.ClassId, number>>;
  /** Mage, multipleChoice: wrong options removed (3 = all of them, the answer shows; fewer leave one wrong option). */
  mageMC: Four;
  /** Mage, fill-in: chance the hint cracks a question the team does not know (letter count / first char / whole answer). */
  mageText: Four;
  mageRefund: Four;
  /** Reward multiplier when the mage answers right a question its spell landed on (6–19 or 20). 1 = none. */
  magePay: number;
  /** Persuasion bonus overrides (lib's CHECK_BONUS), e.g. {"mage":5}. */
  check?: Partial<Record<GT.ClassId | "none", number>>;
  /** Cleric: whether the prayer gives the second answer, and whether it costs the use. */
  clericRetry: Four;
  clericCost: Four;
  /** Thief: reward multiplier on the base reward. Boss damage is ×1, ×1, ×2, ×3 (fixed). */
  thiefPay: Four;
  thiefRefund: Four;
  /** Warrior: the lowest roll that is a correct answer; the share of the question's reward a 1 takes; a 20's total multiplier. */
  warTarget: number;
  war1: number;
  war20: number;
  /** The share of the reward a 6–19 success pays (1 = the whole reward). */
  warPay: number;
  warRefund: Four;
  /** Chef, passive: multiplier on the whole reward, by the correct-answer die; chefNoDie on rewards with no die. */
  chefMul: Four;
  chefNoDie: number;
  /** Chef, active (「加料」, armed before answering like the sneak): when set, there is no passive. */
  chefActive?: boolean;
  chefAct: Four;
  chefActRefund: Four;
  /** What the spring / 中吉 gives the chef: satiety (before chefNoDie), or "use" for +1 ability use. */
  chefSpring: number | "use";
}
const DRAFT: Cfg = {
  dice: ["mage", "cleric", "warrior", "thief", "chef"], small: 5,
  mageMC: [0, 1, 2, 3], mageText: [0, WEAK, HINT, 1], mageRefund: [0, 0, 0, 0], magePay: 1,
  clericRetry: [0, 0, 1, 1], clericCost: [1, 0, 1, 0],
  thiefPay: [1, 1, 1.5, 2], thiefRefund: [0, 1, 0, 0],
  warTarget: 6, war1: 1, war20: 2, warPay: 1, warRefund: [0, 0, 0, 0],
  chefMul: [0.1, 0.5, 1.2, 1.5], chefNoDie: 1.2,
  chefAct: [0.1, 1, 1.5, 3], chefActRefund: [0, 1, 0, 0], chefSpring: 10,
};
const PRESETS: Record<string, Cfg> = {
  today: { ...DRAFT, dice: [] },
  draft: DRAFT,
  // The recommended variant (report of 2026-11-09): 3 uses for every class, chef passive only on answered questions.
  // Decided 2026-11-09: tiers 1 / 2–6 / 7–19 / 20 for every class (so the warrior hits on 7+), 3 uses each, cleric and
  // thief as drafted, mage refunds a small failure and pays ×1.2 on a landed spell, chef only on answered questions.
  // Run it with THIEF_MIN=2: with 3 uses a thief sneaks from difficulty 2.
  rec: { ...DRAFT, small: 6, n: 3, warTarget: 7, mageRefund: [0, 1, 0, 0], magePay: 1.2, chefMul: [0.1, 0.8, 1.3, 2], chefNoDie: 1 },
};
const cfg: Cfg = { ...PRESETS[process.env.RULES ?? "today"], ...JSON.parse(process.env.CFG ?? "{}") };
Object.assign(G.CHECK_BONUS, cfg.check);
const D = (c: C) => c !== undefined && cfg.dice.includes(c);
const tier = (v: number) => (v === 1 ? 0 : v <= cfg.small ? 1 : v <= 19 ? 2 : 3);
if ([1, 2, cfg.small, cfg.small + 1, 19, 20].map(tier).join("") !== "011223") throw new Error("tier boundaries");

const rooms: GT.RoomTemplate[] = [1, 2, 2, 3, 4, 4, 5, 5].map((d) => ({ baseDifficulty: d as GT.Difficulty, reward: d * 10 }));
const pools = [1, 2, 3, 4, 5].map((p) => Array.from({ length: 80 }, (_, j) => `p${p}-${j}`));
const boss = Array.from({ length: 160 }, (_, j) => `b${j}`);
const songs = Array.from({ length: 80 }, (_, j) => `s${j}`);

// Dice the sim rolls (not the kill's 4d20, which lib rolls), and each class's skill dice by tier.
const dice = { n: 0, one: 0, twenty: 0 };
const skill = new Map<string, number[]>();
const d20 = () => {
  const v = 1 + Math.floor(R() * 20);
  dice.n++; if (v === 1) dice.one++; if (v === 20) dice.twenty++;
  return v;
};
const note = (c: string, k: number) => { const a = skill.get(c) ?? [0, 0, 0, 0]; a[k]++; skill.set(c, a); };

function play(classes: C[], maxTurns = 600) {
  const seeds = classes.map((c, i) => ({ id: `T${i}`, name: `T${i}`, ...(c ? { classId: c } : {}) }));
  const later = HP2 > 0 ? [{ maxHp: HP2, questionIds: songs, buzzer: true as const }] : [];
  let g = G.createGame(seeds, rooms, pools, boss, { bossThreshold: THRESH }, HP1, R, HIT, {}, later);
  const usesOf = (c: GT.ClassId) => (typeof cfg.n === "number" ? cfg.n : cfg.n?.[c]);
  g = { ...g, teams: g.teams.map((t) => (t.classId && usesOf(t.classId) !== undefined ? { ...t, abilityUses: usesOf(t.classId)! } : t)) };
  const patch = (id: string, f: (t: GT.Team) => Partial<GT.Team>) => { g = { ...g, teams: g.teams.map((t) => (t.id === id ? { ...t, ...f(t) } : t)) }; };
  const pay = (id: string, delta: number) => patch(id, (t) => ({ reward: Math.max(0, t.reward + delta) }));
  const refund = (id: string, n: number) => { if (n) patch(id, (t) => ({ abilityUses: t.abilityUses + n })); };
  const classOf = (id: string) => g.teams.find((x) => x.id === id)!.classId;
  // The chef's share of a reward lib already paid (with today's +15%), redone with multiplier `m`.
  const chefFix = (id: string, o: GT.AnswerOutcome | { reward: number; chefBonus?: number }, m: number) => {
    if ("reward" in o) pay(id, Math.round((o.reward - (o.chefBonus ?? 0)) * m) - o.reward);
  };
  const chefNoDie = cfg.chefActive ? 1 : cfg.chefNoDie;
  // 🧪 Roll two, keep the higher, on the next die that takes it. A dice mage or cleric keeps it for the skill die.
  const potions = new Set<string>();
  const roll = (id: string, kind: "crit" | "check" | "mage" | "cleric") => {
    const c = classOf(id);
    const wants = D(c) && (c === "mage" || c === "cleric") ? kind === c : kind === "crit" || kind === "check";
    const v = d20();
    if (!potions.has(id) || !wants) return v;
    potions.delete(id);
    return Math.max(v, d20());
  };
  const latent = new Map<string, { known: boolean; h: number; ex: number[] }>();
  const kinds = new Map<string, boolean>();
  // A dice mage's fill-in hint on a question: the chance it cracks an unknown one.
  const given = new Map<string, number>();
  // team:question pairs a dice mage's spell landed on (magePay).
  const spelled = new Set<string>();
  const isText = (q: string) => { if (!kinds.has(q)) kinds.set(q, R() < TEXT); return kinds.get(q)!; };
  for (let turn = 0; turn < maxTurns && g.phase === "playing"; turn++) {
    if (g.boss.phasePending) { g = G.enterNextBossPhase(g); continue; }
    if (G.isBuzzPhase(g)) {
      const bq = g.boss.currentQuestionId;
      const knowers = g.teams.filter(() => R() < KB);
      if (knowers.length === 0) { g = G.skipBuzz(g); continue; }
      const w = knowers[Math.floor(R() * knowers.length)].id;
      const r = G.answerQuestion(G.buzzIn(g, w, bq, true), w, bq, true, "retry", R);
      g = r.game;
      if (D("chef") && classOf(w) === "chef") chefFix(w, r.outcome, chefNoDie);
      continue;
    }
    const id = G.currentTurnTeamId(g)!;
    const team = () => g.teams.find((x) => x.id === id)!;
    if (POTION > 0 && !potions.has(id) && R() < POTION) potions.add(id);
    if (team().event) {
      const r = G.openEvent(g, id, R);
      g = r.game;
      if (D("chef") && team().classId === "chef" && r.result.satiety > 0) {
        const spring = r.result.outcome === "spring" || r.result.outcome === "good";
        if (spring && cfg.chefSpring === "use") { pay(id, -r.result.satiety); refund(id, 1); }
        else if (spring) pay(id, Math.round((cfg.chefSpring as number) * chefNoDie) - r.result.satiety);
        else chefFix(id, { reward: r.result.satiety, chefBonus: r.result.chefBonus }, chefNoDie);
      }
      continue;
    }
    const inBoss = G.isInBossPhase(g, id);
    const q = inBoss ? g.boss.currentQuestionId : team().currentQuestionId;
    const d = inBoss ? 5 : team().currentDifficulty;
    const text = isText(q);
    const key = `${id}:${q}`;
    if (!latent.has(key)) {
      const r = R();
      // The wrong options (1–3) this team rules out by itself on this question.
      latent.set(key, { known: R() < KNOW[d - 1] * (text ? TEXTK : 1), h: R(), ex: shuffle([1, 2, 3]).slice(0, r < EX[0] ? 0 : r < EX[0] + EX[1] ? 1 : 2) });
    }
    const L = latent.get(key)!;
    const settle = (r: { game: GT.GameState; outcome: GT.AnswerOutcome }, ok: boolean) => {
      g = r.game;
      if (ok && EVENTS && G.eventEligible(g, r.outcome) && R() < G.EVENT_CHANCE) g = G.enterEventRoom(g, id, G.drawEvent(R));
    };
    let chefArmed = false;
    // A correct answer. `die` is the crit die (multipleChoice); a fill-in has none, and a dice thief or chef rolls one.
    const right = (die?: number) => {
      const t0 = team();
      const base = inBoss ? g.boss.hitReward : g.rooms[t0.roomIndex].reward;
      const halved = g.checks?.[G.checkKey(q, id)]?.value === 1 || t0.boon === "curse" ? Math.round(base * 0.5) : base;
      let crit = die, delta = 0;
      const answerDie = () => die ?? d20();
      if (D("thief") && t0.classId === "thief" && t0.sneakArmed) {
        const k = tier(answerDie());
        note("thief", k);
        if (k <= 1) {
          // No sneak: lib pays the plain reward.
          patch(id, () => ({ sneakArmed: undefined }));
          refund(id, cfg.thiefRefund[k]);
          delta = Math.round(halved * cfg.thiefPay[k]) - halved;
        } else if (k === 2) delta = Math.round(halved * cfg.thiefPay[2]) - Math.round(halved * G.SNEAK_REWARD_MULTIPLIER);
        else {
          // lib's sneak + crit is boss damage ×3; the reward is thiefPay in place of the two bonuses (no stacking).
          crit = 20;
          delta = Math.round(halved * cfg.thiefPay[3]) - Math.round(halved * G.SNEAK_REWARD_MULTIPLIER) - Math.round(base * 0.5);
        }
      }
      if (spelled.has(key)) delta = Math.round(halved * (cfg.magePay - 1));
      const r = G.answerQuestion(g, id, q, true, "retry", R, crit);
      settle(r, true);
      if (delta) pay(id, delta);
      if (D("chef") && t0.classId === "chef") {
        if (!cfg.chefActive) { const k = tier(answerDie()); note("chef", k); chefFix(id, r.outcome, cfg.chefMul[k]); }
        else if (!chefArmed) chefFix(id, r.outcome, 1);
        else { const k = tier(answerDie()); note("chef", k); refund(id, cfg.chefActRefund[k]); chefFix(id, r.outcome, cfg.chefAct[k]); }
      }
    };
    if (text && !g.checks?.[G.checkKey(q, id)]) {
      const v = roll(id, "check");
      g = G.recordCheck(g, id, q, v, "ab");
      if (v === 20) { right(); continue; }
    }
    const hinted = () => g.checks?.[G.checkKey(q, id)]?.hint !== undefined || g.mageHints?.[q] !== undefined;
    const knows = () => L.known || (text && L.h < Math.max(hinted() ? HINT : 0, given.get(q) ?? 0));
    const gone = () => g.eliminated[q] ?? [];
    // The wrong options the team still takes for possible: neither greyed out nor ruled out by itself.
    const maybe = () => [1, 2, 3].filter((i) => !gone().includes(i) && !L.ex.includes(i));
    const abilityOk = (min: number) => inBoss || g.teams.some((x) => x.inBoss) || d >= min;
    const t = team();
    if (t.abilityUses > 0) {
      if (t.classId === "mage" && abilityOk(MAGE_MIN) && !knows()) {
        if (!D("mage")) {
          if (text && !hinted()) g = G.mageHint(g, id, q, "ab");
          else if (!text && gone().length === 0) g = G.mageEliminate(g, id, q, 0, 4, R);
        } else if (text ? !hinted() && !given.has(q) : gone().length === 0) {
          const k = tier(roll(id, "mage"));
          note("mage", k);
          g = G.spendAbility(g, id, "mage");
          refund(id, cfg.mageRefund[k]);
          if (k >= 2) spelled.add(key);
          if (text) given.set(q, cfg.mageText[k]);
          else {
            // Option 0 is the right one. Below 3, one wrong option always stays (mageEliminate's cap).
            const wrong = shuffle([1, 2, 3].filter((i) => !gone().includes(i)));
            const cut = wrong.slice(0, cfg.mageMC[k] >= 3 ? 3 : Math.min(cfg.mageMC[k], wrong.length - 1));
            if (cut.length) g = { ...g, eliminated: { ...g.eliminated, [q]: [...gone(), ...cut] } };
          }
        }
      }
      if (t.classId === "thief" && !t.sneakArmed && abilityOk(THIEF_MIN) && knows()) g = G.armSneak(g, id);
      if (cfg.chefActive && D("chef") && t.classId === "chef" && abilityOk(THIEF_MIN) && knows()) { g = G.spendAbility(g, id, "chef"); chefArmed = true; }
      const target = D("warrior") ? cfg.warTarget : G.WARRIOR_TARGET;
      // The warrior rolls when stuck, and on multipleChoice only when the roll beats a guess.
      if (t.classId === "warrior" && abilityOk(WAR_MIN) && !knows() && (text || (21 - target) / 20 > 1 / (1 + maybe().length))) {
        const v = d20();
        if (!D("warrior")) { settle(G.warriorRoll(G.spendAbility(g, id, "warrior"), id, q, v, R, !text), v >= target); continue; }
        const k = tier(v), ok = v >= target;
        note("warrior", k);
        const base = inBoss ? g.boss.hitReward : g.rooms[t.roomIndex].reward;
        g = G.spendAbility(g, id, "warrior");
        refund(id, cfg.warRefund[k]);
        // A 20 is a crit on any question kind (+50% and a boss heart from lib), topped up to war20 in all.
        settle(G.answerQuestion(g, id, q, ok, "retry", R, v === 20 ? 20 : text ? undefined : v), ok);
        if (v === 20) pay(id, Math.round(base * (cfg.war20 - 1.5)));
        if (v === 1) pay(id, -Math.round(base * cfg.war1));
        if (ok && v !== 20) pay(id, Math.round(base * (cfg.warPay - 1)));
        continue;
      }
    }
    // Option 0 is the right one; a wrong pick is one of the wrong options the team still takes for possible.
    if (knows() || (!text && R() < 1 / (1 + maybe().length))) { right(text ? undefined : roll(id, "crit")); continue; }
    const cleric = t.classId === "cleric" && team().abilityUses > 0;
    if (!text) g = G.recordWrongLock(g, id, q, maybe()[0]);
    else if (cleric && G.canPrayBeforeJudge(g, id)) g = G.recordTextWrong(g, id, q);
    // A prayer keeps the turn: multipleChoice retries with a wrong tile gone; a fill-in it cannot crack flees to a new one.
    if (cleric && G.canPray(g, id)) {
      if (!D("cleric")) g = G.pray(g, id);
      else {
        const k = tier(roll(id, "cleric"));
        note("cleric", k);
        if (cfg.clericRetry[k]) g = G.pray(g, id);
        // lib's pray took one use; a failed prayer took none.
        refund(id, (cfg.clericRetry[k] ? 1 : 0) - cfg.clericCost[k]);
      }
    }
    const flee = text || (!inBoss && !g.pendingWrong?.prayed && gone().length >= 2 && !(SMART && maybe().length === 0));
    g = G.answerQuestion(g, id, q, false, flee ? "flee" : "retry", R).game;
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
console.log(`games=${N} unfinished=${unfinished} rules=${process.env.RULES ?? "today"} cfg=${process.env.CFG ?? "{}"}`);
for (const k of CLASSES) {
  const s = stats.get(k)!, sk = skill.get(k);
  console.log(k.padEnd(8), "win%", win(k).toFixed(1).padStart(5), "avg", (s.sum / s.n).toFixed(1).padStart(6), "left", (s.left / s.n).toFixed(2), "turns", (s.turns / s.n).toFixed(1),
    // Skill dice per team per game, and how many of them came up 1, a small failure and 20.
    sk ? `skillDice ${(sk.reduce((a, b) => a + b) / s.n).toFixed(2)} ones ${(sk[0] / s.n).toFixed(3)} small ${(sk[1] / s.n).toFixed(2)} twenties ${(sk[3] / s.n).toFixed(3)}` : "");
}
console.log(`dice per game ${(dice.n / N).toFixed(1)}: ones ${(dice.one / N).toFixed(2)}, twenties ${(dice.twenty / N).toFixed(2)} (the kill's 4d20 not counted)`);
// One line to compare runs: win share per class, then the widest gap from 27 among the five classes.
const five = CLASSES.filter((k) => k !== "none");
console.log("SUMMARY", (process.env.LABEL ?? process.env.RULES ?? "today").padEnd(28), CLASSES.map((k) => `${k} ${win(k).toFixed(1)}`).join("  "), " maxdev", Math.max(...five.map((k) => Math.abs(win(k) - 27))).toFixed(1));
