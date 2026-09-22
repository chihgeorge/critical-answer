/** The Worker's host, shared by every page that talks to it (WebSocket rooms and the bank-editor's
 * plain HTTP API) so the default and the local/remote distinction live in exactly one place. */
export const PARTY_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST ?? "localhost:1999";

/** localhost/wrangler dev serves plain HTTP; the deployed Worker is always HTTPS. Only the bank
 * editor needs this (WebSocket pages use partysocket, which derives ws:// vs wss:// itself). */
export function partyHttpBase(host: string = PARTY_HOST): string {
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}`;
}
