import { describe, expect, it } from "vitest";
import {
  extractResultBlocks,
  geometrySummary,
  isGeoJsonUrl,
  isTileUrl,
  validateGeoJson,
} from "../src/api/results";

const FC = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { m: "A" } },
    { type: "Feature", geometry: { type: "Point", coordinates: [1, 1] }, properties: { m: "B" } },
  ],
};

describe("validateGeoJson", () => {
  it("accepts a FeatureCollection and counts geometry types", () => {
    const result = validateGeoJson(FC);
    expect(result.ok).toBe(true);
    expect(result.featureCount).toBe(2);
    expect(result.geometryTypes).toEqual([["Point", 2]]);
  });

  it("wraps a bare Feature", () => {
    const result = validateGeoJson(FC.features[0]);
    expect(result.ok).toBe(true);
    expect(result.fc?.features).toHaveLength(1);
  });

  it("rejects empty collections, wrong types and junk", () => {
    expect(validateGeoJson({ type: "FeatureCollection", features: [] }).ok).toBe(false);
    expect(validateGeoJson({ type: "GeometryCollection" }).ok).toBe(false);
    expect(validateGeoJson("x").ok).toBe(false);
    expect(validateGeoJson(null).ok).toBe(false);
    expect(validateGeoJson([FC]).ok).toBe(false);
    expect(
      validateGeoJson({ type: "FeatureCollection", features: [42] }).ok,
    ).toBe(false);
  });

  it("normalizes null properties to {} and null geometry to type none", () => {
    const result = validateGeoJson({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: null, properties: null }],
    });
    expect(result.ok).toBe(true);
    expect(result.geometryTypes).toEqual([["none", 1]]);
    expect((result.fc?.features[0] as { properties: object }).properties).toEqual({});
  });

  it("reports Multi geometries under their single kind", () => {
    const result = validateGeoJson({
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "MultiPolygon" }, properties: {} },
        { type: "Feature", geometry: { type: "Polygon" }, properties: {} },
      ],
    });
    expect(result.geometryTypes).toEqual([["Polygon", 2]]);
  });
});

describe("extractResultBlocks", () => {
  it("finds a fenced geojson block", () => {
    const text = `Some text.\n\n\`\`\`geojson\n${JSON.stringify(FC, null, 2)}\n\`\`\`\n\nMore text.`;
    const blocks = extractResultBlocks(text);
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    expect(block.kind).toBe("geojson");
    if (block.kind === "geojson") {
      expect(block.featureCount).toBe(2);
      expect(geometrySummary(block.geometryTypes)).toBe("Point ×2");
    }
  });

  it("wraps a fenced json Feature and skips invalid or non-data fences", () => {
    const text = [
      "```json",
      JSON.stringify(FC.features[0]),
      "```",
      "```json",
      "{not json",
      "```",
      "```python",
      '{"type": "FeatureCollection", "features": []}',
      "```",
    ].join("\n");
    const blocks = extractResultBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("geojson");
  });

  it("finds tile and geojson URLs, deduplicated, https only", () => {
    const text = [
      "Tiles: https://tiles.example.com/dengue/{z}/{x}/{y}.png",
      "Same again: https://tiles.example.com/dengue/{z}/{x}/{y}.png",
      "Data: https://data.example.com/cases.geojson?year=2025",
      "Service: https://api.example.com/dados?format=geojson&uf=rj",
      "Article: https://example.com/blog/dengue-overview",
      "Insecure: http://tiles.example.com/{z}/{x}/{y}.png",
    ].join("\n");
    const blocks = extractResultBlocks(text);
    expect(blocks.filter((b) => b.kind === "url")).toHaveLength(3);
  });

  it("ignores URLs inside code fences", () => {
    const text = "```\nhttps://tiles.example.com/{z}/{x}/{y}.png\n```";
    expect(extractResultBlocks(text)).toHaveLength(0);
  });

  it("does not capture the closing paren of markdown links", () => {
    const text = "See [the data](https://data.example.com/cases.geojson).";
    const blocks = extractResultBlocks(text);
    expect(blocks).toHaveLength(1);
    if (blocks[0].kind === "url") {
      expect(blocks[0].url.endsWith(".geojson")).toBe(true);
    }
  });

  it("returns no blocks for plain prose", () => {
    expect(extractResultBlocks("Dengue cases rose by 12%.")).toEqual([]);
    expect(extractResultBlocks("")).toEqual([]);
  });
});

describe("url classifiers", () => {
  it("isTileUrl", () => {
    expect(isTileUrl("https://t.com/{z}/{x}/{y}.png")).toBe(true);
    expect(isTileUrl("https://t.com/{Z}/{X}/{Y}.png")).toBe(true);
    expect(isTileUrl("https://t.com/tms/{z}/{x}/{y}.png")).toBe(true);
    expect(isTileUrl("https://t.com/data.geojson")).toBe(false);
  });

  it("isGeoJsonUrl", () => {
    expect(isGeoJsonUrl("https://d.com/cases.geojson")).toBe(true);
    expect(isGeoJsonUrl("https://d.com/cases.geojson?year=2025")).toBe(true);
    expect(isGeoJsonUrl("https://d.com/api?format=geojson")).toBe(true);
    expect(isGeoJsonUrl("https://d.com/data.json")).toBe(false); // needs a geo hint
    expect(isGeoJsonUrl("https://d.com/geodata.json")).toBe(true);
    expect(isGeoJsonUrl("https://d.com/page.html")).toBe(false);
  });
});
