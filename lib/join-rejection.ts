import type { ServerErrorCode } from "./protocol";

/** Why the room turned a phone's JOIN away, and where the phone's link goes. */
export interface JoinRejection {
  text: string;
  /** bad_password sends the team back to type the password; the rest just go home. */
  link: "password" | "home";
}

/**
 * The sentence a phone shows when the room refuses its JOIN (lib/room/dungeon-room.ts handleJoin), or null for
 * any other error. Pure, so it's unit-tested. `sentPassword`: whether the JOIN carried a password.
 */
export function joinRejection(error: ServerErrorCode, detail: string | undefined, sentPassword: boolean): JoinRejection | null {
  switch (error) {
    case "bad_password":
      return { text: sentPassword ? "房間密碼不對" : "這個房間要密碼才能加入", link: "password" };
    case "game_already_started":
      return { text: "遊戲已經開始了，新隊伍不能再加入", link: "home" };
    case "invalid_name":
      return { text: "隊伍名稱不能用，請換一個名字", link: "home" };
    // A stored team id or key the room can't accept: broken browser data, not something the team did.
    case "invalid_team_id":
    case "bad_token":
      return { text: "加入失敗，請重新整理或換一個瀏覽器", link: "home" };
    case "invalid_action":
      return detail === "room_full" ? { text: "房間已滿（最多 8 隊）", link: "home" } : null;
    default:
      return null;
  }
}
