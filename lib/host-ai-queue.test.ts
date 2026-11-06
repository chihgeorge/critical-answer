import { describe, it, expect } from "vitest";
import { createAiKeyQueue } from "./host-ai-queue";
import type { ClientMessage } from "./protocol";

const own = (key: string): ClientMessage => ({ type: "HOST_AI_KEY", source: "own", provider: "anthropic", key });
const none: ClientMessage = { type: "HOST_AI_KEY", source: "none" };
const limit = (n: number): ClientMessage => ({ type: "HOST_AI_LIMIT", limit: n });

describe("createAiKeyQueue", () => {
  // Value: protects=a key chosen before HOST_OK is sent once after it, not lost to not_host; fails_when=choose sends while
  // unclaimed or hostOk ignores the held choice; why_new=the race failed e2e/ai-key.spec.ts on CI; seam=none
  it("holds a choice made before HOST_OK and sends it, not the saved key, once on HOST_OK", () => {
    const q = createAiKeyQueue();
    const sent: ClientMessage[] = [];
    const send = (m: ClientMessage) => sent.push(m);
    q.choose(own("sk-new"), send);
    q.choose(limit(500), send);
    expect(sent).toEqual([]);
    q.hostOk(own("sk-saved"), send);
    // The key goes last: a held limit's status reply would otherwise wipe the key's invalid_key off the panel.
    expect(sent).toEqual([limit(500), own("sk-new")]);
    // A password change's HOST_OK sends nothing: the saved key would cancel the check of a newer one.
    q.choose(own("sk-newer"), send);
    q.hostOk(own("sk-saved"), send);
    expect(sent).toEqual([limit(500), own("sk-new"), own("sk-newer")]);
    // A reconnect resends the saved key, never the held one: it may have been refused.
    q.closed();
    q.hostOk(own("sk-saved"), send);
    expect(sent.at(-1)).toEqual(own("sk-saved"));
  });

  // Value: protects=only the host's last choice is sent and a closed socket holds again; fails_when=held choices are
  // appended, or closed() stops resetting the claim; why_new=new helper; seam=none
  it("keeps only the last choice, sends at once while claimed, and holds again after the socket closes", () => {
    const q = createAiKeyQueue();
    const sent: ClientMessage[] = [];
    const send = (m: ClientMessage) => sent.push(m);
    q.choose(own("sk-new"), send);
    q.choose(none, send);
    q.hostOk(null, send);
    expect(sent).toEqual([none]);
    q.choose(own("sk-2"), send);
    expect(sent).toEqual([none, own("sk-2")]);
    q.closed();
    q.choose(own("sk-3"), send);
    expect(sent).toHaveLength(2);
    q.hostOk(null, send);
    expect(sent.at(-1)).toEqual(own("sk-3"));
  });

  // Value: protects=a held limit goes before the saved key a reconnect resends, and a flush with no key at all still
  // sends what was held; fails_when=the saved key goes first (its invalid_key is wiped by the limit's status reply) or
  // the `if (key)` guard drops the held limit; why_new=the coverage audit found both branches unset; seam=none
  it("sends a held limit before the saved key, and the held limit alone when there is no key", () => {
    const withSaved = createAiKeyQueue();
    const sent: ClientMessage[] = [];
    withSaved.choose(limit(40), (m) => sent.push(m));
    withSaved.hostOk(own("sk-saved"), (m) => sent.push(m));
    expect(sent).toEqual([limit(40), own("sk-saved")]);
    const noKey = createAiKeyQueue();
    const sentNoKey: ClientMessage[] = [];
    noKey.choose(limit(40), (m) => sentNoKey.push(m));
    noKey.hostOk(null, (m) => sentNoKey.push(m));
    expect(sentNoKey).toEqual([limit(40)]);
  });
});
