// Derives what every surface shows about the current turn from the public
// SpectatorView, so /screen and the /play mini broadcast never disagree.

import { DEFAULT_GAME_CONFIG, type SpectatorView } from "./game-state";
import type { PublicQuestion, StateMessage } from "./protocol";
import type { SceneTheme } from "./pixel-art";
import type { Accessory } from "./monster-catalog";
import type { MonsterSprite, SpriteKind } from "./sprite-kind";

export type Monster = { kind: SpriteKind; name: string; scale: number; hue: number; float?: boolean; accessory?: Accessory };

/** Sprite size (an integer multiple of its native pixels) and whether it hovers. */
const LOOK: Record<MonsterSprite, { scale: number; float?: boolean }> = {
  slime: { scale: 6 },
  "slime-lost": { scale: 6 },
  "slime-king": { scale: 5 },
  ghost: { scale: 5, float: true },
  "ghost-cry": { scale: 5, float: true },
  dragon: { scale: 4 },
  mushroom: { scale: 6 },
  bat: { scale: 6, float: true },
  skeleton: { scale: 5 },
  mimic: { scale: 6 },
  spider: { scale: 6 },
  snail: { scale: 6 },
  wisp: { scale: 5, float: true },
  golem: { scale: 5 },
  jellyfish: { scale: 5, float: true },
  frog: { scale: 6 },
  candle: { scale: 5 },
  mandrake: { scale: 5 },
  eyeball: { scale: 6, float: true },
  crab: { scale: 5 },
  dice: { scale: 6 },
  pumpkin: { scale: 6 },
  cactus: { scale: 5 },
  kraken: { scale: 4 },
  phoenix: { scale: 4 },
};
export const FALLBACK_MONSTER: Monster = { kind: "slime", name: "…", scale: 6, hue: 0 };
export const BOSS_THRESHOLD = DEFAULT_GAME_CONFIG.bossThreshold;

/** Going down (docs/designs/dungeon-scene.md C): each depth has its own biome, the boss room last. */
const DEPTHS: { from: number; theme: SceneTheme; name: string }[] = [
  { from: 0, theme: "stone", name: "入口石牆" },
  { from: 2, theme: "moss", name: "苔蘚水道" },
  { from: 4, theme: "deep", name: "幽暗深淵" },
];
const depth = (room: number) => DEPTHS.filter((d) => room >= d.from).pop() ?? DEPTHS[0]; // no findLast: older TV browsers

/** How the stage draws a bank monster. */
export function monsterLook(m: PublicQuestion["monster"], hueShift = 0): Monster {
  // A sprite this page does not know (a newer server than the page) draws as a slime rather than crash.
  const kind = Object.hasOwn(LOOK, m.sprite) ? m.sprite : "slime";
  return { ...LOOK[kind], kind, name: m.name, hue: (m.hue + hueShift) % 360, ...(m.accessory ? { accessory: m.accessory } : {}) };
}

/** A room's backdrop; `null` is the boss room. */
export function roomTheme(room: number | null): SceneTheme {
  if (room === null) return "crimson";
  return depth(room).theme;
}

/** The big screen's floor chip: how deep the room on stage is, never how many are left (live map D8). */
export function floorLabel(room: number | null): string {
  return room === null ? "首領房" : `地下 ${room + 1} 樓・${depth(room).name}`;
}

/** Each boss phase turns the boss's colour by this much (boss-phases.md D9, chosen from the mockup).
 * app/globals.css's px-phase-blink turns it back by the same amount: change both together. */
export const PHASE_HUE_STEP = 90;

/** `bossMonster`: the boss to draw while no question is out (the phase card). `stageMonster`: STATE's monster during a
 * beat, which sends no question either (#401); unlike `bossMonster` it never turns the scene into the boss's. */
export function describeTurn(view: SpectatorView, question: PublicQuestion | null, bossMonster?: PublicQuestion["monster"], stageMonster?: PublicQuestion["monster"]) {
  const teamIndex = view.teams.findIndex((t) => t.id === view.currentTurnTeamId);
  const team = view.teams[teamIndex];
  // Nobody on turn in a buzzer phase still means the boss (boss-buzzer.md).
  const inBoss = team?.inBossPhase ?? !!view.buzz;
  // The phase card is the boss's moment whoever is on turn (the turn order runs on after the answer, D9):
  // draw the boss scene, while labels about the team on turn still follow `inBoss`.
  const bossScene = inBoss || (!question && !!bossMonster);
  const room = team?.roomIndex ?? 0;
  const m = question?.monster ?? stageMonster ?? bossMonster;
  const phaseHue = bossScene ? PHASE_HUE_STEP * (view.bossPhase - 1) : 0;
  const monster: Monster = m ? monsterLook(m, phaseHue) : FALLBACK_MONSTER;
  return {
    team,
    teamIndex,
    inBoss,
    bossScene,
    room,
    monster,
    /** The monster's sprite scale for the phone-size turn card. */
    miniScale: Math.max(1, Math.floor(monster.scale / 3)),
    theme: roomTheme(bossScene ? null : room),
    questionId: inBoss ? view.bossCurrentQuestionId : team?.currentQuestionId,
    bossHits: view.bossMaxHp - view.bossHp,
  };
}

/** What the stage shows while a reveal is up: the monster answered and its room (null the boss's), not the next team's,
 * which the same STATE already deals (cooking I6). From `reveal.at`, else an older server's `dish`; null without either.
 * The boss keeps its phase colour (`bossPhase`), as on the finale. */
export function revealStage(reveal: Pick<NonNullable<StateMessage["reveal"]>, "at" | "dish"> | null | undefined, bossPhase: number) {
  const at = reveal?.at ?? reveal?.dish;
  if (!at) return null;
  const bossScene = at.room === null;
  return { bossScene, room: at.room, monster: monsterLook(at.monster, bossScene ? PHASE_HUE_STEP * (bossPhase - 1) : 0) };
}

type HoldFields = Pick<StateMessage, "reveal" | "eventReveal" | "fortune" | "phaseCard" | "phaseCardDue">;

/** The host page and the big screen say this while every team's phone is offline (real-device QA 2026-11-16 P1-1). */
export const PAUSED_OFFLINE = "⏸ 遊戲暫停中，等隊伍連回";

/** Every team's phone is offline and none holds the turn, so the game waits until one reconnects. A team that keeps the
 * turn offline (a wrong answer to settle, a typed answer, a door) still has the host's buttons (currentTurnTeamId). */
export function pausedOffline(view: Pick<SpectatorView, "teams" | "currentTurnTeamId">): boolean {
  return view.currentTurnTeamId === null && view.teams.length > 0 && view.teams.every((t) => !t.online);
}

/** The turn has passed to the next team, but the room holds until the host's 下一題: the last answer, an event room's
 * result, a fortune's effect card or a boss phase card. That team's phone reads 「下一個是我們！」. A fortune's earlier
 * steps keep the turn on the drawing team, which acts in them (fortune-teller.md). */
export function nextUp(s: HoldFields): boolean {
  return !!s.reveal || !!s.eventReveal || s.fortune?.step === "card" || !!s.phaseCard || !!s.phaseCardDue;
}

/** The reveal up is the team on turn's own correct answer: the turn stays on it through the answer, the dish die and 上菜
 * (#426), so its phone says so instead of 「下一個是我們！」 (QA 2026-11-19 P1-1). For the team on turn only: a dish die's
 * reveal (`dishNext`, a typed answer names no team) is always the turn's. A 🚨 catch is no correct answer. */
export function ownReveal(reveal: StateMessage["reveal"] | undefined, teamId: string | undefined): boolean {
  if (!reveal || !teamId || reveal.caught) return false;
  return !!reveal.dishNext || [reveal.scored, reveal.choice, reveal.sorted, reveal.fields, reveal.dish].some((x) => x?.teamId === teamId);
}

/** A warrior's missed charge (stageBeat `charge-fail`), as the big screen and the warrior's phone say it: a 1 takes points. */
export function chargeFailText(team: string, value: number, penalty: number): string {
  return `⚔️ ${team}衝鋒${value === 1 ? "大失敗" : "失敗"}${penalty > 0 ? ` −${penalty}` : ""}（擲出 ${value}）`;
}

/** The host card's question line when there is no prompt to print: a media question with no words, or the room holds
 * no question (the 說服成功 card, 占卜師, a 1 or a 20). A status, never the bare question id. */
export function hostNoQuestionText(game: { question?: unknown; fortune?: unknown; stageBeat?: string }): string {
  if (game.question) return "（這題沒有文字，看大螢幕）";
  if (game.fortune) return "❓ 神秘房：🔮 占卜師";
  if (game.stageBeat === "check-success") return "🗣️ 說服成功，題目馬上出現…";
  if (game.stageBeat === "check-twenty") return "🗣️ 說服骰擲出 20：這題免答";
  if (game.stageBeat === "thrown-out") return "🗣️ 說服失敗：這題不算";
  return "題目準備中…";
}

/** A persuasion check's natural 1 (stageBeat `thrown-out`), as the big screen, the phones and the host page say it.
 * An empty `team` is the team's own phone. */
export function thrownOutText(team: string, monster: string): string {
  return `🗣️ 擲出 1！${monster}把${team || "你們"}轟出門了`;
}

/** A persuasion check's natural 20 (stageBeat `check-twenty`): the monster steps aside and gives `gift`, before the dish
 * die. An empty `team` is the team's own phone. */
export function giftText(team: string, monster: string, gift: string): string {
  return `🗣️ 擲出 20！${monster}開心讓路，送${team || "你們"}${gift}`;
}

/** The host's answer box (HOST_ANSWER) shows only for the question on turn while nothing holds it: under a reveal the
 * turn has already moved on, and the next answer beside the revealed one gets read out (#339). A door opening holds it
 * too: ⚔️'s question is not up until the door has opened (branch-fork.md). A boss phase card still due (phaseCardDue)
 * does not: the turn is still on the question just missed, and the host reads its answer to decide 改判答對. */
export function hostAnswerShown(s: HoldFields & Pick<StateMessage, "forkBeat">, answerQuestionId: string | undefined, turnQuestionId: string | undefined): boolean {
  return !!answerQuestionId && answerQuestionId === turnQuestionId && !nextUp({ ...s, phaseCardDue: undefined }) && !s.forkBeat;
}

/** It is this team's turn and its phone can act now, the moment the phone buzzes. Not in a buzzer phase, where every team plays. */
export function turnLive(s: HoldFields & Pick<StateMessage, "phase" | "view" | "intro" | "initiative">, teamId: string): boolean {
  return s.phase === "playing" && !s.intro && !s.initiative && !s.view.buzz && s.view.currentTurnTeamId === teamId && !nextUp(s);
}

/** The phone buzzes when its turn opens: live now, not live on the last STATE. `null`: no STATE yet on this connection,
 * so a (re)connect into its own turn stays silent. */
export function turnOpened(wasLive: boolean | null, live: boolean): boolean {
  return live && wasLive === false;
}
