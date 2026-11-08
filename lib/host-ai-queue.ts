import type { ClientMessage } from "./protocol";

type Send = (msg: ClientMessage) => void;

/** The host's AI panel messages (key, limit). One sent before HOST_OK only gets not_host, so it is held, the last of
 * each type, and sent once on HOST_OK. */
export function createAiKeyQueue() {
  let claimed = false;
  const held = new Map<ClientMessage["type"], ClientMessage>();
  return {
    choose(msg: ClientMessage, send: Send) {
      if (claimed) send(msg);
      else held.set(msg.type, msg);
    },
    /** Sends the rest held, then the held key choice, else the saved key: a restarted room has forgotten it (and skips
     * the check for a key it still has). The key goes last, so its status reply is the last one the panel gets. A HOST_OK while claimed is a password change: sending the saved key then would
     * cancel the check of a newer one. */
    hostOk(saved: ClientMessage | null, send: Send) {
      if (claimed) return;
      claimed = true;
      const key = held.get("HOST_AI_KEY") ?? saved;
      held.delete("HOST_AI_KEY");
      held.forEach((m) => send(m));
      held.clear();
      if (key) send(key);
    },
    closed() {
      claimed = false;
    },
  };
}
