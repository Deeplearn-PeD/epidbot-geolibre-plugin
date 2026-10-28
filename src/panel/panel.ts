/** The EpidBot chat panel: transcript, composer, session bar and settings,
 * rendered as plain DOM (the host's panel contract is a bare container).
 *
 * The panel owns no persistence itself: the API key is read/written through
 * the host credential store via the injected callbacks, settings changes are
 * reported through onSettingsChange (the entry point persists them in
 * project state), and the transcript lives only for the session.
 */

import { EpidBotClient } from "../api/client";
import {
  ChatCancelledError,
  EpidBotApiError,
  EpidBotAuthError,
  EpidBotPlanError,
  EpidBotQuotaError,
} from "../api/errors";
import type { Translator } from "../i18n";
import type { GeoLibreAppAPI } from "../lib/geolibre/host-api";
import {
  credentialLocation,
  sanitizeSettings,
  saveApiKey,
  type ApiKeySaveResult,
} from "../settings/store";
import type { ChatTurn, EpidBotSettings, ResultLayerRecord } from "../types";
import {
  attachContext,
  buildContextText,
  type MapContextPayload,
} from "../api/mapContext";
import {
  extractResultBlocks,
  geometrySummary,
  type GeoJsonResultBlock,
  type LayerUrlResultBlock,
} from "../api/results";
import { styleFor } from "../results/style";
import { renderMarkdown } from "./markdown";

export interface PanelCallbacks {
  getSettings(): EpidBotSettings;
  onSettingsChange(next: EpidBotSettings): void;
  getApiKey(): string;
  /** Collect the map context payload (the entry point binds buildMapContext). */
  buildContext?: () => MapContextPayload | null;
  /** Called after a result layer reaches the map (provenance record). */
  onLayerAdded?: (record: ResultLayerRecord) => void;
}

interface ErrorInfo {
  key: string;
  params?: Record<string, string | number>;
}

const API_KEY_URL = "https://kwar-ai.com.br";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Payload used when the host offers no map members at all: renders as an
 * empty preamble, so nothing is attached. */
function emptyContext(): MapContextPayload {
  return { crs: "", viewBounds: null, layers: [], selection: null };
}

/** Map a thrown error to a localized message key + params. */
export function errorInfo(err: unknown): ErrorInfo {
  if (err instanceof ChatCancelledError) return { key: "error.cancelled" };
  if (err instanceof EpidBotAuthError) return { key: "error.auth" };
  if (err instanceof EpidBotPlanError) return { key: "error.plan" };
  if (err instanceof EpidBotQuotaError) return { key: "error.quota" };
  if (err instanceof EpidBotApiError) {
    if (err.kind === "timeout") return { key: "error.timeout" };
    if (err.kind === "job") {
      return { key: "error.job", params: { reason: err.detail ?? err.message } };
    }
    if (err.status !== undefined) return { key: "error.server", params: { status: err.status } };
    return { key: "error.network" };
  }
  return {
    key: "error.unknown",
    params: { reason: err instanceof Error ? err.message : String(err) },
  };
}

/** Normalize a session-history payload into turns. The server may wrap the
 * list ({messages: [...]}) or return it directly; fields are read loosely to
 * match the QGIS plugin's tolerance. */
export function turnsFromHistory(payload: unknown): ChatTurn[] {
  const list = Array.isArray(payload)
    ? payload
    : ((payload as Record<string, unknown> | null)?.messages as unknown[] | undefined) ?? [];
  const turns: ChatTurn[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const role = record.role === "user" ? "user" : "assistant";
    const text = String(record.content ?? record.text ?? "");
    const images = Array.isArray(record.images) ? record.images.map(String) : [];
    if (!text && images.length === 0) continue;
    turns.push({ role, text, images });
  }
  return turns;
}

export class EpidBotPanel {
  private readonly app: GeoLibreAppAPI;
  private readonly client: EpidBotClient;
  private readonly t: Translator;
  private readonly cb: PanelCallbacks;

  private root: HTMLElement | null = null;
  private turns: ChatTurn[] = [];
  private sessionId: number | null = null;
  private abort: AbortController | null = null;
  private busy = false;
  private oneShotContext = false;
  private objectUrls: string[] = [];
  private sessionsRefreshed = false;

  private readonly i18nEls: Array<{
    el: HTMLElement;
    key: string;
    attr?: "placeholder" | "title";
  }> = [];

  // Element references populated in attach().
  private transcript!: HTMLElement;
  private statusLine!: HTMLElement;
  private composerForm!: HTMLFormElement;
  private composerInput!: HTMLTextAreaElement;
  private composerButton!: HTMLButtonElement;
  private sessionSelect!: HTMLSelectElement;
  private sessionNewButton!: HTMLButtonElement;
  private sessionExportButton!: HTMLButtonElement;
  private settingsDetails!: HTMLDetailsElement;
  private apiKeyInput!: HTMLInputElement;
  private apiKeyHelp!: HTMLElement;
  private testButton!: HTMLButtonElement;
  private testResult!: HTMLElement;
  private serverUrlInput!: HTMLInputElement;
  private localeSelect!: HTMLSelectElement;
  private pollIntervalInput!: HTMLInputElement;
  private contextAttachInput!: HTMLInputElement;
  private contextPreviewToggle!: HTMLButtonElement;
  private contextPreview!: HTMLPreElement;
  private savedIndicator!: HTMLElement;

  constructor(app: GeoLibreAppAPI, client: EpidBotClient, t: Translator, cb: PanelCallbacks) {
    this.app = app;
    this.client = client;
    this.t = t;
    this.cb = cb;
  }

  // ------------------------------------------------------------------
  // DOM construction
  // ------------------------------------------------------------------

  /** Build the panel DOM inside the host container; returns a cleanup the
   * host may call when the panel closes. */
  attach(container: HTMLElement): () => void {
    const root = el("div", "epidbot-panel");
    root.appendChild(this.buildSettings());
    root.appendChild(this.buildSessionBar());
    this.transcript = el("div", "epidbot-transcript");
    this.transcript.setAttribute("role", "log");
    this.transcript.setAttribute("aria-live", "polite");
    root.appendChild(this.transcript);
    this.statusLine = el("div", "epidbot-status");
    this.statusLine.hidden = true;
    root.appendChild(this.statusLine);
    root.appendChild(this.buildContextBar());
    this.composerForm = this.buildComposer();
    root.appendChild(this.composerForm);

    this.root = root;
    container.appendChild(root);
    this.fillSettingsForm(this.cb.getSettings());
    // Sync the selector with any session id applied before the host rendered.
    if (this.sessionId !== null) this.ensureSessionOption(this.sessionId);
    this.sessionSelect.value = this.sessionId === null ? "" : String(this.sessionId);
    this.applyTexts();
    this.renderTranscript();
    void this.refreshSessions();
    return () => this.dispose();
  }

  private bindText(
    node: HTMLElement,
    key: string,
    attr?: "placeholder" | "title",
  ): void {
    this.i18nEls.push({ el: node, key, attr });
    this.setText(node, key, attr);
  }

  private setText(
    node: HTMLElement,
    key: string,
    attr?: "placeholder" | "title",
  ): void {
    const text = this.t(key);
    if (attr === "placeholder") {
      (node as HTMLInputElement).placeholder = text;
    } else if (attr === "title") {
      node.title = text;
    } else {
      node.textContent = text;
    }
  }

  private buildSettings(): HTMLElement {
    const details = el("details", "epidbot-settings");
    this.settingsDetails = details;
    const summary = el("summary");
    const icon = el("span", "epidbot-settings-gear");
    icon.textContent = "⚙";
    const label = el("span");
    this.bindText(label, "settings.title");
    summary.append(icon, label);
    details.appendChild(summary);

    const form = el("form", "epidbot-settings-form");

    // API key + test
    const keyLabel = el("label");
    const keyTitle = el("span", "epidbot-label");
    this.bindText(keyTitle, "settings.apiKey");
    this.apiKeyInput = el("input");
    this.apiKeyInput.type = "password";
    this.apiKeyInput.autocomplete = "off";
    this.apiKeyInput.name = "epidbot-api-key";
    this.testButton = el("button", "epidbot-button epidbot-button-secondary");
    this.testButton.type = "button";
    this.bindText(this.testButton, "settings.test");
    this.testResult = el("div", "epidbot-test-result");
    this.testResult.hidden = true;
    keyLabel.append(keyTitle, this.apiKeyInput, this.testButton, this.testResult);
    this.apiKeyHelp = el("p", "epidbot-hint");
    keyLabel.appendChild(this.apiKeyHelp);
    form.appendChild(keyLabel);

    // Server URL
    const urlLabel = el("label");
    const urlTitle = el("span", "epidbot-label");
    this.bindText(urlTitle, "settings.serverUrl");
    this.serverUrlInput = el("input");
    this.serverUrlInput.type = "url";
    this.serverUrlInput.spellcheck = false;
    urlLabel.append(urlTitle, this.serverUrlInput);
    form.appendChild(urlLabel);

    // Answer language
    const localeLabel = el("label");
    const localeTitle = el("span", "epidbot-label");
    this.bindText(localeTitle, "settings.locale");
    this.localeSelect = el("select");
    for (const value of ["en", "pt-BR"]) {
      const option = el("option");
      option.value = value;
      option.textContent = value === "en" ? "English" : "Português (Brasil)";
      this.localeSelect.appendChild(option);
    }
    localeLabel.append(localeTitle, this.localeSelect);
    form.appendChild(localeLabel);

    // Poll interval
    const pollLabel = el("label");
    const pollTitle = el("span", "epidbot-label");
    this.bindText(pollTitle, "settings.pollInterval");
    this.pollIntervalInput = el("input");
    this.pollIntervalInput.type = "number";
    this.pollIntervalInput.min = "0.5";
    this.pollIntervalInput.max = "10";
    this.pollIntervalInput.step = "0.5";
    pollLabel.append(pollTitle, this.pollIntervalInput);
    form.appendChild(pollLabel);

    // Save
    const saveButton = el("button", "epidbot-button epidbot-button-primary");
    saveButton.type = "submit";
    this.bindText(saveButton, "settings.save");
    this.savedIndicator = el("span", "epidbot-saved");
    this.savedIndicator.hidden = true;
    form.append(saveButton, this.savedIndicator);

    this.testButton.addEventListener("click", () => void this.testKey());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.saveSettings();
    });
    details.appendChild(form);
    return details;
  }

  private buildSessionBar(): HTMLElement {
    const bar = el("div", "epidbot-sessionbar");
    const label = el("label", "epidbot-session-select");
    const title = el("span", "epidbot-label");
    this.bindText(title, "session.label");
    this.sessionSelect = el("select");
    this.sessionSelect.appendChild(this.newSessionOption());
    this.sessionSelect.addEventListener("change", () => {
      const value = this.sessionSelect.value;
      if (value === "") {
        this.newSession();
      } else {
        void this.loadSession(Number(value));
      }
    });
    label.append(title, this.sessionSelect);
    this.sessionNewButton = el("button", "epidbot-button epidbot-button-secondary");
    this.sessionNewButton.type = "button";
    this.bindText(this.sessionNewButton, "session.new");
    this.sessionNewButton.addEventListener("click", () => this.newSession());
    this.sessionExportButton = el("button", "epidbot-button epidbot-button-secondary");
    this.sessionExportButton.type = "button";
    this.bindText(this.sessionExportButton, "session.export");
    this.sessionExportButton.addEventListener("click", () => this.exportMarkdown());
    bar.append(label, this.sessionNewButton, this.sessionExportButton);
    return bar;
  }

  private newSessionOption(): HTMLOptionElement {
    const option = el("option");
    option.value = "";
    this.bindText(option, "session.none");
    return option;
  }

  /** Context indicator above the composer: the attach switch (persisted in
   * settings) and a preview showing the exact preamble that would be sent. */
  private buildContextBar(): HTMLElement {
    const bar = el("div", "epidbot-contextbar");
    const label = el("label", "epidbot-checkbox epidbot-context-attach");
    this.contextAttachInput = el("input");
    this.contextAttachInput.type = "checkbox";
    this.contextAttachInput.addEventListener("change", () => {
      this.cb.onSettingsChange({
        ...this.cb.getSettings(),
        attachMapContext: this.contextAttachInput.checked,
      });
    });
    const text = el("span");
    this.bindText(text, "context.attach");
    this.bindText(label, "context.help", "title");
    label.append(this.contextAttachInput, text);
    this.contextPreviewToggle = el(
      "button",
      "epidbot-button epidbot-button-secondary epidbot-context-preview-toggle",
    );
    this.contextPreviewToggle.type = "button";
    this.bindText(this.contextPreviewToggle, "context.preview");
    this.contextPreviewToggle.addEventListener("click", () => {
      const preview = this.contextPreview;
      preview.hidden = !preview.hidden;
      if (!preview.hidden) this.fillContextPreview();
    });
    this.contextPreview = el("pre", "epidbot-context-preview");
    this.contextPreview.hidden = true;
    bar.append(label, this.contextPreviewToggle);
    bar.appendChild(this.contextPreview);
    return bar;
  }

  private fillContextPreview(): void {
    const payload = this.cb.buildContext?.() ?? null;
    if (!payload) {
      this.contextPreview.textContent = this.t("context.unavailable");
      return;
    }
    const preamble = buildContextText(payload);
    const size = new TextEncoder().encode(preamble).length;
    this.contextPreview.textContent =
      preamble || this.t("context.empty");
    if (preamble) {
      this.contextPreview.textContent +=
        `\n\n— ${this.t("context.bytes", { bytes: size })}`;
    }
  }

  private buildComposer(): HTMLFormElement {
    const form = el("form", "epidbot-composer");
    this.composerInput = el("textarea");
    this.composerInput.rows = 3;
    this.bindText(this.composerInput, "composer.placeholder", "placeholder");
    this.composerInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.submitComposer();
      }
    });
    this.composerButton = el("button", "epidbot-button epidbot-button-primary");
    this.composerButton.type = "submit";
    this.bindText(this.composerButton, "composer.send");
    form.append(this.composerInput, this.composerButton);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitComposer();
    });
    return form;
  }

  private applyTexts(): void {
    for (const entry of this.i18nEls) this.setText(entry.el, entry.key, entry.attr);
    this.apiKeyHelp.textContent = this.t("settings.apiKeyHelp", {
      storage: this.storageName(),
    });
  }

  private storageName(): string {
    const location = credentialLocation(this.app);
    if (location === "keychain") return this.t("settings.storage.keychain");
    if (location === "browser") return this.t("settings.storage.browser");
    return this.t("settings.storage.none");
  }

  // ------------------------------------------------------------------
  // Public API (used by the entry point / toolbar menu)
  // ------------------------------------------------------------------

  dispose(): void {
    this.abort?.abort();
    this.abort = null;
    if (this.statusTimer !== null) {
      window.clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    this.root?.remove();
    this.root = null;
    this.i18nEls.length = 0;
  }

  retranslate(): void {
    if (!this.root) return;
    this.applyTexts();
    if (this.turns.length === 0) this.renderTranscript();
  }

  openSettings(): void {
    if (!this.root || !this.settingsDetails) return;
    this.settingsDetails.open = true;
    this.apiKeyInput.focus();
  }

  newSession(): void {
    this.setSessionId(null);
    this.turns = [];
    if (!this.root) return;
    this.renderTranscript();
  }

  getSessionId(): number | null {
    return this.sessionId;
  }

  setSessionId(id: number | null): void {
    this.sessionId = id;
    // The DOM may not exist yet (the host renders lazily on first open);
    // attach() syncs the selector from this.sessionId.
    if (!this.root) return;
    if (id !== null) this.ensureSessionOption(id);
    this.sessionSelect.value = id === null ? "" : String(id);
  }

  applySettings(next: EpidBotSettings): void {
    if (!this.root) return; // attach() fills the form from getSettings().
    this.fillSettingsForm(next);
  }

  /** Ask a question programmatically (composer submit, toolbar spatial
   * prompts and, later, the host assistant go through here). */
  async ask(question: string, opts: { forceContext?: boolean } = {}): Promise<void> {
    if (this.busy || !this.root) return;
    const text = question.trim();
    if (!text) return;
    if (!this.cb.getApiKey()) {
      this.appendError({ key: "error.noKey" });
      this.openSettings();
      return;
    }
    this.turns.push({ role: "user", text, images: [] });
    this.appendBubble("user", text);
    const pending = this.appendPendingAssistant();
    this.setBusy(true);
    this.abort = new AbortController();
    this.showStatus(this.t("status.submitting"));
    try {
      const attach =
        opts.forceContext === true ||
        this.oneShotContext ||
        this.cb.getSettings().attachMapContext;
      const preamble =
        attach ? buildContextText(this.cb.buildContext?.() ?? emptyContext()) : "";
      const message = attachContext(text, preamble);
      const result = await this.client.ask(message, {
        sessionId: this.sessionId,
        locale: this.cb.getSettings().answerLocale,
        signal: this.abort.signal,
        onStatus: (jobId) =>
          this.showStatus(this.t("status.thinking", { job: jobId.slice(0, 8) })),
      });
      const turn: ChatTurn = {
        role: "assistant",
        text: result.content,
        images: result.images,
      };
      this.turns.push(turn);
      this.renderAssistantInto(pending, turn, text);
      if (result.sessionId !== null) this.setSessionId(result.sessionId);
      void this.refreshSessions();
    } catch (err) {
      pending.remove();
      this.appendError(errorInfo(err));
    } finally {
      this.setBusy(false);
      this.showStatus(null);
      this.abort = null;
      this.oneShotContext = false;
    }
  }

  // ------------------------------------------------------------------
  // Spatial prompts (toolbar: ask about this extent / this selection)
  // ------------------------------------------------------------------

  /** Prefill the composer with a question about the current extent and
   * force-attach the map context for the next send. */
  promptExtent(): void {
    if (!this.root) return;
    const payload = this.cb.buildContext?.() ?? null;
    if (!payload?.viewBounds) {
      this.flashStatus(this.t("prompt.noExtent"));
      return;
    }
    this.composerInput.value = this.t("prompt.extent");
    this.oneShotContext = true;
    this.composerInput.focus();
  }

  /** Prefill the composer with a question about the current selection and
   * force-attach the map context for the next send. */
  promptSelection(): void {
    if (!this.root) return;
    const count = this.app.getSelectedFeatures?.().length ?? 0;
    if (count === 0) {
      this.flashStatus(this.t("prompt.noSelection"));
      return;
    }
    this.composerInput.value = this.t("prompt.selection");
    this.oneShotContext = true;
    this.composerInput.focus();
  }

  // ------------------------------------------------------------------
  // Transcript rendering
  // ------------------------------------------------------------------

  private renderTranscript(): void {
    this.transcript.replaceChildren();
    if (this.turns.length === 0) {
      this.transcript.appendChild(this.buildWelcome());
      return;
    }
    for (let i = 0; i < this.turns.length; i += 1) {
      const turn = this.turns[i];
      const bubble = this.appendBubble(turn.role, turn.role === "user" ? turn.text : undefined);
      if (turn.role === "assistant") {
        const question = this.turns[i - 1]?.role === "user" ? this.turns[i - 1].text : "";
        this.renderAssistantInto(bubble, turn, question);
      }
    }
    this.scrollToEnd();
  }

  private buildWelcome(): HTMLElement {
    const card = el("div", "epidbot-welcome");
    const title = el("h2");
    this.bindText(title, "welcome.title");
    const body = el("p");
    this.bindText(body, "welcome.body");
    card.append(title, body);
    if (!this.cb.getApiKey()) {
      const hint = el("p", "epidbot-hint");
      this.bindText(hint, "welcome.noKey");
      const link = el("a");
      link.href = API_KEY_URL;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      this.bindText(link, "welcome.getApiKey");
      card.append(hint, link);
    }
    return card;
  }

  private appendBubble(role: "user" | "assistant", text?: string): HTMLElement {
    const bubble = el("div", `epidbot-msg epidbot-msg-${role}`);
    if (text !== undefined) bubble.textContent = text;
    this.transcript.appendChild(bubble);
    this.scrollToEnd();
    return bubble;
  }

  private appendPendingAssistant(): HTMLElement {
    const bubble = el("div", "epidbot-msg epidbot-msg-assistant epidbot-msg-pending");
    bubble.textContent = "…";
    this.transcript.appendChild(bubble);
    this.scrollToEnd();
    return bubble;
  }

  private renderAssistantInto(bubble: HTMLElement, turn: ChatTurn, question = ""): void {
    bubble.classList.remove("epidbot-msg-pending");
    bubble.replaceChildren();
    if (turn.text) {
      bubble.appendChild(
        renderMarkdown(turn.text, { resolveImage: () => null }),
      );
    }
    for (const ref of turn.images) {
      bubble.appendChild(this.buildPlotCard(ref));
    }
    if (turn.text && this.canWriteToMap()) {
      const cards = this.buildResultCards(turn.text, question);
      if (cards) bubble.appendChild(cards);
    }
    this.scrollToEnd();
  }

  /** Map-writing actions are offered on the 2D renderers only; on
   * cesium/arcgis the chat works and the cards stay hidden. A host without
   * getMapRenderer is assumed to be 2D. */
  private canWriteToMap(): boolean {
    const renderer = this.app.getMapRenderer?.();
    return renderer === undefined || renderer === "maplibre" || renderer === "mapbox";
  }

  /** "Add to the map" cards for GeoJSON blocks and data URLs found in an
   * answer. Null when the answer has none. */
  private buildResultCards(answerText: string, question: string): HTMLElement | null {
    const blocks = extractResultBlocks(answerText);
    if (blocks.length === 0) return null;
    const wrap = el("div", "epidbot-results");
    const title = el("div", "epidbot-results-title");
    this.bindText(title, "results.title");
    wrap.appendChild(title);
    let index = 0;
    for (const block of blocks) {
      index += 1;
      const card =
        block.kind === "geojson"
          ? this.buildGeoJsonCard(block, question, index)
          : this.buildLayerUrlCard(block, question, index);
      if (card) wrap.appendChild(card);
    }
    return wrap.children.length > 1 ? wrap : null;
  }

  private layerName(question: string, index: number): string {
    const trimmed = question.trim().replace(/\s+/g, " ");
    const base = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
    const label = base || `result ${index}`;
    return `EpidBot · ${label}`;
  }

  private buildGeoJsonCard(
    block: GeoJsonResultBlock,
    question: string,
    index: number,
  ): HTMLElement {
    const card = el("div", "epidbot-result");
    const title = el("div", "epidbot-result-title");
    title.textContent = `GeoJSON · ${this.t("results.features", { count: block.featureCount })} · ${geometrySummary(block.geometryTypes)}`;
    const actions = el("div", "epidbot-result-actions");
    const add = el("button", "epidbot-button epidbot-button-primary");
    add.type = "button";
    this.bindText(add, "results.addToMap");
    add.addEventListener("click", () => {
      const name = this.layerName(question, index);
      try {
        const layerId = this.app.addGeoJsonLayer(name, block.fc);
        const styled = this.app.importLayerStyle?.(layerId, styleFor(block.fc));
        if (styled && !styled.ok) {
          this.flashStatus(this.t("results.styleFailed"));
        }
        this.cb.onLayerAdded?.({
          layerId,
          name,
          kind: "geojson",
          question,
          addedAt: new Date().toISOString(),
        });
        add.disabled = true;
        this.setText(add, "results.added");
      } catch (err) {
        this.flashStatus(
          this.t("results.addFailed", {
            reason: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    });
    const download = el("button", "epidbot-button epidbot-button-secondary");
    download.type = "button";
    this.bindText(download, "results.download");
    download.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(block.fc)], {
        type: "application/geo+json",
      });
      const url = URL.createObjectURL(blob);
      this.objectUrls.push(url);
      const link = el("a");
      link.href = url;
      link.download = `epidbot-result-${index}.geojson`;
      link.click();
    });
    actions.append(add, download);
    card.append(title, actions);
    return card;
  }

  private buildLayerUrlCard(
    block: LayerUrlResultBlock,
    question: string,
    index: number,
  ): HTMLElement | null {
    // Tile layers are an optional capability; without them the card is noise.
    if (!this.app.addTileLayer) return null;
    const card = el("div", "epidbot-result");
    const title = el("div", "epidbot-result-title");
    title.textContent = `${block.urlKind === "tiles" ? "Tiles" : "Dataset"} · ${block.url}`;
    const actions = el("div", "epidbot-result-actions");
    const add = el("button", "epidbot-button epidbot-button-primary");
    add.type = "button";
    this.bindText(add, "results.addTile");
    add.addEventListener("click", () => {
      try {
        const name = this.layerName(question, index);
        const layerId = this.app.addTileLayer?.(name, block.url, {
          attribution: "Added by EpidBot",
        });
        if (layerId) {
          this.cb.onLayerAdded?.({
            layerId,
            name,
            kind: "url",
            question,
            addedAt: new Date().toISOString(),
          });
        }
        add.disabled = true;
        this.setText(add, "results.added");
      } catch (err) {
        this.flashStatus(
          this.t("results.addFailed", {
            reason: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    });
    actions.appendChild(add);
    card.append(title, actions);
    return card;
  }

  private buildPlotCard(imageRef: string): HTMLElement {
    const filename = EpidBotClient.extractPlotFilename(imageRef);
    const card = el("figure", "epidbot-plot");
    const loading = el("div", "epidbot-plot-loading");
    this.bindText(loading, "status.loadingPlots");
    card.appendChild(loading);

    this.client
      .fetchPlot(filename)
      .then((blob) => {
        if (!this.root) return;
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        const img = el("img", "epidbot-plot-image");
        img.alt = filename;
        img.src = url;
        const save = el("a", "epidbot-button epidbot-button-secondary epidbot-plot-save");
        save.href = url;
        save.download = filename;
        this.bindText(save, "plot.download");
        loading.remove();
        card.append(img, save);
        this.scrollToEnd();
      })
      .catch((err: unknown) => {
        if (!this.root) return;
        loading.remove();
        if (err instanceof EpidBotApiError && err.status === 401) {
          // Expired/invalid key: surface the standard auth error once.
          this.appendError({ key: "error.auth" });
          return;
        }
        const failed = el("div", "epidbot-plot-error");
        this.bindText(failed, "plot.loadFailed");
        card.appendChild(failed);
      });
    return card;
  }

  private appendError(info: ErrorInfo): void {
    const bubble = el("div", "epidbot-msg epidbot-msg-assistant epidbot-msg-error");
    bubble.textContent = this.t(info.key, info.params);
    this.transcript.appendChild(bubble);
    this.scrollToEnd();
  }

  private scrollToEnd(): void {
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  private showStatus(text: string | null): void {
    this.statusLine.hidden = text === null;
    this.statusLine.textContent = text ?? "";
  }

  private statusTimer: number | null = null;

  /** Show a status message that clears itself (used for transient notices). */
  private flashStatus(text: string): void {
    this.showStatus(text);
    if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      this.showStatus(null);
      this.statusTimer = null;
    }, 4000);
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.composerButton.textContent = busy ? this.t("composer.stop") : this.t("composer.send");
  }

  // ------------------------------------------------------------------
  // Composer
  // ------------------------------------------------------------------

  private async submitComposer(): Promise<void> {
    if (this.busy) {
      // The send button doubles as the stop button while a question runs.
      this.abort?.abort();
      return;
    }
    const text = this.composerInput.value;
    if (!text.trim()) return;
    this.composerInput.value = "";
    await this.ask(text);
  }

  // ------------------------------------------------------------------
  // Sessions
  // ------------------------------------------------------------------

  private ensureSessionOption(id: number): void {
    const value = String(id);
    if (!Array.from(this.sessionSelect.options).some((option) => option.value === value)) {
      const option = el("option");
      option.value = value;
      option.textContent = `#${id}`;
      this.sessionSelect.appendChild(option);
    }
  }

  private async refreshSessions(): Promise<void> {
    if (this.sessionsRefreshed || !this.cb.getApiKey() || !this.root) return;
    this.sessionsRefreshed = true;
    try {
      const sessions = await this.client.listSessions();
      if (!this.root) return;
      for (const session of sessions.slice(0, 50)) {
        const id = typeof session.id === "number" ? session.id : undefined;
        if (id === undefined) continue;
        this.ensureSessionOption(id);
        const option = this.sessionSelect.options.namedItem(String(id));
        if (option) {
          option.textContent = session.name ? session.name : `#${id}`;
        }
      }
      if (this.sessionId !== null) this.setSessionId(this.sessionId);
    } catch {
      // Listing is best-effort; asking still works without it.
    }
  }

  private async loadSession(id: number): Promise<void> {
    try {
      const payload = await this.client.getMessages(id);
      if (!this.root) return;
      this.turns = turnsFromHistory(payload);
      this.setSessionId(id);
      this.renderTranscript();
    } catch (err) {
      this.appendError({ key: "session.loadFailed" });
      if (!(err instanceof EpidBotApiError)) throw err;
    }
  }

  // ------------------------------------------------------------------
  // Markdown export
  // ------------------------------------------------------------------

  exportMarkdown(): void {
    if (!this.root) return;
    if (this.turns.length === 0) {
      this.flashStatus(this.t("session.exportEmpty"));
      return;
    }
    const lines: string[] = [`# ${this.t("panel.title")}`, ""];
    lines.push(`> ${this.t("session.label")}: ${this.sessionId ?? this.t("session.none")}`, "");
    for (const turn of this.turns) {
      lines.push(turn.role === "user" ? "**You:**" : "**EpidBot:**", "", turn.text, "");
      if (turn.images.length > 0) {
        for (const image of turn.images) lines.push(`![plot](${image})`, "");
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    const link = el("a");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    link.href = url;
    link.download = `epidbot-chat-${stamp}.md`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  // ------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------

  private fillSettingsForm(settings: EpidBotSettings): void {
    this.serverUrlInput.value = settings.serverUrl;
    this.localeSelect.value = settings.answerLocale;
    this.pollIntervalInput.value = String(settings.pollIntervalSec);
    if (this.contextAttachInput) this.contextAttachInput.checked = settings.attachMapContext;
  }

  private readSettingsForm(): EpidBotSettings {
    return sanitizeSettings({
      serverUrl: this.serverUrlInput.value,
      answerLocale: this.localeSelect.value,
      pollIntervalSec: Number(this.pollIntervalInput.value),
      // The attach switch lives in the context bar and persists directly
      // through onSettingsChange; saving the form must not clobber it.
      attachMapContext: this.cb.getSettings().attachMapContext,
    });
  }

  private saveSettings(): void {
    const next = this.readSettingsForm();
    const enteredKey = this.apiKeyInput.value;
    const currentKey = this.cb.getApiKey();
    if (enteredKey !== currentKey) {
      const result = this.saveKey(enteredKey);
      if (result === "unavailable" && enteredKey) {
        // No host store: the key still works for this session; say so.
        this.savedIndicator.hidden = false;
        this.savedIndicator.textContent = this.t("settings.storage.none");
        this.cb.onSettingsChange(next);
        return;
      }
    }
    this.cb.onSettingsChange(next);
    this.savedIndicator.hidden = false;
    this.savedIndicator.textContent = this.t("settings.saved");
    window.setTimeout(() => {
      this.savedIndicator.hidden = true;
    }, 2500);
  }

  private saveKey(key: string): ApiKeySaveResult {
    const result = saveApiKey(this.app, key);
    if (result === "unavailable") {
      // Best effort with no host store: keep it for this session only.
      return "unavailable";
    }
    return result;
  }

  private async testKey(): Promise<void> {
    const enteredKey = this.apiKeyInput.value.trim() || this.cb.getApiKey();
    if (!enteredKey) {
      this.showTestResult(this.t("settings.testFail", { reason: this.t("error.noKey") }), true);
      return;
    }
    this.testButton.disabled = true;
    this.showTestResult(this.t("settings.testing"), false);
    try {
      const user = await this.client
        .withApiKey(enteredKey, this.readSettingsForm().serverUrl)
        .checkAuth();
      const who =
        (typeof user.email === "string" && user.email) ||
        (typeof user.username === "string" && user.username) ||
        (typeof user.name === "string" && user.name) ||
        "OK";
      this.showTestResult(this.t("settings.testOk", { user: who }), false);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.showTestResult(this.t("settings.testFail", { reason }), true);
    } finally {
      this.testButton.disabled = false;
    }
  }

  private showTestResult(text: string, isError: boolean): void {
    this.testResult.hidden = false;
    this.testResult.textContent = text;
    this.testResult.classList.toggle("epidbot-test-error", isError);
  }
}
