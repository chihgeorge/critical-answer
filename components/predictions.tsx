"use client";

// 群眾預測 (docs/designs/crowd-prediction.md): the result's 6 s, shared by the phones and the big screen.

import { useEffect, useState } from "react";
import { PREDICT_SHOW_MS, type StateMessage } from "@/lib/protocol";

/** STATE's `predicted` for PREDICT_SHOW_MS after this page first saw its eventId, then null; null at once when
 * `eventId` (STATE's) has moved past it, so a reload on a later question never shows an old result.
 * shortcut: timed from first sight, so a reload inside the same eventId shows it again; fine for a 6 s strip. */
export function useFreshPrediction(predicted: StateMessage["predicted"], eventId: number): StateMessage["predicted"] | null {
  const id = predicted?.eventId ?? null;
  const [over, setOver] = useState<number | null>(null);
  useEffect(() => {
    if (id === null) return;
    const t = setTimeout(() => setOver(id), PREDICT_SHOW_MS);
    return () => clearTimeout(t);
  }, [id]);
  return predicted && over !== id && id === eventId ? predicted : null;
}
