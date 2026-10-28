import { describe, expect, it } from "vitest";
import {
  attachContext,
  buildContextText,
  buildMapContext,
  DEFAULT_MAP_CONTEXT_BUDGET,
  describeFields,
  sampleRow,
  type MapContextBudget,
  type MapContextPayload,
} from "../src/api/mapContext";
import type {
  GeoLibreAppAPI,
  GeoLibreFeatureInput,
  GeoLibreLayerSummary,
} from "../src/lib/geolibre/host-api";

function feature(properties: Record<string, unknown>): GeoLibreFeatureInput {
  return { type: "Feature", properties };
}

function layer(name: string, visible: boolean): GeoLibreLayerSummary {
  return { id: name, name, type: "geojson", visible, opacity: 1 };
}

function appWith(overrides: Record<string, unknown> = {}): GeoLibreAppAPI {
  return { addGeoJsonLayer: () => "l", ...overrides } as unknown as GeoLibreAppAPI;
}

describe("buildMapContext", () => {
  it("returns an empty payload on a host without map members", () => {
    const payload = buildMapContext(appWith());
    expect(payload).toEqual({
      crs: "EPSG:3857 (default Web Mercator)",
      viewBounds: null,
      layers: [],
      selection: null,
    });
    expect(buildContextText(payload)).toBe("");
  });

  it("collects bounds, CRS, layers and selection", () => {
    const app = appWith({
      listLayers: () => [layer("Municipios", true), layer("Raster", false)],
      getViewBounds: () => [-43.123456, -23.987654, -43.000011, -22.9],
      getMapCrs: () => ({ id: "1", code: "EPSG:4326" }),
      getSelectedLayerId: () => "Municipios",
      getSelectedFeatures: () => [
        feature({ nome: "Rio de Janeiro", casos: 1200, geo: { complex: true } }),
      ],
      getLayerFeatures: (layerId: string) =>
        layerId === "Municipios"
          ? [
              feature({ nome: "Rio de Janeiro", casos: 1200 }),
              feature({ nome: "Niterói", casos: 340 }),
            ]
          : [],
    });
    const payload = buildMapContext(app);
    expect(payload.crs).toBe("EPSG:4326");
    expect(payload.viewBounds).toEqual([-43.1235, -23.9877, -43.0, -22.9]);
    expect(payload.layers).toEqual([
      {
        id: "Municipios",
        name: "Municipios",
        type: "geojson",
        visible: true,
        featureCount: 2,
        selectedCount: 1,
        fields: [
          { name: "nome", type: "string", samples: ["Rio de Janeiro", "Niterói"] },
          { name: "casos", type: "integer", samples: ["1200", "340"] },
        ],
        fieldsMore: 0,
      },
      {
        id: "Raster",
        name: "Raster",
        type: "geojson",
        visible: false,
        featureCount: null,
        selectedCount: null,
        fields: [],
        fieldsMore: 0,
      },
    ]);
    expect(payload.selection).toEqual({
      layerId: "Municipios",
      count: 1,
      rows: [{ nome: "Rio de Janeiro", casos: 1200 }],
    });
  });

  it("renders layer schemas, sample values and counts (QGIS 0.2.0 parity)", () => {
    const app = appWith({
      listLayers: () => [layer("Municipios", true)],
      getLayerFeatures: () => [
        feature({ cd_mun: "3304557", municipio: "Rio de Janeiro", pop: 6748000 }),
        feature({ cd_mun: "3303302", municipio: "Niterói", pop: 515000 }),
        feature({ cd_mun: "3301701", municipio: "Duque de Caxias", pop: 924000 }),
      ],
    });
    const text = buildContextText(buildMapContext(app));
    expect(text).toContain('"Municipios" (geojson, 3 features)');
    expect(text).toContain("fields: cd_mun (string), municipio (string), pop (integer)");
    expect(text).toContain("municipio in {Rio de Janeiro, Niterói, Duque de Caxias}");
  });

  it("puts visible layers first so the cap never hides what the user sees", () => {
    const summaries = Array.from({ length: 12 }, (_, i) => layer(`L${i}`, i >= 8));
    const payload = buildMapContext(appWith({ listLayers: () => summaries }));
    expect(payload.layers.length).toBe(10);
    expect(payload.layers.slice(0, 4).every((l) => l.visible)).toBe(true);
  });

  it("selection is null when nothing is selected", () => {
    const payload = buildMapContext(
      appWith({ getSelectedFeatures: () => [], getSelectedLayerId: () => "x" }),
    );
    expect(payload.selection).toBeNull();
  });

  it("a broken layer does not kill the prompt", () => {
    const app = appWith({
      listLayers: () => [layer("Broken", true), layer("Fine", true)],
      getLayerFeatures: (layerId: string) => {
        if (layerId === "Broken") throw new Error("host exploded");
        return [feature({ ok: 1 })];
      },
    });
    const payload = buildMapContext(app);
    expect(payload.layers).toHaveLength(2);
    expect(payload.layers[0].featureCount).toBeNull();
    expect(payload.layers[1].featureCount).toBe(1);
  });
});

describe("describeFields", () => {
  it("infers integer, number, boolean and string types", () => {
    const described = describeFields([
      feature({ i: 1, f: 1.5, b: true, s: "abc" }),
      feature({ i: 2, f: 2, b: false, s: "bcd" }),
    ]);
    const byName = Object.fromEntries(described.fields.map((f) => [f.name, f.type]));
    expect(byName).toEqual({ i: "integer", f: "number", b: "boolean", s: "string" });
  });

  it("reports string for unknown or all-null fields", () => {
    const described = describeFields([feature({ nothing: null })]);
    expect(described.fields[0].type).toBe("string");
    expect(described.fields[0].samples).toBeUndefined();
  });

  it("drops high-cardinality fields from the sample list", () => {
    const features = Array.from({ length: 20 }, (_, i) => feature({ id: `ID-${i}` }));
    const described = describeFields(features);
    expect(described.fields[0].name).toBe("id");
    expect(described.fields[0].samples).toBeUndefined();
  });

  it("caps the scan and the listed field count", () => {
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`f${i}`, i]));
    const described = describeFields([feature(many)]);
    expect(described.fields).toHaveLength(15);
    expect(described.fieldsMore).toBe(10);
  });

  it("only samples values when there are features to scan", () => {
    const described = describeFields([]);
    expect(described.fields).toEqual([]);
    expect(described.fieldsMore).toBe(0);
  });
});

describe("sampleRow", () => {
  const budget = DEFAULT_MAP_CONTEXT_BUDGET;

  it("keeps primitives, skips objects, truncates long strings", () => {
    const row = sampleRow(
      feature({
        short: "ok",
        long: "x".repeat(60),
        count: 3,
        flag: false,
        nothing: null,
        nested: { a: 1 },
        list: [1, 2],
      }),
      budget,
    );
    expect(row).toEqual({
      short: "ok",
      long: "x".repeat(40),
      count: 3,
      flag: false,
      nothing: null,
    });
  });

  it("caps the number of fields per row", () => {
    const row = sampleRow(feature({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }), budget);
    expect(Object.keys(row)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("buildContextText budget", () => {
  const big: MapContextPayload = {
    crs: "EPSG:4326",
    viewBounds: [-43.123456, -23.987654, -43.000011, -22.9],
    layers: Array.from({ length: 8 }, (_, i) => ({
      id: `L${i}`,
      name: `Camada de municipios numero ${i} com nome comprido`,
      type: "geojson",
      visible: true,
      featureCount: null,
      selectedCount: null,
      fields: [],
      fieldsMore: 0,
    })),
    selection: {
      layerId: "Camada de municipios numero 0 com nome comprido",
      count: 30,
      rows: Array.from({ length: 15 }, (_, i) => ({
        nome: `Municipio numero ${i} com um nome bastante comprido`,
        casos: i * 10,
      })),
    },
  };

  it("renders the full preamble within the default budget", () => {
    const text = buildContextText(big);
    expect(text.startsWith("[Map context]")).toBe(true);
    expect(text).toContain("Selected features: 30");
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(
      DEFAULT_MAP_CONTEXT_BUDGET.maxBytes,
    );
  });

  it("reduces deterministically under a tiny budget", () => {
    const tiny: MapContextBudget = { ...DEFAULT_MAP_CONTEXT_BUDGET, maxBytes: 250 };
    const text = buildContextText(big, tiny);
    expect(text.startsWith("[Map context]")).toBe(true);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(250);
    // Selection is the first thing to go.
    expect(text).not.toContain("Selected features");
  });

  it("never returns a non-empty text over budget", () => {
    for (const budget of [50, 120, 200, 400, 1000, 4000]) {
      const text = buildContextText(big, { ...DEFAULT_MAP_CONTEXT_BUDGET, maxBytes: budget });
      expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(budget);
    }
  });
});

describe("attachContext", () => {
  it("prepends the preamble to the question", () => {
    expect(attachContext("Why dengue?", "[Map context]\nMap extent: 1,2 to 3,4")).toBe(
      "[Map context]\nMap extent: 1,2 to 3,4\n\nWhy dengue?",
    );
  });

  it("returns the bare question when there is no preamble", () => {
    expect(attachContext("Why dengue?", "")).toBe("Why dengue?");
  });
});
