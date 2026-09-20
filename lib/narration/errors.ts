// Every way an LLM narration can fail, by name. All of them fall back to the
// scripted line; the name is what lands in the transcript.

export type FailureReason =
  | "config_missing"
  | "timeout"
  | "upstream"
  | "auth"
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
    this.name = new.target.name;
  }
}

export class ConfigMissingError extends NarrationError {
  constructor() {
    super("config_missing", "ANTHROPIC_API_KEY is not set");
  }
}
export class TimeoutError extends NarrationError {
  constructor() {
    super("timeout", "narration request timed out or was aborted");
  }
}
export class UpstreamError extends NarrationError {
  constructor(message: string, status?: number) {
    super("upstream", message, status);
  }
}
/** 401 or 403: the key is wrong or lacks access. Retrying will not help. */
export class AuthError extends NarrationError {
  constructor(status: number) {
    super("auth", `Anthropic rejected the key (${status})`, status);
  }
}
export class EmptyOrRefusalError extends NarrationError {
  constructor(message: string) {
    super("empty_or_refusal", message);
  }
}
export class InvalidOutputError extends NarrationError {
  constructor(message: string) {
    super("invalid_output", message);
  }
}
export class BreakerOpenError extends NarrationError {
  constructor() {
    super("breaker_open", "LLM narration is switched off for this room");
  }
}
