const ROOM_CODE_CHARS = "BCDEFGHJKLMNPQRSTUVWXYZ";

export function generateRoomCode(): string {
  return Array.from({ length: 4 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join(
    "",
  );
}

const TEAM_ID_STORAGE_KEY = "critical_answer_team_id";
const TEAM_KEY_STORAGE_KEY = "critical_answer_team_key";
const HOST_TOKEN_PREFIX = "critical_answer_host_token_";

/** 16 random bytes as 32 hex chars. getRandomValues, so it works over plain http on a LAN. */
function randomBytesHex(bytes = crypto.getRandomValues(new Uint8Array(16))): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

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
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
  const hex = randomBytesHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Client-only: the value stored under `key` in this browser, or a fresh one from `make`, stored. */
function storedOrCreate(key: string, make: () => string): string {
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const value = make();
  localStorage.setItem(key, value);
  return value;
}

/** Client-only: read the stored team id for this browser, or mint and store a new one. */
export function getOrCreateTeamId(): string {
  return storedOrCreate(TEAM_ID_STORAGE_KEY, randomUuidV4);
}

/**
 * Client-only: this browser's team secret. teamId is public (every STATE message carries it), so
 * this is what proves a connection really is that team when it reconnects.
 */
export function getOrCreateTeamKey(): string {
  return storedOrCreate(TEAM_KEY_STORAGE_KEY, randomBytesHex);
}

/** Client-only: a fresh 32-hex-char host token. */
export function newHostToken(): string {
  return randomBytesHex();
}

/** The URL fragment's query-style params, e.g. "#k=abc&new=1" -> {k: "abc", new: "1"}. */
function hashParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.replace(/^#/, ""));
}

/**
 * Client-only: the host token for this room. A `#k=` URL fragment (from the
 * creation link or QR) wins and is stored, so a refresh or the same browser
 * later keeps control. Returns null when this browser has no token.
 */
export function getHostToken(code: string): string | null {
  const key = HOST_TOKEN_PREFIX + code;
  const fromUrl = hashParams(location.hash).get("k");
  if (fromUrl) {
    localStorage.setItem(key, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(key);
}

/**
 * The link the home page opens for a room the user just created carries `new=<attempt count>` in its fragment
 * (1, then 2, 3, ... on each retry — see freshAttempt). Only such a link may swap its room code when the code
 * turns out to belong to someone else's room (a 1 in 279,841 clash, or a room that has not expired yet). A link
 * to an existing room must never jump to another one.
 */
export function isFreshRoomHash(hash: string): boolean {
  return freshAttempt(hash) > 0;
}

/** How many codes this link has tried: 0 for a link that is not a room being created, 1 for the first code. */
export function freshAttempt(hash: string): number {
  const n = Number(hashParams(hash).get("new"));
  return Number.isInteger(n) && n >= 1 ? n : 0;
}

/** After this many taken codes in a row something is wrong (not bad luck), so stop and show the error. */
export const MAX_FRESH_ATTEMPTS = 5;

/** The same fragment without the `new` marker: once the room is ours, a refresh must not be able to swap it. */
export function settledHash(hash: string): string {
  const params = hashParams(hash);
  params.delete("new");
  const rest = params.toString();
  return rest ? `#${rest}` : "";
}

/** The host link for a room that is being created (see isFreshRoomHash). */
export function freshHostPath(code: string, token: string, attempt = 1): string {
  return `/room/${code}/host#k=${token}&new=${attempt}`;
}
