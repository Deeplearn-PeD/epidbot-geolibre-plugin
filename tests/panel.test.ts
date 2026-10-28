import { describe, expect, it, vi } from "vitest";
import { EpidBotClient } from "../src/api/client";
import { ChatCancelledError, EpidBotQuotaError } from "../src/api/errors";
import { createTranslator, registerEpidBotTranslations } from "../src/i18n";
import { DEFAULT_SETTINGS, type EpidBotSettings } from "../src/types";
import type { MapContextPayload } from "../src/api/mapContext";
import { EpidBotPanel, turnsFromHistory } from "../src/panel/panel";
import { createFakeApp, type FakeApp } from "./fake-app";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const SAMPLE_CONTEXT: MapContextPayload = {
  crs: "EPSG:4326",
  viewBounds: [-43.2, -23.1, -43.1, -22.9],
  layers: [
    {
      id: "Municipios",
      name: "Municipios",
      type: "geojson",
      visible: true,
      featureCount: 5570,
      selectedCount: null,
      fields: [{ name: "cd_mun", type: "string", samples: ["3304557"] }],
      fieldsMore: 0,
    },
  ],
  selection: null,
};

interface Harness {
  fake: FakeApp;
  panel: EpidBotPanel;
  client: {
    ask: ReturnType<typeof vi.fn>;
    getMessages: ReturnType<typeof vi.fn>;
    listSessions: ReturnType<typeof vi.fn>;
    createSession: ReturnType<typeof vi.fn>;
    fetchPlot: ReturnType<typeof vi.fn>;
    checkAuth: ReturnType<typeof vi.fn>;
    uploadArtifact: ReturnType<typeof vi.fn>;
    downloadWithAuth: ReturnType<typeof vi.fn>;
  };
  settings: EpidBotSettings;
  onSettingsChange: ReturnType<typeof vi.fn>;
  onLayerAdded: ReturnType<typeof vi.fn>;
  /** Mutable context payload returned by the buildContext stub. */
  context: { payload: MapContextPayload | null };
  /** The host cleanup returned by attach() (detach, not dispose). */
  cleanup: () => void;
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
    uploadArtifact: vi.fn(async () => ({ id: 91 })),
    downloadWithAuth: vi.fn(
      async () =>
        new Blob([JSON.stringify({ type: "FeatureCollection", features: [] })], {
          type: "application/geo+json",
        }),
    ),
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
  const cleanup = panel.attach(container);
  return {
    fake,
    panel,
    client,
    settings,
    onSettingsChange,
    onLayerAdded,
    context,
    cleanup,
  };
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
    expect(
      document.querySelector(".epidbot-composer textarea")?.getAttribute("placeholder"),
    ).toContain("epidemiological");
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
    expect(document.querySelector(".epidbot-status")?.textContent).toContain("not available");
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
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
              ],
            ],
          },
          properties: { casos: 10, nome: "A" },
        },
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [2, 0],
                [3, 0],
                [3, 1],
                [2, 0],
              ],
            ],
          },
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
    const add = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".epidbot-result button"),
    ).find((b) => b.textContent === "Add to map")!;
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
    const add = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".epidbot-result button"),
    ).find((b) => b.textContent === "Add as tile layer")!;
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

describe("interrupted questions (regression)", () => {
  interface Deferred {
    promise: Promise<{ sessionId: number | null; content: string; images: string[] }>;
    resolve: (value: { sessionId: number | null; content: string; images: string[] }) => void;
    reject: (err: unknown) => void;
  }

  function deferred(): Deferred {
    let resolve!: Deferred["resolve"];
    let reject!: Deferred["reject"];
    const promise = new Promise<{ sessionId: number | null; content: string; images: string[] }>(
      (res, rej) => {
        resolve = res;
        reject = rej;
      },
    );
    return { promise, resolve, reject };
  }

  function composerButton() {
    return composer().form.querySelector<HTMLButtonElement>("button")!;
  }

  it("does not cancel the running question when Enter is pressed again", async () => {
    const { panel, client } = harness();
    const d = deferred();
    client.ask.mockImplementationOnce(() => d.promise);
    await submitQuestion(panel, "first");

    const input = composer().input;
    input.value = "second";
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    await flush();
    expect(client.ask).toHaveBeenCalledTimes(1); // second Enter ignored, no abort

    d.resolve({ sessionId: null, content: "done", images: [] });
    await flush();
    expect(document.querySelectorAll(".epidbot-msg").length).toBe(2);
    expect(document.querySelector(".epidbot-msg-error")).toBeNull();
  });

  it("still cancels via the Stop button", async () => {
    const { panel, client } = harness();
    const d = deferred();
    client.ask.mockImplementationOnce(() => d.promise);
    await submitQuestion(panel, "q");
    expect(composerButton().textContent).toBe("Stop");

    composer().form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    // The real client rejects the pending ask when its signal fires; the
    // stub needs that spelled out.
    d.reject(new ChatCancelledError("Chat request cancelled."));
    await flush();
    expect(document.querySelector(".epidbot-msg-error")?.textContent).toContain("cancelled");
    expect(composerButton().textContent).toBe("Send");
  });

  it("survives host panel cleanup while a question runs", async () => {
    const h = harness();
    const d = deferred();
    h.client.ask.mockImplementationOnce(() => d.promise);
    await submitQuestion(h.panel, "q");

    h.cleanup(); // displaced or closed: detach, but the question keeps running
    expect(document.querySelector(".epidbot-panel")).toBeNull();

    d.resolve({ sessionId: null, content: "late answer", images: [] });
    await flush();
    const container = document.createElement("div");
    document.body.appendChild(container);
    h.panel.attach(container);
    const transcript = document.querySelector(".epidbot-transcript")?.textContent ?? "";
    expect(transcript).toContain("q");
    expect(transcript).toContain("late answer");
    expect(composerButton().textContent).toBe("Send"); // not stuck busy
  });

  it("aborts quietly when a new session starts mid-question", async () => {
    const h = harness();
    const d = deferred();
    h.client.ask.mockImplementationOnce(() => d.promise);
    await submitQuestion(h.panel, "q");

    h.panel.newSession();
    // The aborted ask settles as cancelled; the reset suppresses the notice.
    d.reject(new ChatCancelledError("Chat request cancelled."));
    await flush();
    expect(document.querySelector(".epidbot-welcome")).not.toBeNull();
    expect(document.querySelector(".epidbot-msg-error")).toBeNull();
    expect(composerButton().textContent).toBe("Send");

    const lateAnswer = { sessionId: null, content: "old answer", images: [] };
    d.resolve(lateAnswer);
    await flush();
    expect(document.querySelector(".epidbot-transcript")?.textContent).not.toContain("old answer");
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

// ---------------------------------------------------------------------------
// 0.2.0 — layer exchange, attribute write-back, quick prompts, datasets
// ---------------------------------------------------------------------------

import type { GeoLibreFeatureInput } from "../src/lib/geolibre/host-api";

function muniFeature(cdMun: string, nome: string): GeoLibreFeatureInput {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-43.2, -22.9] },
    properties: { cd_mun: cdMun, municipio: nome },
  };
}

/** Harness with one map layer known to the fake host. */
function mapHarness(options: { features?: GeoLibreFeatureInput[] } = {}) {
  const h = harness();
  const features = options.features ?? [
    muniFeature("3304557", "Rio de Janeiro"),
    muniFeature("3303302", "Niterói"),
  ];
  h.fake.layers.set("L1", {
    summary: { id: "L1", name: "Municipios", type: "geojson", visible: true, opacity: 1 },
    features,
  });
  h.fake.viewBounds = [-43.3, -23.0, -43.0, -22.8];
  return { ...h, features };
}

function modalButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>(".epidbot-modal button")];
}

function clickItem(label: string): void {
  const button = document.querySelector<HTMLButtonElement>(".epidbot-attach-button")!;
  button.click(); // opens the details menu
  const item = [...document.querySelectorAll<HTMLButtonElement>(".epidbot-attach-item")].find(
    (b) => b.textContent === label,
  )!;
  expect(item).toBeDefined();
  item.click();
}

describe("quick prompts", () => {
  it("prefills the composer and resets to the placeholder", () => {
    mapHarness();
    const select = document.querySelector<HTMLSelectElement>(".epidbot-quick-select")!;
    select.value = "quick.dengue";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(composer().input.value).toContain("dengue season");
    expect(select.value).toBe("");
  });
});

describe("layer attachments", () => {
  it("attaches the whole layer as a chip", async () => {
    mapHarness();
    clickItem("Attach entire layer…");
    await flush();
    const chips = document.querySelector(".epidbot-attach-chips")!;
    expect(chips.hidden).toBe(false);
    expect(chips.textContent).toContain("Municipios (all features)");
    expect(chips.textContent).toContain("2 features");
    expect(chips.textContent).not.toContain("artifact");
  });

  it("removes a chip with its ✕ button", async () => {
    mapHarness();
    clickItem("Attach entire layer…");
    await flush();
    document.querySelector<HTMLButtonElement>(".epidbot-chip-remove")!.click();
    expect(document.querySelector(".epidbot-attach-chips")!.hidden).toBe(true);
  });

  it("prepends attachment blocks to the question and clears the chips", async () => {
    const h = mapHarness();
    clickItem("Attach entire layer…");
    await flush();
    await submitQuestion(h.panel, "Summarize this layer");
    const message = h.client.ask.mock.calls[0][0] as string;
    expect(message).toContain("[attachment: Municipios (all features)]");
    expect(message).toContain("```geojson");
    expect(message).toContain('"cd_mun":"3304557"');
    expect(message).toContain("Summarize this layer");
    expect(message.indexOf("[attachment:")).toBeLessThan(message.indexOf("Summarize this layer"));
    expect(document.querySelector(".epidbot-attach-chips")!.hidden).toBe(true);
  });

  it("uploads over-budget attachments as artifacts and sends artifact_ids", async () => {
    const h = mapHarness();
    h.settings.artifactUploads = true;
    // Make the layer payload huge so the reduction dialog appears.
    h.fake.layers.get("L1")!.features = Array.from({ length: 5000 }, (_, i) =>
      muniFeature(String(i), `Município com nome bastante comprido número ${i} do Brasil`),
    );
    clickItem("Attach entire layer…");
    await flush();
    const artifactButton = modalButtons().find(
      (b) => b.textContent === "Upload as artifact (server)",
    )!;
    expect(artifactButton).toBeDefined();
    expect(artifactButton.disabled).toBe(false);
    artifactButton.click();
    await flush();
    expect(h.client.uploadArtifact).toHaveBeenCalled();
    expect(document.querySelector(".epidbot-attach-chips")!.textContent).toContain("artifact 91");

    await submitQuestion(h.panel, "use the artifact");
    const options = h.client.ask.mock.calls[0][1] as { artifactIds?: number[] };
    expect(options.artifactIds).toEqual([91]);
    const message = h.client.ask.mock.calls[0][0] as string;
    expect(message).toContain("[attachment: Municipios (all features) -> artifact 91]");
    expect(message).not.toContain("```geojson");
  });

  it("offers stats-only when over budget and switching the context on", async () => {
    const h = mapHarness({
      features: Array.from({ length: 400 }, (_, i) =>
        muniFeature(String(i), `Município com um nome bastante comprido número ${i}`),
      ),
    });
    h.settings.inlineBudgetKb = 4;
    h.settings.attachMapContext = false;
    const contextInput = document.querySelector<HTMLInputElement>(".epidbot-context-attach input")!;
    contextInput.checked = false;
    clickItem("Attach entire layer…");
    await flush();
    const statsButton = modalButtons().find((b) => b.textContent === "Send statistics only")!;
    expect(statsButton).toBeDefined();
    statsButton.click();
    await flush();
    expect(contextInput.checked).toBe(true);
    expect(h.onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ attachMapContext: true }),
    );
    expect(document.querySelector(".epidbot-attach-chips")!.hidden).toBe(true);
  });

  it("hides attachments on non-2D renderers", async () => {
    const h = mapHarness();
    h.fake.renderer = "cesium";
    await (
      h.panel as unknown as { attachLayerData: (scope: "all") => Promise<void> }
    ).attachLayerData("all");
    await flush();
    expect(document.querySelector(".epidbot-attach-chips")!.hidden).toBe(true);
  });
});

describe("attribute write-back", () => {
  const EDIT_ANSWER = [
    "Here is your data:",
    "```epidbot-edit",
    JSON.stringify({
      op: "add_field",
      layer: "Municipios",
      field: { name: "pop_2024", type: "integer" },
      key: "cd_mun",
      confidence: "estimated",
      values: { "3304557": 7000000, "3303302": "520000", "9999999": 1 },
    }),
    "```",
  ].join("\n");

  function answered(answer: string) {
    const h = mapHarness();
    h.client.ask.mockImplementation(async () => ({
      sessionId: 5,
      content: answer,
      images: [],
    }));
    return h;
  }

  it("renders one review row per edit operation", async () => {
    const h = answered(EDIT_ANSWER);
    await submitQuestion(h.panel, "add population");
    const rows = document.querySelectorAll(".epidbot-edit-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Review field edit: pop_2024 (integer)");
  });

  it("applies the edit only after preview, then offers Revert", async () => {
    const h = answered(EDIT_ANSWER);
    await submitQuestion(h.panel, "add population");
    const review = document.querySelector<HTMLButtonElement>(".epidbot-edit-row button")!;
    review.click();
    await flush();
    const modal = document.querySelector(".epidbot-modal")!;
    expect(modal.textContent).toContain("EpidBot wants to edit a layer");
    expect(modal.textContent).toContain("join by cd_mun");
    expect(modal.textContent).toContain("ESTIMATED by the model");
    // 2 of 3 values match (9999999 is unmatched).
    expect(modal.textContent).toContain("Matches 2 of 3 values");
    expect(modal.textContent).toContain("Unmatched keys: 9999999");

    // Nothing written yet.
    expect(h.fake.updates).toHaveLength(0);
    expect(h.fake.layers.get("L1")!.features[0]!.properties).not.toHaveProperty("pop_2024");

    const apply = modalButtons().find((b) => b.textContent === "Apply")!;
    apply.click();
    await flush();

    expect(h.fake.updates).toHaveLength(1);
    const written = h.fake.layers.get("L1")!.features as Array<
      Record<string, Record<string, unknown>>
    >;
    expect(written[0]!.properties.pop_2024).toBe(7000000);
    expect(written[1]!.properties.pop_2024).toBe(520000);
    expect(written[0]!.properties.cd_mun).toBe("3304557"); // untouched

    const notice = document.querySelector(".epidbot-edit-notice")!;
    expect(notice.textContent).toContain("add_field 'pop_2024' on 'Municipios': 2 features");
    expect(notice.textContent).toContain("(1 keys did not match)");

    const revert = notice.querySelector<HTMLButtonElement>("button")!;
    revert.click();
    await flush();
    expect(h.fake.updates).toHaveLength(2);
    expect(
      (h.fake.layers.get("L1")!.features[0] as Record<string, Record<string, unknown>>).properties
        .pop_2024,
    ).toBeUndefined();
  });

  it("does not render edit rows on non-2D renderers", async () => {
    const h = answered(EDIT_ANSWER);
    h.fake.renderer = "arcgis";
    await submitQuestion(h.panel, "add population");
    expect(document.querySelectorAll(".epidbot-edit-row")).toHaveLength(0);
  });
});

describe("dataset result cards (authenticated downloads)", () => {
  it("loads artifact URLs with the API key and adds them as layers", async () => {
    const h = harness();
    h.client.ask.mockImplementation(async () => ({
      sessionId: 5,
      content: "Get it: https://api.epidbot.kwar-ai.com.br/api/v1/artifacts/42",
      images: [],
    }));
    h.client.downloadWithAuth.mockImplementation(
      async () =>
        new Blob([
          JSON.stringify({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: {},
              },
            ],
          }),
        ]),
    );
    await submitQuestion(h.panel, "give me data");
    const card = [...document.querySelectorAll(".epidbot-result")].find((c) =>
      c.textContent!.includes("/api/v1/artifacts/42"),
    )!;
    expect(card.textContent).toContain("EpidBot artifact");
    const add = [...card.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Add to map",
    )!;
    add.click();
    await flush();
    expect(h.client.downloadWithAuth).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/artifacts/42"),
      expect.anything(),
    );
    expect(h.fake.addedLayers).toHaveLength(1);
  });

  it("converts CSV results with coordinate columns into point layers", async () => {
    const h = harness();
    h.client.ask.mockImplementation(async () => ({
      sessionId: 5,
      content: "Data: https://data.example.com/cases.csv",
      images: [],
    }));
    h.client.downloadWithAuth.mockImplementation(
      async () => new Blob(["municipio,latitude,longitude\nRio,-22.9,-43.2\n"]),
    );
    await submitQuestion(h.panel, "give me csv");
    const card = [...document.querySelectorAll(".epidbot-result")].find((c) =>
      c.textContent!.includes("cases.csv"),
    )!;
    const add = [...card.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Add to map",
    )!;
    add.click();
    await flush();
    expect(h.fake.addedLayers[0]!.data.features[0]!.geometry).toEqual({
      type: "Point",
      coordinates: [-43.2, -22.9],
    });
  });

  it("keeps tile cards on addTileLayer", async () => {
    const h = harness();
    h.client.ask.mockImplementation(async () => ({
      sessionId: 5,
      content: "Tiles: https://t.example.com/{z}/{x}/{y}.png",
      images: [],
    }));
    await submitQuestion(h.panel, "tiles please");
    const card = document.querySelector(".epidbot-result")!;
    expect(card.textContent).toContain("Tiles");
    const add = [...card.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Add as tile layer",
    )!;
    add.click();
    expect(h.fake.addedTiles).toHaveLength(1);
    expect(h.fake.addedLayers).toHaveLength(0);
  });
});

describe("settings additions", () => {
  it("saves the inline budget and the artifact-upload switch", () => {
    const h = mapHarness();
    const budget = document.querySelector<HTMLInputElement>(
      '.epidbot-settings-form input[type="number"][min="4"]',
    )!;
    budget.value = "128";
    const checkboxes = document.querySelectorAll<HTMLInputElement>(
      ".epidbot-settings-form input[type=checkbox]",
    );
    const artifacts = checkboxes[checkboxes.length - 1]!;
    artifacts.checked = true;
    const form = document.querySelector<HTMLFormElement>(".epidbot-settings-form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(h.onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ inlineBudgetKb: 128, artifactUploads: true }),
    );
  });
});
