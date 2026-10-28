import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/types";
import {
  CREDENTIAL_NAME,
  loadApiKey,
  sanitizeProjectState,
  sanitizeSettings,
  saveApiKey,
} from "../src/settings/store";
import { createFakeApp } from "./fake-app";

describe("API key storage", () => {
  it('reads "" when no key is stored or the host has no store', () => {
    const { app } = createFakeApp();
    expect(loadApiKey(app)).toBe("");
    expect(loadApiKey({} as Parameters<typeof loadApiKey>[0])).toBe("");
  });

  it("round-trips the key through the host credential store", () => {
    const { app, credentials } = createFakeApp();
    expect(saveApiKey(app, " secret ")).toBe("saved");
    expect(credentials.get(CREDENTIAL_NAME)).toBe("secret");
    expect(loadApiKey(app)).toBe("secret");
  });

  it("deletes with an empty string", () => {
    const { app, credentials } = createFakeApp();
    saveApiKey(app, "k");
    saveApiKey(app, "");
    expect(credentials.has(CREDENTIAL_NAME)).toBe(false);
    expect(loadApiKey(app)).toBe("");
  });

  it("reports session-only persistence when the host write fails", () => {
    const { app } = createFakeApp();
    app.credentials = {
      ...app.credentials,
      set: () => false,
    };
    expect(saveApiKey(app, "k")).toBe("session-only");
  });

  it("reports unavailable when the host has no credential store", () => {
    const { app } = createFakeApp();
    delete app.credentials;
    expect(saveApiKey(app, "k")).toBe("unavailable");
  });
});

describe("sanitizeSettings", () => {
  it("falls back to defaults on garbage", () => {
    for (const bad of [undefined, null, 42, "x", []]) {
      expect(sanitizeSettings(bad)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("clamps the poll interval into 0.5..10", () => {
    expect(sanitizeSettings({ pollIntervalSec: 0 }).pollIntervalSec).toBe(0.5);
    expect(sanitizeSettings({ pollIntervalSec: 99 }).pollIntervalSec).toBe(10);
    expect(sanitizeSettings({ pollIntervalSec: "3" }).pollIntervalSec).toBe(3);
    expect(sanitizeSettings({ pollIntervalSec: NaN }).pollIntervalSec).toBe(
      DEFAULT_SETTINGS.pollIntervalSec,
    );
  });

  it("normalizes the server URL", () => {
    expect(sanitizeSettings({ serverUrl: "api.example.com//" }).serverUrl).toBe(
      "https://api.example.com",
    );
    expect(sanitizeSettings({ serverUrl: "" }).serverUrl).toBe(DEFAULT_SETTINGS.serverUrl);
  });

  it("only accepts known locales and coerces booleans", () => {
    expect(sanitizeSettings({ answerLocale: "pt-BR" }).answerLocale).toBe("pt-BR");
    expect(sanitizeSettings({ answerLocale: "fr" }).answerLocale).toBe("en");
    expect(sanitizeSettings({ attachMapContext: false }).attachMapContext).toBe(false);
    expect(sanitizeSettings({}).attachMapContext).toBe(true);
  });

  it("never returns fields beyond the known settings", () => {
    const result = sanitizeSettings({ serverUrl: "https://x", apiKey: "SECRET", hack: true });
    expect(Object.keys(result).sort()).toEqual([
      "answerLocale",
      "artifactUploads",
      "attachMapContext",
      "inlineBudgetKb",
      "pollIntervalSec",
      "serverUrl",
    ]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("sanitizes the attachment budget and the artifact-upload switch", () => {
    expect(sanitizeSettings({}).inlineBudgetKb).toBe(DEFAULT_SETTINGS.inlineBudgetKb);
    expect(sanitizeSettings({ inlineBudgetKb: "128" }).inlineBudgetKb).toBe(128);
    expect(sanitizeSettings({ inlineBudgetKb: -5 }).inlineBudgetKb).toBe(
      DEFAULT_SETTINGS.inlineBudgetKb,
    );
    expect(sanitizeSettings({ inlineBudgetKb: 99999 }).inlineBudgetKb).toBe(2048);
    expect(sanitizeSettings({}).artifactUploads).toBe(false);
    expect(sanitizeSettings({ artifactUploads: true }).artifactUploads).toBe(true);
  });
});

describe("sanitizeProjectState", () => {
  it("falls back to defaults on garbage and wrong versions", () => {
    for (const bad of [undefined, null, "x", [], { version: 2 }]) {
      const state = sanitizeProjectState(bad);
      expect(state.version).toBe(1);
      expect(state.settings).toEqual(DEFAULT_SETTINGS);
      expect(state.sessionId).toBeNull();
    }
  });

  it("restores valid state", () => {
    const state = sanitizeProjectState({
      version: 1,
      settings: { serverUrl: "https://staging.example", answerLocale: "pt-BR", pollIntervalSec: 2 },
      sessionId: 42,
    });
    expect(state.sessionId).toBe(42);
    expect(state.settings.answerLocale).toBe("pt-BR");
    expect(state.settings.pollIntervalSec).toBe(2);
  });

  it("rejects non-integer or non-positive session ids", () => {
    for (const bad of ["7", 7.5, 0, -1, true]) {
      expect(sanitizeProjectState({ version: 1, sessionId: bad }).sessionId).toBeNull();
    }
  });

  it("strips secrets that should never be in a project file", () => {
    const state = sanitizeProjectState({
      version: 1,
      settings: { serverUrl: "https://x", apiKey: "SECRET" },
      apiKey: "TOPLEVEL-SECRET",
      sessionId: 1,
    });
    expect(JSON.stringify(state)).not.toContain("SECRET");
  });

  it("sanitizes the result-layer registry", () => {
    const valid = {
      layerId: "l1",
      name: "EpidBot · q",
      kind: "geojson",
      question: "q",
      addedAt: "2026-10-28T00:00:00.000Z",
    };
    const state = sanitizeProjectState({
      version: 1,
      resultLayers: [valid, { junk: true }, null, { ...valid, kind: "wrong" }],
    });
    expect(state.resultLayers).toEqual([valid]);

    const capped = sanitizeProjectState({
      version: 1,
      resultLayers: Array.from({ length: 60 }, (_, i) => ({ ...valid, layerId: `l${i}` })),
    });
    expect(capped.resultLayers).toHaveLength(50);
    expect(capped.resultLayers[0].layerId).toBe("l10");
  });
});
