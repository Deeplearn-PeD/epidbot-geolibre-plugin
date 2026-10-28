import { describe, expect, it } from "vitest";
import {
  buildIdentifiersGeojson,
  collectAttachment,
  collectIdentifiers,
  DEFAULT_INLINE_BUDGET,
  featureKey,
  geometryBounds,
  GEOMETRY_PRECISION,
  LayerExportError,
  overBudget,
  pickJoinKey,
  reduceGeometryPrecision,
  SCOPE_LABELS,
  sizeBytes,
} from "../src/api/layerExport";
import type { GeoLibreFeatureInput } from "../src/lib/geolibre/host-api";

function point(
  lon: number,
  lat: number,
  properties: Record<string, unknown> = {},
  id?: number,
): GeoLibreFeatureInput {
  return {
    type: "Feature",
    ...(id !== undefined ? { id } : {}),
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties,
  };
}

function polygon(ring: number[][], properties: Record<string, unknown> = {}): GeoLibreFeatureInput {
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties };
}

const MUNI_FEATURES = [
  point(-43.2, -22.9, { cd_mun: "3304557", municipio: "Rio de Janeiro" }),
  point(-43.1, -22.9, { cd_mun: "3303302", municipio: "Niterói" }),
  point(-43.4, -23.1, { cd_mun: "3301701", municipio: "Duque de Caxias" }),
];

describe("pickJoinKey", () => {
  it("prefers semantic municipality codes case-insensitively", () => {
    expect(pickJoinKey(["NOME", "CD_MUN"])).toBe("CD_MUN");
    expect(pickJoinKey(["CodMun", "nome"])).toBe("CodMun");
    expect(pickJoinKey(["co_uf", "estado"])).toBe("co_uf");
  });

  it("returns null without a semantic field", () => {
    expect(pickJoinKey(["nome", "valor"])).toBeNull();
  });
});

describe("geometry helpers", () => {
  it("computes bounds across geometry kinds", () => {
    expect(geometryBounds(point(-43.2, -22.9))).toEqual([-43.2, -22.9, -43.2, -22.9]);
    const bounds = geometryBounds(
      polygon([
        [-43.5, -23.2],
        [-43.0, -22.8],
        [-43.2, -23.0],
        [-43.5, -23.2],
      ]),
    );
    expect(bounds).toEqual([-43.5, -23.2, -43.0, -22.8]);
  });

  it("returns null for geometry-less features", () => {
    expect(geometryBounds(null)).toBeNull();
    expect(geometryBounds({ type: "Point", coordinates: [] })).toBeNull();
  });

  it("reduces coordinate precision without touching attributes", () => {
    const geometry = reduceGeometryPrecision(
      { type: "Point", coordinates: [-43.123456789, -22.912345678, 50] },
      4,
    );
    expect((geometry as { coordinates: number[] }).coordinates).toEqual([-43.1235, -22.9123, 50]);
    const multi = reduceGeometryPrecision(
      {
        type: "GeometryCollection",
        geometries: [{ type: "Point", coordinates: [1.123456, 2.123456] }],
      },
      2,
    );
    expect(
      (multi as { geometries: Array<{ coordinates: number[] }> }).geometries[0].coordinates,
    ).toEqual([1.12, 2.12]);
  });
});

describe("sizes and budgets", () => {
  it("measures UTF-8 byte length", () => {
    expect(sizeBytes("abc")).toBe(3);
    expect(sizeBytes("ã")).toBe(2);
  });

  it("flags over-budget payloads", () => {
    expect(overBudget("xxx", 2)).toBe(true);
    expect(overBudget("x", 10)).toBe(false);
    expect(overBudget("x", 0)).toBe(true);
  });
});

describe("collectAttachment", () => {
  const viewBounds: [number, number, number, number] = [-43.25, -23.0, -43.05, -22.85];

  it("serializes every feature on the all scope with ids and compact JSON", () => {
    const result = collectAttachment({
      scope: "all",
      layerName: "Municipios",
      features: MUNI_FEATURES.map((f, i) => (i === 0 ? point(-43.2, -22.9, f.properties!, 7) : f)),
    });
    const parsed = JSON.parse(result.geojson) as {
      type: string;
      features: Array<{ id: number | string; geometry: unknown; properties: unknown }>;
    };
    expect(parsed.type).toBe("FeatureCollection");
    expect(parsed.features).toHaveLength(3);
    expect(parsed.features[0].id).toBe(7);
    // Compact: byte-identical to JSON.stringify with no indent.
    expect(result.geojson).toBe(JSON.stringify(JSON.parse(result.geojson)));
    expect(result.label).toBe(`Municipios (${SCOPE_LABELS.all})`);
    expect(result.overBudget).toBe(false);
  });

  it("falls back to positional keys when the host gives no ids", () => {
    const result = collectAttachment({ scope: "all", layerName: "L", features: MUNI_FEATURES });
    const parsed = JSON.parse(result.geojson) as { features: Array<{ id: number }> };
    expect(parsed.features.map((f) => f.id)).toEqual([0, 1, 2]);
    expect(featureKey(MUNI_FEATURES[0]!, 0)).toBe(0);
    expect(featureKey(point(0, 0, {}, "abc"), 0)).toBe("abc");
  });

  it("keeps only features intersecting the extent", () => {
    const result = collectAttachment({
      scope: "extent",
      layerName: "Municipios",
      features: MUNI_FEATURES,
      viewBounds,
    });
    expect(result.featureCount).toBe(2); // Caxias (-23.1) is outside
    const parsed = JSON.parse(result.geojson) as {
      features: Array<{ properties: { municipio: string } }>;
    };
    expect(parsed.features.map((f) => f.properties.municipio).sort()).toEqual([
      "Niterói",
      "Rio de Janeiro",
    ]);
  });

  it("polygon extents intersect, not merely contain", () => {
    const bigPolygon = polygon([
      [-45, -25],
      [-40, -25],
      [-40, -20],
      [-45, -20],
      [-45, -25],
    ]);
    const result = collectAttachment({
      scope: "extent",
      layerName: "Region",
      features: [bigPolygon, point(10, 10)],
      viewBounds,
    });
    expect(result.featureCount).toBe(1);
  });

  it("uses the selection features as given", () => {
    const selected = [MUNI_FEATURES[1]!];
    const result = collectAttachment({
      scope: "selection",
      layerName: "Municipios",
      features: MUNI_FEATURES,
      selectedFeatures: selected,
    });
    expect(result.featureCount).toBe(1);
    expect(JSON.parse(result.geojson)).toMatchObject({
      features: [{ properties: { cd_mun: "3303302" } }],
    });
  });

  it("errors on an empty selection or a missing extent", () => {
    expect(() =>
      collectAttachment({ scope: "selection", layerName: "L", features: MUNI_FEATURES }),
    ).toThrow(LayerExportError);
    expect(() =>
      collectAttachment({ scope: "extent", layerName: "L", features: MUNI_FEATURES }),
    ).toThrow(LayerExportError);
    expect(() =>
      collectAttachment({ scope: "nope" as never, layerName: "L", features: [] }),
    ).toThrow(LayerExportError);
  });

  it("reports over_budget against the caller's budget", () => {
    const result = collectAttachment({
      scope: "all",
      layerName: "Municipios",
      features: MUNI_FEATURES,
      budgetBytes: 10,
    });
    expect(result.overBudget).toBe(true);
  });

  it("rejects payloads beyond the hard feature limit", () => {
    const many = Array.from({ length: 50_001 }, (_, i) => point(i / 100, i / 100));
    expect(() => collectAttachment({ scope: "all", layerName: "L", features: many })).toThrow(
      /inline limit/,
    );
  });

  it("reduces precision as a size-reduction option", () => {
    const detailed = [
      point(-43.123456789, -22.987654321, { cd_mun: "3304557" }),
      point(-43.123456788, -22.987654322, { cd_mun: "3303302" }),
    ];
    const full = collectAttachment({ scope: "all", layerName: "L", features: detailed });
    const reduced = collectAttachment({
      scope: "all",
      layerName: "L",
      features: detailed,
      precision: 3,
    });
    expect(reduced.sizeBytes).toBeLessThan(full.sizeBytes);
    const parsed = JSON.parse(reduced.geojson) as {
      features: Array<{ geometry: { coordinates: number[] } }>;
    };
    expect(parsed.features[0]!.geometry.coordinates).toEqual([-43.123, -22.988]);
    expect(GEOMETRY_PRECISION).toBe(6);
    expect(DEFAULT_INLINE_BUDGET).toBe(64 * 1024);
  });
});

describe("collectIdentifiers", () => {
  it("emits geometry-less features keyed by fid with only the join key", () => {
    const result = collectIdentifiers({ layerName: "Municipios", features: MUNI_FEATURES });
    expect(result.scope).toBe("identifiers");
    expect(result.joinKey).toBe("cd_mun");
    const parsed = JSON.parse(result.geojson) as {
      features: Array<{ id: number; geometry: unknown; properties: Record<string, unknown> }>;
    };
    expect(parsed.features).toHaveLength(3);
    expect(parsed.features[0]!.geometry).toBeNull();
    expect(parsed.features[0]!.properties).toEqual({ cd_mun: "3304557" });
    expect(parsed.features[0]!.id).toBe(0);
  });

  it("falls back to the first fields when nothing is semantic", () => {
    const features = [
      point(0, 0, { a: 1, b: 2, c: 3, d: 4 }),
      point(1, 1, { a: 5, b: 6, c: 7, d: 8 }),
    ];
    const result = collectIdentifiers({ layerName: "L", features });
    expect(result.joinKey).toBeNull();
    const parsed = JSON.parse(result.geojson) as {
      features: Array<{ properties: Record<string, unknown> }>;
    };
    expect(Object.keys(parsed.features[0]!.properties)).toEqual(["a", "b", "c"]);
  });

  it("builds identifier geojson from raw rows too", () => {
    const text = buildIdentifiersGeojson([{ fid: "x", properties: { k: 1 } }]);
    expect(JSON.parse(text)).toMatchObject({
      features: [{ id: "x", properties: { k: 1 }, geometry: null }],
    });
  });

  it("flags over-budget identifier payloads", () => {
    const features = Array.from({ length: 500 }, (_, i) =>
      point(i, i, { cd_mun: `LONG-CODE-${i}-PADDING-PADDING` }),
    );
    const result = collectIdentifiers({ layerName: "L", features, budgetBytes: 1000 });
    expect(result.overBudget).toBe(true);
  });
});
