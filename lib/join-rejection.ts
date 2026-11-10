import { MAX_TEAMS, type ServerErrorCode } from "./protocol";

/** Why the room turned a phone's JOIN away, and where the phone's link goes. */
export interface JoinRejection {
  text: string;
  /** bad_password sends the team back to type the password; the rest just go home. */
  link: "password" | "home";
  /** The phone may type the host's handoff code here (docs/designs/team-handoff.md). */
  handoff?: true;
}

/**
 * The sentence a phone shows when the room refuses its JOIN (lib/room/dungeon-room.ts handleJoin), or null for
 * any other error. Pure, so it's unit-tested. `sentPassword`: whether the JOIN carried a password. `joined`: the
 * phone has seen its team in a LOBBY or STATE. Then the error answers something else, e.g. a class pick that
 * raced HOST_START gets game_already_started too. invalid_team_id and bad_token answer only JOIN/REJOIN, and the
 * connect-time snapshot already names a known team, so `joined` doesn't hide them.
 */
export function joinRejection(error: ServerErrorCode, detail: string | undefined, sentPassword: boolean, joined: boolean): JoinRejection | null {
  if (joined && error !== "invalid_team_id" && error !== "bad_token" && error !== "team_removed" && error !== "bad_code") return null;
  switch (error) {
    case "bad_password":
      if (detail === "too_many_attempts") return { text: "密碼猜錯太多次，請等一分鐘再試", link: "password" };
      return { text: sentPassword ? "房間密碼不對" : "這個房間要密碼才能加入", link: "password" };
    // Sent to a team's own phones only (HOST_REMOVE_TEAM): joining again from the home page is allowed.
    case "team_removed":
      // not_admitted: the host's 不收 on a team that joined after the start (docs/designs/late-join.md).
      return { text: detail === "not_admitted" ? "主持人這場沒有收你們的隊伍" : "主持人把你們的隊伍移除了", link: "home" };
    // No JOIN gets it since late joining (a class pick that races HOST_START does, and `joined` hides that one).
    // Kept for a page that still talks to a Worker from before late joining, while a deploy rolls out.
    case "game_already_started":
      return { text: "遊戲已經開始了，新隊伍不能再加入", link: "home", handoff: true };
    // Only TEAM_CLAIM sends it, so it is a refusal even after `joined`: the screen keeps its code input for another try.
    case "bad_code":
      return { text: "配對碼不對或過期了，請主持人再按一次", link: "home", handoff: true };
    case "invalid_name":
      return { text: detail === "duplicate_name" ? "這個隊名已經有人用了，請換一個名字" : "隊伍名稱不能用，請換一個名字", link: "home" };
    // A stored team id or key the room can't accept: broken browser data, not something the team did.
    case "invalid_team_id":
      return { text: "加入失敗，請換一個瀏覽器再加入", link: "home" };
    // Also a browser that kept its team id but lost the key: the host's handoff code still gets it back (D8).
    case "bad_token":
      return { text: "加入失敗，請換一個瀏覽器再加入", link: "home", handoff: true };
    case "invalid_action":
      return detail === "room_full" ? { text: `房間已滿（最多 ${MAX_TEAMS} 隊）`, link: "home" } : null;
    default:
      return null;
  }
}
