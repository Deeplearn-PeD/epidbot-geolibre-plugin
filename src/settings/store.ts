/** Settings persistence: the API key goes to the host credential store
 * (app.credentials — OS keychain on desktop, localStorage on web); non-secret
 * preferences travel in the plugin's project state so they never carry a
 * secret into a shared .geolibre project file. */

import { DEFAULT_SERVER_URL, normalizeServerUrl } from "../api/client";
import type { GeoLibreAppAPI } from "../lib/geolibre/host-api";
import { DEFAULT_SETTINGS, type AnswerLocale, type EpidBotSettings } from "../types";
import type { EpidBotProjectState } from "../projectState";

/** Credential name; the host stores it as `plugin.epidbot.api-key`. */
export const CREDENTIAL_NAME = "api-key";

export type ApiKeySaveResult = "saved" | "session-only" | "unavailable";

/** Read the stored key; "" when nothing is saved or the host has no store. */
export function loadApiKey(app: GeoLibreAppAPI): string {
  return app.credentials?.get(CREDENTIAL_NAME) ?? "";
}

/** Persist the key; "" deletes. "unavailable" means the host has no
 * credential store (the key then lives only in memory for this session). */
export function saveApiKey(app: GeoLibreAppAPI, key: string): ApiKeySaveResult {
  if (!app.credentials) return "unavailable";
  const persisted = app.credentials.set(CREDENTIAL_NAME, key.trim());
  return persisted ? "saved" : "session-only";
}

export function credentialLocation(app: GeoLibreAppAPI): "keychain" | "browser" | "none" {
  return app.credentials?.location() ?? "none";
}

// ---------------------------------------------------------------------------
// Sanitizers — everything read back from persisted state goes through these.
// ---------------------------------------------------------------------------

export function sanitizeSettings(value: unknown): EpidBotSettings {
  const source = (value ?? {}) as Record<string, unknown>;
  const locale: AnswerLocale = source.answerLocale === "pt-BR" ? "pt-BR" : "en";
  const rawPoll = Number(source.pollIntervalSec);
  const pollIntervalSec = Number.isFinite(rawPoll)
    ? Math.min(Math.max(rawPoll, 0.5), 10)
    : DEFAULT_SETTINGS.pollIntervalSec;
  const serverUrl = normalizeServerUrl(
    typeof source.serverUrl === "string" ? source.serverUrl : "",
  );
  return {
    serverUrl: serverUrl || DEFAULT_SETTINGS.serverUrl,
    answerLocale: locale,
    pollIntervalSec,
    attachMapContext:
      typeof source.attachMapContext === "boolean"
        ? source.attachMapContext
        : DEFAULT_SETTINGS.attachMapContext,
  };
}

/** Restore project state; unknown or hostile input falls back to defaults.
 * A stored apiKey (now or ever) is deliberately dropped: secrets never live
 * in project files. */
export function sanitizeProjectState(value: unknown): EpidBotProjectState {
  const fallback: EpidBotProjectState = {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, serverUrl: DEFAULT_SERVER_URL },
    sessionId: null,
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return fallback;
  const rawSession = record.sessionId;
  const sessionId =
    typeof rawSession === "number" && Number.isInteger(rawSession) && rawSession > 0
      ? rawSession
      : null;
  return {
    version: 1,
    settings: sanitizeSettings(record.settings),
    sessionId,
  };
}
