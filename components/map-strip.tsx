"use client";

// The big screen's live map strip (docs/designs/live-map.md): rooms, team pawns, fog of war and the
// boss room, in the row the team cards used to take. Geometry comes from lib/map-layout.ts.

import { useEffect, useRef, useState } from "react";
import type { SpectatorView } from "@/lib/game-state";
import { layoutMap, nameTags, PAWN, BOSS_SPRITE, CORRIDOR, DOOR_W, type Pawn } from "@/lib/map-layout";
import { LabelChip, Sprite } from "@/components/pixel";

const ROOM_STYLE = { background: "#7a6496", boxShadow: "inset 0 -5px 0 #5d4a79, inset 0 4px 0 #9a84b8" };
const BOSS_STYLE = { background: "#8a2d45", boxShadow: "inset 0 -6px 0 #6a1f34, inset 0 4px 0 #b04560" };
const ROOM_BOX = { top: 18, h: 58 };
const BOSS_BOX = { top: 10, h: 72 };

export function MapStrip({ view }: { view: SpectatorView }) {
  const ref = useRef<HTMLDivElement>(null);
  const [budget, setBudget] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBudget(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const map = layoutMap(view.teams, budget);
  const tags = nameTags(view.teams.map((t) => t.name));
  const byId = new Map(view.teams.map((t, i) => [t.id, { t, i }]));
  // The key changes when a team moves, so its pawn remounts and plays its arrival (D13): a hop in,
  // or a vanish-then-appear into the boss room, plus one outline flash on the room it lands in. The
  // places teams already held when the strip mounted (a reload, a reconnect) do not replay it.
  const placeKey = (t: SpectatorView["teams"][number]) => `${t.id}:${t.inBossPhase ? "boss" : t.roomIndex}`;
  const [mounted] = useState(() => new Set(view.teams.map(placeKey)));

  const pawn = (p: Pawn, top: number, box: { x: number; w: number; top: number; h: number }) => {
    const { t, i } = byId.get(p.teamId)!;
    const turn = t.id === view.currentTurnTeamId;
    const key = placeKey(t);
    const arrived = !mounted.has(key);
    return (
      <div key={key} role="img" aria-label={`${t.name}${turn ? "（輪到）" : ""}${t.online ? "" : "（離線）"}`} className="absolute" style={{ left: p.x, top, width: PAWN }}>
        {arrived && <div className="px-room-flash pointer-events-none absolute" style={{ left: box.x - p.x, top: box.top - top, width: box.w, height: box.h }} />}
        <div className={arrived ? (t.inBossPhase ? "px-charge" : "px-hop-in") : ""}>
        {turn && (
          <span className="px-hop absolute text-[14px]" style={{ left: 7, top: -26, color: "var(--danger)", textShadow: "2px 2px 0 var(--k)" }}>
            ▼
          </span>
        )}
        <div className="flex justify-center">
          <LabelChip tone="tag">{tags[i]}</LabelChip>
        </div>
        <div className={`relative mx-auto w-[24px] ${turn ? "px-turn" : ""}`} style={{ opacity: t.online ? 1 : 0.5 }}>
          <Sprite kind="hero" variant={i} scale={1} />
        </div>
        {!t.online && <Sprite kind="zz" scale={1} className="absolute" style={{ right: -4, top: 16 }} />}
        </div>
      </div>
    );
  };

  const room = (x: number, w: number, label: string) => (
    <div key={`room-${label}`} className="absolute border-4" style={{ ...ROOM_STYLE, left: x, width: w, top: ROOM_BOX.top, height: ROOM_BOX.h, borderColor: "var(--k)" }}>
      <span className="px-num absolute text-[8px]" style={{ right: 2, top: 1, color: "var(--cream)" }} /* right corner: the turn ▼ sits top-left */>
        {label}
      </span>
    </div>
  );
  const corridor = (x: number) => <div key={`cor-${x}`} className="absolute border-y-4" style={{ left: x, width: CORRIDOR, top: 40, height: 14, background: "#5d4a79", borderColor: "var(--k)" }} />;

  const fill = Math.max(1, Math.floor(map.fog.w / 30));
  const clouds = map.boss.open ? Math.max(1, Math.floor(fill / 2)) : fill; // D16: the fog thins once the door opens
  return (
    <div ref={ref} data-testid="map-strip" className="relative min-w-0 flex-1" style={{ height: 82, marginTop: -16 }}>
      {budget > 0 && (
        <>
          {map.stub && [room(map.stub.x, map.stub.w, "…"), corridor(map.stub.x + map.stub.w)]}
          {map.rooms.map((r) => [room(r.x, r.w, String(r.index + 1)), corridor(r.x + r.w)])}
          <div className="absolute" style={{ left: map.fog.x, width: map.fog.w, top: 14, height: 66 }}>
            {Array.from({ length: clouds }, (_, k) => (
              <Sprite key={k} kind="cloud" scale={2} className={`absolute ${k % 2 ? "px-drift2" : "px-drift"}`} style={{ left: Math.round((k * (map.fog.w - 36)) / Math.max(1, clouds - 1)), top: k % 2 ? 30 : 4 }} />
            ))}
          </div>
          {map.boss.open ? (
            <div key="boss-open" data-testid="boss-room" className="absolute border-4" style={{ ...BOSS_STYLE, left: map.boss.x, width: map.boss.w, top: BOSS_BOX.top, height: BOSS_BOX.h, borderColor: "var(--k)" }}>
              <Sprite kind="slime-king" scale={1} className="absolute" style={{ left: 6, top: 22 }} />
              <div className="absolute border-[3px]" style={{ left: BOSS_SPRITE - 4, right: 4, top: 2, height: 10, background: "#4a1a28", borderColor: "var(--k)" }}>
                <div style={{ width: `${(100 * view.bossHp) / view.bossMaxHp}%`, height: "100%", background: "var(--danger)" }} />
              </div>
            </div>
          ) : (
            <Sprite kind="door" scale={2} className="absolute" style={{ left: map.boss.x + (DOOR_W - 40) / 2, top: 26 }} />
          )}
          {/* One array, so a pawn whose room folds into the stub keeps its element and replays nothing. */}
          {[
            ...(map.stub?.pawns.map((p) => pawn(p, 34, { ...map.stub!, ...ROOM_BOX })) ?? []),
            ...map.rooms.flatMap((r) => r.pawns.map((p) => pawn(p, 34, { ...r, ...ROOM_BOX }))),
            ...map.boss.pawns.map((p) => pawn(p, 28, { ...map.boss, ...BOSS_BOX })),
          ]}
        </>
      )}
    </div>
  );
}
