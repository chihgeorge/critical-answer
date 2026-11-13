import { describe, expect, it } from "vitest";
import { memoryLine, memoryPhoneHint } from "./memory-copy";
import type { PublicQuestion } from "./protocol";

const base = { id: "m1", difficulty: 1, boss: false, monster: { name: "史萊姆", sprite: "slime" as never, hue: 0 }, memorize: true as const };
const image: PublicQuestion = { ...base, content: { kind: "image", url: "u" } };
const video: PublicQuestion = { ...base, content: { kind: "youtube" } };
const audio: PublicQuestion = { ...base, content: { kind: "youtube", audioOnly: true } };
const playing = { questionId: "m1", state: "playing" as const, seq: 0, press: 1 };

describe("記憶題 copy (memory-questions.md)", () => {
  it("says what to do by media kind, waits for the host's ▶ on a clip, and names the turn's team", () => {
    expect(memoryLine(image, "藍隊", undefined)).toBe("🧠 藍隊的記憶題：記住這張圖！");
    expect(memoryLine(video, "藍隊", undefined)).toBe("🧠 藍隊的記憶題：等主持人播放…");
    expect(memoryLine(video, "藍隊", playing)).toBe("🧠 藍隊的記憶題：看仔細，播完才出題");
    expect(memoryLine(audio, undefined, playing)).toBe("🧠 記憶題：仔細聽，播完才出題");
    expect(memoryLine(video, undefined, { ...playing, questionId: "other" })).toBe("🧠 記憶題：等主持人播放…");
    expect(memoryPhoneHint(audio)).toBe("👂 仔細聽大螢幕");
    expect(memoryPhoneHint(image)).toBe("👀 看大螢幕");
  });
});
