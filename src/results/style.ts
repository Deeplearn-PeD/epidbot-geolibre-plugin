/** Default styling for EpidBot result layers.
 *
 * Builds Mapbox GL style JSON (one of the three formats the host's
 * importLayerStyle understands; applied as text and merged over the layer's
 * current style). A polygon layer whose features share a dominant numeric
 * property gets a 5-class quantile choropleth; everything else gets a
 * uniform EpicBot-branded fill/line/circle style. If the host cannot apply
 * the style it reports {ok:false} and the host default remains — never a
 * hard failure.
 */

import type { GeoLibreFeatureCollection } from "../lib/geolibre/host-api";

export const CLASS_COUNT = 5;

/** ColorBrewer YlGnBu, 5-class — legible over standard basemaps. */
export const CHOROPLETH_COLORS = ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"];

/** Quantile breaks including both ends (min..max). Returns null when the
 * values cannot support CLASS_COUNT distinct classes. */
export function quantileBreaks(values: number[], classCount = CLASS_COUNT): number[] | null {
  if (values.length < classCount) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const breaks: number[] = [];
  for (let k = 0; k < classCount; k += 1) {
    const position = (k * (sorted.length - 1)) / (classCount - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const value =
      lower === upper
        ? sorted[lower]
        : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
    breaks.push(value);
  }
  const distinct = new Set(breaks);
  if (distinct.size < classCount) return null;
  return breaks;
}

export interface NumericPropertySummary {
  property: string;
  values: number[];
  coverage: number;
}

/** Find the numeric property with the highest coverage across features. */
export function dominantNumericProperty(fc: GeoLibreFeatureCollection): NumericPropertySummary | null {
  const counts = new Map<string, { count: number; values: number[] }>();
  const features = fc.features as Array<{ properties?: Record<string, unknown> | null }>;
  for (const feature of features) {
    const properties = feature.properties ?? {};
    for (const [key, value] of Object.entries(properties)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const entry = counts.get(key) ?? { count: 0, values: [] };
      entry.count += 1;
      entry.values.push(value);
      counts.set(key, entry);
    }
  }
  let best: { property: string; count: number; values: number[] } | null = null;
  for (const [property, { count, values }] of counts) {
    if (!best || count > best.count) best = { property, count, values };
  }
  if (!best || best.count === 0) return null;
  return {
    property: best.property,
    values: best.values,
    coverage: best.count / Math.max(features.length, 1),
  };
}

function dominantGeometry(fc: GeoLibreFeatureCollection): "point" | "line" | "polygon" {
  const counts = new Map<string, number>();
  for (const feature of fc.features as Array<{ geometry?: { type?: string } | null }>) {
    const type = feature.geometry?.type ?? "";
    const kind = type.startsWith("Multi")
      ? type.slice(5)
      : type || "point";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  let best = "point";
  let bestCount = -1;
  for (const [kind, count] of counts) {
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  if (best === "LineString") return "line";
  if (best === "Polygon") return "polygon";
  return "point";
}

/** Uniform style per dominant geometry (EpidBot blue). */
export function defaultStyle(geometry: "point" | "line" | "polygon"): Record<string, unknown> {
  switch (geometry) {
    case "polygon":
      return {
        fill: { "fill-color": "#2456a6", "fill-opacity": 0.45 },
        line: { "line-color": "#1c4688", "line-width": 1 },
      };
    case "line":
      return { line: { "line-color": "#2456a6", "line-width": 2 } };
    case "point":
      return { circle: { "circle-color": "#2456a6", "circle-radius": 5, "circle-opacity": 0.8 } };
  }
}

/** 5-class quantile choropleth for polygons, using a data-driven fill. */
export function choroplethStyle(
  property: string,
  breaks: number[],
): Record<string, unknown> {
  const stops: unknown[] = [];
  breaks.forEach((value, index) => {
    stops.push(value, CHOROPLETH_COLORS[index]);
  });
  return {
    fill: {
      "fill-color": [
        "interpolate",
        ["linear"],
        ["to-number", ["get", property]],
        ...stops,
      ],
      "fill-opacity": 0.7,
    },
    line: { "line-color": "#333333", "line-width": 0.5, "line-opacity": 0.8 },
  };
}

/** Build the style text for a result FeatureCollection: choropleth when the
 * geometry is polygonal and a numeric property classifies cleanly, otherwise
 * the uniform default. Serialized for importLayerStyle. */
export function styleFor(fc: GeoLibreFeatureCollection): string {
  const geometry = dominantGeometry(fc);
  let style: Record<string, unknown>;
  if (geometry === "polygon") {
    const summary = dominantNumericProperty(fc);
    const breaks = summary ? quantileBreaks(summary.values) : null;
    style =
      summary && breaks
        ? choroplethStyle(summary.property, breaks)
        : defaultStyle(geometry);
  } else {
    style = defaultStyle(geometry);
  }
  return JSON.stringify(style);
}
