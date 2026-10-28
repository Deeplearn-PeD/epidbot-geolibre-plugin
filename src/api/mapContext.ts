/** Map context extraction for EpidBot prompts.
 *
 * TS counterpart of the QGIS plugin's core/map_context.py: a pure text
 * builder, unit-testable without the host, plus a collector that gathers the
 * data through the GeoLibre host API. The rendered `[Map context]` preamble
 * is prepended to the chat message, and the panel's preview shows exactly
 * that text.
 *
 * The context is bounded twice: structural caps (layer count, sample rows,
 * field count, string length) and a byte budget on the rendered text, reduced
 * in deterministic stages when over budget.
 */

import type { GeoLibreAppAPI, GeoLibreFeatureInput } from "../lib/geolibre/host-api";

export interface MapContextBudget {
  maxLayers: number;
  maxSampleRows: number;
  maxFieldsPerRow: number;
  maxValueLength: number;
  boundsDecimals: number;
  /** Byte budget for the rendered preamble. */
  maxBytes: number;
}

export const DEFAULT_MAP_CONTEXT_BUDGET: MapContextBudget = {
  maxLayers: 10,
  maxSampleRows: 15,
  maxFieldsPerRow: 5,
  maxValueLength: 40,
  boundsDecimals: 4,
  maxBytes: 8192,
};

export interface MapContextLayer {
  name: string;
  type: string;
  visible: boolean;
}

export interface MapContextSelection {
  layerId: string | null;
  count: number;
  rows: Array<Record<string, string | number | boolean | null>>;
}

export interface MapContextPayload {
  crs: string;
  viewBounds: [number, number, number, number] | null;
  layers: MapContextLayer[];
  selection: MapContextSelection | null;
}

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

function byteLength(text: string): number {
  return encoder ? encoder.encode(text).length : text.length;
}

function round(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/** Keep primitive-valued properties only; truncate strings. Field order is
 * the feature's own insertion order, capped at maxFieldsPerRow. */
export function sampleRow(
  feature: GeoLibreFeatureInput,
  budget: MapContextBudget,
): Record<string, string | number | boolean | null> {
  const row: Record<string, string | number | boolean | null> = {};
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(properties)) {
    if (Object.keys(row).length >= budget.maxFieldsPerRow) break;
    if (typeof value === "string") {
      row[key] =
        value.length > budget.maxValueLength
          ? value.slice(0, budget.maxValueLength)
          : value;
    } else if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      row[key] = value;
    }
    // Objects/arrays are skipped: too costly in tokens, rarely useful.
  }
  return row;
}

/** Collect the context payload through the host API. Always returns a
 * payload (possibly empty); the rendered text decides whether anything is
 * attached. */
export function buildMapContext(
  app: GeoLibreAppAPI,
  budget: MapContextBudget = DEFAULT_MAP_CONTEXT_BUDGET,
): MapContextPayload {
  // Visible layers first so an early cap never hides what the user sees.
  const summaries = app.listLayers?.() ?? [];
  const ordered = [...summaries].sort((a, b) => Number(b.visible) - Number(a.visible));
  const layers: MapContextLayer[] = ordered.slice(0, budget.maxLayers).map((layer) => ({
    name: layer.name,
    type: layer.type,
    visible: layer.visible,
  }));

  const rawBounds = app.getViewBounds?.() ?? null;
  const viewBounds = rawBounds
    ? (rawBounds.map((value) => round(value, budget.boundsDecimals)) as [
        number,
        number,
        number,
        number,
      ])
    : null;

  // getMapCrs() returns null on the default Web Mercator map or globe.
  const crs = app.getMapCrs?.()?.code ?? "EPSG:3857 (default Web Mercator)";

  const features = app.getSelectedFeatures?.() ?? [];
  const selectedLayerId = app.getSelectedLayerId?.() ?? null;
  const selection: MapContextSelection | null =
    features.length > 0
      ? {
          layerId: selectedLayerId,
          count: features.length,
          rows: features
            .slice(0, budget.maxSampleRows)
            .map((feature) => sampleRow(feature, budget)),
        }
      : null;

  return { crs, viewBounds, layers, selection };
}

interface RenderDetail {
  maxLayers: number;
  sampleRows: number;
  includeSelection: boolean;
  boundsDecimals: number;
}

/** Render the preamble at a given level of detail ("" when nothing to say). */
function renderContext(payload: MapContextPayload, detail: RenderDetail): string {
  const sections: string[] = [];

  if (payload.layers.length > 0) {
    const shown = payload.layers.slice(0, detail.maxLayers);
    const lines = shown.map(
      (layer) => `  - "${layer.name}" (${layer.type || "unknown type"}${layer.visible ? "" : ", hidden"})`,
    );
    if (payload.layers.length > shown.length) {
      lines.push(`  - ... and ${payload.layers.length - shown.length} more layers`);
    }
    sections.push("Active layers:\n" + lines.join("\n"));
  }

  if (payload.viewBounds) {
    const [west, south, east, north] = payload.viewBounds.map((value) =>
      round(value, detail.boundsDecimals),
    );
    sections.push(
      `Map extent: ${west},${south} to ${east},${north} (${payload.crs})`,
    );
  }

  if (detail.includeSelection && payload.selection && payload.selection.rows.length > 0) {
    const selection = payload.selection;
    const layerPart = selection.layerId ? ` from layer "${selection.layerId}"` : "";
    const rows = selection.rows
      .slice(0, detail.sampleRows)
      .map((row) => `  - ${JSON.stringify(row)}`);
    const more =
      selection.count > rows.length ? `\n  - ... and ${selection.count - rows.length} more` : "";
    sections.push(
      `Selected features: ${selection.count}${layerPart}; sample properties:\n${rows.join("\n")}${more}`,
    );
  }

  if (sections.length === 0) return "";
  return "[Map context] " + sections.join("\n");
}

/** Reduction stages, from full detail to minimal, applied while over budget. */
const STAGES: RenderDetail[] = [
  { maxLayers: Infinity, sampleRows: Infinity, includeSelection: true, boundsDecimals: 4 },
  { maxLayers: Infinity, sampleRows: 5, includeSelection: true, boundsDecimals: 4 },
  { maxLayers: Infinity, sampleRows: 5, includeSelection: false, boundsDecimals: 4 },
  { maxLayers: 5, sampleRows: 2, includeSelection: false, boundsDecimals: 2 },
  { maxLayers: 3, sampleRows: 0, includeSelection: false, boundsDecimals: 2 },
];

/** Render the preamble within the budget's byte cap. Returns "" when the
 * payload has nothing to report. */
export function buildContextText(
  payload: MapContextPayload,
  budget: MapContextBudget = DEFAULT_MAP_CONTEXT_BUDGET,
): string {
  for (const stage of STAGES) {
    const text = renderContext(payload, stage);
    if (text === "") return "";
    if (byteLength(text) <= budget.maxBytes) return text;
  }
  return renderContext(payload, STAGES[STAGES.length - 1]).slice(0, budget.maxBytes);
}

/** Prepend the preamble to a question. */
export function attachContext(question: string, preamble: string): string {
  return preamble ? `${preamble}\n\n${question}` : question;
}
