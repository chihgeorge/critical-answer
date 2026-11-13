// 記憶題's words on the big screen and the phones (docs/designs/memory-questions.md): what to do while the question
// is hidden, by media kind. Pure, so both pages say the same thing and a test can pin it.

import type { MediaCommand, PublicQuestion } from "./protocol";

/** An image, a sound-only clip, or a video. */
const kindOf = (q: PublicQuestion): "image" | "audio" | "video" =>
  q.content.kind === "image" ? "image" : q.content.kind === "youtube" && q.content.audioOnly ? "audio" : "video";

/** The big screen's line in the question's slot. `team`: the turn's team (none in a buzzer phase). `media`: the host's
 * last ▶ ⏸ ⟲; a clip with none for this question is still waiting for the host. */
export function memoryLine(q: PublicQuestion, team: string | undefined, media: MediaCommand | undefined): string {
  const who = team ? `🧠 ${team}的記憶題：` : "🧠 記憶題：";
  const kind = kindOf(q);
  if (kind === "image") return `${who}記住這張圖！`;
  if (media?.questionId !== q.id) return `${who}等主持人播放…`;
  return `${who}${kind === "audio" ? "仔細聽" : "看仔細"}，播完才出題`;
}

/** The phone's hint: where to look (or listen) while the question is hidden. */
export const memoryPhoneHint = (q: PublicQuestion): string => (kindOf(q) === "audio" ? "👂 仔細聽大螢幕" : "👀 看大螢幕");
