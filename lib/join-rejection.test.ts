// Value: protects=a phone the room turns away says why (TODOS: 手機被拒絕加入時不顯示原因); fails_when=an error code
// handleJoin sends maps to null, or a mid-game error is mistaken for a refused JOIN; no_claim=the page wiring (e2e).
import { describe, expect, it } from "vitest";
import { joinRejection } from "./join-rejection";

describe("joinRejection", () => {
  it("explains every way the room turns a JOIN away", () => {
    expect(joinRejection("bad_password", undefined, true, false)).toEqual({ text: "房間密碼不對", link: "password" });
    expect(joinRejection("bad_password", undefined, false, false)).toEqual({ text: "這個房間要密碼才能加入", link: "password" });
    expect(joinRejection("bad_password", "too_many_attempts", true, false)).toEqual({ text: "密碼猜錯太多次，請等一分鐘再試", link: "password" });
    expect(joinRejection("game_already_started", undefined, false, false)?.text).toBe("遊戲已經開始了，新隊伍不能再加入");
    expect(joinRejection("invalid_name", undefined, false, false)?.text).toBe("隊伍名稱不能用，請換一個名字");
    expect(joinRejection("invalid_name", "duplicate_name", false, false)?.text).toBe("這個隊名已經有人用了，請換一個名字");
    expect(joinRejection("invalid_action", "room_full", false, false)).toEqual({ text: "房間已滿（最多 8 隊）", link: "home" });
    expect(joinRejection("invalid_team_id", undefined, false, false)?.link).toBe("home");
    expect(joinRejection("bad_token", undefined, false, false)?.link).toBe("home");
  });

  // /review: a joined team's class tap that races HOST_START gets game_already_started (dungeon-room.ts
  // handleTeamPickClass); it must not lock that team out of the game it is in.
  it("never calls an error a refused JOIN once the phone has joined", () => {
    expect(joinRejection("game_already_started", undefined, false, true)).toBeNull();
  });

  // /ship: the connect-time snapshot names a known team before its JOIN is checked, so `joined` is already true
  // when a stale key's bad_token arrives. Only JOIN/REJOIN send these two, so they are always a refusal.
  it("still refuses a stale team key after the snapshot named the team", () => {
    expect(joinRejection("bad_token", undefined, false, true)?.text).toBe("加入失敗，請換一個瀏覽器再加入");
    expect(joinRejection("invalid_team_id", undefined, false, true)?.link).toBe("home");
  });

  it("leaves errors that are not a refused JOIN alone", () => {
    expect(joinRejection("invalid_action", "no_hint", false, false)).toBeNull();
    expect(joinRejection("unknown_team", undefined, false, false)).toBeNull();
    expect(joinRejection("no_active_game", undefined, false, false)).toBeNull();
  });
});

// Value: protects=a turned-away phone during a game can type the host's handoff code; fails_when=the input is not
// offered on game_already_started / bad_token, or a wrong code hides it; why_new=team handoff; seam=none
describe("handoff code input (team-handoff.md)", () => {
  it("is offered when the game has started, on a lost key, and after a wrong code; not for a bad password", () => {
    expect(joinRejection("game_already_started", undefined, false, false)?.handoff).toBe(true);
    expect(joinRejection("bad_token", undefined, false, true)?.handoff).toBe(true);
    expect(joinRejection("bad_code", undefined, false, false)).toEqual({ text: "配對碼不對或過期了，請主持人再按一次", link: "home", handoff: true });
    expect(joinRejection("bad_password", undefined, true, false)?.handoff).toBeUndefined();
    // /review: a lost-key phone (bad_token) is already `joined` (the connect-time snapshot names its team); a wrong
    // code must still say so, or the screen keeps telling it to switch browsers.
    expect(joinRejection("bad_code", undefined, false, true)?.text).toBe("配對碼不對或過期了，請主持人再按一次");
  });
});

describe("team_removed", () => {
  it("shows even after the phone joined, and links home", () => {
    expect(joinRejection("team_removed", undefined, false, true)).toEqual({ text: "主持人把你們的隊伍移除了", link: "home" });
  });
});
