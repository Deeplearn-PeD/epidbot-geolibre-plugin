import { describe, expect, it } from "vitest";
import type { GeoLibreFeatureCollection } from "../src/lib/geolibre/host-api";
import {
  CHOROPLETH_COLORS,
  choroplethStyle,
  defaultStyle,
  dominantNumericProperty,
  quantileBreaks,
  styleFor,
} from "../src/results/style";

function fc(
  features: Array<{ geometry: string; properties: Record<string, unknown> }>,
): GeoLibreFeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      geometry:
        f.geometry === "none" ? null : ({ type: f.geometry, coordinates: [0, 0] } as unknown),
      properties: f.properties,
    })),
  };
}

describe("quantileBreaks", () => {
  it("returns classCount monotonic breaks", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const breaks = quantileBreaks(values);
    expect(breaks).not.toBeNull();
    expect(breaks).toHaveLength(5);
    for (let i = 1; i < breaks!.length; i += 1) {
      expect(breaks![i]).toBeGreaterThanOrEqual(breaks![i - 1]);
    }
    expect(breaks![0]).toBe(1);
    expect(breaks![4]).toBe(100);
  });

  it("returns null for constant or too-short series", () => {
    expect(quantileBreaks([5, 5, 5, 5, 5, 5])).toBeNull();
    expect(quantileBreaks([1, 2, 3, 4])).toBeNull();
    expect(quantileBreaks([])).toBeNull();
  });

  it("accepts distinct series at the minimum length", () => {
    expect(quantileBreaks([10, 20, 30, 40, 50])).toEqual([10, 20, 30, 40, 50]);
  });
});

describe("dominantNumericProperty", () => {
  it("picks the property with the highest numeric coverage", () => {
    const summary = dominantNumericProperty(
      fc([
        { geometry: "Polygon", properties: { casos: 10, nome: "A" } },
        { geometry: "Polygon", properties: { casos: 20, nome: "B" } },
        { geometry: "Polygon", properties: { casos: 30, nome: "C" } },
      ]),
    );
    expect(summary?.property).toBe("casos");
    expect(summary?.coverage).toBe(1);
  });

  it("returns null when no numeric property exists", () => {
    expect(
      dominantNumericProperty(fc([{ geometry: "Polygon", properties: { nome: "A" } }])),
    ).toBeNull();
  });

  it("ignores non-finite numbers", () => {
    const summary = dominantNumericProperty(
      fc([
        { geometry: "Polygon", properties: { casos: Number.NaN } },
        { geometry: "Polygon", properties: { casos: 3 } },
      ]),
    );
    expect(summary?.values).toEqual([3]);
  });
});

describe("styleFor", () => {
  it("builds a choropleth for polygon layers with a classifiable property", () => {
    const features = Array.from({ length: 20 }, (_, i) => ({
      geometry: "Polygon",
      properties: { casos: i + 1 },
    }));
    const style = JSON.parse(styleFor(fc(features))) as {
      fill: { "fill-color": unknown[] };
    };
    expect(style.fill["fill-color"][0]).toBe("interpolate");
    // The property name rides inside the ["get", prop] accessor.
    expect(JSON.stringify(style.fill["fill-color"])).toContain('"casos"');
    // Five class anchors, each paired with a ColorBrewer color.
    const anchors = style.fill["fill-color"].slice(3).filter((v) => typeof v === "number");
    expect(anchors).toHaveLength(5);
    expect(style.fill["fill-color"]).toContain(CHOROPLETH_COLORS[4]);
  });

  it("falls back to the uniform style when no property classifies", () => {
    const style = JSON.parse(
      styleFor(fc([{ geometry: "Polygon", properties: { nome: "A" } }])),
    ) as { fill: { "fill-color": string } };
    expect(style.fill["fill-color"]).toBe("#2456a6");
  });

  it("styles point and line layers without a choropleth", () => {
    const points = JSON.parse(
      styleFor(fc([{ geometry: "Point", properties: { casos: 5 } }])),
    ) as Record<string, unknown>;
    expect(points.circle).toBeDefined();
    expect(points.fill).toBeUndefined();

    const lines = JSON.parse(
      styleFor(fc([{ geometry: "LineString", properties: { casos: 5 } }])),
    ) as Record<string, unknown>;
    expect(lines.line).toBeDefined();
    expect(lines.fill).toBeUndefined();
  });
});

describe("style builders", () => {
  it("choropleth stops pair each break with a color in order", () => {
    const style = choroplethStyle("casos", [0, 10, 20, 30, 40]) as {
      fill: { "fill-color": unknown[] };
    };
    const tail = style.fill["fill-color"].slice(3);
    expect(tail[0]).toBe(0);
    expect(tail[1]).toBe(CHOROPLETH_COLORS[0]);
    expect(tail[8]).toBe(40);
    expect(tail[9]).toBe(CHOROPLETH_COLORS[4]);
  });

  it("defaultStyle covers each geometry", () => {
    expect(defaultStyle("polygon").fill).toBeDefined();
    expect(defaultStyle("line").line).toBeDefined();
    expect(defaultStyle("point").circle).toBeDefined();
  });
});
