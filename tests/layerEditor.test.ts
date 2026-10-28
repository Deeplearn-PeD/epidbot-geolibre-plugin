import { describe, expect, it } from "vitest";
import {
  applyEditOp,
  buildLayerKeys,
  chooseJoinKey,
  coerceValue,
  EditOpError,
  planEdit,
  requireJoinField,
  validateEditOp,
} from "../src/api/layerEditor";
import type { GeoLibreAppAPI, GeoLibreFeatureInput } from "../src/lib/geolibre/host-api";

function feature(properties: Record<string, unknown>, id?: number): GeoLibreFeatureInput {
  return { type: "Feature", ...(id !== undefined ? { id } : {}), geometry: null, properties };
}

const MUNI_FEATURES = [
  feature({ cd_mun: "3304557", municipio: "Rio de Janeiro", pop: 6748000 }),
  feature({ cd_mun: "3303302", municipio: "Niterói", pop: 515000 }),
  feature({ cd_mun: "3301701", municipio: "Duque de Caxias", pop: 924000 }),
];

const ADD_OP = {
  op: "add_field",
  layer: "Municipios",
  field: { name: "pop_2024", type: "integer" },
  key: "cd_mun",
  confidence: "fetched",
  values: { 3304557: 7000000, "3303302": "520000" },
};

describe("validateEditOp", () => {
  it("normalizes types and values", () => {
    const op = validateEditOp({
      op: "add_field",
      field: { name: " x ", type: "INT64" },
      key: " CD_MUN ",
      values: { a: 1 },
      confidence: "estimated",
      layer: "L",
    });
    expect(op).toEqual({
      op: "add_field",
      layer: "L",
      field: { name: "x", type: "integer" },
      key: "CD_MUN",
      values: { a: 1 },
      confidence: "estimated",
    });
  });

  it("rejects structural garbage", () => {
    expect(() => validateEditOp(null)).toThrow(EditOpError);
    expect(() => validateEditOp([])).toThrow(EditOpError);
    expect(() =>
      validateEditOp({ op: "drop_table", field: { name: "x" }, key: "k", values: { a: 1 } }),
    ).toThrow(/unsupported operation/);
    expect(() =>
      validateEditOp({ op: "add_field", field: {}, key: "k", values: { a: 1 } }),
    ).toThrow(/missing a field name/);
    expect(() =>
      validateEditOp({ op: "add_field", field: { name: "x" }, values: { a: 1 } }),
    ).toThrow(/missing the join key/);
    expect(() => validateEditOp({ op: "add_field", field: { name: "x" }, key: "k" })).toThrow(
      /no values/,
    );
    expect(() =>
      validateEditOp({ op: "add_field", field: { name: "x" }, key: "k", values: {} }),
    ).toThrow(/no values/);
  });
});

describe("coerceValue", () => {
  it("coerces integers, numbers, booleans and strings", () => {
    expect(coerceValue("42", "integer")).toBe(42);
    expect(coerceValue(1.9, "integer")).toBe(1);
    expect(coerceValue("1,5", "double")).toBe(1.5);
    expect(coerceValue("sim", "boolean")).toBe(true);
    expect(coerceValue("não", "boolean")).toBe(false);
    expect(coerceValue(true, "boolean")).toBe(true);
    expect(coerceValue(7, "string")).toBe("7");
  });

  it("raises on garbage", () => {
    expect(() => coerceValue("abc", "integer")).toThrow(/not an integer/);
    expect(() => coerceValue("abc", "number")).toThrow(/not a number/);
    expect(() => coerceValue("maybe", "boolean")).toThrow(/not a boolean/);
  });
});

describe("planEdit / buildLayerKeys", () => {
  it("matches values to feature indices by key", () => {
    const keys = buildLayerKeys(MUNI_FEATURES, "cd_mun");
    const plan = planEdit(ADD_OP.values, keys, "integer");
    expect(plan.matched.size).toBe(2);
    expect(plan.matched.get(0)).toBe(7000000);
    expect(plan.matched.get(1)).toBe(520000);
    expect(plan.unmatched).toEqual([]);
    expect(plan.invalid).toEqual([]);
  });

  it("reports unmatched and invalid entries without failing", () => {
    const keys = buildLayerKeys(MUNI_FEATURES, "cd_mun");
    const plan = planEdit({ 3304557: 1, "9999999": 2, "3301701": "oops" }, keys, "integer");
    expect(plan.matched.size).toBe(1);
    expect(plan.unmatched).toEqual(["9999999"]);
    expect(plan.invalid).toEqual([
      { key: "3301701", value: "oops", error: expect.stringContaining("not an integer") },
    ]);
  });

  it("joins by fid using host ids or positions", () => {
    const withIds = [feature({ v: 1 }, "fid-a"), feature({ v: 2 }, "fid-b")];
    const keys = buildLayerKeys(withIds, "fid");
    expect(keys.get("fid-a")).toBe(0);
    expect(keys.get("fid-b")).toBe(1);
    const positional = buildLayerKeys(MUNI_FEATURES, "fid");
    expect(positional.get("0")).toBe(0);
    expect(positional.get("2")).toBe(2);
  });

  it("requires the join field to exist", () => {
    expect(() => requireJoinField(MUNI_FEATURES, "cd_mun", "Municipios")).not.toThrow();
    expect(() => requireJoinField(MUNI_FEATURES, "fid", "Municipios")).not.toThrow();
    expect(() => requireJoinField(MUNI_FEATURES, "inexistente", "Municipios")).toThrow(/not found/);
  });

  it("chooses the advertised join key", () => {
    expect(chooseJoinKey(["NOME", "CODMUN"])).toBe("CODMUN");
    expect(chooseJoinKey(["nome"])).toBe("fid");
  });
});

describe("applyEditOp", () => {
  interface HostLayer {
    data: { type: "FeatureCollection"; features: GeoLibreFeatureInput[] };
    updates: number;
  }

  function hostWith(layer: HostLayer): { app: GeoLibreAppAPI; layer: HostLayer } {
    const app = {
      getLayerFeatures: () => layer.data.features,
      updateGeoJsonLayer: (
        _layerId: string,
        data: { type: "FeatureCollection"; features: GeoLibreFeatureInput[] },
      ) => {
        layer.updates += 1;
        layer.data = data;
        return true;
      },
    } as unknown as GeoLibreAppAPI;
    return { app, layer };
  }

  it("adds a field after preview, and revert restores the snapshot", () => {
    const layer: HostLayer = {
      data: { type: "FeatureCollection", features: MUNI_FEATURES },
      updates: 0,
    };
    const { app } = hostWith(layer);
    const report = applyEditOp(
      app,
      { layerId: "l1", layerName: "Municipios", features: MUNI_FEATURES },
      ADD_OP,
    );
    expect(report.matched).toBe(2);
    expect(report.unmatched).toEqual([]);
    expect(layer.updates).toBe(1);
    const written = layer.data.features as Array<Record<string, Record<string, unknown>>>;
    expect(written[0]!.properties.pop_2024).toBe(7000000);
    expect(written[1]!.properties.pop_2024).toBe(520000);
    expect(written[2]!.properties.pop_2024).toBeUndefined();

    report.revert();
    expect(layer.updates).toBe(2);
    expect(
      (layer.data.features[0] as Record<string, Record<string, unknown>>).properties.pop_2024,
    ).toBeUndefined();
    // Revert is idempotent.
    report.revert();
    expect(layer.updates).toBe(2);
  });

  it("updates an existing field", () => {
    const layer: HostLayer = {
      data: { type: "FeatureCollection", features: MUNI_FEATURES },
      updates: 0,
    };
    const { app } = hostWith(layer);
    applyEditOp(
      app,
      { layerId: "l1", layerName: "Municipios", features: MUNI_FEATURES },
      {
        op: "update_field",
        field: { name: "pop", type: "number" },
        key: "cd_mun",
        values: { 3304557: "7000000,5" },
      },
    );
    expect((layer.data.features[0] as Record<string, Record<string, unknown>>).properties.pop).toBe(
      7000000.5,
    );
  });

  it("refuses add_field over an existing field and update_field on a missing one", () => {
    const { app } = hostWith({
      data: { type: "FeatureCollection", features: MUNI_FEATURES },
      updates: 0,
    });
    expect(() =>
      applyEditOp(
        app,
        { layerId: "l1", layerName: "Municipios", features: MUNI_FEATURES },
        {
          op: "add_field",
          field: { name: "pop", type: "integer" },
          key: "cd_mun",
          values: { 3304557: 1 },
        },
      ),
    ).toThrow(/already exists/);
    expect(() =>
      applyEditOp(
        app,
        { layerId: "l1", layerName: "Municipios", features: MUNI_FEATURES },
        {
          op: "update_field",
          field: { name: "nope", type: "integer" },
          key: "cd_mun",
          values: { 3304557: 1 },
        },
      ),
    ).toThrow(/does not exist/);
  });

  it("refuses to write when nothing matches", () => {
    const layer: HostLayer = {
      data: { type: "FeatureCollection", features: MUNI_FEATURES },
      updates: 0,
    };
    const { app } = hostWith(layer);
    expect(() =>
      applyEditOp(
        app,
        { layerId: "l1", layerName: "Municipios", features: MUNI_FEATURES },
        { op: "add_field", field: { name: "x", type: "integer" }, key: "cd_mun", values: { 1: 2 } },
      ),
    ).toThrow(/no features matched/);
    expect(layer.updates).toBe(0);
  });

  it("throws when the host cannot update layers", () => {
    expect(() =>
      applyEditOp(
        {} as GeoLibreAppAPI,
        { layerId: "l1", layerName: "L", features: MUNI_FEATURES },
        ADD_OP,
      ),
    ).toThrow(/cannot update layer data/);
  });

  it("throws when the host refuses the update (nothing written)", () => {
    const app = {
      updateGeoJsonLayer: () => false,
    } as unknown as GeoLibreAppAPI;
    expect(() =>
      applyEditOp(app, { layerId: "l1", layerName: "L", features: MUNI_FEATURES }, ADD_OP),
    ).toThrow(/refused/);
  });
});
