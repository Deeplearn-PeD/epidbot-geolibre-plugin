/** HTTP client for the EpidBot REST API (API-key authentication).
 *
 * Port of the QGIS plugin's core/api_client.py to fetch, so both speak the
 * same contract against the production host:
 *
 * - GET  /api/v1/auth/me                      — connection test
 * - POST /api/v1/chat                         — submit a question, get a job id
 * - GET  /api/v1/chat/{job_id}                — poll until the answer completes
 * - GET/POST /api/v1/sessions                 — list/create sessions
 * - GET  /api/v1/sessions/{id}/messages       — session history
 * - GET  /api/v1/sessions/plots/{filename}    — authenticated plot download
 *
 * Transient failures (network errors, HTTP 502/503/504) are retried with
 * exponential backoff. Polling grows the interval by 1.15x up to a cap, like
 * the QGIS plugin. All waits honor the caller's AbortSignal.
 */

import {
  ChatCancelledError,
  EpidBotApiError,
  EpidBotAuthError,
  EpidBotPlanError,
  EpidBotQuotaError,
  throwIfAborted,
} from "./errors";
import type { ChatJobStatusResponse, ChatSubmitResponse, SessionInfo } from "../types";

export const DEFAULT_SERVER_URL = "https://api.epidbot.kwar-ai.com.br";
const API_PREFIX = "/api/v1";
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

export interface EpidBotClientOptions {
  serverUrl?: string;
  /** Called on every request, so the panel can change the key at runtime. */
  getApiKey: () => string;
  pollIntervalMs?: number;
  pollMaxIntervalMs?: number;
  /** Overall deadline for one chat job. */
  chatTimeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  /** Defaults to globalThis.fetch; the entry point passes app.nativeFetch. */
  fetchImpl?: typeof globalThis.fetch;
  /** Pass the abort signal into fetch() itself, cancelling the in-flight
   * HTTP request. Default true (browser fetch supports it). Set false when
   * fetchImpl is a host nativeFetch whose signal support is unknown — Stop
   * then takes effect at the next poll boundary instead. */
  passSignalToFetch?: boolean;
  /** Injectable wait (tests). */
  sleep?: (ms: number) => Promise<void>;
}

export interface AskOptions {
  sessionId?: number | null;
  locale?: string;
  signal?: AbortSignal;
  /** Progress callback with the job id while polling. */
  onStatus?: (jobId: string) => void;
  /** Called once the job is accepted: (jobId, effectiveSessionId). */
  onSubmitted?: (jobId: string, sessionId: number | null) => void;
}

export interface ChatResult {
  sessionId: number | null;
  content: string;
  images: string[];
}

export function normalizeServerUrl(url: string): string {
  const trimmed = (url ?? "").trim().replace(/\/+$/, "");
  if (trimmed && !trimmed.includes("://")) return "https://" + trimmed;
  return trimmed;
}

function errorForStatus(status: number, detail: string): EpidBotApiError {
  if (status === 401) return new EpidBotAuthError(`EpidBot API error (HTTP 401): ${detail}`, { status, detail });
  if (status === 403) return new EpidBotPlanError(`EpidBot API error (HTTP 403): ${detail}`, { status, detail });
  if (status === 429) return new EpidBotQuotaError(`EpidBot API error (HTTP 429): ${detail}`, { status, detail });
  return new EpidBotApiError(`EpidBot API error (HTTP ${status}): ${detail}`, { status, detail });
}

export class EpidBotClient {
  private serverUrl: string;
  private readonly getApiKey: () => string;
  private readonly pollIntervalMs: number;
  private readonly pollMaxIntervalMs: number;
  private readonly chatTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly passSignalToFetch: boolean;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: EpidBotClientOptions) {
    this.serverUrl = normalizeServerUrl(opts.serverUrl || DEFAULT_SERVER_URL);
    this.getApiKey = opts.getApiKey;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1500;
    this.pollMaxIntervalMs = opts.pollMaxIntervalMs ?? 5000;
    this.chatTimeoutMs = opts.chatTimeoutMs ?? 600_000;
    this.maxRetries = Math.max(opts.maxRetries ?? 2, 0);
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 500;
    this.fetchImpl = opts.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.passSignalToFetch = opts.passSignalToFetch ?? true;
    this.sleep =
      opts.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  setServerUrl(url: string): void {
    this.serverUrl = normalizeServerUrl(url || DEFAULT_SERVER_URL);
  }

  getServerUrl(): string {
    return this.serverUrl;
  }

  /** A clone of this client that sends a different API key (used by the
   * settings panel to test a not-yet-saved key), optionally against a
   * not-yet-saved server URL. Shares the transport and timing options;
   * retries are disabled for one-off calls. */
  withApiKey(apiKey: string, serverUrl?: string): EpidBotClient {
    return new EpidBotClient({
      serverUrl: serverUrl ?? this.serverUrl,
      getApiKey: () => apiKey,
      pollIntervalMs: this.pollIntervalMs,
      pollMaxIntervalMs: this.pollMaxIntervalMs,
      chatTimeoutMs: this.chatTimeoutMs,
      maxRetries: 0,
      retryBaseDelayMs: this.retryBaseDelayMs,
      fetchImpl: this.fetchImpl,
      sleep: this.sleep,
    });
  }

  // ------------------------------------------------------------------
  // HTTP plumbing
  // ------------------------------------------------------------------

  private authHeaders(): Record<string, string> {
    const key = this.getApiKey();
    return key ? { "X-API-Key": key } : {};
  }

  private endpoint(path: string): string {
    if (!this.serverUrl) {
      throw new EpidBotApiError("EpidBot server URL is not configured.");
    }
    return `${this.serverUrl}${API_PREFIX}${path}`;
  }

  private async errorDetail(response: Response): Promise<string> {
    try {
      const payload = (await response.json()) as unknown;
      if (payload && typeof payload === "object") {
        const record = payload as Record<string, unknown>;
        const detail = record.detail ?? record.message;
        if (detail !== undefined && detail !== null) return String(detail);
        return JSON.stringify(payload).slice(0, 300);
      }
      return String(payload).slice(0, 300);
    } catch {
      return "unknown error";
    }
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { json?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const url = this.endpoint(path);
    const attempts = this.maxRetries + 1;
    let lastError: EpidBotApiError | undefined;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      throwIfAborted(opts.signal);
      let response: Response;
      const fetchSignal = this.passSignalToFetch ? opts.signal : undefined;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: {
            ...(opts.json !== undefined ? { "Content-Type": "application/json" } : {}),
            ...this.authHeaders(),
          },
          body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
          signal: fetchSignal,
        });
      } catch (err) {
        if (opts.signal?.aborted) throw new ChatCancelledError("Chat request cancelled.");
        lastError = new EpidBotApiError(
          `Could not reach EpidBot at ${url}: ${err instanceof Error ? err.message : String(err)}`,
          { kind: "network" },
        );
        if (attempt + 1 < attempts) {
          await this.sleep(this.retryBaseDelayMs * 2 ** attempt);
          continue;
        }
        throw lastError;
      }

      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt + 1 < attempts) {
        await this.sleep(this.retryBaseDelayMs * 2 ** attempt);
        continue;
      }

      if (response.status >= 400) {
        const detail = await this.errorDetail(response);
        throw errorForStatus(response.status, detail);
      }

      const text = await response.text();
      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new EpidBotApiError(`EpidBot returned a non-JSON response for ${path}.`, {
          kind: "http",
        });
      }
    }

    throw lastError ?? new EpidBotApiError("EpidBot request failed.", { kind: "network" });
  }

  // ------------------------------------------------------------------
  // High-level API operations
  // ------------------------------------------------------------------

  /** Verify the API key against GET /auth/me; returns the user payload. */
  checkAuth(signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.request("GET", "/auth/me", { signal });
  }

  listSessions(signal?: AbortSignal): Promise<SessionInfo[]> {
    return this.request("GET", "/sessions", { signal });
  }

  createSession(name?: string, signal?: AbortSignal): Promise<SessionInfo> {
    return this.request("POST", "/sessions", { json: { name: name ?? null }, signal });
  }

  getMessages(sessionId: number | string, signal?: AbortSignal): Promise<unknown> {
    return this.request("GET", `/sessions/${encodeURIComponent(String(sessionId))}/messages`, {
      signal,
    });
  }

  /** A signal-aware wait for the poll loop: resolves after ms, or rejects
   * as soon as the caller aborts — no zombie polls after Stop. */
  private waitOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new ChatCancelledError("Chat request cancelled."));
    }
    if (!signal) return this.sleep(ms);
    let onAbort = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new ChatCancelledError("Chat request cancelled."));
      signal.addEventListener("abort", onAbort, { once: true });
    });
    return Promise.race([this.sleep(ms), cancelled]).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  }

  /** Submit the question and poll until the answer completes. */
  async ask(message: string, opts: AskOptions = {}): Promise<ChatResult> {
    const submitted = await this.request<ChatSubmitResponse>("POST", "/chat", {
      json: {
        message,
        session_id: opts.sessionId ?? null,
        locale: opts.locale ?? "en",
      },
      signal: opts.signal,
    });
    const jobId = submitted.job_id;
    if (!jobId) {
      throw new EpidBotApiError("EpidBot did not return a job id.", { kind: "http" });
    }
    const submittedSession = submitted.session_id ?? null;
    opts.onSubmitted?.(jobId, submittedSession);

    const deadline = Date.now() + this.chatTimeoutMs;
    let wait = this.pollIntervalMs;
    while (true) {
      throwIfAborted(opts.signal);
      if (Date.now() > deadline) {
        throw new EpidBotApiError(
          `EpidBot did not answer within ${Math.round(this.chatTimeoutMs / 1000)} seconds.`,
          { kind: "timeout" },
        );
      }
      opts.onStatus?.(jobId);

      const status = await this.request<ChatJobStatusResponse>(
        "GET",
        `/chat/${encodeURIComponent(jobId)}`,
        { signal: opts.signal },
      );
      if (status.status === "completed") {
        return {
          sessionId: status.session_id ?? submittedSession ?? opts.sessionId ?? null,
          content: status.content ?? "",
          images: status.images ?? [],
        };
      }
      if (status.status === "failed" || status.status === "cancelled") {
        throw new EpidBotApiError(status.error || "The chat job failed on the server.", {
          kind: "job",
          detail: status.status,
        });
      }
      await this.waitOrAbort(wait, opts.signal);
      wait = Math.min(wait * 1.15, this.pollMaxIntervalMs);
    }
  }

  /** Turn an image reference ("plots/foo.png" or a full URL) into the bare
   * filename served by GET /sessions/plots/{filename}. */
  static extractPlotFilename(imageRef: string): string {
    let ref = (imageRef ?? "").trim();
    if (ref.includes("://")) {
      ref = ref.split("?", 1)[0];
      const slash = ref.lastIndexOf("/");
      if (slash !== -1) ref = ref.slice(slash + 1);
    }
    for (const prefix of ["plots/", "/plots/", "plots\\"]) {
      if (ref.startsWith(prefix)) {
        ref = ref.slice(prefix.length);
        break;
      }
    }
    const slash = ref.lastIndexOf("/");
    return slash === -1 ? ref : ref.slice(slash + 1);
  }

  /** URL of an authenticated plot download (fetch as blob, not <img src>). */
  plotUrl(filename: string): string {
    return this.endpoint(`/sessions/plots/${encodeURIComponent(filename)}`);
  }

  /** Download an agent-generated plot as a blob (auth included). Plain
   * `<img src>` cannot send the X-API-Key header, so plots are fetched as
   * blobs and shown through object URLs. */
  async fetchPlot(filename: string, signal?: AbortSignal): Promise<Blob> {
    const url = this.endpoint(`/sessions/plots/${encodeURIComponent(filename)}`);
    const attempts = this.maxRetries + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      throwIfAborted(signal);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: this.authHeaders(),
          signal: this.passSignalToFetch ? signal : undefined,
        });
      } catch (err) {
        if (signal?.aborted) throw new ChatCancelledError("Chat request cancelled.");
        if (attempt + 1 < attempts) {
          await this.sleep(this.retryBaseDelayMs * 2 ** attempt);
          continue;
        }
        throw new EpidBotApiError(
          `Could not download plot ${filename}: ${err instanceof Error ? err.message : String(err)}`,
          { kind: "network" },
        );
      }
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt + 1 < attempts) {
        await this.sleep(this.retryBaseDelayMs * 2 ** attempt);
        continue;
      }
      if (response.status >= 400) {
        const detail = await this.errorDetail(response);
        throw errorForStatus(response.status, detail);
      }
      return await response.blob();
    }
    throw new EpidBotApiError(`Could not download plot ${filename}.`, { kind: "network" });
  }
}
