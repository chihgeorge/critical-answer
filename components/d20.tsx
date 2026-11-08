"use client";

import { useEffect, useState } from "react";
import { WARRIOR_TARGET } from "@/lib/game-state";
import { LabelChip } from "@/components/pixel";
import { killRollText } from "@/lib/kill-roll";
import { INITIATIVE_TIE_MS, type InitiativeView } from "@/lib/initiative";

/** A pixel-outlined d20 face: the hexagon with its front triangle, `value` in the middle. */
export function D20({ value, size }: { value: number | string; size: number }) {
  const edge = { stroke: "var(--k)", strokeWidth: 3 };
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={{ display: "block", filter: "drop-shadow(0 6px 0 var(--k))" }}>
      <polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill="#ffa94d" stroke="var(--k)" strokeWidth={5} />
      <polygon points="50,18 84,74 16,74" fill="#ffd9a3" {...edge} />
      {["50,3 50,18", "7,27 50,18", "93,27 50,18", "16,74 7,73", "84,74 93,73", "16,74 50,97", "84,74 50,97"].map((l) => {
        const [a, b] = l.split(" ").map((p) => p.split(",").map(Number));
        return <line key={l} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} {...edge} />;
      })}
      <text x="50" y="62" textAnchor="middle" fontFamily="'Press Start 2P', monospace" fontSize="20" fill="var(--k)">
        {value}
      </text>
    </svg>
  );
}

/** How long the die tumbles before it lands; the room judges at 2000 ms (BEAT_MS), so the result stays up a moment. */
const TUMBLE_MS = 1200;

/** The big screen's 2 s over a roll (class-abilities.md D12=A): the scene dims, a big d20 tumbles and lands on the
 * room's `value`. `kind`: a warrior's roll for the answer (12+ hits), or the crit die after a correct answer (20 is a
 * critical hit, 1 a fumble, still a hit). Keyed by the caller per roll, so every roll tumbles again. */
export function RollOverlay({ teamName, value, kind = "warrior", critable = false, bonus = 0, dc = 0 }: { teamName: string; value: number; kind?: "warrior" | "crit" | "check"; critable?: boolean; bonus?: number; dc?: number }) {
  const [face, setFace] = useState<number | null>(null);
  useEffect(() => {
    // Reduced motion: no face flicker either (the CSS tumble already stops), the die shows its value at once.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tick = setInterval(() => setFace(1 + Math.floor(Math.random() * 20)), 80);
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
  const crit = kind === "crit";
  const check = kind === "check";
  // A persuasion check (dnd design R6): die + class bonus against the monster's DC; a 20 wins outright, a 1 halves.
  const hit = check ? value === 20 || (value !== 1 && value + bonus >= dc) : crit ? value !== 1 : value >= WARRIOR_TARGET;
  const result = check
    ? value === 20
      ? "20！說服成功，免答"
      : value === 1
        ? "1……說服失敗，答對只拿一半"
        : `${value} + ${bonus} = ${value + bonus} ${hit ? "≥" : "<"} DC ${dc}${hit ? " 過了！" : " 沒過"}`
    : crit
    ? value === 20
      ? "20 大成功！多拿一半"
      : value === 1
        ? "1 大失敗……還是打中了"
        : `${value}，答對！`
    : critable && value === 20 // a warrior's 20 on a multipleChoice question is a crit too (game-state warriorRoll)
      ? "20 大成功！命中，多拿一半"
      : hit
        ? `${value} ≥ ${WARRIOR_TARGET} 命中！`
        : `${value}，差一點……`;
  return (
    <div data-testid="roll-overlay" data-kind={kind} className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ zIndex: 8, background: "#1b132099" }}>
      <div className="text-[18px]">
        <LabelChip>
          {check ? `🗣️ ${teamName} 說服檢定：d20 + ${bonus}，DC ${dc}` : crit ? `✨ ${teamName} 答對！擲暴擊骰，20 是大成功` : `⚔️ ${teamName} 擲骰！${WARRIOR_TARGET} 以上就贏`}
        </LabelChip>
      </div>
      <div className={landed ? undefined : "px-roll-tumble"}>
        <D20 value={landed ? value : face} size={190} />
      </div>
      <div
        data-testid="roll-result"
        className={`px-bar text-[26px] ${landed && hit ? "ok" : ""}`}
        style={{
          visibility: landed ? "visible" : "hidden",
          ...(landed && !hit ? { background: "var(--danger)", color: "#fff" } : {}),
          ...(landed && (crit || check || critable) && value === 20 ? { background: "var(--warn)", color: "var(--k)", boxShadow: "inset 0 -6px 0 var(--orange)" } : {}),
        }}
      >
        {result}
      </div>
    </div>
  );
}

/** How far apart the kill's four dice land (kill-roll.md: one by one, the total adding up). */
const KILL_STAGGER_MS = 500;

/** The big screen over a boss kill's 4d20 (docs/designs/kill-roll.md): four dice tumble and land one by one while the
 * total adds up. The room judges the kill when its 4 s beat ends, so phones and the podium show the new total only after. */
export function KillRollOverlay({ teamName, values, value }: { teamName: string; values: number[]; value: number }) {
  // Reduced motion: every die shows its value at once. Only drawn from a live STATE, so never on the server.
  const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [landed, setLanded] = useState(() => (still() ? values.length : 0));
  const [faces, setFaces] = useState<number[]>(() => values.map(() => 1));
  useEffect(() => {
    if (still()) return;
    const count = values.length;
    const tick = setInterval(() => setFaces(Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 20))), 80);
    const lands = Array.from({ length: count }, (_, i) => setTimeout(() => setLanded(i + 1), TUMBLE_MS + i * KILL_STAGGER_MS));
    return () => {
      clearInterval(tick);
      lands.forEach(clearTimeout);
    };
    // Every STATE brings a new values array with the same dice: the caller keys this overlay per roll instead.
  }, [values.length]);
  const { chip, result, done } = killRollText(values, value, landed);
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
        className="px-bar text-[26px]"
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
    const tick = setInterval(() => setFaces(Array.from({ length: count }, () => 1 + Math.floor(Math.random() * 20))), 80);
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
  const size = values.length <= 4 ? 150 : 90;
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
            <div className="truncate text-[18px] text-white" style={{ maxWidth: size + 20, textShadow: "2px 2px 0 var(--k)" }}>
              {names[i]}
            </div>
          </div>
        ))}
      </div>
      <div data-testid="roll-result" className="px-bar text-[26px]" style={{ visibility: landed ? "visible" : "hidden", background: "var(--warn)", color: "var(--k)", boxShadow: "inset 0 -6px 0 var(--orange)" }}>
        {result}
      </div>
    </div>
  );
}

/** A d20 that tumbles once when it mounts, then shows `value`: key it by its value so a new roll tumbles again. */
function TumbleDie({ value, size }: { value: number; size: number }) {
  const [face, setFace] = useState<number | null>(() => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? null : 1));
  useEffect(() => {
    if (face === null) return;
    const tick = setInterval(() => setFace(1 + Math.floor(Math.random() * 20)), 80);
    const land = setTimeout(() => {
      clearInterval(tick);
      setFace(null);
    }, TUMBLE_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(land);
    };
    // Tumbles once, from mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (!ini.order || beat >= ties.length) return;
    const t = setTimeout(() => setBeat((b) => b + 1), INITIATIVE_TIE_MS);
    return () => clearTimeout(t);
  }, [ini.order, beat, ties.length]);
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? "";
  const tie = ini.order && beat < ties.length ? ties[beat] : null;
  const ids = tie ? tie.teams : (ini.order ?? teams.map((t) => t.id));
  const value = (id: string, i: number) => (tie ? tie.values[i] : ini.rolls[id]);
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
        <LabelChip>{chip ?? <>🎲 擲先攻！用手機按「擲骰」　<Countdown key={ini.left} ms={ini.left} /></>}</LabelChip>
      </div>
      <div className="flex gap-6">
        {ids.map((id, i) => {
          const v = value(id, i);
          return (
            <div key={id} className="flex flex-col items-center gap-2" style={v === undefined ? { opacity: 0.45 } : undefined}>
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
        className="px-bar text-[26px]"
        style={ini.order ? { background: "var(--warn)", color: "var(--k)", boxShadow: "inset 0 -6px 0 var(--orange)" } : { background: "var(--cream)", color: "var(--k)" }}
      >
        {result}
      </div>
    </div>
  );
}
