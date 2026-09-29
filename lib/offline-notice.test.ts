import { describe, expect, it } from "vitest";
import { offlineNotice } from "./offline-notice";

describe("offlineNotice", () => {
  it("says nothing when no judgment happened while the phone was away", () => {
    expect(offlineNotice({ eventId: 5, wasMyTurn: true }, 5)).toBeNull();
    expect(offlineNotice({ eventId: 5, wasMyTurn: false }, 5)).toBeNull();
  });

  it("tells the team its turn was skipped when it dropped on its own turn and the game moved on", () => {
    expect(offlineNotice({ eventId: 5, wasMyTurn: true }, 6)).toBe("斷線時剛好輪到你們，這一回合被跳過了。");
  });

  it("otherwise says how many judgments happened meanwhile", () => {
    expect(offlineNotice({ eventId: 5, wasMyTurn: false }, 8)).toBe("斷線期間遊戲進行了 3 次判定。");
  });

  it("ignores an eventId that went backwards (a room reset, handled by its own notice)", () => {
    expect(offlineNotice({ eventId: 9, wasMyTurn: true }, 1)).toBeNull();
  });
});
