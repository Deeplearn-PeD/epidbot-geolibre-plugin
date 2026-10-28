import { describe, expect, it } from "vitest";
import {
  csvToFeatureCollection,
  parseCsv,
  sniffCsvCoordinateColumns,
  splitCsvLine,
} from "../src/api/csvSource";

const CSV = `municipio,ibgecode,latitude,longitude
Rio de Janeiro,3304557,-22.9,-43.2
Niterói,3303302,-22.88,-43.1
`;

describe("splitCsvLine", () => {
  it("splits plain fields", () => {
    expect(splitCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("honors quoted commas and escaped quotes", () => {
    expect(splitCsvLine('"a,b",c,"say ""hi"""')).toEqual(["a,b", "c", 'say "hi"']);
  });
});

describe("parseCsv", () => {
  it("parses the header and tolerates BOM and CRLF", () => {
    const records = parseCsv("\uFEFFa,b\r\n1,2\r\n3,4\n");
    expect(records).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("caps the row count", () => {
    const rows = parseCsv("a\n1\n2\n3", 2);
    expect(rows).toHaveLength(2);
  });

  it("returns nothing without a header", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("sniffCsvCoordinateColumns", () => {
  it("finds latitude/longitude columns and validates them numerically", () => {
    const records = parseCsv(CSV);
    expect(sniffCsvCoordinateColumns(records)).toEqual(["latitude", "longitude"]);
  });

  it("accepts the documented aliases", () => {
    const records = parseCsv("nu_latitude,lon_x\n1,2\n");
    expect(sniffCsvCoordinateColumns(records)).toEqual(["nu_latitude", "lon_x"]);
  });

  it("rejects non-numeric coordinate columns", () => {
    const records = parseCsv("latitude,longitude\nnorth,west\n");
    expect(sniffCsvCoordinateColumns(records)).toEqual([null, null]);
  });

  it("returns nulls when the columns are missing", () => {
    expect(sniffCsvCoordinateColumns(parseCsv("a,b\n1,2\n"))).toEqual([null, null]);
  });
});

describe("csvToFeatureCollection", () => {
  it("converts rows into EPSG:4326 points carrying all columns", () => {
    const result = csvToFeatureCollection(CSV);
    expect(result).not.toBeNull();
    expect(result!.featureCount).toBe(2);
    expect(result!.latColumn).toBe("latitude");
    expect(result!.lonColumn).toBe("longitude");
    const feature = result!.fc.features[0]!;
    expect(feature.geometry).toEqual({ type: "Point", coordinates: [-43.2, -22.9] });
    expect(feature.properties).toEqual({
      municipio: "Rio de Janeiro",
      ibgecode: "3304557",
      latitude: "-22.9",
      longitude: "-43.2",
    });
  });

  it("returns null when there are no usable coordinates", () => {
    expect(csvToFeatureCollection("a,b\n1,2\n")).toBeNull();
    expect(csvToFeatureCollection("")).toBeNull();
  });
});
