import { describe, expect, it } from "vitest";
import { clericStage, hostKeyAction } from "./host-keys";

describe("hostKeyAction", () => {
  it("maps 1/2/3 to the three judge buttons", () => {
    expect(hostKeyAction({ key: "1" }, false)).toBe("correct");
    expect(hostKeyAction({ key: "2" }, false)).toBe("retry");
    expect(hostKeyAction({ key: "3" }, false)).toBe("flee");
    expect(hostKeyAction({ key: "4" }, false)).toBeNull();
    expect(hostKeyAction({ key: "Enter" }, false)).toBeNull(); // Enter must not mark an answer correct
  });

  it("while the answer is on show, 1 or Enter press 下一題 and 2/3 do nothing", () => {
    expect(hostKeyAction({ key: "1" }, true)).toBe("next");
    expect(hostKeyAction({ key: "Enter" }, true)).toBe("next");
    expect(hostKeyAction({ key: "2" }, true)).toBeNull();
    expect(hostKeyAction({ key: "3" }, true)).toBeNull();
  });

  it("leaves modified, held-down and typed-in-a-field keys to the browser", () => {
    expect(hostKeyAction({ key: "1", ctrlKey: true }, false)).toBeNull(); // Ctrl+1 switches tabs
    expect(hostKeyAction({ key: "1", metaKey: true }, false)).toBeNull();
    expect(hostKeyAction({ key: "1", altKey: true }, false)).toBeNull();
    expect(hostKeyAction({ key: "1", repeat: true }, false)).toBeNull();
    expect(hostKeyAction({ key: "1", target: { tagName: "textarea" } }, false)).toBeNull(); // the notes box
    expect(hostKeyAction({ key: "1", target: { tagName: "INPUT" } }, false)).toBeNull();
    expect(hostKeyAction({ key: "1", target: { tagName: "DIV", isContentEditable: true } }, false)).toBeNull();
    expect(hostKeyAction({ key: "1", target: { tagName: "BUTTON" } }, false)).toBe("correct");
  });

  it("on a multipleChoice turn, 1 does nothing and 2/3 wait for the stuck row (phone-answering.md D13)", () => {
    expect(hostKeyAction({ key: "1" }, false, { stuck: false })).toBeNull();
    expect(hostKeyAction({ key: "2" }, false, { stuck: false })).toBeNull();
    expect(hostKeyAction({ key: "3" }, false, { stuck: false })).toBeNull();
    expect(hostKeyAction({ key: "1" }, false, { stuck: true })).toBeNull(); // the lock judges it, never the host
    expect(hostKeyAction({ key: "2" }, false, { stuck: true })).toBe("retry");
    expect(hostKeyAction({ key: "3" }, false, { stuck: true })).toBe("flee");
  });

  // Value: protects=a cleric's fill-in turn gets one 答錯 key, then 祈禱 / 重答 / 逃跑 on 2 / 3 / 4, and a view from a Worker
  // before #106 keeps the old two keys (split deploy); fails_when=the host's 2 settles a cleric's answer the team should
  // choose, or an old Worker's view hides 答錯・逃跑; seam=none; no_claim=the buttons' layout
  it("a cleric's fill-in: one 答錯 key, then 祈禱 / 重答 / 逃跑; an old view keeps the two keys (#106)", () => {
    const team = (mayPray?: true) => ({ id: "T0", ...(mayPray ? { mayPray } : {}) }) as never;
    expect(clericStage({ teams: [team(true)], pendingWrong: null }, "T0")).toBe("before");
    expect(clericStage({ teams: [team()], pendingWrong: null }, "T0")).toBeUndefined(); // no mayPray: an old Worker
    expect(clericStage({ teams: [team()], pendingWrong: { teamId: "T0", questionId: "q", optionIndex: null } }, "T0")).toBe("wait");
    expect(clericStage({ teams: [team()], pendingWrong: { teamId: "T0", questionId: "q", optionIndex: 1 } }, "T0")).toBeUndefined();
    expect(hostKeyAction({ key: "1" }, false, undefined, "before")).toBe("correct");
    expect(hostKeyAction({ key: "2" }, false, undefined, "before")).toBe("wrong");
    expect(hostKeyAction({ key: "3" }, false, undefined, "before")).toBeNull();
    expect(hostKeyAction({ key: "1" }, false, undefined, "wait")).toBeNull();
    expect(hostKeyAction({ key: "2" }, false, undefined, "wait")).toBe("pray");
    expect(hostKeyAction({ key: "3" }, false, undefined, "wait")).toBe("retry");
    expect(hostKeyAction({ key: "4" }, false, undefined, "wait")).toBe("flee");
    expect(hostKeyAction({ key: "4" }, false)).toBeNull();
  });
});
