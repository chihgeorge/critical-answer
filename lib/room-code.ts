const ROOM_CODE_CHARS = "BCDEFGHJKLMNPQRSTUVWXYZ";

export function generateRoomCode(): string {
  return Array.from({ length: 4 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join(
    "",
  );
}

const TEAM_ID_STORAGE_KEY = "critical_answer_team_id";

/**
 * `crypto.randomUUID()` only exists in secure contexts (HTTPS or localhost).
 * Local playtests are joined over a plain `http://<lan-ip>:3000` URL so
 * phones on the same Wi-Fi can reach the host — that's an insecure context,
 * where `crypto.randomUUID` is undefined and throws. `crypto.getRandomValues`
 * has no such restriction, so build a UUID v4 from it instead.
 */
function randomUuidV4(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Client-only: read the stored team id for this browser, or mint and store a new one. */
export function getOrCreateTeamId(): string {
  const stored = localStorage.getItem(TEAM_ID_STORAGE_KEY);
  if (stored) return stored;
  const id = randomUuidV4();
  localStorage.setItem(TEAM_ID_STORAGE_KEY, id);
  return id;
}

const TEAM_KEY_STORAGE_KEY = "critical_answer_team_key";

/**
 * Client-only: this browser's team secret. teamId is public (every STATE message carries it), so
 * this is what proves a connection really is that team when it reconnects.
 */
export function getOrCreateTeamKey(): string {
  const stored = localStorage.getItem(TEAM_KEY_STORAGE_KEY);
  if (stored) return stored;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(TEAM_KEY_STORAGE_KEY, key);
  return key;
}

const HOST_TOKEN_PREFIX = "critical_answer_host_token_";

/** Client-only: a fresh 32-hex-char host token (getRandomValues, so it works over plain http on a LAN). */
export function newHostToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Client-only: the host token for this room. A `#k=` URL fragment (from the
 * creation link or QR) wins and is stored, so a refresh or the same browser
 * later keeps control. Returns null when this browser has no token.
 */
export function getHostToken(code: string): string | null {
  const key = HOST_TOKEN_PREFIX + code;
  const fromUrl = new URLSearchParams(location.hash.replace(/^#/, "")).get("k");
  if (fromUrl) {
    localStorage.setItem(key, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(key);
}
