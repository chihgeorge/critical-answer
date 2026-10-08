// Every way an LLM narration can fail, by name. All of them fall back to the
// scripted line; the name is what lands in the transcript.

export type FailureReason =
  | "config_missing"
  | "timeout"
  | "upstream"
  | "auth" // 401 or 403: the key is wrong or lacks access. Retrying will not help.
  | "empty_or_refusal"
  | "invalid_output"
  | "breaker_open";

export class NarrationError extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = `NarrationError(${reason})`;
  }
}
