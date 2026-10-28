/** Apply EpidBot attribute edit operations to GeoLibre vector layers.
 *
 * TS port of the QGIS plugin's core/layer_editor.py. An edit operation
 * (parsed by `extractEditOps` in api/results.ts) looks like:
 *
 *     {"op": "add_field",
 *      "layer": "dengue_cases",
 *      "field": {"name": "pop_2024", "type": "integer"},
 *      "key": "CD_MUN",
 *      "confidence": "fetched",
 *      "values": {"1100205": 12345, "1200301": 678}}
 *
 * Safety model: validation and join planning here are pure; the actual write
 * happens in the panel after explicit user confirmation (the review modal is
 * the mandatory human-in-the-loop step). The host has no edit-session/undo
 * API, so `applyEditOp` snapshots the original features before writing and
 * returns a revert closure — the panel offers it as a "Revert" action while
 * the plugin session lives.
 */

import { featureKey, LayerExportError, pickJoinKey } from "./layerExport";
import type { GeoLibreAppAPI, GeoLibreFeatureInput } from "../lib/geolibre/host-api";

export const OP_ADD_FIELD = "add_field";
export const OP_UPDATE_FIELD = "update_field";
export const KNOWN_OPS = [OP_ADD_FIELD, OP_UPDATE_FIELD] as const;
export type EditOpKind = (typeof KNOWN_OPS)[number];

/** Requested EpidBot type -> accepted spellings. */
const TYPE_ALIASES: Record<string, string[]> = {
  integer: ["integer", "int", "long", "int64"],
  number: ["number", "float", "double", "real"],
  string: ["string", "text", "str", "varchar"],
  boolean: ["boolean", "bool"],
};

/** Guard against pathological payloads. */
const MAX_VALUES = 500_000;

export class EditOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditOpError";
  }
}

export interface EditOp {
  op: EditOpKind;
  /** Layer-name hint from EpidBot (may be empty). */
  layer: string;
  field: { name: string; type: string };
  key: string;
  values: Record<string, unknown>;
  confidence: string;
}

export interface JoinPlan {
  /** feature index in the layer's feature array -> coerced value. */
  matched: Map<number, string | number | boolean>;
  unmatched: string[];
  invalid: Array<{ key: string; value: unknown; error: string }>;
}

// ---------------------------------------------------------------------------
// Pure validation and join planning
// ---------------------------------------------------------------------------

function canonicalType(typeName: unknown): string {
  const lowered = String(typeName ?? "string")
    .trim()
    .toLowerCase();
  for (const [canonical, aliases] of Object.entries(TYPE_ALIASES)) {
    if (aliases.includes(lowered)) return canonical;
  }
  return "string";
}

/** Structural validation; returns a normalized copy of `op`.
 * @throws EditOpError with a user-presentable message. */
export function validateEditOp(op: unknown): EditOp {
  if (!op || typeof op !== "object" || Array.isArray(op)) {
    throw new EditOpError("edit operation must be an object");
  }
  const record = op as Record<string, unknown>;
  const kind = record.op;
  if (kind !== OP_ADD_FIELD && kind !== OP_UPDATE_FIELD) {
    throw new EditOpError(
      `unsupported operation ${JSON.stringify(kind)} (expected one of ${KNOWN_OPS.join(", ")})`,
    );
  }
  const field = record.field;
  if (
    !field ||
    typeof field !== "object" ||
    !String((field as Record<string, unknown>).name ?? "").trim()
  ) {
    throw new EditOpError("edit operation is missing a field name");
  }
  const fieldRecord = field as Record<string, unknown>;
  const key = String(record.key ?? "").trim();
  if (!key) {
    throw new EditOpError("edit operation is missing the join key ('fid' or a field name)");
  }
  const values = record.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new EditOpError("edit operation has no values");
  }
  const entries = Object.entries(values as Record<string, unknown>);
  if (entries.length === 0) {
    throw new EditOpError("edit operation has no values");
  }
  if (entries.length > MAX_VALUES) {
    throw new EditOpError(`too many values (${entries.length.toLocaleString("en-US")})`);
  }
  return {
    op: kind,
    layer: String(record.layer ?? ""),
    field: {
      name: String(fieldRecord.name).trim(),
      type: canonicalType(fieldRecord.type),
    },
    key,
    values: Object.fromEntries(entries),
    confidence: String(record.confidence ?? ""),
  };
}

/** Convert a raw value to the field's type (throws TypeError/ValueError). */
export function coerceValue(value: unknown, typeName: string): string | number | boolean {
  const canonical = canonicalType(typeName);
  if (canonical === "integer") {
    const num = Number(String(value).trim());
    if (!Number.isFinite(num)) throw new Error(`not an integer: ${JSON.stringify(value)}`);
    return Math.trunc(num);
  }
  if (canonical === "number") {
    const num = Number(String(value).trim().replace(",", "."));
    if (!Number.isFinite(num)) throw new Error(`not a number: ${JSON.stringify(value)}`);
    return num;
  }
  if (canonical === "boolean") {
    if (typeof value === "string") {
      const lowered = value.trim().toLowerCase();
      if (["true", "1", "yes", "sim", "t"].includes(lowered)) return true;
      if (["false", "0", "no", "nao", "não", "f"].includes(lowered)) return false;
      throw new Error(`not a boolean: ${JSON.stringify(value)}`);
    }
    return Boolean(value);
  }
  return String(value);
}

/** Match requested values to features; pure, no host access.
 *
 * @param values requested `key -> raw value` map.
 * @param layerKeys `String(key) -> feature index` map built from the layer.
 * @param typeName canonical field type for coercion.
 */
export function planEdit(
  values: Record<string, unknown>,
  layerKeys: Map<string, number>,
  typeName: string,
): JoinPlan {
  const matched = new Map<number, string | number | boolean>();
  const unmatched: string[] = [];
  const invalid: Array<{ key: string; value: unknown; error: string }> = [];
  for (const [key, raw] of Object.entries(values)) {
    const index = layerKeys.get(key.trim());
    if (index === undefined) {
      unmatched.push(key);
      continue;
    }
    try {
      matched.set(index, coerceValue(raw, typeName));
    } catch (err) {
      invalid.push({
        key,
        value: raw,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { matched, unmatched, invalid };
}

/** The key the plugin advertises to EpidBot: semantic key or "fid". */
export function chooseJoinKey(fieldNames: string[]): string {
  const semantic = pickJoinKey(fieldNames);
  return semantic ?? "fid";
}

/** `String(key value) -> feature index` map for one layer's features.
 * `key === "fid"` maps the stringified feature key (host id or position) to
 * its index. */
export function buildLayerKeys(features: GeoLibreFeatureInput[], key: string): Map<string, number> {
  const keys = new Map<string, number>();
  if (key === "fid") {
    features.forEach((feature, index) => {
      keys.set(String(featureKey(feature, index)), index);
    });
    return keys;
  }
  features.forEach((feature, index) => {
    const value = (feature.properties as Record<string, unknown> | null)?.[key];
    if (value === undefined || value === null) return;
    keys.set(String(value).trim(), index);
  });
  return keys;
}

/** @throws EditOpError when the join-key field does not exist. */
export function requireJoinField(
  features: GeoLibreFeatureInput[],
  key: string,
  layerName: string,
): void {
  if (key === "fid") return;
  const present = features.some(
    (feature) =>
      feature.properties !== null &&
      typeof feature.properties === "object" &&
      key in (feature.properties as Record<string, unknown>),
  );
  if (!present) {
    throw new EditOpError(`join key field '${key}' not found on layer '${layerName}'`);
  }
}

// ---------------------------------------------------------------------------
// Host-dependent application
// ---------------------------------------------------------------------------

export interface ApplyEditReport {
  layerId: string;
  layerName: string;
  op: EditOpKind;
  field: string;
  matched: number;
  unmatched: string[];
  invalid: Array<{ key: string; value: unknown; error: string }>;
  confidence: string;
  /** Restore the layer's previous features (the host has no undo). */
  revert: () => void;
}

export interface ApplyEditTarget {
  layerId: string;
  layerName: string;
  features: GeoLibreFeatureInput[];
}

/** Validate, plan and apply one edit operation through the host API.
 *
 * The caller is responsible for having confirmed the operation with the user
 * (review modal). Throws EditOpError without touching the layer when
 * validation fails; a failed `updateGeoJsonLayer` never reaches the write.
 */
export function applyEditOp(
  app: GeoLibreAppAPI,
  target: ApplyEditTarget,
  rawOp: unknown,
): ApplyEditReport {
  const update = app.updateGeoJsonLayer;
  if (!update) {
    throw new EditOpError("this GeoLibre build cannot update layer data");
  }
  const normalized = validateEditOp(rawOp);
  const kind = normalized.op;
  const fieldName = normalized.field.name;
  const typeName = normalized.field.type;

  const existing = target.features.some((feature) => {
    const properties = feature.properties;
    return (
      properties !== null &&
      typeof properties === "object" &&
      fieldName in (properties as Record<string, unknown>)
    );
  });
  if (kind === OP_ADD_FIELD && existing) {
    throw new EditOpError(
      `field '${fieldName}' already exists on '${target.layerName}' - use update_field`,
    );
  }
  if (kind === OP_UPDATE_FIELD && !existing) {
    throw new EditOpError(`field '${fieldName}' does not exist on '${target.layerName}'`);
  }

  requireJoinField(target.features, normalized.key, target.layerName);
  const layerKeys = buildLayerKeys(target.features, normalized.key);
  const plan = planEdit(normalized.values, layerKeys, typeName);
  if (plan.matched.size === 0) {
    throw new EditOpError(`no features matched (${plan.unmatched.length} unmatched keys)`);
  }

  // Snapshot before writing: the host has no edit session or undo.
  const previous: GeoLibreFeatureInput[] = target.features.map((feature) => ({
    ...feature,
    properties:
      feature.properties && typeof feature.properties === "object"
        ? { ...(feature.properties as Record<string, unknown>) }
        : feature.properties,
  }));

  const updated: GeoLibreFeatureInput[] = target.features.map((feature, index) => {
    if (!plan.matched.has(index)) return feature;
    const properties =
      feature.properties && typeof feature.properties === "object"
        ? { ...(feature.properties as Record<string, unknown>) }
        : {};
    properties[fieldName] = plan.matched.get(index);
    return { ...feature, properties };
  });

  const ok = update.call(app, target.layerId, {
    type: "FeatureCollection",
    features: updated,
  });
  if (!ok) {
    throw new EditOpError(`the host refused the update of '${target.layerName}'`);
  }

  let reverted = false;
  return {
    layerId: target.layerId,
    layerName: target.layerName,
    op: kind,
    field: fieldName,
    matched: plan.matched.size,
    unmatched: plan.unmatched,
    invalid: plan.invalid,
    confidence: normalized.confidence,
    revert: () => {
      if (reverted) return;
      reverted = true;
      if (!update.call(app, target.layerId, { type: "FeatureCollection", features: previous })) {
        throw new LayerExportError(
          `could not restore '${target.layerName}' - restore it manually from the project history`,
        );
      }
    },
  };
}
