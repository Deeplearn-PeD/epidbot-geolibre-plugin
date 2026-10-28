/** EpidBot as a tool of GeoLibre's built-in AI assistant (README F5).
 *
 * Registers two declarative tools via registerAssistantToolSpec:
 * - ask_epidbot: delegates an epidemiological question to EpidBot and
 *   returns the answer text (with the session id and plot references);
 * - add_epidbot_result: adds a GeoJSON answer to the map as a styled layer.
 *
 * Model-facing descriptions and guidance are English-only by design (they
 * are read by the model, not rendered as UI). Input is not validated by the
 * host — every callback validates model-supplied input before acting, and
 * honors context.signal (the assistant's Stop button) on network work.
 */

import type {
  GeoLibreAppAPI,
  GeoLibreAssistantToolSpec,
  GeoLibreFeatureCollection,
} from "./lib/geolibre/host-api";
import type { EpidBotClient } from "./api/client";
import { validateGeoJson } from "./api/results";
import { buildContextText, attachContext, type MapContextPayload } from "./api/mapContext";
import { styleFor } from "./results/style";
import type { EpidBotSettings, ResultLayerRecord } from "./types";

export interface AssistantDeps {
  app: GeoLibreAppAPI;
  client: EpidBotClient;
  getSettings(): EpidBotSettings;
  getSessionId(): number | null;
  buildContext(): MapContextPayload | null;
  onLayerAdded(record: ResultLayerRecord): void;
}

const GUIDANCE = [
  "ask_epidbot answers epidemiological questions with EpidBot (Brazilian public",
  "health data: DATASUS/SINAN — dengue, Zika, chikungunya, malaria, COVID-19,",
  "vaccination — plus WHO, PAHO and ECDC sources). Call it for public-health",
  "data questions in Portuguese or English; set attach_context to include the",
  "current map extent, visible layers and selection. When an answer contains",
  "GeoJSON, offer to put it on the map with add_epidbot_result. Both tools need",
  "an EpidBot API key (Max or Team plan) configured in the EpidBot panel.",
].join(" ");

function askEpidBotSpec(deps: AssistantDeps): GeoLibreAssistantToolSpec {
  return {
    name: "ask_epidbot",
    description:
      "Ask EpidBot — the AI assistant for Brazilian public health data " +
      "(DATASUS/SINAN: dengue, Zika, chikungunya, malaria, COVID-19, " +
      "vaccination) — a question and get the answer text.",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The epidemiological question, in English or Portuguese.",
        },
        attach_context: {
          type: "boolean",
          description:
            "Attach the current map extent, layers and selection as context. " +
            "Defaults to the user's panel setting.",
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
    callback: async (input, context) => {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("input must be an object with a question string.");
      }
      const question = (input as Record<string, unknown>).question;
      if (typeof question !== "string" || !question.trim()) {
        throw new Error("question must be a non-empty string.");
      }
      const attach = (input as Record<string, unknown>).attach_context;
      const settings = deps.getSettings();
      const includeContext = typeof attach === "boolean" ? attach : settings.attachMapContext;
      const preamble = includeContext
        ? buildContextText(
            deps.buildContext() ?? { crs: "", viewBounds: null, layers: [], selection: null },
          )
        : "";
      const result = await deps.client.ask(attachContext(question.trim(), preamble), {
        sessionId: deps.getSessionId(),
        locale: settings.answerLocale,
        signal: context?.signal,
      });
      return {
        answer: result.content,
        session_id: result.sessionId,
        images: result.images,
      };
    },
  };
}

function addResultSpec(deps: AssistantDeps): GeoLibreAssistantToolSpec {
  return {
    name: "add_epidbot_result",
    description:
      "Add a GeoJSON FeatureCollection produced by EpidBot to the map as a " +
      "styled layer (choropleth when a numeric property classifies).",
    inputSchema: {
      type: "object",
      properties: {
        geojson: {
          type: "object",
          description: "A GeoJSON FeatureCollection (or a single Feature).",
        },
        name: {
          type: "string",
          description: "Optional layer name. Defaults to 'EpidBot result'.",
        },
      },
      required: ["geojson"],
      additionalProperties: false,
    },
    callback: (input) => {
      const renderer = deps.app.getMapRenderer?.();
      if (renderer !== undefined && renderer !== "maplibre" && renderer !== "mapbox") {
        throw new Error(`Adding layers is not available on the ${renderer} renderer.`);
      }
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("input must be an object with a geojson property.");
      }
      const raw = (input as Record<string, unknown>).geojson;
      const validation = validateGeoJson(raw);
      if (!validation.ok || !validation.fc) {
        throw new Error(`Invalid GeoJSON: ${validation.reason ?? "unknown reason"}.`);
      }
      const requested = (input as Record<string, unknown>).name;
      const name =
        typeof requested === "string" && requested.trim() ? requested.trim() : "EpidBot result";
      const layerId = deps.app.addGeoJsonLayer(name, validation.fc as GeoLibreFeatureCollection);
      const styled = deps.app.importLayerStyle?.(layerId, styleFor(validation.fc));
      deps.onLayerAdded({
        layerId,
        name,
        kind: "geojson",
        question: "assistant",
        addedAt: new Date().toISOString(),
      });
      return {
        layerId,
        featureCount: validation.featureCount ?? 0,
        styleApplied: styled ? styled.ok : false,
      };
    },
  };
}

/** Register the EpidBot tools and guidance; returns a disposer or null when
 * the host predates assistant tools. */
export function registerAssistantTools(deps: AssistantDeps): (() => void) | null {
  const { app } = deps;
  if (!app.registerAssistantToolSpec) return null;
  const disposers: Array<() => void> = [];
  const askTool = app.registerAssistantToolSpec(askEpidBotSpec(deps));
  if (askTool) disposers.push(askTool);
  const addTool = app.registerAssistantToolSpec(addResultSpec(deps));
  if (addTool) disposers.push(addTool);
  if (app.registerAssistantGuidance) {
    const disposeGuidance = app.registerAssistantGuidance(GUIDANCE);
    if (disposeGuidance) disposers.push(disposeGuidance);
  }
  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // Teardown races must not block deactivation.
      }
    }
  };
}
