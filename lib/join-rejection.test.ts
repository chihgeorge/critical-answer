// Value: protects=a phone the room turns away says why (TODOS: 手機被拒絕加入時不顯示原因); fails_when=an error code
// handleJoin sends maps to null, or a mid-game error is mistaken for a refused JOIN; no_claim=the page wiring (e2e).
import { describe, expect, it } from "vitest";
import { joinRejection } from "./join-rejection";

describe("joinRejection", () => {
  it("explains every way the room turns a JOIN away", () => {
    expect(joinRejection("bad_password", undefined, true, false)).toEqual({ text: "房間密碼不對", link: "password" });
    expect(joinRejection("bad_password", undefined, false, false)).toEqual({ text: "這個房間要密碼才能加入", link: "password" });
    expect(joinRejection("game_already_started", undefined, false, false)?.text).toBe("遊戲已經開始了，新隊伍不能再加入");
    expect(joinRejection("invalid_name", undefined, false, false)?.text).toBe("隊伍名稱不能用，請換一個名字");
    expect(joinRejection("invalid_action", "room_full", false, false)).toEqual({ text: "房間已滿（最多 8 隊）", link: "home" });
    expect(joinRejection("invalid_team_id", undefined, false, false)?.link).toBe("home");
    expect(joinRejection("bad_token", undefined, false, false)?.link).toBe("home");
  });

  // /review: a joined team's class tap that races HOST_START gets game_already_started (dungeon-room.ts
  // handleTeamPickClass); it must not lock that team out of the game it is in.
  it("never calls an error a refused JOIN once the phone has joined", () => {
    expect(joinRejection("game_already_started", undefined, false, true)).toBeNull();
    expect(joinRejection("bad_token", undefined, false, true)).toBeNull();
  });

  it("leaves errors that are not a refused JOIN alone", () => {
    expect(joinRejection("invalid_action", "no_hint", false, false)).toBeNull();
    expect(joinRejection("unknown_team", undefined, false, false)).toBeNull();
    expect(joinRejection("no_active_game", undefined, false, false)).toBeNull();
  });
});
