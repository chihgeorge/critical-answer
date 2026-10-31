"use client";

import { useEffect } from "react";
import { Panel, PixelButton } from "./pixel";
import { reportClientError } from "@/lib/report-client-error";

export const ERROR_TITLE = "畫面出錯了";
export const ERROR_HINT = "按「重新載入」就能回到遊戲，分數和進度都還在。";
export const ERROR_RELOAD_LABEL = "重新載入";

/** What app/error.tsx and app/global-error.tsx show instead of a blank page. A full reload, not
 * Next's retry(): the usual cause is a client that no longer matches the server (an old page after
 * a deploy), and only a fresh page fixes that. The room keeps the game, so nothing is lost. */
export function ErrorScreen({ error }: { error: unknown }) {
  useEffect(() => reportClientError(error), [error]);
  return (
    <main className="flex min-h-screen items-center justify-center p-4" style={{ background: "var(--stage)" }}>
      <Panel className="flex w-full max-w-[480px] flex-col items-center gap-4 p-6 text-center" role="alert">
        <div className="text-[26px]">{ERROR_TITLE}</div>
        <div className="text-[17px]">{ERROR_HINT}</div>
        <PixelButton variant="ok" onClick={() => location.reload()} className="!m-0 min-h-[44px] !px-6 text-[20px]">
          {ERROR_RELOAD_LABEL}
        </PixelButton>
      </Panel>
    </main>
  );
}
