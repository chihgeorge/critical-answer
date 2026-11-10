import { CLASS_ICONS, CLASS_LABELS } from "@/lib/game-state";
import type { ClientMessage, StateMessage } from "@/lib/protocol";
import { Panel, PixelButton } from "@/components/pixel";

/** The host page's rows for teams that joined after the start (docs/designs/late-join.md): 收這隊 lets one in at room 1,
 * last in turn; 不收 turns it away. Once the boss fight has begun (`late.closed`) only 不收 is left. */
export function LateTeams({ late, disabled, send }: { late: NonNullable<StateMessage["late"]>; disabled: boolean; send: (m: ClientMessage) => void }) {
  return (
    <ul data-testid="late-teams" aria-label="等待加入的隊伍" className="flex flex-col gap-2">
      {late.teams.map((t) => (
        <Panel key={t.id} tone="lav" className="flex flex-wrap items-center gap-2 px-3 py-1">
          {/* Only the name is cut short: the status says why 收這隊 is there or gone. */}
          <div className="flex min-w-0 flex-1 basis-full flex-wrap items-baseline gap-x-2 text-[15px] md:basis-0">
            <span className="min-w-0 truncate">
              🚪 {t.name}
              {t.classId ? ` ${CLASS_ICONS[t.classId]}${CLASS_LABELS[t.classId]}` : ""}
            </span>
            <span className="text-[13px]">{late.closed ? "首領戰開始了，等下一場" : "想中途加入"}</span>
          </div>
          {!late.closed && (
            <PixelButton variant="ok" className="!m-0 min-h-[44px] !px-3 !py-0 text-[14px]" disabled={disabled} onClick={() => send({ type: "HOST_LATE_TEAM", teamId: t.id, admit: true })}>
              收這隊
            </PixelButton>
          )}
          <PixelButton className="!m-0 min-h-[44px] !px-3 !py-0 text-[14px]" disabled={disabled} onClick={() => send({ type: "HOST_LATE_TEAM", teamId: t.id, admit: false })}>
            不收
          </PixelButton>
        </Panel>
      ))}
    </ul>
  );
}
