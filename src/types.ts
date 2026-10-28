/** EpidBot domain types: settings, chat turns and REST payloads. */

export type AnswerLocale = "en" | "pt-BR";

/** One EpidBot-made layer, recorded for provenance ("which layer came from
 * which question"). The layer itself persists in the host project; this
 * record only documents its origin. */
export interface ResultLayerRecord {
  layerId: string;
  name: string;
  kind: "geojson" | "url";
  question: string;
  addedAt: string;
}

/** Non-secret preferences. The API key never lives here — it goes to the
 * host credential store (see settings/store.ts). */
export interface EpidBotSettings {
  serverUrl: string;
  answerLocale: AnswerLocale;
  /** Seconds between job-status polls while an answer is pending. */
  pollIntervalSec: number;
  /** Attach viewport/layers/selection context to questions (F2 payload). */
  attachMapContext: boolean;
  /** Advisory inline budget for layer attachments, in KiB (QGIS parity). */
  inlineBudgetKb: number;
  /** Offer server artifact uploads when an attachment is over budget
   * (requires server support; off by default, like the QGIS plugin). */
  artifactUploads: boolean;
}

/** One message shown in the transcript. */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** Plot references from the assistant (relative paths like "plots/x.png"). */
  images: string[];
}

export const DEFAULT_SETTINGS: EpidBotSettings = {
  serverUrl: "https://api.epidbot.kwar-ai.com.br",
  answerLocale: "en",
  pollIntervalSec: 1.5,
  attachMapContext: true,
  inlineBudgetKb: 64,
  artifactUploads: false,
};

// --- REST payloads (mirror of the QGIS plugin's core/api_client.py) --------

/** Job statuses, mirroring epidbot.api.schemas.JobStatus. */
export type JobStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export interface ChatSubmitResponse {
  job_id: string;
  session_id?: number;
}

export interface ChatJobStatusResponse {
  status: JobStatus;
  session_id?: number;
  content?: string;
  images?: string[];
  error?: string;
}

export interface SessionInfo {
  id?: number;
  name?: string;
  [key: string]: unknown;
}
