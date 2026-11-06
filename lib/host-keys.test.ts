import { describe, expect, it } from "vitest";
import { clericStage, hostKeyAction, introKeyAction } from "./host-keys";

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

  // Value: protects=the host can reveal a waiting lock from the keyboard, and 1 still does nothing once the beat runs
  // or with no lock (host-reveal.md D6).
  it("1 is 公布答案 while a lock waits, and nothing otherwise on a multipleChoice turn", () => {
    expect(hostKeyAction({ key: "1" }, false, { stuck: false }, undefined, true)).toBe("reveal");
    expect(hostKeyAction({ key: "1" }, false, undefined, undefined, true)).toBe("reveal"); // a lock whose turn moved on
    expect(hostKeyAction({ key: "1" }, false, { stuck: false }, undefined, false)).toBeNull(); // the beat runs
    expect(hostKeyAction({ key: "2" }, false, { stuck: false }, undefined, true)).toBeNull();
    expect(hostKeyAction({ key: "1" }, true, { stuck: false }, undefined, true)).toBe("next"); // the answer is on show
    expect(hostKeyAction({ key: "1", ctrlKey: true }, false, { stuck: false }, undefined, true)).toBeNull();
  });

  // Value: protects=a cleric's fill-in turn gets one 答錯 key, then 祈禱 / 重答 / 逃跑 on 2 / 3 / 4, and a team that may not
  // pray keeps the two keys; fails_when=the host's 2 settles a cleric's answer the team should
  // choose, or a non-praying team's view hides 答錯・逃跑; seam=none; no_claim=the buttons' layout
  it("a cleric's fill-in: one 答錯 key, then 祈禱 / 重答 / 逃跑; a team that may not pray keeps the two keys (#106)", () => {
    const team = (mayPray?: true) => ({ id: "T0", ...(mayPray ? { mayPray } : {}) }) as never;
    expect(clericStage({ teams: [team(true)], pendingWrong: null }, "T0")).toBe("before");
    expect(clericStage({ teams: [team()], pendingWrong: null }, "T0")).toBeUndefined(); // no mayPray
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

describe("introKeyAction", () => {
  it("→ and Enter turn forward, ← back, anything else does nothing", () => {
    expect(introKeyAction({ key: "ArrowRight" })).toBe("next");
    expect(introKeyAction({ key: "Enter" })).toBe("next");
    expect(introKeyAction({ key: "ArrowLeft" })).toBe("prev");
    expect(introKeyAction({ key: "1" })).toBeNull();
  });

  it("leaves a held key, a modifier and a text field alone", () => {
    expect(introKeyAction({ key: "ArrowRight", repeat: true })).toBeNull();
    expect(introKeyAction({ key: "ArrowLeft", altKey: true })).toBeNull();
    expect(introKeyAction({ key: "Enter", target: { tagName: "input" } })).toBeNull();
    expect(introKeyAction({ key: "Enter", target: { tagName: "div", isContentEditable: true } })).toBeNull();
  });

  it("leaves Enter on a focused button to the button itself, but the arrows still turn", () => {
    expect(introKeyAction({ key: "Enter", target: { tagName: "BUTTON" } })).toBeNull();
    expect(introKeyAction({ key: "ArrowRight", target: { tagName: "BUTTON" } })).toBe("next");
  });
});
