"use client";

import type { ClientMessage, StateMessage } from "@/lib/protocol";
import { Panel, PixelButton } from "@/components/pixel";

type Types = NonNullable<StateMessage["buzzTypes"]>;

/** The type buttons (#321): a used-up type is greyed and cannot be pressed; the chosen one is green. */
function TypeButtons({ types, chosen, disabled, big, onPick }: { types: Types; chosen?: string; disabled?: boolean; big?: boolean; onPick: (type: string) => void }) {
  return (
    <div className={big ? "grid grid-cols-2 gap-2" : "flex flex-wrap gap-1"}>
      {types.map((t) => (
        <PixelButton
          key={t.type}
          aria-pressed={t.type === chosen}
          disabled={disabled || !t.left}
          title={t.left ? undefined : "這個題型的題目用完了"}
          className={`!m-0 ${big ? "!min-h-[56px] !text-[20px]" : "min-h-[40px] !px-3 text-[15px]"} [overflow-wrap:anywhere]`}
          // A used-up type uses DESIGN.md's faded-tile tokens.
          style={t.left ? { background: t.type === chosen ? "var(--ok)" : "var(--cream)" } : { background: "var(--cream2)", color: "var(--dim-ink)", textDecoration: "line-through" }}
          onClick={() => onPick(t.type)}
        >
          {t.type}
        </PixelButton>
      ))}
    </div>
  );
}

/** The buzz winner's phone: pick the next question's type, and change it until the host's ▶ or the host's own pick. */
export function TypePickPanel({ types, chosen, send }: { types: Types; chosen?: string; send: (m: ClientMessage) => void }) {
  return (
    <div data-testid="pick-type">
      <Panel tone="turn" className="flex flex-col gap-2 px-[10px] py-[10px]">
        <div className="text-[20px]">答對了！選下一題的題型</div>
        <TypeButtons types={types} chosen={chosen} big onPick={(qtype) => send({ type: "TEAM_PICK_TYPE", qtype })} />
        <div className="text-[13px]">{chosen ? `已選：${chosen}・主持人出題前都能改` : "沒有時間限制；不選就照順序出下一題"}</div>
      </Panel>
    </div>
  );
}

/** The host page: who picks, what was picked, and the host's own pick by type or by question (#321). */
export function BuzzTypePick({ game, ready, teamName, send, onQuestion }: { game: StateMessage; ready: boolean; teamName: (id: string) => string; send: (m: ClientMessage) => void; onQuestion: () => void }) {
  const buzz = game.view.buzz;
  if (!game.buzzTypes || !buzz) return null;
  const status = buzz.hostPicked
    ? `你指定了下一題${buzz.qtype ? `：${buzz.qtype}` : ""}`
    : buzz.picker
      ? buzz.qtype
        ? `${teamName(buzz.picker)} 選的題型：${buzz.qtype}`
        : `${teamName(buzz.picker)} 正在手機上選下一題的題型…`
      : "下一題的題型";
  return (
    <div data-testid="host-buzz-type" className="mt-2 flex flex-col gap-1">
      <div className="text-[15px]">{status}</div>
      <TypeButtons types={game.buzzTypes} chosen={buzz.qtype} disabled={!ready} onPick={(qtype) => send({ type: "HOST_BUZZ_PICK", qtype })} />
      <PixelButton className="!m-0 min-h-[40px] text-[15px]" disabled={!ready} onClick={onQuestion}>
        指定題目
      </PixelButton>
      <div className="text-[12px]">按題型或指定題目，就換成你選的，隊伍不能再改。</div>
    </div>
  );
}
