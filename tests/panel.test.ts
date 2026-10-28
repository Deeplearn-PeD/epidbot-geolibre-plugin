import { describe, expect, it, vi } from "vitest";
import { EpidBotClient } from "../src/api/client";
import { EpidBotQuotaError } from "../src/api/errors";
import { createTranslator, registerEpidBotTranslations } from "../src/i18n";
import { DEFAULT_SETTINGS, type EpidBotSettings } from "../src/types";
import type { MapContextPayload } from "../src/api/mapContext";
import { EpidBotPanel, turnsFromHistory } from "../src/panel/panel";
import { createFakeApp, type FakeApp } from "./fake-app";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const SAMPLE_CONTEXT: MapContextPayload = {
  crs: "EPSG:4326",
  viewBounds: [-43.2, -23.1, -43.1, -22.9],
  layers: [{ name: "Municipios", type: "geojson", visible: true }],
  selection: null,
};

interface Harness {
  fake: FakeApp;
  panel: EpidBotPanel;
  client: {
    ask: ReturnType<typeof vi.fn>;
    getMessages: ReturnType<typeof vi.fn>;
    listSessions: ReturnType<typeof vi.fn>;
    fetchPlot: ReturnType<typeof vi.fn>;
    checkAuth: ReturnType<typeof vi.fn>;
  };
  settings: EpidBotSettings;
  onSettingsChange: ReturnType<typeof vi.fn>;
  onLayerAdded: ReturnType<typeof vi.fn>;
  /** Mutable context payload returned by the buildContext stub. */
  context: { payload: MapContextPayload | null };
}

function harness({ withKey = true }: { withKey?: boolean } = {}): Harness {
  const fake = createFakeApp();
  registerEpidBotTranslations(fake.app);
  const t = createTranslator(fake.app);
  if (withKey) fake.credentials.set("api-key", "KEY");

  const client = {
    ask: vi.fn(async () => ({
      sessionId: 5,
      content: "**Dengue** cases rose in the North region.",
      images: [],
    })),
    getMessages: vi.fn(async () => ({ messages: [] })),
    listSessions: vi.fn(async () => [{ id: 5, name: "Dengue work" }]),
    createSession: vi.fn(async (name: string) => ({ id: 77, name })),
    fetchPlot: vi.fn(async () => new Blob(["PNG"], { type: "image/png" })),
    checkAuth: vi.fn(async () => ({ email: "epi@example.org" })),
    withApiKey: vi.fn(() => ({ checkAuth: client.checkAuth })),
    extractPlotFilename: (ref: string) => EpidBotClient.extractPlotFilename(ref),
  };

  const settings: EpidBotSettings = { ...DEFAULT_SETTINGS };
  const onSettingsChange = vi.fn((next: EpidBotSettings) => {
    Object.assign(settings, next);
  });
  const onLayerAdded = vi.fn();
  const context: { payload: MapContextPayload | null } = { payload: { ...SAMPLE_CONTEXT } };

  const panel = new EpidBotPanel(fake.app, client as unknown as EpidBotClient, t, {
    getSettings: () => settings,
    onSettingsChange,
    getApiKey: () => fake.credentials.get("api-key") ?? "",
    buildContext: () => context.payload,
    onLayerAdded,
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  panel.attach(container);
  return { fake, panel, client, settings, onSettingsChange, onLayerAdded, context };
}

function composer(): { input: HTMLTextAreaElement; form: HTMLFormElement } {
  const input = document.querySelector<HTMLTextAreaElement>(".epidbot-composer textarea")!;
  const form = document.querySelector<HTMLFormElement>(".epidbot-composer")!;
  return { input, form };
}

async function submitQuestion(panel: EpidBotPanel, text: string): Promise<void> {
  const { input, form } = composer();
  input.value = text;
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
}

describe("EpidBotPanel", () => {
  it("renders the welcome card and session controls", () => {
    harness();
    expect(document.querySelector(".epidbot-welcome")).not.toBeNull();
    expect(document.querySelector(".epidbot-transcript")?.textContent).toContain("EpidBot");
    expect(composer().input.placeholder).toContain("epidemiological");
  });

  it("hides the API-key hint when a key is present", () => {
    harness({ withKey: true });
    expect(document.querySelector(".epidbot-welcome")?.textContent).not.toContain(
      "Add your EpidBot API key",
    );
  });

  it("asks a question and renders the markdown answer", async () => {
    const { panel, client } = harness();
    await submitQuestion(panel, "How many dengue cases in 2025?");

    expect(client.ask).toHaveBeenCalledWith(
      expect.stringContaining("How many dengue cases in 2025?"),
      expect.objectContaining({ sessionId: null, locale: "en" }),
    );
    const bubbles = document.querySelectorAll(".epidbot-msg");
    expect(bubbles[0].classList.contains("epidbot-msg-user")).toBe(true);
    expect(bubbles[0].textContent).toBe("How many dengue cases in 2025?");
    expect(bubbles[1].querySelector("strong")?.textContent).toBe("Dengue");
    // The server-reported session id lands in the session selector.
    const select = document.querySelector<HTMLSelectElement>(".epidbot-session-select select")!;
    expect(select.value).toBe("5");
    expect(panel.getSessionId()).toBe(5);
  });

  it("shows a localized error bubble when the API refuses", async () => {
    const fresh = harness();
    fresh.client.ask.mockRejectedValueOnce(new EpidBotQuotaError("quota", { status: 429 }));
    await submitQuestion(fresh.panel, "q");
    const error = document.querySelector(".epidbot-msg-error");
    expect(error?.textContent).toContain("quota exceeded");
  });

  it("refuses to ask without an API key and opens settings", async () => {
    const { panel } = harness({ withKey: false });
    await submitQuestion(panel, "q");
    expect(document.querySelector(".epidbot-msg-error")?.textContent).toContain("No API key");
    const details = document.querySelector<HTMLDetailsElement>(".epidbot-settings")!;
    expect(details.open).toBe(true);
  });

  it("loads a session's history through the client", async () => {
    const { panel, client } = harness();
    await flush(); // let refreshSessions populate the selector
    client.getMessages.mockResolvedValueOnce({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello", images: ["plots/a.png"] },
      ],
    });
    const select = document.querySelector<HTMLSelectElement>(".epidbot-session-select select")!;
    select.value = "5";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(client.getMessages).toHaveBeenCalledWith(5);
    const msgs = document.querySelectorAll(".epidbot-msg");
    expect(msgs.length).toBe(2);
    expect(msgs[1].textContent).toContain("hello");
    expect(panel.getSessionId()).toBe(5);
  });

  it("starts a new session locally, then binds the server-created one", async () => {
    const { panel, client } = harness();
    await submitQuestion(panel, "q");
    expect(panel.getSessionId()).toBe(5);
    const newButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "New session",
    )!;
    newButton.click();
    // Reset is immediate; the server-side creation follows asynchronously.
    expect(panel.getSessionId()).toBeNull();
    expect(document.querySelector(".epidbot-welcome")).not.toBeNull();
    await flush();
    expect(client.createSession).toHaveBeenCalledWith(expect.stringContaining("Session "));
    expect(panel.getSessionId()).toBe(77);
    const select = document.querySelector<HTMLSelectElement>(".epidbot-session-select select")!;
    expect(select.value).toBe("77");
  });

  it("keeps a local session when creation is impossible", async () => {
    const { panel, client } = harness({ withKey: false });
    panel.newSession();
    await flush();
    expect(client.createSession).not.toHaveBeenCalled();
    expect(panel.getSessionId()).toBeNull();
  });

  it("saves settings through the callbacks and the credential store", () => {
    const { onSettingsChange, settings } = harness();
    const form = document.querySelector<HTMLFormElement>(".epidbot-settings-form")!;
    const serverUrl = form.querySelector<HTMLInputElement>('input[type="url"]')!;
    serverUrl.value = "https://staging.example.com/";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(onSettingsChange).toHaveBeenCalledTimes(1);
    expect(settings.serverUrl).toBe("https://staging.example.com");
  });

  it("persists a changed API key into the host credential store", () => {
    const { fake, onSettingsChange } = harness();
    onSettingsChange.mockClear();
    const form = document.querySelector<HTMLFormElement>(".epidbot-settings-form")!;
    const keyInput = form.querySelector<HTMLInputElement>('input[type="password"]')!;
    keyInput.value = "BRAND-NEW-KEY";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(fake.credentials.get("api-key")).toBe("BRAND-NEW-KEY");
  });

  it("tests the key against /auth/me and reports the user", async () => {
    const { client } = harness();
    const testButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Test key",
    )!;
    testButton.click();
    await flush();
    expect(client.checkAuth).toHaveBeenCalled();
    const result = document.querySelector(".epidbot-test-result")!;
    expect(result.textContent).toContain("epi@example.org");
  });

  it("retranslates static labels", () => {
    const { panel } = harness();
    panel.retranslate();
    expect(document.querySelector(".epidbot-composer textarea")?.getAttribute("placeholder")).toContain(
      "epidemiological",
    );
  });

  it("disposes cleanly and can re-attach", () => {
    const { panel } = harness();
    panel.dispose();
    expect(document.querySelector(".epidbot-panel")).toBeNull();
    const container = document.createElement("div");
    document.body.appendChild(container);
    expect(() => panel.attach(container)).not.toThrow();
  });
});

describe("map context (F2)", () => {
  it("reflects the attach switch and persists toggles through settings", () => {
    const { onSettingsChange, settings } = harness();
    const checkbox = document.querySelector<HTMLInputElement>(".epidbot-context-attach input")!;
    expect(checkbox.checked).toBe(true);
    checkbox.click();
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ attachMapContext: false }),
    );
    expect(settings.attachMapContext).toBe(false);
  });

  it("previews the exact preamble with its byte size", () => {
    const { panel } = harness();
    const toggle = document.querySelector<HTMLButtonElement>(".epidbot-context-preview-toggle")!;
    toggle.click();
    const pre = document.querySelector<HTMLPreElement>(".epidbot-context-preview")!;
    expect(pre.hidden).toBe(false);
    expect(pre.textContent).toContain("[Map context]");
    expect(pre.textContent).toContain("-43.2");
    expect(pre.textContent).toMatch(/bytes$/m);
    toggle.click();
    expect(pre.hidden).toBe(true);
    void panel;
  });

  it("attaches the context to the outgoing message when enabled", async () => {
    const { panel, client } = harness();
    await submitQuestion(panel, "Why dengue here?");
    const message = client.ask.mock.calls[0][0] as string;
    expect(message).toContain("[Map context]");
    expect(message).toContain("Map extent: -43.2,-23.1 to -43.1,-22.9");
    expect(message.trim().endsWith("Why dengue here?")).toBe(true);
    // The user bubble shows the bare question, not the preamble.
    const bubbles = document.querySelectorAll(".epidbot-msg");
    expect(bubbles[0].textContent).toBe("Why dengue here?");
  });

  it("sends a bare question when the switch is off", async () => {
    const { panel, client } = harness();
    document.querySelector<HTMLInputElement>(".epidbot-context-attach input")!.click();
    await submitQuestion(panel, "Why dengue here?");
    expect(client.ask.mock.calls[0][0]).toBe("Why dengue here?");
  });

  it("force-attaches context once via 'ask about this extent'", async () => {
    const { panel, client } = harness();
    document.querySelector<HTMLInputElement>(".epidbot-context-attach input")!.click();
    panel.promptExtent();
    const { input } = composer();
    expect(input.value).toContain("current map extent");
    await submitQuestion(panel, input.value);
    expect(client.ask.mock.calls[0][0]).toContain("[Map context]");
    // The one-shot override is spent: the next question goes out bare.
    await submitQuestion(panel, "plain question");
    expect(client.ask.mock.calls[1][0]).toBe("plain question");
  });

  it("'ask about this selection' requires a selection", async () => {
    const { fake, panel, client } = harness();
    panel.promptSelection();
    expect(document.querySelector(".epidbot-status")?.textContent).toContain(
      "No features are selected",
    );
    expect(composer().input.value).toBe("");
    expect(client.ask).not.toHaveBeenCalled();
    void fake;
  });

  it("'ask about this selection' prefills when features are selected", () => {
    const { fake, panel } = harness();
    fake.selectedFeatures.push({ type: "Feature", properties: { nome: "X" } });
    panel.promptSelection();
    expect(composer().input.value).toContain("selected features");
  });

  it("'ask about this extent' without bounds shows a notice", () => {
    const { context, panel } = harness();
    context.payload = null;
    panel.promptExtent();
    expect(document.querySelector(".epidbot-status")?.textContent).toContain(
      "not available",
    );
    expect(composer().input.value).toBe("");
  });
});

describe("results on the map (F3)", () => {
  const GEOJSON_ANSWER = [
    "Here are the dengue cases by municipality:",
    "",
    "```geojson",
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
          properties: { casos: 10, nome: "A" },
        },
        {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [[[2, 0], [3, 0], [3, 1], [2, 0]]] },
          properties: { casos: 30, nome: "B" },
        },
      ],
    }),
    "```",
  ].join("\n");

  async function askWithContent(content: string) {
    const h = harness();
    h.client.ask.mockResolvedValueOnce({
      sessionId: null,
      content,
      images: [],
    });
    await submitQuestion(h.panel, "q");
    await flush();
    return h;
  }

  it("renders an Add-to-map card for a GeoJSON answer", async () => {
    await askWithContent(GEOJSON_ANSWER);
    const card = document.querySelector(".epidbot-result");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("2 features");
    expect(card?.textContent).toContain("Polygon ×2");
    const buttons = Array.from(card!.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toContain("Add to map");
    expect(buttons).toContain("Download .geojson");
  });

  it("adds the layer with a plugin name, style and provenance record", async () => {
    const { fake, onLayerAdded } = await askWithContent(GEOJSON_ANSWER);
    const add = Array.from(document.querySelectorAll<HTMLButtonElement>(".epidbot-result button")).find(
      (b) => b.textContent === "Add to map",
    )!;
    add.click();
    await flush();
    expect(fake.addedLayers).toHaveLength(1);
    expect(fake.addedLayers[0].name.startsWith("EpidBot · ")).toBe(true);
    expect(fake.addedLayers[0].data.features).toHaveLength(2);
    expect(onLayerAdded).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "geojson", layerId: "layer-1" }),
    );
    expect(add.disabled).toBe(true);
    expect(add.textContent).toBe("Added ✓");
  });

  it("offers tile URLs as tile layers", async () => {
    const { fake } = await askWithContent(
      "You can load the data from https://tiles.example.com/dengue/{z}/{x}/{y}.png",
    );
    const add = Array.from(document.querySelectorAll<HTMLButtonElement>(".epidbot-result button")).find(
      (b) => b.textContent === "Add as tile layer",
    )!;
    add.click();
    await flush();
    expect(fake.addedTiles).toHaveLength(1);
    expect(fake.addedTiles[0].url).toContain("{z}/{x}/{y}");
  });

  it("hides map actions on non-2D renderers", async () => {
    const h = harness();
    h.fake.renderer = "cesium";
    h.client.ask.mockResolvedValueOnce({ sessionId: null, content: GEOJSON_ANSWER, images: [] });
    await submitQuestion(h.panel, "q");
    await flush();
    expect(document.querySelector(".epidbot-result")).toBeNull();
  });

  it("shows no cards when the answer has no valid map blocks", async () => {
    await askWithContent("```geojson\n{broken\n```");
    expect(document.querySelector(".epidbot-result")).toBeNull();
  });
});

describe("turnsFromHistory", () => {
  it("accepts a wrapped message list and unknown shapes", () => {
    const turns = turnsFromHistory({
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: "a", images: ["plots/a.png"] },
        { role: "assistant" },
        null,
      ],
    });
    expect(turns).toEqual([
      { role: "user", text: "q", images: [] },
      { role: "assistant", text: "a", images: ["plots/a.png"] },
    ]);
  });

  it("accepts a bare array", () => {
    expect(turnsFromHistory([{ role: "user", content: "x" }])).toHaveLength(1);
  });
});
