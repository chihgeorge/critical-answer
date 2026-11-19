// Class balance: plays many 4-team games through lib/game-state.ts and prints each class's win share (fair is 25%),
// average reward, ability uses left and turns. Run: node scripts/balance-sim.ts [games].
// Dice (docs/designs/class-dice-rework.md) come from lib: every correct turn-based answer rolls a dish die here and lib
// multiplies by DISH_MULTIPLIERS / CHEF_DISH_MULTIPLIERS; 偷襲 rolls the sneak die (startSneak, sneakRoll); the kill is a plain 4d20.
// Model (docs/designs/class-abilities.md, 「職業平衡（2026-11-13）」 and 「職業技能擲骰」):
// - Class dice live in lib: the mage's skill die (mageCast) and the cleric's prayer die (prayerRoll) roll here; the warrior's
//   roll is warriorRoll, and a hit rolls its dish die too. A
//   letter-count hint cracks WEAK of the unknown fill-ins, a whole answer or order all of them.
// - TEXT of the questions are fill-in (persuasion check first), SORT are sort questions, the rest multipleChoice.
// - A correct answer may lead to a fork (EVENT_CHANCE); the unmarked doors are ⚔️ or ❓ half and half, and the room ⚔️
//   led to rolls no fork. ❓ opens an event (a fortune's effect is picked at random). A team that flees outside the boss room takes 逃跑・換房 (FLEESAME=0.5: 逃跑・同房 half the time, the rule before 2026-11-18).
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
// - Fill-ins outside the boss room roll a persuasion check first; the boss room rolls none (#382).
// - A potion a team holds (a fortune's, or PGIVE's) goes on its next die: a check, a class die, or the dish die of an answer it knows.
// - A turn-based boss question's knowledge and hit pay follow its difficulty in lib (unset = 3); a song's pay does, its
//   knowledge stays KB. BOSSD rates every phase-1 question,
//   BUZZD the songs ("2:17,3:38": 17 songs of difficulty 2, then 38 of 3); BOSSTEXT is phase 1's fill-in share (else TEXT/SORT).
// - 抓包與神諭 (AC=1: the switch is on from the start). A team that uses the oracle (ORACLEP of teams) asks it on its first
//   unknown room question of difficulty ORACLE_MIN or more. CHEATERS teams per game ask an AI on an unknown turn-based
//   question with CHEAT (boss phase 1 too unless CHEATBOSS=0; lib allows no catch there); each waiting team with catches spots it with SPOT (成立). On any other room turn a waiting team
//   files a false catch with FALSE (冤枉). The AI is right with AIOK. Pay: BOUNTY CAUGHT FALSEREPORT WRONGED (CATCH_PAY).
// Not modelled: memory questions (they only hide the question while the media plays; no score or ability rule), the
// host handing out potions, multi-field songs, late teams, offline phones, away teams.
// Env knobs: ROOMS TEXT TEXTK HINT SORT SORTK SORTHINT SORTFIX TAP TAPSD GUESSB GUESSOK EVENTS=0 THRESH HP1 HP2 KB MAGE_MIN
// WAR_MIN THIEF_MIN BOSSD BUZZD BOSSTEXT PGIVE TEAMS CHEFS STARTPOT (what-if: LIB), plus the 抓包與神諭 ones above (see the defaults below).
// The event bank (2026-11-18): ROOMS=1,2,2,3,4,4,5,5 TEXT=0.29 SORT=0.12 BOSSTEXT=1 BOSSD=4 HP2=20 TAP=0.07 BUZZD=2:17,3:38,4:13,5:4.
import { registerHooks } from "node:module";
import type * as GT from "../lib/game-state";
// lib/ imports without ".ts" (Next and vitest resolve that; plain node does not): retry a relative import as ".ts".
registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx); } catch (e) { if (spec.startsWith(".") && !spec.endsWith(".ts")) return next(spec + ".ts", ctx); throw e; }
  },
  // LIB="NAME=value;NAME2=[1,2]": rewrite `export const NAME = ...;` in lib/game-state.ts for a what-if sweep (no lib change).
  load(url, ctx, next) {
    const r = next(url, ctx);
    if (!url.endsWith("/lib/game-state.ts") || !process.env.LIB) return r;
    let src = String(r.source);
    for (const kv of (process.env.LIB ?? "").split(";").filter(Boolean)) {
      const [k, v] = kv.split("=");
      const re = new RegExp(`export const ${k}(: [^=]+)? = [^;]+;`);
      if (!re.test(src)) throw new Error(`LIB: no const ${k}`);
      src = src.replace(re, `export const ${k} = ${v};`);
    }
    return { ...r, source: src };
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
const THRESH = env("THRESH", 15), HP1 = env("HP1", 8), HP2 = env("HP2", 3), KB = env("KB", 0.5);
// Lowest room difficulty an ability is used on (always once a team is in the boss room).
// With 3 uses a thief sneaks from difficulty 2 (2026-11-09 balance).
const MAGE_MIN = env("MAGE_MIN", 2), WAR_MIN = env("WAR_MIN", 2), THIEF_MIN = env("THIEF_MIN", 2), WEAK = env("WEAK", 0.1);
// The default layout (issue #371): six rooms of difficulty 1–4 that add up to the 進王門檻. Unrated boss questions count as 3 (lib).
const rooms: GT.RoomTemplate[] = (process.env.ROOMS ?? "1,2,2,3,3,4").split(",").map(Number).map((d) => ({ baseDifficulty: d as GT.Difficulty, reward: d * 10 }));
// Big pools: a team that cannot answer keeps fleeing, and a small pool would deal it the same unknown question again.
const pools = [1, 2, 3, 4, 5].map((p) => Array.from({ length: 80 }, (_, j) => `p${p}-${j}`));
const boss = Array.from({ length: 160 }, (_, j) => `b${j}`);
const songs = Array.from({ length: 80 }, (_, j) => `s${j}`);
const BOSSD = env("BOSSD", 0), BOSSTEXT = env("BOSSTEXT", NaN);
const bossDifficulties: Record<string, GT.Difficulty> = {};
if (BOSSD) for (const b of boss) bossDifficulties[b] = BOSSD as GT.Difficulty;
let songAt = 0;
for (const [d, n] of (process.env.BUZZD ?? "").split(",").filter(Boolean).map((x) => x.split(":").map(Number)))
  for (let j = 0; j < n && songAt < songs.length; j++) bossDifficulties[songs[songAt++]] = d as GT.Difficulty;
// The rework's what-ifs (REWORK, DISHALL, DISHM, SNEAK1*, SNEAKLOSE, CHEF*) are gone: lib plays those rules now.
// PGIVE: chance per own turn that the host hands a team with no potion one.
const PGIVE = env("PGIVE", 0);
const AC = process.env.AC === "1", ORACLEP = env("ORACLEP", 1), ORACLE_MIN = env("ORACLE_MIN", 3), AIOK = env("AIOK", 0.9);
const CHEATBOSS = process.env.CHEATBOSS !== "0", CHEATERS = env("CHEATERS", 0), CHEAT = env("CHEAT", 0.5), SPOT = env("SPOT", 0.3), FALSE = env("FALSE", 0);
// CATCH_PAY is a const in lib; the sim overrides it in place for a sweep.
for (const k of Object.keys(G.CATCH_PAY)) if (process.env[k.toUpperCase()]) (G.CATCH_PAY as Record<string, number>)[k] = Number(process.env[k.toUpperCase()]);
// TEAMS=n teams a game (default 4; over 6 picks classes with repeats), CHEFS=k forces the first k to be chefs.
// FLEESAME: share of room flees that are 逃跑・同房. 0 = the owner's 2026-11-18 rule (only 逃跑・換房 outside the boss room); 0.5 = the rule before.
const FLEESAME = env("FLEESAME", 0);
const TEAMS = env("TEAMS", 4), CHEFS = env("CHEFS", 0);
// STARTPOT="chef,none": these classes start the game holding one potion.
const STARTPOT = (process.env.STARTPOT ?? "").split(",").filter(Boolean);
type Tag = { oracle: boolean; cheater: boolean };

function play(classes: C[], tags: Tag[], maxTurns = 600) {
  const teams = classes.map((c, i) => ({ id: `T${i}`, name: `T${i}`, ...(c ? { classId: c } : {}) }));
  const later = HP2 > 0 ? [{ maxHp: HP2, questionIds: songs, buzzer: true as const }] : [];
  let g = G.createGame(teams, rooms, pools, boss, { bossThreshold: THRESH }, HP1, R, undefined, {}, later, undefined, [], bossDifficulties);
  if (AC) g = G.setAntiCheat(g, true);
  for (const [k, c] of classes.entries()) if (STARTPOT.includes(c ?? "none")) g = G.giveItem(g, `T${k}`);
  const latent = new Map<string, { known: boolean; hintable: boolean; weak: boolean }>();
  // A team knows a buzz song for good too, so a skipped song that comes back is not re-rolled.
  const songKnown = new Map<string, boolean>();
  const knowsSong = (id: string, q: string) => { const k = `${id}|${q}`; if (!songKnown.has(k)) songKnown.set(k, R() < KB); return songKnown.get(k)!; };
  const kinds = new Map<string, "text" | "sort" | "mc" | "tap">();
  const kindOf = (q: string, buzz = false, boss = false) => {
    const [tx, so] = boss && !Number.isNaN(BOSSTEXT) ? [BOSSTEXT, 0] : [TEXT, SORT];
    if (!kinds.has(q)) { const r = R(); kinds.set(q, buzz ? (r < TAP ? "tap" : "text") : r < tx ? "text" : r < tx + so ? "sort" : "mc"); }
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
    if (PGIVE && !g.teams.find((x) => x.id === id)!.item && R() < PGIVE) g = G.giveItem(g, id);
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
    const d = inBoss ? G.bossQuestionDifficulty(g, q) : team().currentDifficulty;
    const kind = kindOf(q, false, inBoss), text = kind === "text", sort = kind === "sort", opts = sort ? 24 : 4; // 4! orders of a sort
    const key = `${id}:${q}`;
    if (!latent.has(key)) latent.set(key, { known: R() < KNOW[d - 1] * (text ? TEXTK : sort ? SORTK : 1), hintable: R() < (sort ? SORTHINT : HINT), weak: R() < WEAK });
    const L = latent.get(key)!;
    const settle = (r: { game: GT.GameState; outcome: GT.AnswerOutcome }, ok: boolean) => {
      g = r.game;
      if (ok && EVENTS && !afterMonster && G.eventEligible(g, r.outcome) && R() < G.EVENT_CHANCE) g = G.enterFork(g, id);
    };
    // A held potion (a fortune's) goes on the next check, mage or prayer die, or the crit die of an answer the team knows.
    const potionRoll = () => { if (!team().item) return d20(); g = G.spendPotion(G.drinkPotion(g, id), id); return Math.max(d20(), d20()); };
    // A correct turn-based answer's dish die, rolled first: potionRoll spends the potion on g, and the call must see that g.
    const rightText = () => { const v = potionRoll(); settle(G.answerQuestion(g, id, q, true, "retry", R, v), true); };
    // The boss room rolls no persuasion check (#382; the room refuses one there, lib does not).
    if (text && !inBoss && !g.checks?.[G.checkKey(q, id)]) {
      const v = potionRoll();
      g = G.recordCheck(g, id, q, v, "ab");
      if (v === 20) { rightText(); continue; }
    }
    const hinted = () => g.checks?.[G.checkKey(q, id)]?.hint !== undefined || g.mageHints?.[q] !== undefined;
    const hintKind = () => g.mageHintKinds?.[q];
    const knows = () => L.known || hintKind() === "whole" || ((text || sort) && hinted() && (hintKind() === "count" ? L.weak : L.hintable));
    const gone = () => g.eliminated[q] ?? [];
    const abilityOk = (min: number) => inBoss || g.teams.some((x) => x.inBoss) || d >= min;
    // 抓包與神諭: the oracle and a cheat come before the abilities (an answer the AI gave is known); a catch is ruled at once.
    const tag = tags[g.teams.findIndex((x) => x.id === id)];
    let cheated = false;
    // One catch per question-turn (lib's caughtTurn): a turn the loop comes back to cannot be caught again.
    const catchable = !inBoss && g.antiCheat?.caughtTurn !== `${id}:${q}:${team().turns ?? 0}`;
    if (AC && !knows()) {
      if (!inBoss && tag.oracle && (team().oracleLeft ?? 0) > 0 && d >= ORACLE_MIN) { g = G.askOracle(g, id, q); if (R() < AIOK) L.known = true; }
      else if (tag.cheater && (CHEATBOSS || !inBoss) && !G.oracleActive(g, id) && R() < CHEAT) {
        cheated = true;
        const spotter = !catchable ? undefined : shuffle(g.teams.filter((x) => x.id !== id && (x.catchesLeft ?? 0) > 0)).find(() => R() < SPOT);
        if (spotter) { g = G.upholdCatch(G.fileCatch(g, spotter.id, q), R).game; continue; }
        if (R() < AIOK) L.known = true;
      }
    }
    if (AC && FALSE > 0 && !cheated && catchable && !G.oracleActive(g, id) && R() < FALSE) {
      const by = shuffle(g.teams.filter((x) => x.id !== id && (x.catchesLeft ?? 0) > 0))[0];
      if (by) g = G.dismissCatch(G.fileCatch(g, by.id, q)).game;
    }
    const t = team();
    if (t.abilityUses > 0) {
      if (t.classId === "mage" && abilityOk(MAGE_MIN) && !knows() && !g.mageCasts?.[G.checkKey(q, id)]) {
        const target: GT.MageTarget | null = text && !hinted() ? { kind: "text", answer: "ab" } : sort && !hinted() ? { kind: "sort", items: ["first", "b", "c", "d"] } : kind === "mc" && gone().length === 0 ? { kind: "multipleChoice", correctIndex: 0, optionCount: 4 } : null;
        if (target) { g = G.spendAbility(g, id, "mage"); g = G.mageCast(g, id, q, target, potionRoll(), R); }
      }
      // One 偷襲 per question, whatever its sneak die shows (lib refuses a second).
      if (t.classId === "thief" && !t.sneakArmed && t.sneakTry?.questionId !== q && abilityOk(THIEF_MIN) && knows()) {
        g = G.startSneak(g, id);
        g = G.sneakRoll(g, id, potionRoll()).game;
      }
      // The warrior rolls when stuck, and on multipleChoice only when the roll beats a guess.
      if (t.classId === "warrior" && abilityOk(WAR_MIN) && !knows() && (text || (21 - G.WARRIOR_TARGET) / 20 > 1 / (opts - gone().length))) {
        const v = potionRoll(), dish = v >= G.WARRIOR_TARGET ? potionRoll() : undefined;
        settle(G.warriorRoll(G.spendAbility(g, id, "warrior"), id, q, v, R, dish), v >= G.WARRIOR_TARGET);
        continue;
      }
    }
    // Option 0 is the right one; a wrong pick is the first wrong option still shown.
    if (knows() || (!text && R() < 1 / (opts - gone().length))) {
      if (text) { rightText(); continue; }
      // A guess keeps the potion for a die the team trusts.
      const dish = knows() ? potionRoll() : d20();
      settle(G.answerQuestion(g, id, q, true, "retry", R, dish), true);
      continue;
    }
    const cleric = t.classId === "cleric" && team().abilityUses > 0;
    if (!text) g = G.recordWrongLock(g, id, q, Array.from({ length: opts - 1 }, (_, i) => i + 1).find((i) => !gone().includes(i))!);
    else if (cleric && G.canPrayBeforeJudge(g, id)) g = G.recordTextWrong(g, id, q);
    if (sort && R() < SORTFIX) L.known = true;
    // A prayer keeps the turn: multipleChoice retries with a wrong tile gone; a fill-in it cannot crack flees to a new one.
    if (cleric && G.canPray(g, id)) g = G.prayerRoll(G.pray(g, id), id, potionRoll());
    const flee = text || (!inBoss && !g.pendingWrong?.prayed && gone().length >= 2);
    g = G.answerQuestion(g, id, q, false, flee ? (inBoss || R() < FLEESAME ? "flee" : "switch") : "retry", R).game;
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
  const lineup = TEAMS <= 6 && !CHEFS ? shuffle([...CLASSES]).slice(0, TEAMS) : Array.from({ length: TEAMS }, (_, k) => (k < CHEFS ? "chef" : CLASSES[Math.floor(R() * CLASSES.length)]));
  const cheaters = new Set(shuffle(lineup.map((_, k) => k)).slice(0, CHEATERS));
  const tags = lineup.map((_, k) => ({ oracle: R() < ORACLEP, cheater: cheaters.has(k) }));
  const g = play(lineup.map((c) => (c === "none" ? undefined : c)), tags);
  if (g.phase !== "finished") unfinished++;
  const max = Math.max(...g.teams.map((t) => t.reward));
  g.teams.forEach((t, k) => {
    const s = stats.get(lineup[k]) ?? { sum: 0, wins: 0, n: 0, left: 0, turns: 0 };
    s.sum += t.reward; s.n++; s.left += t.abilityUses; s.turns += t.turns ?? 0;
    if (t.reward === max) s.wins += 1 / g.teams.filter((x) => x.reward === max).length;
    stats.set(lineup[k], s);
    if (AC) for (const key of [tags[k].cheater ? "*cheater" : "*honest", tags[k].oracle ? "*oracle" : "*no-oracle"]) {
      const u = stats.get(key) ?? { sum: 0, wins: 0, n: 0, left: 0, turns: 0 };
      u.sum += t.reward; u.n++; // "left" here: catches upheld minus dismissed
      u.left += (t.catchesUpheld ?? 0) - (t.catchesDismissed ?? 0); u.turns += t.turns ?? 0;
      if (t.reward === max) u.wins += 1 / g.teams.filter((x) => x.reward === max).length;
      stats.set(key, u);
    }
  });
}
console.log(`games=${N} unfinished=${unfinished}`);
for (const [k, s] of [...stats].sort((a, b) => b[1].wins / b[1].n - a[1].wins / a[1].n))
  // ±: the 95% interval of the win share (normal approximation; class rows are one team per game, the * rows share games, so theirs is a little wide).
  console.log(k.padEnd(10), "win%", ((100 * s.wins) / s.n).toFixed(1).padStart(5), "±" + (196 * Math.sqrt((s.wins / s.n) * (1 - s.wins / s.n) / s.n)).toFixed(1), "(fair 25.0)", "avg", (s.sum / s.n).toFixed(1).padStart(6), "left", (s.left / s.n).toFixed(2), "turns", (s.turns / s.n).toFixed(1));
