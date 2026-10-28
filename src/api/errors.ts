/** Typed failures for the EpidBot REST API, mapped to localized messages by
 * the panel (see panel.errorKeyFor). */
export type EpidBotErrorKind = "http" | "network" | "timeout" | "job";

export class EpidBotApiError extends Error {
  readonly status?: number;
  readonly detail?: string;
  readonly kind: EpidBotErrorKind;

  constructor(
    message: string,
    opts: { status?: number; detail?: string; kind?: EpidBotErrorKind } = {},
  ) {
    super(message);
    this.name = "EpidBotApiError";
    this.status = opts.status;
    this.detail = opts.detail;
    this.kind = opts.kind ?? (opts.status !== undefined ? "http" : "network");
  }
}

/** 401 — missing, unknown or revoked API key. */
export class EpidBotAuthError extends EpidBotApiError {}

/** 403 — the plan does not include API keys (Max/Team gate). */
export class EpidBotPlanError extends EpidBotApiError {}

/** 429 — quota exceeded. */
export class EpidBotQuotaError extends EpidBotApiError {}

/** The caller aborted a pending question (stop button, panel close). */
export class ChatCancelledError extends EpidBotApiError {}

export function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (isAborted(signal)) throw new ChatCancelledError("Chat request cancelled.");
}
