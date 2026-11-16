// STATE.hostAway's one line (host-offline banner): the host page dropped, so nothing moves until it is back. The big
// screen gets a strip like its own 連線中斷 one, the phone a small panel in the same spot. No timer stops.

import { Panel } from "@/components/pixel";

export const HOST_AWAY_NOTICE = "⏳ 主持人重新連線中…請稍候";

export function HostAwayBanner({ screen = false }: { screen?: boolean }) {
  return screen ? (
    <div role="status" data-testid="host-away" className="text-center text-[20px]" style={{ background: "var(--turn)", color: "var(--ink)", padding: 6 }}>
      {HOST_AWAY_NOTICE}
    </div>
  ) : (
    <Panel tone="turn" role="status"className="px-3 py-2 text-center text-[16px]">
      {HOST_AWAY_NOTICE}
    </Panel>
  );
}
