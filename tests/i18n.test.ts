import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/en";
import { ptBR } from "../src/i18n/pt-BR";
import { KEY_PREFIX, interpolate } from "../src/i18n";

function keysOf(map: Record<string, string>): string[] {
  return Object.keys(map).sort();
}

describe("translation catalogs", () => {
  it("en and pt-BR carry the same key set", () => {
    const enKeys = keysOf(en);
    const ptKeys = keysOf(ptBR);
    const missingInPt = enKeys.filter((key) => !ptBR[key]);
    const missingInEn = ptKeys.filter((key) => !en[key]);
    expect(missingInPt).toEqual([]);
    expect(missingInEn).toEqual([]);
    expect(enKeys).toEqual(ptKeys);
  });

  it("every key is namespaced under plugin.epidbot.", () => {
    for (const key of Object.keys(en)) {
      expect(key.startsWith(KEY_PREFIX)).toBe(true);
    }
    for (const key of Object.keys(ptBR)) {
      expect(key.startsWith(KEY_PREFIX)).toBe(true);
    }
  });

  it("no catalog value is empty", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), key).not.toBe("");
    }
    for (const [key, value] of Object.entries(ptBR)) {
      expect(value.trim(), key).not.toBe("");
    }
  });
});

describe("interpolate", () => {
  it("substitutes {{param}} placeholders", () => {
    expect(interpolate("{{n}} features", { n: 3 })).toBe("3 features");
    expect(interpolate("HTTP {{status}}!", { status: 500 })).toBe("HTTP 500!");
  });

  it("leaves unknown placeholders and plain text alone", () => {
    expect(interpolate("job {{job}}", undefined)).toBe("job {{job}}");
    expect(interpolate("job {{job}}", { other: 1 })).toBe("job {{job}}");
  });
});
