/** Load EpidBot-provided CSV tables as point layers.
 *
 * TS counterpart of the coordinate half of the QGIS plugin's
 * core/layer_loader.py: sniff latitude/longitude columns in the header and
 * first rows, then convert the table into a point FeatureCollection
 * (EPSG:4326) that `addGeoJsonLayer` can place on the map. The host has no
 * delimited-text provider, so the conversion happens client-side.
 */

import type { GeoLibreFeatureInput } from "../lib/geolibre/host-api";

/** Column names accepted as coordinates (lowercase). */
const LAT_NAMES = ["lat", "latitude", "y", "nu_latitude", "lat_y"];
const LON_NAMES = ["lon", "long", "longitude", "x", "nu_longitude", "lon_x"];

/** A single CSV record: header names -> raw field text. */
export type CsvRecord = Record<string, string>;

/** Split one CSV line, honoring double-quoted fields (RFC 4180 subset). */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/** Parse CSV text into records (header row required; BOM tolerated).
 * At most `maxRows` records are returned. */
export function parseCsv(text: string, maxRows = 50_000): CsvRecord[] {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = clean.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((name) => name.trim());
  const records: CsvRecord[] = [];
  for (const line of lines.slice(1)) {
    if (records.length >= maxRows) break;
    const values = splitCsvLine(line);
    const record: CsvRecord = {};
    header.forEach((name, index) => {
      record[name] = (values[index] ?? "").trim();
    });
    records.push(record);
  }
  return records;
}

function matchColumn(columns: string[], candidates: string[]): string | null {
  for (const candidate of candidates) {
    const found = columns.find((name) => name.toLowerCase() === candidate);
    if (found !== undefined) return found;
  }
  return null;
}

function toNumber(value: string): number | null {
  if (value === "") return null;
  const num = Number(value.replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

/** Find latitude/longitude columns from the header + first rows.
 * The columns must actually hold numbers, like the QGIS sniffer.
 * @returns `[latColumn, lonColumn]` or `[null, null]`. */
export function sniffCsvCoordinateColumns(records: CsvRecord[]): [string | null, string | null] {
  if (records.length === 0) return [null, null];
  const columns = Object.keys(records[0]);
  const lat = matchColumn(columns, LAT_NAMES);
  const lon = matchColumn(columns, LON_NAMES);
  if (lat === null || lon === null) return [null, null];
  for (const record of records.slice(0, 5)) {
    if (toNumber(record[lat]) === null || toNumber(record[lon]) === null) return [null, null];
  }
  return [lat, lon];
}

/** Convert CSV text into a point FeatureCollection; null when no usable
 * coordinate columns exist (the text is then shown as a plain download). */
export function csvToFeatureCollection(text: string): {
  fc: { type: "FeatureCollection"; features: GeoLibreFeatureInput[] };
  featureCount: number;
  latColumn: string;
  lonColumn: string;
} | null {
  const records = parseCsv(text);
  const [latColumn, lonColumn] = sniffCsvCoordinateColumns(records);
  if (latColumn === null || lonColumn === null) return null;
  const features: GeoLibreFeatureInput[] = [];
  for (const record of records) {
    const lat = toNumber(record[latColumn]);
    const lon = toNumber(record[lonColumn]);
    if (lat === null || lon === null) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: record,
    });
  }
  if (features.length === 0) return null;
  return {
    fc: { type: "FeatureCollection", features },
    featureCount: features.length,
    latColumn,
    lonColumn,
  };
}
