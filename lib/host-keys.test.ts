import { describe, expect, it } from "vitest";
import { hostKeyAction } from "./host-keys";

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
});
