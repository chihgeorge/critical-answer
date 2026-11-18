"use client";

import type { ClientMessage, StateMessage } from "@/lib/protocol";
import { PixelButton } from "@/components/pixel";

type Types = NonNullable<StateMessage["buzzTypes"]>;

/** The type buttons (#321), host-only since #370: a used-up type is greyed and cannot be pressed; the chosen one is green. */
function TypeButtons({ types, chosen, disabled, onPick }: { types: Types; chosen?: string; disabled?: boolean; onPick: (type: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {types.map((t) => (
        <PixelButton
          key={t.type}
          aria-pressed={t.type === chosen}
          disabled={disabled || !t.left}
          title={t.left ? undefined : "這個題型的題目用完了"}
          className="!m-0 min-h-[40px] !px-3 text-[15px] [overflow-wrap:anywhere]"
          // A used-up type uses DESIGN.md's faded-tile tokens, drawn, not :disabled opacity (as the cooling reaction buttons).
          style={t.left ? { background: t.type === chosen ? "var(--ok)" : "var(--cream)" } : { background: "var(--cream2)", color: "var(--dim-ink)", textDecoration: "line-through", opacity: 1, boxShadow: "0 -4px 0 0 var(--dim-line), 0 4px 0 0 var(--dim-line), -4px 0 0 0 var(--dim-line), 4px 0 0 0 var(--dim-line)" }}
          onClick={() => onPick(t.type)}
        >
          {t.type}
        </PixelButton>
      ))}
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
      ? buzz.category
        ? `${teamName(buzz.picker)} 選的類別：${buzz.category}`
        : game.buzzCategories
          ? `${teamName(buzz.picker)} 正在手機上選下一題的類別…`
          : "下一題的題型"
      : "下一題的題型";
  return (
    <div data-testid="host-buzz-type" className="mt-2 flex flex-col gap-1">
      <div className="text-[15px]">{status}</div>
      <TypeButtons types={game.buzzTypes} chosen={buzz.qtype} disabled={!ready} onPick={(qtype) => send({ type: "HOST_BUZZ_PICK", qtype })} />
      <PixelButton className="!m-0 min-h-[40px] text-[15px]" disabled={!ready} onClick={onQuestion}>
        指定題目
      </PixelButton>
      {/* #370: the next question waits for the winner's category; 下一步 plays the dealt one now. */}
      {game.pickHold && (
        <PixelButton data-testid="host-buzz-next" className="!m-0 min-h-[44px] text-[16px]" style={{ background: "var(--turn)" }} disabled={!ready} onClick={() => send({ type: "HOST_BUZZ_PICK", questionId: buzz.questionId })}>
          ▶ 下一步（不等隊伍，照順序出題）
        </PixelButton>
      )}
      <div className="text-[12px]">按題型、指定題目或下一步，就換成你選的，隊伍不能再改。</div>
    </div>
  );
}
