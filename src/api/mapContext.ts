/** Map context extraction for EpidBot prompts.
 *
 * TS counterpart of the QGIS plugin's core/map_context.py (pure text builder,
 * unit-testable without the host) plus a collector that gathers the data
 * through the GeoLibre host API. The rendered `[Map context]` preamble is
 * prepended to the chat message, and the panel's preview shows exactly that
 * text.
 *
 * Layers are described the way the QGIS plugin does it (0.2.0 parity): field
 * schemas (name + inferred type), sample values for categorical fields,
 * feature counts and selected-feature counts. All introspection is bounded
 * twice: structural caps (layer count, scan depth, sample values, string
 * length) and a byte budget on the rendered text, reduced in deterministic
 * stages when over budget.
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

// --- Layer introspection caps (QGIS map_context_qgis.py parity) ------------

/** Features scanned to collect field types and sample values. */
const FIELD_SAMPLE_SCAN_LIMIT = 300;
/** Distinct values kept per field; more than this means high-cardinality
 * (ids, names) and the field is dropped from the sample list. */
const FIELD_SAMPLE_CAP = 8;
/** Distinct values observed per field for type inference (enough to tell
 * integer from number from boolean). */
const TYPE_VALUES_CAP = 50;
/** Maximum number of fields named in the context preamble. */
const MAX_FIELDS_LISTED = 15;
/** Fields rendered with sample values in the preamble. */
const SAMPLE_FIELDS_SHOWN = 4;
/** Sample values shown per field. */
const SAMPLE_VALUES_SHOWN = 5;

export interface MapContextLayerField {
  name: string;
  type: string;
  /** Distinct sample values; absent for high-cardinality or empty fields. */
  samples?: string[];
}

export interface MapContextLayer {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  /** Total features reported by the host (null when unknown). */
  featureCount: number | null;
  /** Selected features on this layer (null when the selection is elsewhere). */
  selectedCount: number | null;
  fields: MapContextLayerField[];
  /** Fields beyond the listed cap. */
  fieldsMore: number;
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
        value.length > budget.maxValueLength ? value.slice(0, budget.maxValueLength) : value;
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      row[key] = value;
    }
    // Objects/arrays are skipped: too costly in tokens, rarely useful.
  }
  return row;
}

/** Infer a field type name from observed values (best effort, like QGIS's
 * typeName; unknown/empty fields report "string"). */
export function inferFieldType(values: unknown[]): string {
  const observed = values.filter((v) => v !== null && v !== undefined);
  if (observed.length === 0) return "string";
  if (observed.every((v) => typeof v === "boolean")) return "boolean";
  if (observed.every((v) => typeof v === "number")) {
    return observed.every((v) => Number.isInteger(v)) ? "integer" : "number";
  }
  return "string";
}

/** Field schemas and categorical sample values from a feature sample.
 * Mirrors the QGIS collector: scan at most FIELD_SAMPLE_SCAN_LIMIT features,
 * keep at most FIELD_SAMPLE_CAP distinct values per field and drop fields
 * that exceed the cap (ids, free text). */
export function describeFields(
  features: GeoLibreFeatureInput[],
  maxFields = MAX_FIELDS_LISTED,
): { fields: MapContextLayerField[]; fieldsMore: number } {
  const order: string[] = [];
  const distinct = new Map<string, string[] | null>();
  const typeValues = new Map<string, unknown[]>();
  const scan = Math.min(features.length, FIELD_SAMPLE_SCAN_LIMIT);
  for (let i = 0; i < scan; i += 1) {
    const properties = features[i].properties;
    if (!properties || typeof properties !== "object") continue;
    for (const [key, value] of Object.entries(properties as Record<string, unknown>)) {
      if (!distinct.has(key)) {
        order.push(key);
        distinct.set(key, []);
        typeValues.set(key, []);
      }
      if (value === null || value === undefined) continue;
      const typeObserved = typeValues.get(key)!;
      if (
        typeObserved.length < TYPE_VALUES_CAP &&
        (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      ) {
        typeObserved.push(value);
      }
      const values = distinct.get(key);
      if (values === null || values === undefined) continue; // high-cardinality
      const text = String(value).trim();
      if (!text) continue;
      if (!values.includes(text)) {
        if (values.length >= FIELD_SAMPLE_CAP) {
          distinct.set(key, null); // ids, names: not a categorical field
        } else {
          values.push(text);
        }
      }
    }
  }
  const fields = order.slice(0, maxFields).map((name) => {
    const values = distinct.get(name);
    const field: MapContextLayerField = {
      name,
      type: inferFieldType(typeValues.get(name) ?? []),
    };
    if (values && values.length > 0) field.samples = values;
    return field;
  });
  return { fields, fieldsMore: Math.max(order.length - maxFields, 0) };
}

/** Collect the context payload through the host API. Always returns a
 * payload (possibly empty); the rendered text decides whether anything is
 * attached. A broken or unavailable layer must never kill the prompt. */
export function buildMapContext(
  app: GeoLibreAppAPI,
  budget: MapContextBudget = DEFAULT_MAP_CONTEXT_BUDGET,
): MapContextPayload {
  // Visible layers first so an early cap never hides what the user sees.
  const summaries = app.listLayers?.() ?? [];
  const ordered = [...summaries].sort((a, b) => Number(b.visible) - Number(a.visible));
  const capped = ordered.slice(0, budget.maxLayers);

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

  const layers: MapContextLayer[] = capped.map((layer) => {
    const entry: MapContextLayer = {
      id: layer.id,
      name: layer.name,
      type: layer.type,
      visible: layer.visible,
      featureCount: null,
      selectedCount: selection !== null && selection.layerId === layer.id ? selection.count : null,
      fields: [],
      fieldsMore: 0,
    };
    try {
      const layerFeatures = app.getLayerFeatures?.(layer.id) ?? [];
      if (layerFeatures.length > 0) {
        entry.featureCount = layerFeatures.length;
        const described = describeFields(layerFeatures);
        entry.fields = described.fields;
        entry.fieldsMore = described.fieldsMore;
      }
    } catch {
      // Introspection is best-effort; the summary line still renders.
    }
    return entry;
  });

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

  return { crs, viewBounds, layers, selection };
}

interface RenderDetail {
  maxLayers: number;
  sampleRows: number;
  includeSelection: boolean;
  boundsDecimals: number;
  /** Per-layer schema/sample detail level (the first thing to go). */
  layerDetail: "full" | "fields" | "none";
}

function layerDetailText(layer: MapContextLayer, detail: RenderDetail): string {
  const fields = layer.fields ?? [];
  if (detail.layerDetail === "none" || fields.length === 0) return "";
  const parts = fields.map((field) => `${field.name} (${field.type})`);
  if ((layer.fieldsMore ?? 0) > 0) parts.push(`... and ${layer.fieldsMore} more`);
  let text = `    fields: ${parts.join(", ")}`;
  if (detail.layerDetail === "full") {
    const sampleBits: string[] = [];
    for (const field of fields.slice(0, SAMPLE_FIELDS_SHOWN)) {
      const values = field.samples ?? [];
      if (values.length === 0) continue;
      const shown = values.slice(0, SAMPLE_VALUES_SHOWN);
      const suffix = values.length > SAMPLE_VALUES_SHOWN ? ", ..." : "";
      sampleBits.push(`${field.name} in {${shown.join(", ")}${suffix}}`);
    }
    if (sampleBits.length > 0) text += `\n    sample values: ${sampleBits.join("; ")}`;
  }
  return text;
}

/** Render the preamble at a given level of detail ("" when nothing to say). */
function renderContext(payload: MapContextPayload, detail: RenderDetail): string {
  const sections: string[] = [];

  if (payload.layers.length > 0) {
    const shown = payload.layers.slice(0, detail.maxLayers);
    const lines = shown.map((layer) => {
      let desc = `"${layer.name}" (${layer.type || "unknown type"}`;
      if (!layer.visible) desc += ", hidden";
      if (layer.featureCount != null) {
        desc += `, ${layer.featureCount.toLocaleString("en-US")} features`;
      }
      if (layer.selectedCount) {
        desc += `, ${layer.selectedCount.toLocaleString("en-US")} selected`;
      }
      desc += ")";
      const detailText = layerDetailText(layer, detail);
      return detailText ? `  - ${desc}\n${detailText}` : `  - ${desc}`;
    });
    if (payload.layers.length > shown.length) {
      lines.push(`  - ... and ${payload.layers.length - shown.length} more layers`);
    }
    sections.push("Active layers:\n" + lines.join("\n"));
  }

  if (payload.viewBounds) {
    const [west, south, east, north] = payload.viewBounds.map((value) =>
      round(value, detail.boundsDecimals),
    );
    sections.push(`Map extent: ${west},${south} to ${east},${north} (${payload.crs})`);
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
  {
    maxLayers: Infinity,
    sampleRows: Infinity,
    includeSelection: true,
    boundsDecimals: 4,
    layerDetail: "full",
  },
  {
    maxLayers: Infinity,
    sampleRows: 5,
    includeSelection: true,
    boundsDecimals: 4,
    layerDetail: "fields",
  },
  {
    maxLayers: Infinity,
    sampleRows: 5,
    includeSelection: false,
    boundsDecimals: 4,
    layerDetail: "none",
  },
  { maxLayers: 5, sampleRows: 2, includeSelection: false, boundsDecimals: 2, layerDetail: "none" },
  { maxLayers: 3, sampleRows: 0, includeSelection: false, boundsDecimals: 2, layerDetail: "none" },
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
