// Which AI company a host's key belongs to. One entry per provider: adding OpenAI, Gemini or
// OpenRouter later means a new id in AI_PROVIDER_IDS (lib/protocol.ts) and an entry here, nothing else.
// Server-side only: this file makes the network calls that use a host's key.

import type { AiProviderId } from "../protocol";
import { createLlmProvider, type LlmOptions } from "./llm";
import type { NarrationProvider } from "./scripted";

export type KeyCheck = "ok" | "invalid" | "failed";

export interface AiProvider {
  id: AiProviderId;
  label: string;
  /** Checked before any network call, so a pasted typo costs nothing. */
  keyFormat: RegExp;
  /** A free request that only proves the key is accepted. Never throws: an abort or timeout is "failed". */
  checkKey(key: string, o: { fetch?: typeof fetch; signal: AbortSignal }): Promise<KeyCheck>;
  createNarrator(opts: LlmOptions): NarrationProvider;
}

export const PROVIDERS: Record<AiProviderId, AiProvider> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    keyFormat: /^sk-ant-[A-Za-z0-9_-]{20,200}$/,
    async checkKey(key, { fetch: doFetch = fetch, signal }) {
      try {
        // Listing models is not billed.
        const res = await doFetch("https://api.anthropic.com/v1/models?limit=1", {
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
          signal,
        });
        if (res.status === 401 || res.status === 403) return "invalid";
        return res.ok ? "ok" : "failed";
      } catch {
        return "failed";
      }
    },
    createNarrator: createLlmProvider,
  },
};
