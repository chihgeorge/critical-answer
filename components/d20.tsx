"use client";

import { useEffect, useState } from "react";
import { TIER_LABELS, WARRIOR_TARGET, dishTier, skillTier } from "@/lib/game-state";
import { clericEffect, dishEffect, mageEffect, sneakEffect, warriorEffect, type CastOn } from "@/lib/class-dice";
import { LabelChip } from "@/components/pixel";
import { killRollText } from "@/lib/kill-roll";
import { ROW_NAMES } from "@/lib/podium";
import { INITIATIVE_ORDER_MS, INITIATIVE_TIE_MS, type InitiativeView } from "@/lib/initiative";

/** A pixel-outlined d20 face: the hexagon with its front triangle, `value` in the middle. A natural 20 turns gold with a
 * glow and four blinking pixel sparkles (static under reduced motion), wherever a d20 lands on 20. `tone`: a 🍀 lucky die's
 * two dice (lucky-potion.md D10): the kept one keeps its colours and gets a green outline and a ✓ badge, the other dims. */
export function D20({ value, size, tone }: { value: number | string; size: number; tone?: "kept" | "dim" }) {
  const dim = tone === "dim";
  const nat20 = value === 20 && !dim;
  const line = dim ? "var(--dim-line)" : "var(--k)";
  const edge = { stroke: line, strokeWidth: 3 };
  const g = "var(--ok)";
  const filter = [
    ...(tone === "kept" ? [`drop-shadow(4px 0 0 ${g})`, `drop-shadow(-4px 0 0 ${g})`, `drop-shadow(0 4px 0 ${g})`, `drop-shadow(0 -4px 0 ${g})`] : []),
    "drop-shadow(0 6px 0 var(--k))",
    ...(nat20 ? [`drop-shadow(0 0 ${Math.round(size / 8)}px #ffd23f)`] : []),
  ].join(" ");
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden data-tone={tone} data-nat20={nat20 || undefined} style={{ display: "block", overflow: "visible", filter, opacity: dim ? 0.6 : undefined }}>
      <polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill={nat20 ? "#ffcc33" : "#ffa94d"} stroke={line} strokeWidth={5} />
      <polygon points="50,18 84,74 16,74" fill={nat20 ? "#fff6b0" : "#ffd9a3"} {...edge} />
      {["50,3 50,18", "7,27 50,18", "93,27 50,18", "16,74 7,73", "84,74 93,73", "16,74 50,97", "84,74 50,97"].map((l) => {
        const [a, b] = l.split(" ").map((p) => p.split(",").map(Number));
        return <line key={l} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} {...edge} />;
      })}
      {/* Two digits at 20 ran over the triangle's edges; 16 sits inside it, a little lower where the triangle is wider. */}
      <text x="50" y={String(value).length > 1 ? 66 : 62} textAnchor="middle" fontFamily="'Press Start 2P', monospace" fontSize={String(value).length > 1 ? 16 : 20} fill={dim ? "var(--dim-ink)" : "var(--k)"}>
        {value}
      </text>
      {nat20 &&
        [[8, 8], [92, 10], [6, 92], [94, 90]].map(([x, y], i) => (
          <path key={i} className={i % 2 ? "px-nat20-spark px-nat20-spark2" : "px-nat20-spark"} d={`M${x - 2} ${y - 7}h4v5h5v4h-5v5h-4v-5h-5v-4h5z`} fill="#fff6b0" stroke="var(--k)" strokeWidth={1.5} />
        ))}
      {tone === "kept" && (
        <g>
          <circle cx="86" cy="86" r="12" fill={g} stroke="var(--k)" strokeWidth={3} />
          <path d="M80 86l4 4 8-9" fill="none" stroke="var(--k)" strokeWidth={4} />
        </g>
      )}
    </svg>
  );
}

/** A face while the die tumbles: never 20, so the nat-20 glow shows only where a die lands. */
const tumbleFace = () => 1 + Math.floor(Math.random() * 19);

/** How long the die tumbles before it lands; the room judges at 2000 ms (BEAT_MS), so the result stays up a moment. */
const TUMBLE_MS = 1200;

/** The big screen's 2 s over a roll (class-abilities.md D12=A): the scene dims, a big d20 tumbles and lands on the
 * room's `value`. `kind`: a warrior's roll for the answer, the dish die after a correct answer (class-dice-rework.md;
 * `chef`: read with the chef's multipliers), a persuasion check, or a class die: a mage's skill die on `castOn`, a
 * cleric's prayer die, or the thief's sneak die (`penalty`: what its 1 takes). `rejudge`: the dish die is the host's
 * 改成答對. Every die but the check lands red on 1–6 (a warrior's too), plain on 7–19 and gold on 20. Keyed by the caller
 * per roll, so every roll tumbles again. `values`: a 🍀 lucky die's two dice (lucky-potion.md D10), tumbling and landing
 * together; `value` is the higher, and a tie shows both as kept. */
export function RollOverlay({ teamName, value, values, kind = "warrior", bonus = 0, dc = 0, castOn = "multipleChoice", chef = false, penalty = 0, rejudge = false }: { teamName: string; value: number; values?: number[]; kind?: "warrior" | "dish" | "check" | "mage" | "cleric" | "thief"; bonus?: number; dc?: number; castOn?: CastOn; chef?: boolean; penalty?: number; rejudge?: boolean }) {
  // Start covered: the winning face and tier must not flash before the tumble effect mounts.
  const [face, setFace] = useState<number | null>(1);
  useEffect(() => {
    // Reduced motion: no face flicker either (the CSS tumble already stops), the die shows its value at once.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const land = setTimeout(() => setFace(null), 0);
      return () => clearTimeout(land);
    }
    const tick = setInterval(() => setFace(tumbleFace()), 80);
    const land = setTimeout(() => {
      clearInterval(tick);
      setFace(null);
    }, TUMBLE_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(land);
    };
  }, []);
  const landed = face === null;
  const check = kind === "check";
  // A persuasion check (dnd design R6): die + class bonus against the monster's DC; a 20 wins outright, a 1 throws the team out.
  const hit = check ? value === 20 || (value !== 1 && value + bonus >= dc) : kind === "warrior" ? value >= WARRIOR_TARGET : kind === "dish" ? value !== 1 : skillTier(value) >= 2;
  // The dish die is red only on a 1: a 2–6 pays as usual, so it reads 成功, or 沒加成 in plain cream for a chef.
  const dish = kind === "dish" ? dishTier(value, chef) : undefined;
  const plain = dish === 1;
  const tier = `${value} ${plain ? "沒加成" : TIER_LABELS[dish ?? skillTier(value)]}`;
  const result =
    kind === "mage"
      ? `${tier}：${mageEffect(castOn, value)}`
      : kind === "cleric"
        ? `${tier}：${clericEffect(value)}`
        : kind === "thief"
          ? `${tier}：${sneakEffect(value, penalty)}`
          : kind === "dish"
            ? `${tier}：${dishEffect(value, chef)}`
            : check
              ? value === 20
                ? "20！說服成功，免答"
                : value === 1
                  ? "1……被轟出門，這題不算分"
                  : `${value} + ${bonus} = ${value + bonus} ${hit ? "≥" : "<"} 擲骰檢定 ${dc}${hit ? " 過了！" : " 沒過"}`
              : warriorEffect(value);
  const chip =
    kind === "mage"
      ? `🔮 ${teamName} 洞悉！擲技能骰`
      : kind === "cleric"
        ? `✝️ ${teamName} 祈禱！擲技能骰`
        : kind === "thief"
          ? `🗡️ ${teamName} 偷襲！擲偷襲骰`
          : kind === "dish"
            ? rejudge
              ? `↩ ${teamName} 改判答對！擲料理骰`
              : `🍳 ${teamName} 答對！擲料理骰`
            : check
              ? `🗣️ ${teamName} 說服：d20 + ${bonus}，擲骰檢定 ${dc}`
              : `⚔️ ${teamName} 衝鋒！${WARRIOR_TARGET} 以上就算答對`;
  const potion = values && values.length > 1 ? values : null;
  return (
    <div data-testid="roll-overlay" data-kind={kind} className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ zIndex: 8, background: "#1b132099" }}>
      <div className="text-[18px]">
        <LabelChip>
          {potion ? `🍀 ${teamName} 幸運骰！擲兩次取高` : chip}
        </LabelChip>
      </div>
      {potion ? (
        <div className="flex gap-6">
          {potion.map((v, i) => (
            <div key={i} data-testid="potion-die" className={landed ? undefined : "px-roll-tumble"}>
              <D20 value={landed ? v : face} size={150} tone={landed ? (v === value ? "kept" : "dim") : undefined} />
            </div>
          ))}
        </div>
      ) : (
        <div className={landed ? undefined : "px-roll-tumble"}>
          <D20 value={landed ? value : face} size={190} />
        </div>
      )}
      <div
        data-testid="roll-result"
        className={`px-bar px-5 text-[26px] ${landed && hit && !plain ? "ok" : ""}`}
        style={{
          visibility: landed ? "visible" : "hidden",
          ...(landed && !hit ? { background: "var(--danger)", color: "#fff" } : {}),
          ...(landed && value === 20 ? { background: "var(--warn)", color: "var(--k)", boxShadow: "inset 0 -6px 0 var(--orange)" } : {}),
        }}
      >
        {potion ? `取高：${value}　${result}` : result}
      </div>
    </div>
  );
}

/** How far apart the kill's four dice land (kill-roll.md: one by one, the total adding up). */
const KILL_STAGGER_MS = 500;

/** The big screen over a boss kill's 4d20 (docs/designs/kill-roll.md): four dice tumble and land one by one while the
 * total adds up. The room judges the kill when its 4 s beat ends, so phones and the podium show the new total only after. */
export function KillRollOverlay({ teamName, values }: { teamName: string; values: number[] }) {
  // Reduced motion: every die shows its value at once. Only drawn from a live STATE, so never on the server.
  const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [landed, setLanded] = useState(() => (still() ? values.length : 0));
  const [faces, setFaces] = useState<number[]>(() => values.map(() => 1));
  useEffect(() => {
    if (still()) return;
    const count = values.length;
    const tick = setInterval(() => setFaces(Array.from({ length: count }, () => tumbleFace())), 80);
    const lands = Array.from({ length: count }, (_, i) => setTimeout(() => setLanded(i + 1), TUMBLE_MS + i * KILL_STAGGER_MS));
    return () => {
      clearInterval(tick);
      lands.forEach(clearTimeout);
    };
    // Every STATE brings a new values array with the same dice: the caller keys this overlay per roll instead.
  }, [values.length]);
  const { chip, result, done } = killRollText(values, landed);
  return (
    <div data-testid="roll-overlay" data-kind="kill" className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ zIndex: 8, background: "#1b132099" }}>
      <div className="text-[18px]">
        <LabelChip>{`💀 ${teamName} ${chip}`}</LabelChip>
      </div>
      <div className="flex gap-6">
        {values.map((v, i) => (
          <div key={i} className={i < landed ? undefined : "px-roll-tumble"} style={i < landed ? undefined : { opacity: 0.55 }}>
            <D20 value={i < landed ? v : faces[i]} size={150} />
          </div>
        ))}
      </div>
      <div
        data-testid="roll-result"
        className="px-bar px-5 text-[26px]"
        style={{ visibility: landed > 0 ? "visible" : "hidden", color: "var(--k)", ...(done ? { background: "var(--warn)", boxShadow: "inset 0 -6px 0 var(--orange)" } : { background: "var(--cream)" }) }}
      >
        {result}
      </div>
    </div>
  );
}

/** The podium's tie-break (docs/designs/podium-reveal.md D4b): the tied teams' d20s tumble in one row, each over its
 * team's name, and land together on the room's values; the bar reads who won or that they roll again. Keyed per roll. */
export function TieRollOverlay({ line, names, values, result }: { line: string; names: string[]; values: number[]; result: string }) {
  const [landed, setLanded] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [faces, setFaces] = useState<number[]>(() => values.map(() => 1));
  useEffect(() => {
    if (landed) return;
    const count = values.length;
    const tick = setInterval(() => setFaces(Array.from({ length: count }, () => tumbleFace())), 80);
    const land = setTimeout(() => {
      clearInterval(tick);
      setLanded(true);
    }, TUMBLE_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(land);
    };
    // The caller keys this overlay per roll, so it tumbles once.
  }, [landed, values.length]);
  const size = values.length <= ROW_NAMES ? 150 : 90;
  return (
    <div data-testid="roll-overlay" data-kind="tie" className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ zIndex: 8, background: "#1b132099" }}>
      <div className="text-[18px]">
        <LabelChip>{`🎲 ${line}`}</LabelChip>
      </div>
      <div className="flex gap-6">
        {values.map((v, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className={landed ? undefined : "px-roll-tumble"}>
              <D20 value={landed ? v : faces[i]} size={size} />
            </div>
            <div className="truncate text-[18px] text-white" style={{ maxWidth: values.length <= ROW_NAMES ? size + 20 : size, textShadow: "2px 2px 0 var(--k)" }}>
              {names[i]}
            </div>
          </div>
        ))}
      </div>
      <div data-testid="roll-result" className="px-bar px-5 text-[26px]" style={{ visibility: landed ? "visible" : "hidden", background: "var(--warn)", color: "var(--k)", boxShadow: "inset 0 -6px 0 var(--orange)" }}>
        {result}
      </div>
    </div>
  );
}

/** A d20 that tumbles once when it mounts, then shows `value`: key it by its value so a new roll tumbles again. */
function TumbleDie({ value, size }: { value: number; size: number }) {
  const [still] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [face, setFace] = useState<number | null>(still ? null : 1);
  useEffect(() => {
    if (still) return;
    const tick = setInterval(() => setFace(tumbleFace()), 80);
    const land = setTimeout(() => {
      clearInterval(tick);
      setFace(null);
    }, TUMBLE_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(land);
    };
  }, [still]);
  return (
    <div className={face === null ? undefined : "px-roll-tumble"}>
      <D20 value={face ?? value} size={size} />
    </div>
  );
}

/** Seconds left of `ms`, counted down from mount: key it by `ms` so each STATE restarts it from the room's figure. */
function Countdown({ ms }: { ms: number }) {
  const [end] = useState(() => Date.now() + ms);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  return <>⏱ {Math.max(0, Math.ceil((end - now) / 1000))}</>;
}

/**
 * 擲先攻 on the big screen (lib/initiative.ts): one d20 per team in a row, grey `?` until its phone rolls. Once the
 * order is set, each tie's reroll holds INITIATIVE_TIE_MS, then the order shows in the bar until the first question.
 */
export function InitiativeOverlay({ ini, teams }: { ini: InitiativeView; teams: { id: string; name: string }[] }) {
  const ties = ini.tieRolls ?? [];
  // A screen that (re)connects mid-hold skips the rerolls already past, by the room's `left`.
  const [beat, setBeat] = useState(() => (ini.order ? Math.max(0, ties.length - Math.ceil(Math.max(0, ini.left - INITIATIVE_ORDER_MS) / INITIATIVE_TIE_MS)) : 0));
  useEffect(() => {
    if (!ini.order || beat >= ties.length) return;
    const t = setTimeout(() => setBeat((b) => b + 1), INITIATIVE_TIE_MS);
    return () => clearTimeout(t);
  }, [ini.order, beat, ties.length]);
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "";
  const tie = ini.order && beat < ties.length ? ties[beat] : null;
  // The order (or a reroll's values) shows once its dice have landed, not while they still tumble (QA 2026-11-19, L9).
  const rollKey = !ini.order ? null : tie ? `tie-${beat}` : "order";
  const [landedKey, setLandedKey] = useState<string | null>(null);
  useEffect(() => {
    if (!rollKey) return;
    const t = setTimeout(() => setLandedKey(rollKey), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : TUMBLE_MS);
    return () => clearTimeout(t);
  }, [rollKey]);
  const landed = rollKey !== null && landedKey === rollKey;
  const ids = tie ? tie.teams : (ini.order ?? teams.map((t) => t.id));
  const value = (id: string, i: number) => (tie ? tie.values[i] : ini.order ? ini.rolls[id] : undefined);
  const size = ids.length <= 4 ? 150 : 90;
  const left = ids.filter((id) => ini.rolls[id] === undefined).length;
  const chip = tie
    ? `🎲 ${tie.teams.map(name).join("、")} 同點，重擲！`
    : ini.order
      ? "🎲 先攻順序"
      : null;
  const result = tie
    ? tie.teams.map((id, i) => `${name(id)} ${tie.values[i]}`).join("、")
    : ini.order
      ? ini.order.map(name).join(" → ")
      : `還有 ${left} 隊沒擲`;
  return (
    <div data-testid="initiative" data-done={ini.order ? true : undefined} className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ zIndex: 8, background: "#1b132099" }}>
      <div className="text-[18px]">
        <LabelChip>{chip ?? <>🎲 擲先攻！用手機按「擲骰」{/* Manual pacing: no countdown, the host rolls for the rest. */}{!ini.untimed && <>　<Countdown key={ini.left} ms={ini.left} /></>}</>}</LabelChip>
      </div>
      <div className="flex gap-6">
        {ids.map((id, i) => {
          const v = value(id, i);
          return (
            <div key={id} className="flex flex-col items-center gap-2" style={ini.rolls[id] === undefined ? { opacity: 0.45 } : undefined}>
              {v === undefined ? <D20 value="?" size={size} /> : <TumbleDie key={tie ? `t${beat}-${v}` : v} value={v} size={size} />}
              <div className="truncate text-[18px] text-white" style={{ maxWidth: size + 20, textShadow: "2px 2px 0 var(--k)" }}>
                {name(id)}
              </div>
            </div>
          );
        })}
      </div>
      <div
        data-testid="initiative-result"
        className="px-bar px-5 text-[26px]"
        style={{ ...(ini.order ? { background: "var(--warn)", color: "var(--k)", boxShadow: "inset 0 -6px 0 var(--orange)" } : { background: "var(--cream)", color: "var(--k)" }), visibility: ini.order && !landed ? "hidden" : undefined }}
      >
        {result}
      </div>
    </div>
  );
}
