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
// Reward sources (reward-balance, 2026-11-09): every satiety change is booked to room / boss (turn-based hits) / buzz
// (buzzer hits) / kill (the 4d20) / event (event satiety) / boon (the ±50% of a blessing or curse) / first / pull, and a
// SOURCES block prints shares, flips and luck lines. Knobs: ROOMR="10,20,20,30,40,40,50,50" room rewards,
// EVS='{"feast":20,"rotten":-10,"great":25,"spring":10}', EVCH (fork chance, lib's 0.25), FORK (chance the picked door is
// ❓, 0.5: the doors are unmarked), KILL="4d20" or "2d20+10" (kill bonus), BUZZHIT (a buzzer hit's reward, default HIT),
// SKILL (spread of team knowledge: ×(1-s), ×(1-s/3), ×(1+s/3), ×(1+s)), FIRSTBONUS (satiety for the first team into the
// boss room), PULLPAY (share of the skipped rooms' rewards a later team gets when it walks into the boss room).
// Boss length (boss-hp, 2026-11-09): BOSSQ (phase-1 questions, default 160; an earlier phase that runs out moves on, lib),
// SONGS (buzzer songs, default 80; the last phase repeats unrevealed ones, lib). SONGMEM=1: whether a team knows a song is
// fixed per team and song, so a skipped song stays unknown when it comes round again; when no team knows any unrevealed song
// the host ends the game there (no kill; counted as stalled). A LENGTH line prints questions per game and a minutes estimate.
// Room length (50 questions, 2026-11-09): ROOMD="1,2,2,3,4,4,5,5" room base difficulties (one per room; ROOMR needs as many
// rewards), PULL=all: once the first team is in, the host sends every other team in at once (lib's sendToBoss) instead of
// D9's "next correct answer". A REACH line prints the share of teams that played each room.
// Songs in both boss phases (2026-11-09): P1=0.6 makes every phase-1 boss question a turn-based song, a fill-in the team
// knows with chance P1 (no options; the check, mage hint, warrior roll, sneak and prayer work as on any fill-in), in place
// of a difficulty-5 general question. T1 = seconds per phase-1 turn in the LENGTH minutes (default 75). A SONGS line
// prints the phase-1 hit rate per turn and the distinct songs each phase used per game (mean / p95 / p99 / max).
// MAGESONG="0,0.3,0.7,1": a dice mage's hint on a phase-1 song cracks it with these chances by tier (default: Cfg.mageText).
// Three phases (stage compare, 2026-11-10): HP3>0 adds a third phase. Then phase 2 is a buzzer phase of HP2 on its own
// SONGS2 songs (know rate KB2, default KB) and phase 3 the buzzer phase of HP3 on SONGS (KB). Opening the first buzzer
// phase pulls every room team in (lib). B1=0.6 (hypothetical rule, needs a code change): phase 1 is a buzzer phase fought
// only by the teams already in the boss room, the others keep playing rooms and join by D9; no pull until phase 2.
// PHASES prints answers and distinct questions per phase, PULLED the teams still in rooms when a buzzer phase pulls.
// 占卜師 (fortune teller, design 2026-11-10): FT=best|rand replaces 大吉/中吉/凶 (same 1/6 share of the event deck) with
// a condition (9 counters, max > 0, ties all match, the drawer may match) and one of 6 effects the drawer picks: "best"
// is expected-value greedy on its guess of who matches (others' counters seen with N(0, ESTSD) noise, default 1; its own
// exact; 20 samples), "rand" uniform. TRIB=A: non-matchers pay 10 each, split among matchers; TRIB=B: 10 to each matcher.
// Transfers go to the "fortune" source; a fortune boon pays later under "boon". A FORTUNE line prints the effect mix.
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
const ROOMR = (process.env.ROOMR ?? "10,20,20,30,40,40,50,50").split(",").map(Number);
const ROOMD = (process.env.ROOMD ?? "1,2,2,3,4,4,5,5").split(",").map(Number), PULLALL = process.env.PULL === "all";
if (ROOMD.length !== ROOMR.length) throw new Error("ROOMD and ROOMR need one entry per room");
/** Teams (over all games) whose last room was at least room k (index k). */
const REACH = ROOMD.map(() => 0);
Object.assign(G.EVENT_SATIETY, JSON.parse(process.env.EVS ?? "{}"));
const EVCH = env("EVCH", G.EVENT_CHANCE), FORK = env("FORK", 0.5), BUZZHIT = env("BUZZHIT", HIT), SKILL = env("SKILL", 0);
const FIRSTBONUS = env("FIRSTBONUS", 0), PULLPAY = env("PULLPAY", 0);
const P1 = process.env.P1 === undefined ? undefined : Number(process.env.P1), T1 = env("T1", 75);
const MAGESONG = process.env.MAGESONG?.split(",").map(Number);
/** Per game: distinct phase-1 songs, distinct buzzer songs; phase-1 turns that hit. */
const USED: { p1: number[]; p2: number[]; hit1: number } = { p1: [], p2: [], hit1: 0 };
const HP3 = env("HP3", 0), KB2 = env("KB2", KB), SONGS2 = env("SONGS2", env("SONGS", 80));
const B1 = process.env.B1 === undefined ? undefined : Number(process.env.B1);
/** Per phase index: answers (skips too) and distinct questions per game. Pulled: teams, games with one, skipped rewards, wins. */
const PH = { n: [0, 0, 0], q: [[], [], []] as number[][] }, PULLED = { teams: 0, games: 0, skipped: 0, wins: 0 };
const BOSSQ = env("BOSSQ", 160), SONGS = env("SONGS", 80), SONGMEM = process.env.SONGMEM === "1";
/** Per game: room answers, phase-1 boss answers, buzzer songs played (skips too), events; games stalled in the buzzer phase. */
const LEN = { room: 0, boss1: 0, songs: 0, events: 0, boss1Q: 0, stalled: 0, kills: 0, killSum: 0 };
const [, KN, KS, KF] = (process.env.KILL ?? "4d20").match(/^(\d+)d(\d+)(?:\+(\d+))?$/)!.map(Number);
const killRoll = () => { let s = KF || 0; for (let i = 0; i < KN; i++) { const v = 1 + Math.floor(R() * KS); if (cur && v === 1) cur.n1++; if (cur && v === KS) cur.n20++; s += v; } return s; };
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

const rooms: GT.RoomTemplate[] = ROOMD.map((d, i) => ({ baseDifficulty: d as GT.Difficulty, reward: ROOMR[i] }));
const SRC = ["room", "boss", "buzz", "kill", "event", "fortune", "boon", "first", "pull"] as const;
type Src = (typeof SRC)[number];
/** Per team, per game: satiety by source, correct answers, and the boss-room entry. */
interface Book { src: Record<Src, number>; correct: number; skill: number; n1: number; n20: number; flee: number; potion: number; wrong: number; events: number; dishes: number; rotten: number; first?: { lead: number }; skipped?: number; killer?: boolean; pulled?: boolean }
const pools = [1, 2, 3, 4, 5].map((p) => Array.from({ length: 80 }, (_, j) => `p${p}-${j}`));
const boss = Array.from({ length: BOSSQ }, (_, j) => `b${j}`);
const songs = Array.from({ length: SONGS }, (_, j) => `s${j}`);
const mids = Array.from({ length: SONGS2 }, (_, j) => `m${j}`);

// Dice the sim rolls (not the kill's 4d20, which lib rolls), and each class's skill dice by tier.
const dice = { n: 0, one: 0, twenty: 0 };
/** The team whose dice are being rolled (占卜師's natural1s / natural20s). */
let cur: Book | undefined;
const FT = process.env.FT, ESTSD = env("ESTSD", 1), TRIB = process.env.TRIB ?? "A";
const EFFECTS = ["blessing", "curse", "potion", "stun", "tribute", "relief"] as const;
const COND = ["n20", "n1", "flee", "potion", "wrong", "correct", "events", "dishes", "rotten"] as const;
/** Fortunes drawn, effects picked, the drawer matched, matchers, all matched, satiety moved, stunned turns / songs, conditions. */
const FTS = { n: 0, eff: EFFECTS.map(() => 0), self: 0, matchers: 0, all: 0, moved: 0, skipTurn: 0, skipSong: 0, cond: COND.map(() => 0) };
const gauss = () => Math.sqrt(-2 * Math.log(1 - R())) * Math.cos(2 * Math.PI * R());
const skill = new Map<string, number[]>();
const d20 = () => {
  const v = 1 + Math.floor(R() * 20);
  dice.n++; if (v === 1) dice.one++; if (v === 20) dice.twenty++;
  if (cur && v === 1) cur.n1++; if (cur && v === 20) cur.n20++;
  return v;
};
const note = (c: string, k: number) => { const a = skill.get(c) ?? [0, 0, 0, 0]; a[k]++; skill.set(c, a); };

function play(classes: C[], maxTurns = 600) {
  const seeds = classes.map((c, i) => ({ id: `T${i}`, name: `T${i}`, ...(c ? { classId: c } : {}) }));
  const later = HP3 > 0 ? [{ maxHp: HP2, questionIds: mids, buzzer: true as const }, { maxHp: HP3, questionIds: songs, buzzer: true as const }]
    : HP2 > 0 ? [{ maxHp: HP2, questionIds: songs, buzzer: true as const }] : [];
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
    potions.delete(id); book[idx(id)].potion++;
    return Math.max(v, d20());
  };
  const latent = new Map<string, { known: boolean; h: number; ex: number[] }>();
  const kinds = new Map<string, boolean>();
  // A dice mage's fill-in hint on a question: the chance it cracks an unknown one.
  const given = new Map<string, number>();
  // team:question pairs a dice mage's spell landed on (magePay).
  const spelled = new Set<string>();
  const isText = (q: string) => { if (!kinds.has(q)) kinds.set(q, R() < TEXT); return kinds.get(q)!; };
  const book: Book[] = classes.map((_, i) => ({ src: Object.fromEntries(SRC.map((s) => [s, 0])) as Record<Src, number>, correct: 0, n1: 0, n20: 0, flee: 0, potion: 0, wrong: 0, events: 0, dishes: 0, rotten: 0, skill: SKILL ? [1 - SKILL, 1 - SKILL / 3, 1 + SKILL / 3, 1 + SKILL][i] : 1 }));
  const idx = (id: string) => Number(id.slice(1));
  const know = (id: string, p: number) => R() < Math.min(0.98, p * book[idx(id)].skill);
  // Teams that took the ⚔️ door: the room they walk out of draws no fork (branch-fork.md).
  const noFork = new Set<string>();
  // The 4d20 lib rolled, swapped for KILL's; returns what the kill paid.
  const killFix = (id: string, o: GT.AnswerOutcome) => {
    if (o.type !== "correct-boss-hit" || o.killBonus === undefined) return 0;
    cur = book[idx(id)];
    const k = killRoll();
    book[idx(id)].killer = true; book[idx(id)].dishes++;
    LEN.kills++; LEN.killSum += k;
    pay(id, k - o.killBonus);
    return k;
  };
  const boonOf = (b: GT.Boon | undefined, base: number) => (b === "blessing" ? Math.round(base * 0.5) : b === "curse" ? Math.round(base * 0.5) - base : 0);
  const seen = [new Set<string>(), new Set<string>(), new Set<string>()];
  const songKnow = (t: GT.Team, q: string, p: number) => { const k = `${t.id}:${q}`; if (!latent.has(k)) latent.set(k, { known: know(t.id, p), h: 0, ex: [] }); return latent.get(k)!.known; };
  const stunned = new Set<string>();
  // 占卜師: the drawer `id` picks an effect for the teams that match a drawn condition.
  const fortune = (id: string) => {
    const me = idx(id), vals = COND.map((c) => book.map((b) => b[c]));
    const pool = COND.map((_, k) => k).filter((k) => Math.max(...vals[k]) > 0);
    const c = pool[Math.floor(R() * pool.length)], top = (v: number[]) => v.map((x) => x === Math.max(...v));
    const match = top(vals[c]);
    const base = (t: GT.Team) => (t.inBoss ? g.boss.hitReward : g.rooms[t.roomIndex].reward);
    const buzz = G.isBuzzPhase(g);
    // Satiety each team moves by (tribute, relief); shortcut: rewards at the press, each payer capped by what it has.
    const moves = (e: string, m: boolean[]) => {
      const r = g.teams.map((t) => t.reward), d = r.map(() => 0), M = m.flatMap((x, j) => (x ? [j] : [])), NM = m.flatMap((x, j) => (x ? [] : [j]));
      if (e === "tribute" && NM.length) {
        if (TRIB === "A") {
          let pot = 0, last = -1;
          for (const j of NM) { const p = Math.min(10, r[j]); d[j] -= p; pot += p; if (p) last = j; }
          const each = Math.floor(pot / M.length);
          M.forEach((j) => (d[j] += each)); if (last >= 0) d[last] += pot - each * M.length;
        } else for (const j of NM) { const p = Math.min(10 * M.length, r[j]), each = Math.floor(p / M.length); d[j] -= each * M.length; M.forEach((i) => (d[i] += each)); }
      }
      if (e === "relief") {
        const lo = Math.min(...r), recv = r.flatMap((x, i) => (x === lo ? [i] : []));
        for (const j of M) { const to = recv.filter((i) => i !== j), each = to.length ? Math.floor(Math.min(20, r[j]) / to.length) : 0; d[j] -= each * to.length; to.forEach((i) => (d[i] += each)); }
      }
      return d;
    };
    // The drawer's value of an effect on a guessed match set: its own change minus the others' mean, in satiety.
    const value = (e: string, m: boolean[]) => {
      const d = e === "tribute" || e === "relief" ? moves(e, m) : g.teams.map((t, j) => !m[j] ? 0
        : e === "blessing" ? 0.5 * base(t) : e === "curse" ? -0.5 * base(t) : e === "potion" ? (potions.has(t.id) ? 0 : 2)
        : -(buzz ? 0.15 : 0.5) * base(t));
      return d[me] - d.reduce((a, x, j) => (j === me ? a : a + x), 0) / (d.length - 1);
    };
    let e: string;
    if (FT === "rand") e = EFFECTS[Math.floor(R() * EFFECTS.length)];
    else {
      const guesses = ESTSD === 0 ? [match] : Array.from({ length: 20 }, () => top(vals[c].map((v, j) => (j === me ? v : v + gauss() * ESTSD))));
      const ev = EFFECTS.map((x) => guesses.reduce((a, m) => a + value(x, m), 0));
      const best = EFFECTS.filter((_, k) => ev[k] > Math.max(...ev) - 1e-9);
      e = best[Math.floor(R() * best.length)];
    }
    FTS.n++; FTS.eff[EFFECTS.indexOf(e as (typeof EFFECTS)[number])]++; FTS.cond[c]++;
    if (match[me]) FTS.self++;
    const nm = match.filter(Boolean).length; FTS.matchers += nm; if (nm === match.length) FTS.all++;
    const d = moves(e, match);
    d.forEach((x, j) => { if (x) { pay(g.teams[j].id, x); if (x > 0) FTS.moved += x; } });
    g.teams.forEach((t, j) => {
      if (!match[j]) return;
      if (e === "blessing" || e === "curse") patch(t.id, () => ({ boon: e as GT.Boon }));
      if (e === "potion") potions.add(t.id);
      if (e === "stun") stunned.add(t.id);
    });
  };
  for (let turn = 0; turn < maxTurns && g.phase === "playing"; turn++) {
    cur = undefined;
    const before = g.teams.map((t) => t.reward), wasIn = g.teams.map((t) => t.inBoss);
    let cat: Src = "room", actor = -1, killAmt = 0, boonAmt = 0;
    try {
    if (g.boss.phasePending) {
      if (g.boss.phases[g.boss.phaseIndex + 1]?.buzzer) {
        const out = g.teams.filter((t) => !t.inBoss);
        if (out.length) PULLED.games++;
        for (const t of out) { PULLED.teams++; book[idx(t.id)].pulled = true; PULLED.skipped += rooms.slice(t.roomIndex + 1).reduce((a, r) => a + r.reward, 0); }
      }
      g = G.enterNextBossPhase(g); continue;
    }
    if (PULLALL && wasIn.some(Boolean) && !wasIn.every(Boolean)) {
      for (const t of g.teams) if (!t.inBoss && g.pendingWrong?.teamId !== t.id) g = G.sendToBoss(g, t.id, R);
      if (g.teams.some((t, j) => t.inBoss !== wasIn[j])) continue;
    }
    if (G.isBuzzPhase(g)) {
      const bq = g.boss.currentQuestionId;
      const kb = g.boss.phaseIndex === g.boss.phases.length - 1 ? KB : KB2;
      if (SONGMEM && g.boss.questionIds.filter((q) => !g.revealedQuestionIds.includes(q)).every((q) => !g.teams.some((t) => songKnow(t, q, kb)))) { LEN.stalled++; break; }
      LEN.songs++; seen[g.boss.phaseIndex].add(bq); PH.n[g.boss.phaseIndex]++;
      const out = new Set(stunned); stunned.clear(); FTS.skipSong += out.size;
      const knowers = g.teams.filter((t) => !out.has(t.id) && (SONGMEM ? songKnow(t, bq, kb) : know(t.id, kb)));
      if (knowers.length === 0) { g = G.skipBuzz(g); continue; }
      const w = knowers[Math.floor(R() * knowers.length)].id;
      actor = idx(w); cat = "buzz"; book[actor].correct++;
      boonAmt = boonOf(g.teams[actor].boon, g.boss.hitReward);
      const r = G.answerQuestion(G.buzzIn(g, w, bq, true), w, bq, true, "retry", R);
      g = r.game;
      if (D("chef") && classOf(w) === "chef") chefFix(w, r.outcome, chefNoDie);
      if (BUZZHIT !== HIT) pay(w, BUZZHIT - HIT);
      killAmt = killFix(w, r.outcome);
      continue;
    }
    const id = G.currentTurnTeamId(g)!;
    const team = () => g.teams.find((x) => x.id === id)!;
    cur = book[idx(id)];
    if (stunned.delete(id)) { FTS.skipTurn++; g = G.advanceTurn(g); continue; }
    if (POTION > 0 && !potions.has(id) && R() < POTION) potions.add(id);
    if (team().event) {
      actor = idx(id); cat = "event"; LEN.events++; book[actor].events++;
      if (FT && team().event!.scene === "fortune") {
        // lib's 大吉 opens the room (records, boss entry, next turn); its satiety is taken back.
        cat = "fortune";
        const keep = team().reward;
        patch(id, () => ({ event: { scene: "fortune", outcome: "great" } }));
        g = G.openEvent(g, id, R).game;
        patch(id, () => ({ reward: keep }));
        fortune(id);
        continue;
      }
      const r = G.openEvent(g, id, R);
      g = r.game;
      if (r.result.outcome === "rotten") book[actor].rotten++;
      if (D("chef") && team().classId === "chef" && r.result.satiety > 0) {
        const spring = r.result.outcome === "spring" || r.result.outcome === "good";
        if (spring && cfg.chefSpring === "use") { pay(id, -r.result.satiety); refund(id, 1); }
        else if (spring) pay(id, Math.round((cfg.chefSpring as number) * chefNoDie) - r.result.satiety);
        else chefFix(id, { reward: r.result.satiety, chefBonus: r.result.chefBonus }, chefNoDie);
      }
      continue;
    }
    const inBoss = G.isInBossPhase(g, id);
    if (inBoss && B1 !== undefined && g.boss.phaseIndex === 0) {
      // shortcut: S2b is a hypothetical rule, not in lib. The song plays in the boss team's turn slot among the teams in the
      // boss room; lib credits the team on turn, so the hit (a plain HIT, no crit, no chef share) is moved to the buzz winner.
      const bq = g.boss.currentQuestionId;
      LEN.songs++; seen[0].add(bq); PH.n[0]++;
      const knowers = g.teams.filter((t) => t.inBoss && songKnow(t, bq, B1));
      if (!knowers.length) { g = G.answerQuestion(g, id, bq, false, "flee", R).game; continue; }
      const w = knowers[Math.floor(R() * knowers.length)].id;
      const t0 = team();
      if (t0.sneakArmed) patch(id, () => ({ sneakArmed: undefined, abilityUses: t0.abilityUses + 1 }));
      const keep = { reward: t0.reward, boon: t0.boon };
      g = G.answerQuestion(g, id, bq, true, "retry", R).game;
      patch(id, () => keep);
      actor = idx(w); cat = "buzz"; book[actor].correct++;
      const wb = g.teams[actor].boon;
      boonAmt = boonOf(wb, g.boss.hitReward);
      pay(w, BUZZHIT + boonAmt);
      if (wb) patch(w, () => ({ boon: undefined }));
      continue;
    }
    actor = idx(id); cat = inBoss ? "boss" : "room";
    if (inBoss) { LEN.boss1++; PH.n[g.boss.phaseIndex]++; seen[g.boss.phaseIndex].add(g.boss.currentQuestionId); } else LEN.room++;
    const boon0 = team().boon, base0 = inBoss ? g.boss.hitReward : g.rooms[team().roomIndex].reward;
    const q = inBoss ? g.boss.currentQuestionId : team().currentQuestionId;
    const d = inBoss ? 5 : team().currentDifficulty;
    const song1 = inBoss && P1 !== undefined;
    const text = song1 || isText(q);
    const key = `${id}:${q}`;
    if (!latent.has(key)) {
      const r = R();
      // The wrong options (1–3) this team rules out by itself on this question.
      latent.set(key, { known: know(id, song1 ? P1! : KNOW[d - 1] * (text ? TEXTK : 1)), h: R(), ex: shuffle([1, 2, 3]).slice(0, r < EX[0] ? 0 : r < EX[0] + EX[1] ? 1 : 2) });
    }
    const L = latent.get(key)!;
    const settle = (r: { game: GT.GameState; outcome: GT.AnswerOutcome }, ok: boolean) => {
      g = r.game;
      if (!ok) { book[actor].wrong++; return; }
      if (inBoss) USED.hit1++; else book[actor].dishes++;
      book[actor].correct++;
      boonAmt = boonOf(boon0, base0);
      killAmt = killFix(id, r.outcome);
      // A fork (EVCH), then the team picks a door blind: ❓ with FORK. ⚔️ marks the next room as fork-free.
      if (!EVENTS || !G.eventEligible(g, r.outcome)) return;
      if (noFork.delete(id)) return;
      if (R() < EVCH) { if (R() < FORK) g = G.enterEventRoom(g, id, G.drawEvent(R)); else noFork.add(id); }
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
          if (text) given.set(q, (song1 && MAGESONG ? MAGESONG : cfg.mageText)[k]);
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
    if (flee) book[actor].flee++; else book[actor].wrong++;
    g = G.answerQuestion(g, id, q, false, flee ? "flee" : "retry", R).game;
    } finally {
      g.teams.forEach((t, j) => {
        const dlt = t.reward - before[j];
        if (!dlt) return;
        const b = book[j].src;
        if (j === actor) { b.kill += killAmt; b.boon += boonAmt; b[cat] += dlt - killAmt - boonAmt; } else b[cat] += dlt;
      });
      const first = !wasIn.some(Boolean);
      g.teams.forEach((t, j) => {
        if (wasIn[j] || !t.inBoss) return;
        if (first) {
          const others = Math.max(...g.teams.filter((_, k) => k !== j).map((x) => x.reward));
          book[j].first = { lead: t.reward - others };
          if (FIRSTBONUS) { pay(t.id, FIRSTBONUS); book[j].src.first += FIRSTBONUS; }
          return;
        }
        const skipped = rooms.slice(t.roomIndex + 1).reduce((a, r) => a + r.reward, 0);
        book[j].skipped = skipped;
        const pp = Math.round(skipped * PULLPAY);
        if (pp) { pay(t.id, pp); book[j].src.pull += pp; }
      });
    }
  }
  LEN.boss1Q += seen[0].size; USED.p1.push(seen[0].size); USED.p2.push(seen[HP3 > 0 ? 2 : 1].size);
  seen.forEach((x, k) => PH.q[k].push(x.size));
  g.teams.forEach((t) => { for (let k = 0; k <= t.roomIndex; k++) REACH[k]++; });
  return { g, book };
}

const N = Number(process.argv[2] ?? 4000);
const CLASSES: (GT.ClassId | "none")[] = ["mage", "cleric", "warrior", "thief", "chef", "none"];
const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const stats = new Map<string, { sum: number; wins: number; n: number; left: number; turns: number }>();
let unfinished = 0;
// SOURCES accumulators: the winner's share by source, flips (the winner changes once a source is taken out), luck lines.
const sh = Object.fromEntries(SRC.map((k) => [k, { s: 0, s2: 0, abs: 0, all: 0, flip: 0 }])) as Record<Src, { s: number; s2: number; abs: number; all: number; flip: number }>;
const L = { games: 0, mc: [0, 0], sk: [0, 0], kill: [0, 0], first: [0, 0], lead: 0, firstFinal: 0, margin: 0, margin2: 0, close: 0, buckets: [-Infinity, 0, 20, 50].map((lo) => ({ lo, n: 0, w: 0 })), leaderAtEntryWins: [0, 0],
  fin: { room: 0, bossSide: 0, n: 0 }, pul: { room: 0, bossSide: 0, skipped: 0, n: 0 } };
const argmax = (a: number[]) => { const m = Math.max(...a); const k = a.filter((x) => x === m).length; return k === 1 ? a.indexOf(m) : -1; };
for (let i = 0; i < N; i++) {
  // 4 teams: shuffle 4 of the 6 options, so every class meets every other.
  const lineup = shuffle([...CLASSES]).slice(0, 4);
  const { g, book } = play(lineup.map((c) => (c === "none" ? undefined : c)));
  if (g.phase !== "finished") unfinished++;
  const max = Math.max(...g.teams.map((t) => t.reward));
  const tot = g.teams.map((t) => t.reward), w = argmax(tot);
  book.forEach((b) => SRC.forEach((k) => (sh[k].all += b.src[k])));
  if (w >= 0) {
    L.games++;
    const sorted = [...tot].sort((x, y) => y - x), mg = sorted[0] - sorted[1];
    L.margin += mg; L.margin2 += mg * mg; if (mg < 42) L.close++;
    for (const k of SRC) {
      const v = book[w].src[k], f = v / tot[w];
      sh[k].s += f; sh[k].s2 += f * f; sh[k].abs += v;
      if (argmax(tot.map((x, j) => x - book[j].src[k])) !== w) sh[k].flip++;
    }
    const line = (arr: number[], j: number) => { if (j >= 0) { arr[0]++; if (j === w) arr[1]++; } };
    line(L.mc, argmax(book.map((b) => b.correct)));
    if (SKILL) line(L.sk, argmax(book.map((b) => b.skill)));
    line(L.kill, book.findIndex((b) => b.killer));
    book.forEach((b, j) => { if (b.pulled && j === w) PULLED.wins++; });
    const fi = book.findIndex((b) => b.first);
    line(L.first, fi);
    if (fi >= 0) {
      const lead = book[fi].first!.lead;
      L.lead += lead;
      L.firstFinal += tot[fi] - Math.max(...tot.filter((_, j) => j !== fi));
      L.leaderAtEntryWins[0]++; if (lead > 0 && fi === w) L.leaderAtEntryWins[1]++;
      const bk = [...L.buckets].reverse().find((x) => lead >= x.lo)!; bk.n++; if (fi === w) bk.w++;
      book.forEach((b, j) => {
        const side = b.src.boss + b.src.buzz + b.src.kill;
        if (j === fi) { L.fin.room += b.src.room; L.fin.bossSide += side; L.fin.n++; }
        else if (b.skipped !== undefined) { L.pul.room += b.src.room; L.pul.bossSide += side; L.pul.skipped += b.skipped; L.pul.n++; }
      });
    }
  }
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
const pct = (x: number[]) => (x[0] ? ((100 * x[1]) / x[0]).toFixed(1) : "-");
console.log("SOURCES (winner's share mean±sd | winner's avg | all teams' avg | flip% = winner changes without it)");
for (const k of SRC) {
  const m = sh[k].s / L.games, sd = Math.sqrt(Math.max(0, sh[k].s2 / L.games - m * m));
  console.log(" ", k.padEnd(6), `${(100 * m).toFixed(1).padStart(5)}%±${(100 * sd).toFixed(1).padStart(4)}`, (sh[k].abs / L.games).toFixed(1).padStart(6), (sh[k].all / N / 4).toFixed(1).padStart(6), `flip ${((100 * sh[k].flip) / L.games).toFixed(1)}%`);
}
const mgm = L.margin / L.games;
console.log(`LUCK margin ${mgm.toFixed(1)}±${Math.sqrt(L.margin2 / L.games - mgm * mgm).toFixed(1)} (<42: ${((100 * L.close) / L.games).toFixed(1)}%)  mostCorrect wins ${pct(L.mc)}% (unique in ${((100 * L.mc[0]) / L.games).toFixed(0)}%)  killer wins ${pct(L.kill)}%${SKILL ? `  mostSkilled wins ${pct(L.sk)}%` : ""}`);
console.log(`FIRST first-in wins ${pct(L.first)}%  lead at entry ${(L.lead / L.first[0]).toFixed(1)} -> final ${(L.firstFinal / L.first[0]).toFixed(1)}  buckets ${L.buckets.map((b) => `[${b.lo}+ n${((100 * b.n) / L.first[0]).toFixed(0)}% w${pct([b.n, b.w])}%]`).join(" ")}`);
console.log(`FIRST first: room ${(L.fin.room / L.fin.n).toFixed(1)} boss+buzz+kill ${(L.fin.bossSide / L.fin.n).toFixed(1)} | later: room ${(L.pul.room / L.pul.n).toFixed(1)} boss+buzz+kill ${(L.pul.bossSide / L.pul.n).toFixed(1)} skipped rooms' rewards ${(L.pul.skipped / L.pul.n).toFixed(1)}`);
console.log(`dice per game ${(dice.n / N).toFixed(1)}: ones ${(dice.one / N).toFixed(2)}, twenties ${(dice.twenty / N).toFixed(2)} (the kill's 4d20 not counted)`);
{
  const per = (x: number) => x / N, min = (per(LEN.room) * 75 + per(LEN.boss1) * T1 + per(LEN.songs) * 60 + per(LEN.events) * 30) / 60;
  const hits = (sh.boss.all + sh.buzz.all) / N / 4;
  console.log(`LENGTH room ${per(LEN.room).toFixed(1)} boss1 ${per(LEN.boss1).toFixed(1)} (distinct ${per(LEN.boss1Q).toFixed(1)}) songs ${per(LEN.songs).toFixed(1)} events ${per(LEN.events).toFixed(1)} total ${per(LEN.room + LEN.boss1 + LEN.songs).toFixed(1)} min ${min.toFixed(0)} (75s room/boss, 60s song, 30s event) stalled ${(100 * per(LEN.stalled)).toFixed(1)}%  perTeamBossHits ${hits.toFixed(1)} kill ${(LEN.killSum / Math.max(1, LEN.kills)).toFixed(1)} in ${(100 * per(LEN.kills)).toFixed(1)}% of games  killFlip ${((100 * sh.kill.flip) / L.games).toFixed(1)}%`);
}
{
  const q = (a: number[], f: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))];
  const d = (a: number[]) => `${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)}/${q(a, 0.95)}/${q(a, 0.99)}/${Math.max(...a)}`;
  console.log(`SONGS phase1 hit/turn ${(100 * USED.hit1 / Math.max(1, LEN.boss1)).toFixed(1)}%  distinct p1 ${d(USED.p1)}  distinct p2 ${d(USED.p2)} (mean/p95/p99/max)`);
}
{
  const q = (a: number[], f: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))];
  const nP = HP3 > 0 ? 3 : 2, buzz = (k: number) => k > 0 || B1 !== undefined;
  const min = (LEN.room * 75 + PH.n.reduce((a, n, k) => a + n * (buzz(k) ? 60 : T1), 0) + LEN.events * 30) / 60 / N;
  console.log(`PHASES ${PH.n.slice(0, nP).map((n, k) => `p${k + 1}${buzz(k) ? "(buzz)" : ""} ${(n / N).toFixed(1)} distinct ${(PH.q[k].reduce((a, b) => a + b, 0) / N).toFixed(1)}/p99 ${q(PH.q[k], 0.99)}/max ${Math.max(...PH.q[k])}`).join("  ")}  room ${(LEN.room / N).toFixed(1)} total ${((LEN.room + PH.n.reduce((a, b) => a + b, 0)) / N).toFixed(1)} min ${min.toFixed(0)}`);
  console.log(`PULLED teams/game ${(PULLED.teams / N).toFixed(2)} games with a pull ${((100 * PULLED.games) / N).toFixed(0)}%  skipped rewards per pulled team ${(PULLED.skipped / Math.max(1, PULLED.teams)).toFixed(1)}  pulled team wins ${((100 * PULLED.wins) / Math.max(1, PULLED.teams)).toFixed(1)}%`);
}
if (FT) console.log(`FORTUNE ${FT} trib ${TRIB} per game ${(FTS.n / N).toFixed(2)}  effects ${EFFECTS.map((e, k) => `${e} ${((100 * FTS.eff[k]) / Math.max(1, FTS.n)).toFixed(0)}%`).join(" ")}  drawer matches ${((100 * FTS.self) / Math.max(1, FTS.n)).toFixed(0)}%  matchers ${(FTS.matchers / Math.max(1, FTS.n)).toFixed(2)} (all ${((100 * FTS.all) / Math.max(1, FTS.n)).toFixed(0)}%)  moved/fortune ${(FTS.moved / Math.max(1, FTS.n)).toFixed(1)}  stun turns ${FTS.skipTurn} songs ${FTS.skipSong}  conds ${COND.map((c, k) => `${c} ${((100 * FTS.cond[k]) / Math.max(1, FTS.n)).toFixed(0)}%`).join(" ")}`);
console.log(`REACH ${REACH.map((n, k) => `r${k + 1}(${ROOMR[k]}) ${((100 * n) / N / 4).toFixed(0)}%`).join("  ")}`);
// One line to compare runs: win share per class, then the widest gap from 27 among the five classes.
const five = CLASSES.filter((k) => k !== "none");
console.log("SUMMARY", (process.env.LABEL ?? process.env.RULES ?? "today").padEnd(28), CLASSES.map((k) => `${k} ${win(k).toFixed(1)}`).join("  "), " maxdev", Math.max(...five.map((k) => Math.abs(win(k) - 27))).toFixed(1));
