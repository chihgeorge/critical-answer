const ROOM_CODE_CHARS = "BCDEFGHJKLMNPQRSTUVWXYZ";

export function generateRoomCode(): string {
  return Array.from({ length: 4 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join(
    "",
  );
}

const TEAM_ID_STORAGE_KEY = "dungeon_master_team_id";

/** Client-only: read the stored team id for this browser, or mint and store a new one. */
export function getOrCreateTeamId(): string {
  const stored = localStorage.getItem(TEAM_ID_STORAGE_KEY);
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem(TEAM_ID_STORAGE_KEY, id);
  return id;
}
