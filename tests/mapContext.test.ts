import { describe, expect, it } from "vitest";
import {
  attachContext,
  buildContextText,
  buildMapContext,
  DEFAULT_MAP_CONTEXT_BUDGET,
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
    });
    const payload = buildMapContext(app);
    expect(payload.crs).toBe("EPSG:4326");
    expect(payload.viewBounds).toEqual([-43.1235, -23.9877, -43.0, -22.9]);
    expect(payload.layers).toEqual([
      { name: "Municipios", type: "geojson", visible: true },
      { name: "Raster", type: "geojson", visible: false },
    ]);
    expect(payload.selection).toEqual({
      layerId: "Municipios",
      count: 1,
      rows: [{ nome: "Rio de Janeiro", casos: 1200 }],
    });
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
      name: `Camada de municipios numero ${i} com nome comprido`,
      type: "geojson",
      visible: true,
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
