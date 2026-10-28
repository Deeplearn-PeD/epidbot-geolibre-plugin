import { describe, expect, it, vi } from "vitest";
import { EpidBotClient } from "../src/api/client";
import { EpidBotQuotaError } from "../src/api/errors";
import { createTranslator, registerEpidBotTranslations } from "../src/i18n";
import { DEFAULT_SETTINGS, type EpidBotSettings } from "../src/types";
import { EpidBotPanel, turnsFromHistory } from "../src/panel/panel";
import { createFakeApp, type FakeApp } from "./fake-app";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    fetchPlot: vi.fn(async () => new Blob(["PNG"], { type: "image/png" })),
    checkAuth: vi.fn(async () => ({ email: "epi@example.org" })),
    withApiKey: vi.fn(() => ({ checkAuth: client.checkAuth })),
    extractPlotFilename: (ref: string) => EpidBotClient.extractPlotFilename(ref),
  };

  const settings: EpidBotSettings = { ...DEFAULT_SETTINGS };
  const onSettingsChange = vi.fn((next: EpidBotSettings) => {
    Object.assign(settings, next);
  });

  const panel = new EpidBotPanel(fake.app, client as unknown as EpidBotClient, t, {
    getSettings: () => settings,
    onSettingsChange,
    getApiKey: () => fake.credentials.get("api-key") ?? "",
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  panel.attach(container);
  return { fake, panel, client, settings, onSettingsChange };
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
      "How many dengue cases in 2025?",
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

  it("starts a new session from the button", async () => {
    const { panel } = harness();
    await submitQuestion(panel, "q");
    expect(panel.getSessionId()).toBe(5);
    const newButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "New session",
    )!;
    newButton.click();
    expect(panel.getSessionId()).toBeNull();
    expect(document.querySelector(".epidbot-welcome")).not.toBeNull();
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
