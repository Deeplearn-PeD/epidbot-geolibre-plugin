/** Export GeoLibre layers as compact GeoJSON attachments for EpidBot prompts.
 *
 * TS port of the QGIS plugin's core/layer_export.py. Instead of QgsVectorLayer
 * it works on the host's feature arrays (getLayerFeatures / getSelectedFeatures),
 * which keeps every helper pure and unit-testable without a live map.
 *
 * Scopes (see SCOPE_CHOICES):
 *
 * - "selection" — only the currently selected features of the layer;
 * - "extent" — only features whose geometry intersects the current view bounds;
 * - "all" — every feature of the layer;
 * - "identifiers" — fid + join-key fields only, no geometry (cheap payload
 *   that lets EpidBot return attribute edits keyed to real features).
 */

import type { GeoLibreBounds, GeoLibreFeatureInput } from "../lib/geolibre/host-api";

export const SCOPE_SELECTION = "selection";
export const SCOPE_EXTENT = "extent";
export const SCOPE_ALL = "all";
export const SCOPE_IDENTIFIERS = "identifiers";

export const SCOPE_CHOICES = [SCOPE_SELECTION, SCOPE_EXTENT, SCOPE_ALL, SCOPE_IDENTIFIERS] as const;

export type AttachmentScope = (typeof SCOPE_CHOICES)[number];

export const SCOPE_LABELS: Record<AttachmentScope, string> = {
  selection: "selected features",
  extent: "features in extent",
  all: "all features",
  identifiers: "identifiers",
};

/** Default inline attachment budget (bytes). */
export const DEFAULT_INLINE_BUDGET = 64 * 1024;

/** Never serialize more features than this inline; the interactive reduction
 * flow takes over instead of freezing the UI. */
export const HARD_FEATURE_LIMIT = 50_000;

/** Coordinate precision for exported geometries (6 dp is about 11 cm). */
export const GEOMETRY_PRECISION = 6;

/** Candidate join-key field names for attribute write-back, in priority order
 * (matched case-insensitively against layer fields). */
const JOIN_KEY_CANDIDATES = [
  "cd_mun",
  "cd_munic",
  "cd_municip",
  "co_munic",
  "co_municip",
  "codmun",
  "municipality_code",
  "codarea",
  "co_uf",
  "cd_uf",
  "uf",
  "estado",
  "state",
  "region",
  "regiao",
  "codigo",
  "code",
  "gid",
  "id",
];

export class LayerExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayerExportError";
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Serialize with minimal separators (smaller attachments). JSON.stringify
 * without an indent is already compact; strings never contain literal
 * whitespace because control characters are escaped. */
export function compactJson(obj: unknown): string {
  return JSON.stringify(obj);
}

/** Best semantic join-key field for attribute write-back, or null. Matching
 * is case-insensitive against JOIN_KEY_CANDIDATES (priority order); the
 * original field-name spelling is returned. */
export function pickJoinKey(fieldNames: string[]): string | null {
  const lowered = new Map<string, string>();
  for (const name of fieldNames) lowered.set(name.toLowerCase(), name);
  for (const candidate of JOIN_KEY_CANDIDATES) {
    const original = lowered.get(candidate);
    if (original !== undefined) return original;
  }
  return null;
}

/** UTF-8 byte length of a serialized payload. */
export function sizeBytes(text: string): number {
  const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  return encoder ? encoder.encode(text).length : text.length;
}

/** True when `text` exceeds `budgetBytes`. */
export function overBudget(text: string, budgetBytes: number): boolean {
  return sizeBytes(text) > Math.max(Math.trunc(budgetBytes), 0);
}

// --- Geometry walking (bounds + precision) ---------------------------------

type Position = number[];

function isPosition(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

/** Walk every position of any GeoJSON geometry (deep, geometry-collection
 * safe); `visit` receives each [x, y, ...] position. Objects are traversed
 * property by property (Point has {type, coordinates}), arrays nest. */
function visitPositions(node: unknown, visit: (position: Position) => void): void {
  if (isPosition(node)) {
    visit(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) visitPositions(child, visit);
    return;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node as Record<string, unknown>)) {
      visitPositions(value, visit);
    }
  }
}

function roundTo(value: number, decimals: number): number {
  if (decimals >= 5) return Number(value.toFixed(decimals));
  // toFixed is fine for our ranges; keep Number() to drop trailing zeros.
  return Number(value.toFixed(decimals));
}

/** Round every coordinate of a geometry (a reduction option). Returns the
 * input unchanged when the geometry is not an object. */
export function reduceGeometryPrecision(geometry: unknown, precision: number): unknown {
  if (!geometry || typeof geometry !== "object") return geometry;
  const record = geometry as Record<string, unknown>;
  const clone: Record<string, unknown> = { ...record };
  if (Array.isArray(record.coordinates)) {
    const walk = (node: unknown): unknown => {
      if (isPosition(node)) {
        return node.map((component, index) =>
          index < 2 ? roundTo(component, precision) : component,
        );
      }
      return Array.isArray(node) ? node.map(walk) : node;
    };
    clone.coordinates = walk(record.coordinates);
  }
  if (Array.isArray(record.geometries)) {
    clone.geometries = record.geometries.map((child) => reduceGeometryPrecision(child, precision));
  }
  return clone;
}

/** Bounding box [west, south, east, north] of a geometry, or null when the
 * geometry has no numeric coordinates. */
export function geometryBounds(geometry: unknown): GeoLibreBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let seen = false;
  visitPositions(geometry, ([x, y]) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    seen = true;
    if (x < west) west = x;
    if (y < south) south = y;
    if (x > east) east = x;
    if (y > north) north = y;
  });
  return seen ? [west, south, east, north] : null;
}

function intersectsExtent(bounds: GeoLibreBounds, extent: GeoLibreBounds): boolean {
  return !(
    bounds[2] < extent[0] ||
    bounds[0] > extent[2] ||
    bounds[3] < extent[1] ||
    bounds[1] > extent[3]
  );
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** The stable key EpidBot echoes back on edits: the host feature id when the
 * host provides one, otherwise the feature's position (stable within a
 * session — attachments and write-back read the same host arrays). */
export function featureKey(feature: GeoLibreFeatureInput, index: number): string | number {
  if (feature.id !== undefined && feature.id !== null) return feature.id;
  return index;
}

function serializeFeature(
  feature: GeoLibreFeatureInput,
  index: number,
  precision: number,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: "Feature",
    id: featureKey(feature, index),
    properties: feature.properties ?? {},
  };
  if (feature.geometry !== undefined && feature.geometry !== null) {
    out.geometry = reduceGeometryPrecision(feature.geometry, precision);
  } else {
    out.geometry = null;
  }
  return out;
}

function serializeFeatures(features: GeoLibreFeatureInput[], precision: number): string {
  const collection = {
    type: "FeatureCollection",
    features: features.map((feature, index) => serializeFeature(feature, index, precision)),
  };
  return compactJson(collection);
}

/** Build a geometry-less FeatureCollection of identifiers.
 *
 * @param rows iterable of `{ fid, properties }` pairs; the fid becomes the
 *   GeoJSON feature `id` so EpidBot can echo edits back keyed by fid.
 */
export function buildIdentifiersGeojson(
  rows: Array<{ fid: string | number; properties: Record<string, unknown> }>,
): string {
  const collection = {
    type: "FeatureCollection",
    features: rows.map((row) => ({
      type: "Feature",
      id: row.fid,
      properties: { ...row.properties },
      geometry: null,
    })),
  };
  return compactJson(collection);
}

// ---------------------------------------------------------------------------
// Attachment collection
// ---------------------------------------------------------------------------

/** One prepared attachment: serialized GeoJSON plus reporting for the chips
 * and the interactive reduction flow. */
export interface Attachment {
  scope: AttachmentScope;
  label: string;
  geojson: string;
  featureCount: number;
  sizeBytes: number;
  overBudget: boolean;
  /** Semantic join key advertised to EpidBot (identifiers scope only). */
  joinKey?: string | null;
  /** Set when the payload was uploaded as a server artifact instead of being
   * sent inline. */
  artifactId?: number;
}

export interface CollectAttachmentInput {
  scope: AttachmentScope;
  layerName: string;
  /** All features of the layer (host getLayerFeatures). */
  features: GeoLibreFeatureInput[];
  /** Features selected on the map (host getSelectedFeatures); used by the
   * selection scope. The caller must verify they belong to this layer. */
  selectedFeatures?: GeoLibreFeatureInput[];
  /** Current view bounds [w, s, e, n] (host getViewBounds). */
  viewBounds?: GeoLibreBounds | null;
  budgetBytes?: number;
  precision?: number;
}

/** Serialize a layer (or a subset of it) as compact GeoJSON.
 *
 * @returns the attachment with `overBudget` reported so the caller can offer
 *   reductions.
 * @throws LayerExportError on unsupported scope, missing selection/bounds, or
 *   when the feature count exceeds HARD_FEATURE_LIMIT.
 */
export function collectAttachment(input: CollectAttachmentInput): Attachment {
  const { scope } = input;
  if (!SCOPE_CHOICES.includes(scope)) {
    throw new LayerExportError(`unknown scope: ${String(scope)}`);
  }
  const budgetBytes = input.budgetBytes ?? DEFAULT_INLINE_BUDGET;
  const precision = input.precision ?? GEOMETRY_PRECISION;

  let features: GeoLibreFeatureInput[];
  if (scope === SCOPE_SELECTION) {
    features = input.selectedFeatures ?? [];
    if (features.length === 0) {
      throw new LayerExportError(`No features selected on layer '${input.layerName}'`);
    }
  } else if (scope === SCOPE_EXTENT) {
    if (!input.viewBounds) {
      throw new LayerExportError("the current extent is required for this scope");
    }
    features = input.features.filter((feature) => {
      const bounds = geometryBounds(feature.geometry);
      return bounds !== null && intersectsExtent(bounds, input.viewBounds!);
    });
  } else {
    features = input.features;
  }

  if (features.length > HARD_FEATURE_LIMIT) {
    throw new LayerExportError(
      `${features.length.toLocaleString("en-US")} features exceed the inline limit of ` +
        `${HARD_FEATURE_LIMIT.toLocaleString("en-US")}`,
    );
  }

  const geojson = serializeFeatures(features, precision);
  return {
    scope,
    label: `${input.layerName} (${SCOPE_LABELS[scope]})`,
    geojson,
    featureCount: features.length,
    sizeBytes: sizeBytes(geojson),
    overBudget: overBudget(geojson, budgetBytes),
  };
}

/** Identifiers scope: fid + join-key fields only (no geometry), so EpidBot
 * can propose `epidbot-edit` operations keyed to real features. */
export function collectIdentifiers(input: Omit<CollectAttachmentInput, "scope">): Attachment {
  const budgetBytes = input.budgetBytes ?? DEFAULT_INLINE_BUDGET;
  const fieldCounts = new Map<string, number>();
  for (const feature of input.features) {
    const properties = feature.properties;
    if (!properties || typeof properties !== "object") continue;
    for (const name of Object.keys(properties)) {
      fieldCounts.set(name, (fieldCounts.get(name) ?? 0) + 1);
    }
  }
  const fieldNames = [...fieldCounts.keys()];
  const joinKey = pickJoinKey(fieldNames);
  const subset = joinKey ? [joinKey] : fieldNames.slice(0, 3);

  const rows = input.features.map((feature, index) => {
    const properties: Record<string, unknown> = {};
    const source = (feature.properties ?? {}) as Record<string, unknown>;
    for (const name of subset) properties[name] = source[name] ?? null;
    return { fid: featureKey(feature, index), properties };
  });

  const geojson = buildIdentifiersGeojson(rows);
  return {
    scope: SCOPE_IDENTIFIERS,
    label: `${input.layerName} (${SCOPE_LABELS.identifiers})`,
    geojson,
    featureCount: rows.length,
    sizeBytes: sizeBytes(geojson),
    overBudget: overBudget(geojson, budgetBytes),
    joinKey,
  };
}
