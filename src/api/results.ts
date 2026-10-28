/** Result extraction from EpidBot answers.
 *
 * Scans an answer's markdown for map-worthy blocks:
 * - fenced ```geojson / ```json code blocks that parse as GeoJSON
 *   FeatureCollections (a bare Feature is wrapped);
 * - https URLs that look like data services: XYZ tile templates
   ({z}/{x}/{y}) or .geojson/.json endpoints.
 *
 * Parsing is defensive by design (README §8: answers may contain GeoJSON
 * that is wrong or empty) — anything that does not validate is left as
 * plain text in the transcript and never reaches the map.
 */

import type { GeoLibreFeatureCollection } from "../lib/geolibre/host-api";

/** Upper bound on accepted feature counts (sanity, not a product limit). */
export const MAX_FEATURES = 50_000;

export interface GeoJsonResultBlock {
  kind: "geojson";
  fc: GeoLibreFeatureCollection;
  featureCount: number;
  /** Unique geometry types with counts, e.g. [["Point", 12], ["Polygon", 3]]. */
  geometryTypes: Array<[string, number]>;
}

export interface LayerUrlResultBlock {
  kind: "url";
  url: string;
  urlKind: "tiles" | "geojson" | "csv";
  /** True for EpidBot artifact URLs (fetched with the API key). */
  artifact?: boolean;
}

export type ResultBlock = GeoJsonResultBlock | LayerUrlResultBlock;

const FENCE_OPEN = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE = /^```\s*$/;
const URL_RE = /https?:\/\/[^\s<>"`')\]]+/g;

/** Fence language reserved for attribute edit operations (see
 * api/layerEditor.ts). Parsed separately from geo sources. */
export const EDIT_FENCE_LANG = "epidbot-edit";

/** EpidBot artifact URLs are loadable layers even without a known extension. */
const ARTIFACT_PATH = "/api/v1/artifacts/";

/** Iterate fenced blocks (```lang … ```) in document order; runs of an
 * unterminated fence are passed too (like the QGIS regex). */
function forEachFence(text: string, visit: (lang: string, code: string) => void): void {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let lang: string | null = null;
  let code: string[] = [];
  for (const line of lines) {
    if (lang !== null) {
      if (FENCE_CLOSE.test(line)) {
        visit(lang, code.join("\n"));
        lang = null;
        code = [];
      } else {
        code.push(line);
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      lang = open[1] ?? "";
      code = [];
    }
  }
  if (lang !== null) visit(lang, code.join("\n"));
}

export interface Validation {
  ok: boolean;
  reason?: string;
  fc?: GeoLibreFeatureCollection;
  featureCount?: number;
  geometryTypes?: Array<[string, number]>;
}

function normalizeGeometryType(type: unknown): string {
  if (typeof type !== "string" || type === "") return "none";
  return type.startsWith("Multi") ? type.slice(5) : type;
}

/** Validate parsed JSON as a FeatureCollection (or a single Feature, which
 * is wrapped). Returns a reason when the block should not reach the map. */
export function validateGeoJson(value: unknown): Validation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "not an object" };
  }
  const record = value as Record<string, unknown>;
  let features: unknown[];
  if (record.type === "FeatureCollection") {
    if (!Array.isArray(record.features)) return { ok: false, reason: "features is not an array" };
    features = record.features;
  } else if (record.type === "Feature") {
    features = [record];
  } else {
    return { ok: false, reason: `unsupported type: ${String(record.type)}` };
  }
  if (features.length === 0) return { ok: false, reason: "empty feature collection" };
  if (features.length > MAX_FEATURES) {
    return { ok: false, reason: `too many features (${features.length})` };
  }
  const counts = new Map<string, number>();
  const normalized: unknown[] = [];
  for (const item of features) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, reason: "feature is not an object" };
    }
    const feature = item as Record<string, unknown>;
    if (feature.type !== "Feature" && feature.type !== undefined) {
      return { ok: false, reason: `unsupported feature type: ${String(feature.type)}` };
    }
    const geometry = feature.geometry as Record<string, unknown> | null | undefined;
    if (geometry !== null && geometry !== undefined) {
      if (typeof geometry !== "object" || Array.isArray(geometry)) {
        return { ok: false, reason: "geometry is not an object" };
      }
    }
    const kind = normalizeGeometryType(geometry?.type);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    normalized.push({
      type: "Feature",
      geometry: geometry ?? null,
      properties: (feature.properties ?? null) === null ? {} : feature.properties,
    });
  }
  return {
    ok: true,
    fc: { type: "FeatureCollection", features: normalized },
    featureCount: features.length,
    geometryTypes: [...counts.entries()],
  };
}

function parseGeoJsonFence(lang: string, code: string): GeoJsonResultBlock | null {
  const lower = lang.trim().toLowerCase();
  if (lower !== "geojson" && lower !== "json") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(code);
  } catch {
    return null;
  }
  const validation = validateGeoJson(parsed);
  if (!validation.ok || !validation.fc) return null;
  return {
    kind: "geojson",
    fc: validation.fc,
    featureCount: validation.featureCount ?? 0,
    geometryTypes: validation.geometryTypes ?? [],
  };
}

export function isTileUrl(url: string): boolean {
  return /\{[-z]\}\/\{[-x]\}\/\{[-y]\}/i.test(url);
}

export function isGeoJsonUrl(url: string): boolean {
  if (/\.geojson(\?|#|$)/i.test(url)) return true;
  if (/format=geojson/i.test(url)) return true;
  const path = url.split("?", 1)[0].split("#", 1)[0];
  return /\.json$/i.test(path) && /geo/i.test(url);
}

/** The id path segment of an EpidBot artifact URL, or null. */
export function artifactIdFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    if (!path.includes(ARTIFACT_PATH)) return null;
    return path.slice(path.lastIndexOf("/") + 1) || null;
  } catch {
    return null;
  }
}

/** CSV URLs become spatial layers client-side when coordinate columns exist. */
export function isCsvUrl(url: string): boolean {
  const path = url.split("?", 1)[0].split("#", 1)[0];
  return /\.csv$/i.test(path);
}

function classifyUrl(url: string): LayerUrlResultBlock | null {
  // EpidBot artifact URLs are pulled through the authenticated downloader,
  // so plain http (local dev servers) is acceptable for them alone.
  const artifactId = artifactIdFromUrl(url);
  if (artifactId !== null) {
    return {
      kind: "url",
      url: url.replace(/[.,;:!?)'"]+$/, ""),
      urlKind: "geojson",
      artifact: true,
    };
  }
  if (!url.startsWith("https://")) return null; // only https reaches the map
  if (isTileUrl(url)) return { kind: "url", url, urlKind: "tiles" };
  if (isGeoJsonUrl(url)) return { kind: "url", url, urlKind: "geojson" };
  if (isCsvUrl(url)) return { kind: "url", url, urlKind: "csv" };
  return null;
}

/** Extract map-worthy blocks from an answer. GeoJSON fences come first (in
 * document order), then data URLs (deduplicated, capped). */
export function extractResultBlocks(text: string, maxUrlBlocks = 5): ResultBlock[] {
  if (!text) return [];
  const blocks: ResultBlock[] = [];
  const fenceRanges: Array<[number, number]> = [];

  // Pass 1: fenced geojson/json blocks (tracked so URLs inside are skipped).
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let offset = 0;
  let fence: { lang: string; code: string[]; start: number } | null = null;
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    if (fence) {
      if (FENCE_CLOSE.test(line)) {
        const block = parseGeoJsonFence(fence.lang, fence.code.join("\n"));
        if (block) blocks.push(block);
        fenceRanges.push([fence.start, lineStart + line.length]);
        fence = null;
      } else {
        fence.code.push(line);
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) fence = { lang: open[1] ?? "", code: [], start: lineStart };
  }

  // Pass 2: data URLs outside fences.
  const outside = fenceRanges.reduce(
    (acc, [start, end]) => acc.slice(0, start) + " ".repeat(end - start) + acc.slice(end),
    text,
  );
  const seen = new Set<string>();
  for (const match of outside.matchAll(URL_RE)) {
    if (blocks.filter((b) => b.kind === "url").length >= maxUrlBlocks) break;
    const block = classifyUrl(match[0]);
    if (block && !seen.has(block.url)) {
      seen.add(block.url);
      blocks.push(block);
    }
  }
  return blocks;
}

/** "Point ×12, Polygon ×3" summary for a result card. */
export function geometrySummary(types: Array<[string, number]>): string {
  return types.map(([type, count]) => `${type} ×${count}`).join(", ");
}

/** Extract attribute edit operations from ```epidbot-edit blocks.
 *
 * Malformed blocks are skipped (never fail the whole message); structural
 * validation happens in api/layerEditor.validateEditOp.
 */
export function extractEditOps(text: string): unknown[] {
  const ops: unknown[] = [];
  forEachFence(text ?? "", (lang, code) => {
    if (lang.trim().toLowerCase() !== EDIT_FENCE_LANG) return;
    const content = code.trim();
    if (!content) return;
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      return;
    }
    if (Array.isArray(data)) {
      ops.push(
        ...data.filter((item) => item !== null && typeof item === "object" && !Array.isArray(item)),
      );
    } else if (data !== null && typeof data === "object") {
      ops.push(data);
    }
  });
  return ops;
}
