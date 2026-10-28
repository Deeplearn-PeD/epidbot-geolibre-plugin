import type { EpidBotSettings } from "./types";

/** The plugin's project state: session binding and non-secret preferences.
 * Serialized through getProjectState/applyProjectState; the registry entry
 * declares these keys as publishableSettings so they are stripped from
 * projects shared with others. Never contains the API key. */
export interface EpidBotProjectState {
  version: 1;
  settings: EpidBotSettings;
  /** Chat session bound to this project, or null for "new on first ask". */
  sessionId: number | null;
}

export function newProjectState(settings: EpidBotSettings): EpidBotProjectState {
  return { version: 1, settings: { ...settings }, sessionId: null };
}
