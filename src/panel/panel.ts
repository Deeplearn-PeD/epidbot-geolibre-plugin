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
import type { GeoLibreAppAPI, GeoLibreFeatureCollection } from "../lib/geolibre/host-api";
import {
  credentialLocation,
  sanitizeSettings,
  saveApiKey,
  type ApiKeySaveResult,
} from "../settings/store";
import type { ChatTurn, EpidBotSettings, ResultLayerRecord } from "../types";
import { attachContext, buildContextText, type MapContextPayload } from "../api/mapContext";
import {
  extractResultBlocks,
  extractEditOps,
  geometrySummary,
  validateGeoJson,
  type GeoJsonResultBlock,
  type LayerUrlResultBlock,
} from "../api/results";
import {
  collectAttachment,
  collectIdentifiers,
  GEOMETRY_PRECISION,
  pickJoinKey,
  SCOPE_ALL,
  SCOPE_EXTENT,
  SCOPE_IDENTIFIERS,
  SCOPE_SELECTION,
  type Attachment,
  type AttachmentScope,
} from "../api/layerExport";
import {
  applyEditOp,
  buildLayerKeys,
  planEdit,
  requireJoinField,
  validateEditOp,
  EditOpError,
} from "../api/layerEditor";
import { csvToFeatureCollection } from "../api/csvSource";
import { styleFor } from "../results/style";
import { renderMarkdown } from "./markdown";
import { applyTheme } from "./theme";

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
    : (((payload as Record<string, unknown> | null)?.messages as unknown[] | undefined) ?? []);
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
  /** Watches the host's theme root so live dark/light flips re-sample. */
  private themeObserver: MutationObserver | null = null;
  /** Pending layer attachments (QGIS 0.3.0 parity). */
  private attachments: Attachment[] = [];
  /** Layer + scope of the last over-budget attempt, for reduction retries. */
  private lastAttempt: {
    layerId: string;
    layerName: string;
    features: ReturnType<NonNullable<GeoLibreAppAPI["getLayerFeatures"]>>;
    scope: AttachmentScope;
    precision: number;
  } | null = null;
  /** In-flight load of a result dataset (one at a time, like QGIS). */
  private loadingDataset = false;

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
  private quickSelect!: HTMLSelectElement;
  private attachChips!: HTMLElement;
  private settingsDetails!: HTMLDetailsElement;
  private apiKeyInput!: HTMLInputElement;
  private apiKeyHelp!: HTMLElement;
  private testButton!: HTMLButtonElement;
  private testResult!: HTMLElement;
  private serverUrlInput!: HTMLInputElement;
  private localeSelect!: HTMLSelectElement;
  private pollIntervalInput!: HTMLInputElement;
  private inlineBudgetInput!: HTMLInputElement;
  private artifactUploadsInput!: HTMLInputElement;
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
    root.appendChild(this.buildQuickBar());
    root.appendChild(this.buildAttachChips());
    this.composerForm = this.buildComposer();
    root.appendChild(this.composerForm);

    this.root = root;
    container.appendChild(root);
    this.startThemeWatcher(container);
    this.fillSettingsForm(this.cb.getSettings());
    // Sync the selector with any session id applied before the host rendered.
    if (this.sessionId !== null) this.ensureSessionOption(this.sessionId);
    this.sessionSelect.value = this.sessionId === null ? "" : String(this.sessionId);
    this.applyTexts();
    this.renderTranscript();
    // Restore the composer state after a detach while a question runs.
    this.setBusy(this.busy);
    if (this.busy) this.showStatus(this.t("status.submitting"));
    void this.refreshSessions();
    return () => this.detach();
  }

  // ------------------------------------------------------------------
  // Theme (native controls follow the host's dark/light scheme)
  // ------------------------------------------------------------------

  /** Sample the host theme now and again when the host flips it. Without
   * this, the quick-prompts `<select>` popup renders in the browser's
   * default (light) scheme on a dark app — unreadable. */
  private startThemeWatcher(container: HTMLElement): void {
    const root = this.root;
    if (!root) return;
    applyTheme(root, container);
    this.themeObserver?.disconnect();
    const themeRoot = document.body?.parentElement ?? document.body ?? root.getRootNode();
    const observer = new MutationObserver(() => {
      if (this.root) applyTheme(this.root, container);
    });
    if (themeRoot instanceof HTMLElement) {
      observer.observe(themeRoot, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme", "data-bs-theme"],
      });
    }
    this.themeObserver = observer;
  }

  private stopThemeWatcher(): void {
    this.themeObserver?.disconnect();
    this.themeObserver = null;
  }

  private bindText(node: HTMLElement, key: string, attr?: "placeholder" | "title"): void {
    this.i18nEls.push({ el: node, key, attr });
    this.setText(node, key, attr);
  }

  private setText(node: HTMLElement, key: string, attr?: "placeholder" | "title"): void {
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

    // Inline attachment budget (KiB)
    const budgetLabel = el("label");
    const budgetTitle = el("span", "epidbot-label");
    this.bindText(budgetTitle, "settings.inlineBudget");
    this.inlineBudgetInput = el("input");
    this.inlineBudgetInput.type = "number";
    this.inlineBudgetInput.min = "4";
    this.inlineBudgetInput.max = "2048";
    this.inlineBudgetInput.step = "4";
    budgetLabel.append(budgetTitle, this.inlineBudgetInput);
    const budgetHint = el("p", "epidbot-hint");
    this.bindText(budgetHint, "settings.inlineBudgetHelp");
    budgetLabel.appendChild(budgetHint);
    form.appendChild(budgetLabel);

    // Server artifact uploads (off by default; requires server support)
    const artifactsLabel = el("label", "epidbot-checkbox");
    this.artifactUploadsInput = el("input");
    this.artifactUploadsInput.type = "checkbox";
    const artifactsText = el("span");
    this.bindText(artifactsText, "settings.artifactUploads");
    artifactsLabel.append(this.artifactUploadsInput, artifactsText);
    form.appendChild(artifactsLabel);

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
    this.contextPreview.textContent = preamble || this.t("context.empty");
    if (preamble) {
      this.contextPreview.textContent += `\n\n— ${this.t("context.bytes", { bytes: size })}`;
    }
  }

  // ------------------------------------------------------------------
  // Quick prompts and layer attachments (QGIS 0.2.0 / 0.3.0 parity)
  // ------------------------------------------------------------------

  private static readonly QUICK_PROMPT_KEYS = [
    "quick.dengue",
    "quick.malaria",
    "quick.layers",
    "quick.sinan",
    "quick.population",
  ] as const;

  /** Preset prompts (QGIS quick_combo): pick one to prefill the composer. */
  private buildQuickBar(): HTMLElement {
    const bar = el("div", "epidbot-quickbar");
    this.quickSelect = el("select", "epidbot-quick-select");
    const placeholder = el("option");
    placeholder.value = "";
    this.bindText(placeholder, "quick.placeholder");
    this.quickSelect.appendChild(placeholder);
    for (const key of EpidBotPanel.QUICK_PROMPT_KEYS) {
      const option = el("option");
      option.value = key;
      this.bindText(option, key);
      this.quickSelect.appendChild(option);
    }
    this.quickSelect.addEventListener("change", () => {
      const key = this.quickSelect.value;
      this.quickSelect.value = ""; // back to the placeholder
      if (!key) return;
      this.composerInput.value = this.t(key);
      this.composerInput.focus();
    });
    bar.appendChild(this.quickSelect);
    bar.appendChild(this.buildAttachMenu());
    return bar;
  }

  /** The 📎 dropdown offering the four attachment scopes. */
  private buildAttachMenu(): HTMLElement {
    const details = el("details", "epidbot-attach-menu");
    const summary = el("summary", "epidbot-button epidbot-button-secondary epidbot-attach-button");
    summary.textContent = "📎";
    this.bindText(summary, "attach.label", "title");
    const list = el("div", "epidbot-attach-items");
    const item = (scope: AttachmentScope, labelKey: string) => {
      const button = el("button", "epidbot-attach-item");
      button.type = "button";
      this.bindText(button, labelKey);
      button.addEventListener("click", () => {
        details.open = false;
        void this.attachLayerData(scope);
      });
      list.appendChild(button);
    };
    item(SCOPE_SELECTION, "attach.selected");
    item(SCOPE_EXTENT, "attach.extent");
    item(SCOPE_ALL, "attach.all");
    item(SCOPE_IDENTIFIERS, "attach.identifiers");
    details.append(summary, list);
    // Close the dropdown when focus leaves it.
    details.addEventListener("focusout", (event) => {
      if (!details.contains(event.relatedTarget as Node | null)) details.open = false;
    });
    return details;
  }

  /** Pending attachments as removable chips (hidden while empty). */
  private buildAttachChips(): HTMLElement {
    this.attachChips = el("div", "epidbot-attach-chips");
    this.attachChips.hidden = true;
    return this.attachChips;
  }

  private rebuildChips(): void {
    if (!this.root) return;
    this.attachChips.replaceChildren();
    this.attachments.forEach((attachment, index) => {
      const chip = el("span", "epidbot-chip");
      const kb = Math.floor(attachment.sizeBytes / 1024) + 1;
      chip.textContent =
        attachment.artifactId !== undefined
          ? `📎 ${attachment.label} → artifact ${attachment.artifactId}`
          : `📎 ${attachment.label} — ${this.t("attach.chipMeta", {
              count: attachment.featureCount,
              kb,
            })}`;
      const remove = el("button", "epidbot-chip-remove");
      remove.type = "button";
      remove.textContent = "✕";
      this.bindText(remove, "attach.remove", "title");
      remove.addEventListener("click", () => {
        this.attachments.splice(index, 1);
        this.rebuildChips();
      });
      chip.appendChild(remove);
      this.attachChips.appendChild(chip);
    });
    this.attachChips.hidden = this.attachments.length === 0;
  }

  private clearAttachments(): void {
    this.attachments = [];
    this.rebuildChips();
  }

  /** Serialize the pending attachments as prompt blocks and the artifact id
   * list (QGIS _attachment_blocks), then empty the chips. */
  private takeAttachmentBlocks(): { blocks: string[]; artifactIds: number[] } {
    const blocks: string[] = [];
    const artifactIds: number[] = [];
    for (const attachment of this.attachments) {
      if (attachment.artifactId !== undefined) {
        artifactIds.push(attachment.artifactId);
        blocks.push(`[attachment: ${attachment.label} -> artifact ${attachment.artifactId}]`);
        continue;
      }
      blocks.push(
        `[attachment: ${attachment.label}]\n\`\`\`geojson\n${attachment.geojson}\n\`\`\`\n[/attachment]`,
      );
    }
    this.clearAttachments();
    return { blocks, artifactIds };
  }

  private inlineBudgetBytes(): number {
    const kb = this.cb.getSettings().inlineBudgetKb;
    return Math.max(Math.round(kb * 1024), 1024);
  }

  /** Vector layers that can serve as attachment targets, canvas order. */
  private targetLayers(): Array<{ id: string; name: string }> {
    return (this.app.listLayers?.() ?? []).map((layer) => ({ id: layer.id, name: layer.name }));
  }

  /** Ask which layer to use; resolves null on cancel. One layer short-circuits. */
  private pickLayer(): Promise<{ id: string; name: string } | null> {
    const layers = this.targetLayers();
    if (layers.length === 0) {
      this.flashStatus(this.t("attach.noLayers"));
      return Promise.resolve(null);
    }
    if (layers.length === 1) return Promise.resolve(layers[0] ?? null);
    return new Promise((resolve) => {
      const close = this.openModal((body, done) => {
        const title = el("h3", "epidbot-modal-title");
        this.bindText(title, "attach.pickLayer");
        const select = el("select");
        for (const layer of layers) {
          const option = el("option");
          option.value = layer.id;
          option.textContent = layer.name;
          select.appendChild(option);
        }
        const actions = el("div", "epidbot-modal-actions");
        const ok = el("button", "epidbot-button epidbot-button-primary");
        ok.type = "button";
        this.bindText(ok, "attach.ok");
        ok.addEventListener("click", () => {
          const chosen = layers.find((layer) => layer.id === select.value) ?? null;
          done();
          resolve(chosen);
        });
        const cancel = el("button", "epidbot-button epidbot-button-secondary");
        cancel.type = "button";
        this.bindText(cancel, "attach.cancel");
        cancel.addEventListener("click", () => {
          done();
          resolve(null);
        });
        actions.append(ok, cancel);
        body.append(title, select, actions);
      });
      void close;
    });
  }

  /** Entry point for the 📎 menu: build an attachment of one scope. */
  private async attachLayerData(
    scope: AttachmentScope,
    presetLayer?: { id: string; name: string } | null,
    precision: number = GEOMETRY_PRECISION,
  ): Promise<void> {
    if (!this.canWriteToMap()) {
      this.flashStatus(this.t("attach.unavailable"));
      return;
    }
    const layer = presetLayer ?? (await this.pickLayer());
    if (!layer) return;

    const selectedFeatures = this.app.getSelectedFeatures?.() ?? [];
    const selectedLayerId = this.app.getSelectedLayerId?.() ?? null;
    if (
      scope === SCOPE_SELECTION &&
      (selectedFeatures.length === 0 || selectedLayerId !== layer.id)
    ) {
      this.flashStatus(this.t("prompt.noSelection"));
      return;
    }

    this.flashStatus(this.t("attach.preparing"));
    let features: ReturnType<NonNullable<GeoLibreAppAPI["getLayerFeatures"]>>;
    try {
      features = this.app.getLayerFeatures?.(layer.id) ?? [];
    } catch (err) {
      this.flashStatus(
        this.t("results.loadFailed", {
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
      return;
    }
    if (features.length === 0) {
      this.flashStatus(this.t("attach.noLayers"));
      return;
    }

    const attempt = { layerId: layer.id, layerName: layer.name, features, scope, precision };
    let attachment: Attachment;
    try {
      attachment =
        scope === SCOPE_IDENTIFIERS
          ? collectIdentifiers({
              layerName: layer.name,
              features,
              budgetBytes: this.inlineBudgetBytes(),
            })
          : collectAttachment({
              scope,
              layerName: layer.name,
              features,
              selectedFeatures: scope === SCOPE_SELECTION ? selectedFeatures : undefined,
              viewBounds: this.app.getViewBounds?.() ?? null,
              budgetBytes: this.inlineBudgetBytes(),
              precision,
            });
    } catch (err) {
      this.lastAttempt = attempt;
      this.askStatsOrCancel(err instanceof Error ? err.message : String(err));
      return;
    }
    this.showStatus(null);
    if (!attachment.overBudget) {
      this.lastAttempt = attempt;
      this.attachments.push(attachment);
      this.rebuildChips();
      return;
    }
    this.lastAttempt = attempt;
    this.askReduction(attachment);
  }

  /** Interactive reduction menu (QGIS _ask_reduction). */
  private askReduction(attachment: Attachment): void {
    const attempt = this.lastAttempt;
    if (!attempt) return;
    const sizeKb = Math.floor(attachment.sizeBytes / 1024) + 1;
    const budgetKb = Math.floor(this.inlineBudgetBytes() / 1024);
    const hasSelection =
      (this.app.getSelectedFeatures?.() ?? []).length > 0 &&
      this.app.getSelectedLayerId?.() === attempt.layerId;
    const precision = attempt.precision;

    this.openModal((body, done) => {
      const title = el("h3", "epidbot-modal-title");
      this.bindText(title, "attach.tooLargeTitle");
      const message = el("p", "epidbot-modal-text");
      message.textContent = this.t("attach.tooLarge", {
        label: attachment.label,
        size: sizeKb,
        budget: budgetKb,
      });
      const actions = el("div", "epidbot-modal-actions epidbot-modal-actions-column");

      const option = (labelKey: string, enabled: boolean, run: () => void) => {
        const button = el("button", "epidbot-button epidbot-button-secondary");
        button.type = "button";
        this.bindText(button, labelKey);
        button.disabled = !enabled;
        button.addEventListener("click", () => {
          done();
          run();
        });
        actions.appendChild(button);
      };

      option(
        "attach.limitExtent",
        attempt.scope === SCOPE_ALL && this.app.getViewBounds?.() != null,
        () =>
          void this.attachLayerData(
            SCOPE_EXTENT,
            { id: attempt.layerId, name: attempt.layerName },
            precision,
          ),
      );
      option(
        "attach.narrowSelection",
        attempt.scope === SCOPE_EXTENT && hasSelection,
        () =>
          void this.attachLayerData(
            SCOPE_SELECTION,
            { id: attempt.layerId, name: attempt.layerName },
            precision,
          ),
      );
      option(
        "attach.reducePrecision",
        precision > 3,
        () =>
          void this.attachLayerData(
            attempt.scope,
            { id: attempt.layerId, name: attempt.layerName },
            precision > 4 ? 4 : 3,
          ),
      );
      option(
        "attach.uploadArtifact",
        this.cb.getSettings().artifactUploads && this.cb.getApiKey() !== "",
        () => void this.uploadAsArtifact(attachment),
      );
      option("attach.statsOnly", true, () => {
        this.fallBackToStats();
      });
      const cancel = el("button", "epidbot-button epidbot-button-secondary");
      cancel.type = "button";
      this.bindText(cancel, "attach.cancel");
      cancel.addEventListener("click", done);
      actions.appendChild(cancel);

      body.append(title, message, actions);
    });
  }

  /** "Send statistics only": the context block already carries the layer
   * summaries, so switching the context on is the fallback (QGIS). */
  private fallBackToStats(): void {
    if (!this.cb.getSettings().attachMapContext) {
      this.cb.onSettingsChange({ ...this.cb.getSettings(), attachMapContext: true });
      this.contextAttachInput.checked = true;
    }
    this.flashStatus(this.t("attach.dropped"));
  }

  /** Tier 2: upload the serialized layer as a server artifact. */
  private async uploadAsArtifact(attachment: Attachment): Promise<void> {
    this.showStatus(this.t("attach.uploading"));
    const filename = `${attachment.label.replace(/[^\w.-]+/g, "_").slice(0, 60)}.geojson`;
    try {
      const response = await this.client.uploadArtifact(
        new Blob([attachment.geojson], { type: "application/geo+json" }),
        filename,
      );
      const artifactId = EpidBotClient.artifactIdFrom(response);
      this.showStatus(null);
      if (artifactId === null) {
        this.flashStatus(this.t("attach.noArtifactId"));
        return;
      }
      this.attachments.push({ ...attachment, artifactId });
      this.rebuildChips();
    } catch (err) {
      this.showStatus(null);
      this.flashStatus(
        this.t("attach.uploadFailed", {
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  private askStatsOrCancel(message: string): void {
    this.showStatus(null);
    this.openModal((body, done) => {
      const title = el("h3", "epidbot-modal-title");
      this.bindText(title, "attach.failedTitle");
      const text = el("p", "epidbot-modal-text");
      text.textContent = message;
      const actions = el("div", "epidbot-modal-actions");
      const stats = el("button", "epidbot-button epidbot-button-primary");
      stats.type = "button";
      this.bindText(stats, "attach.statsOnly");
      stats.addEventListener("click", () => {
        done();
        this.fallBackToStats();
      });
      const cancel = el("button", "epidbot-button epidbot-button-secondary");
      cancel.type = "button";
      this.bindText(cancel, "attach.cancel");
      cancel.addEventListener("click", done);
      actions.append(stats, cancel);
      body.append(title, text, actions);
    });
  }

  /** Small modal helper: builds an overlay inside the panel root. `build`
   * fills the card body and receives `done` (closes the overlay). */
  private openModal(build: (body: HTMLElement, done: () => void) => void): () => void {
    if (!this.root) return () => {};
    const overlay = el("div", "epidbot-overlay");
    const card = el("div", "epidbot-modal");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    const body = el("div", "epidbot-modal-body");
    const done = () => overlay.remove();
    build(body, done);
    card.appendChild(body);
    overlay.appendChild(card);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) done();
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        done();
        overlay.removeEventListener("keydown", onKey);
      }
    };
    overlay.addEventListener("keydown", onKey);
    this.root.appendChild(overlay);
    return done;
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
      // Submitting via the button while a question runs means "Stop".
      void this.submitComposer(true);
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

  /** Host cleanup (the panel was closed or displaced by another panel):
   * remove the DOM but keep state and any in-flight question running.
   * Re-attach restores the transcript, including the answer when it
   * arrives while detached. */
  detach(): void {
    this.stopThemeWatcher();
    this.root?.remove();
    this.root = null;
    this.i18nEls.length = 0;
  }

  /** Full teardown (plugin deactivation): stop everything and reset. */
  dispose(): void {
    this.abort?.abort();
    this.abort = null;
    if (this.statusTimer !== null) {
      window.clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    this.busy = false;
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    this.detach();
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
    // A running question belongs to the old session: stop it (the cancelled
    // notice is suppressed while the transcript is being reset).
    this.abort?.abort();
    this.setSessionId(null);
    this.turns = [];
    if (!this.root) return;
    this.renderTranscript();
    // Create the session server-side when possible so it shows in the list,
    // like the QGIS plugin; without a key (or on failure) the server simply
    // auto-creates a session on the first question.
    if (!this.cb.getApiKey()) return;
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    void this.client
      .createSession(this.t("session.createdName", { stamp }))
      .then((created) => {
        const id = typeof created.id === "number" ? created.id : null;
        if (id !== null && this.root) this.setSessionId(id);
      })
      .catch(() => {
        // Local-only session; asking still works.
      });
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
        opts.forceContext === true || this.oneShotContext || this.cb.getSettings().attachMapContext;
      const preamble = attach ? buildContextText(this.cb.buildContext?.() ?? emptyContext()) : "";
      // Pending layer attachments are prepended to the question and cleared
      // immediately (QGIS reads then clears before submitting).
      const { blocks, artifactIds } = this.takeAttachmentBlocks();
      const question = blocks.length > 0 ? [...blocks, text].join("\n\n") : text;
      const message = attachContext(question, preamble);
      const result = await this.client.ask(message, {
        sessionId: this.sessionId,
        locale: this.cb.getSettings().answerLocale,
        artifactIds: artifactIds.length > 0 ? artifactIds : undefined,
        signal: this.abort.signal,
        onStatus: (jobId) => this.showStatus(this.t("status.thinking", { job: jobId.slice(0, 8) })),
      });
      const turn: ChatTurn = {
        role: "assistant",
        text: result.content,
        images: result.images,
      };
      this.turns.push(turn);
      this.renderAssistantInto(pending, turn, text);
      // The transcript may have been rebuilt while we waited (panel
      // detached, session reset): re-render so the answer is visible.
      if (!pending.isConnected && this.root && this.turns.length > 0) {
        this.renderTranscript();
      }
      if (result.sessionId !== null) this.setSessionId(result.sessionId);
      void this.refreshSessions();
    } catch (err) {
      pending.remove();
      // While a reset is in flight the transcript is already the new
      // session's; don't spray a cancellation notice into it.
      if (this.turns.length > 0) this.appendError(errorInfo(err));
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

  /** Toolbar "Let EpidBot edit this layer…": attach the layer's identifiers
   * and prefill a prompt asking for an epidbot-edit block (QGIS 0.3.0). */
  async promptEditLayer(): Promise<void> {
    if (!this.root) return;
    if (!this.canWriteToMap() || !this.app.getLayerFeatures || !this.app.updateGeoJsonLayer) {
      this.flashStatus(this.t("attach.unavailable"));
      return;
    }
    const layer = await this.pickLayer();
    if (!layer) return;
    await this.attachLayerData(SCOPE_IDENTIFIERS, layer);
    const features = this.app.getLayerFeatures?.(layer.id) ?? [];
    const fieldNames = new Set<string>();
    for (const feature of features.slice(0, 50)) {
      const properties = feature.properties;
      if (!properties || typeof properties !== "object") continue;
      for (const name of Object.keys(properties)) fieldNames.add(name);
    }
    const joinKey = pickJoinKey([...fieldNames]);
    this.composerInput.value = joinKey
      ? this.t("prompt.editLayer", { key: joinKey })
      : this.t("prompt.editLayerNoKey");
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
        renderMarkdown(turn.text, {
          resolveImage: () => null,
          codeCopyLabels: { copy: this.t("code.copy"), copied: this.t("code.copied") },
        }),
      );
    }
    for (const ref of turn.images) {
      bubble.appendChild(this.buildPlotCard(ref));
    }
    if (
      turn.text &&
      this.canWriteToMap() &&
      this.app.getLayerFeatures &&
      this.app.updateGeoJsonLayer
    ) {
      for (const op of extractEditOps(turn.text)) {
        bubble.appendChild(this.buildEditRow(op));
      }
    }
    if (turn.text && this.canWriteToMap()) {
      const cards = this.buildResultCards(turn.text, question);
      if (cards) bubble.appendChild(cards);
    }
    this.scrollToEnd();
  }

  // ------------------------------------------------------------------
  // Attribute write-back (QGIS 0.3.0 parity)
  // ------------------------------------------------------------------

  /** One "review field edit" row per epidbot-edit operation. */
  private buildEditRow(op: unknown): HTMLElement {
    const row = el("div", "epidbot-edit-row");
    const button = el("button", "epidbot-button epidbot-button-secondary");
    button.type = "button";
    button.textContent = "🛠";
    const caption = el("span", "epidbot-edit-caption");
    let summaryKey = "edit.review";
    let summaryParams: Record<string, string | number> = { name: "?", type: "" };
    try {
      const normalized = validateEditOp(op);
      summaryParams = { name: normalized.field.name, type: normalized.field.type };
    } catch {
      summaryKey = "edit.reviewInvalid";
    }
    this.bindText(caption, summaryKey, undefined);
    caption.textContent = this.t(summaryKey, summaryParams);
    button.title = caption.textContent;
    button.addEventListener("click", () => this.openEditModal(op));
    row.append(button, caption);
    return row;
  }

  /** The mandatory human-in-the-loop preview for an edit operation. Nothing
   * is written until Apply; afterwards the message gains a Revert chip. */
  private openEditModal(op: unknown): void {
    let normalized: ReturnType<typeof validateEditOp>;
    try {
      normalized = validateEditOp(op);
    } catch (err) {
      this.showEditErrorModal(err instanceof Error ? err.message : String(err));
      return;
    }
    const hint = normalized.layer.trim().toLowerCase();
    const allLayers = this.targetLayers();
    const candidates = hint ? allLayers.filter((layer) => layer.name.toLowerCase() === hint) : [];
    const choices = candidates.length > 0 ? candidates : allLayers;

    this.openModal((body, done) => {
      const title = el("h3", "epidbot-modal-title");
      this.bindText(title, "edit.title");
      const intro = el("p", "epidbot-modal-text");
      this.bindText(intro, "edit.intro");

      const targetLabel = el("label", "epidbot-modal-label");
      const targetTitle = el("span", "epidbot-label");
      this.bindText(targetTitle, "edit.targetLabel");
      const select = el("select");
      for (const layer of choices) {
        const option = el("option");
        option.value = layer.id;
        option.textContent = layer.name;
        select.appendChild(option);
      }
      if (choices.length <= 1) select.disabled = true;
      targetLabel.append(targetTitle, select);

      const opWord = normalized.op === "add_field" ? this.t("edit.opAdd") : this.t("edit.opUpdate");
      const confidence =
        normalized.confidence === "fetched"
          ? this.t("edit.confidenceFetched")
          : normalized.confidence === "estimated"
            ? this.t("edit.confidenceEstimated")
            : "";
      const summary = el("p", "epidbot-modal-text");
      summary.textContent = this.t("edit.summary", {
        op: opWord,
        name: normalized.field.name,
        type: normalized.field.type,
        key: normalized.key,
        confidence,
      });

      const stats = el("p", "epidbot-modal-text epidbot-edit-stats");
      const sample = el("pre", "epidbot-edit-sample");
      let selectedLayer: { id: string; name: string } | null = choices[0] ?? null;

      const refreshStats = () => {
        selectedLayer = choices.find((layer) => layer.id === select.value) ?? null;
        stats.textContent = "";
        sample.textContent = "";
        sample.hidden = true;
        if (!selectedLayer) {
          stats.textContent = this.t("edit.noMatchingLayer");
          return;
        }
        let features;
        try {
          features = this.app.getLayerFeatures?.(selectedLayer.id) ?? [];
        } catch (err) {
          stats.textContent = this.t("edit.cannotJoin", {
            reason: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        try {
          requireJoinField(features, normalized.key, selectedLayer.name);
          const keys = buildLayerKeys(features, normalized.key);
          const plan = planEdit(normalized.values, keys, normalized.field.type);
          const unmatched = plan.unmatched.length;
          const invalid = plan.invalid.length;
          stats.textContent = this.t("edit.stats", {
            matched: plan.matched.size,
            total: Object.keys(normalized.values).length,
            unmatched,
            invalid,
          });
          if (unmatched > 0) {
            const shown = plan.unmatched.slice(0, 5).join(", ");
            stats.textContent +=
              "\n" +
              this.t("edit.unmatchedKeys", {
                keys: shown + (unmatched > 5 ? "…" : ""),
              });
          }
          const rows = [...plan.matched.entries()].slice(0, 8);
          const lines = rows.map(([index, value]) => `${index} -> ${value}`);
          if (plan.matched.size > rows.length) {
            lines.push(this.t("edit.moreRows", { count: plan.matched.size - rows.length }));
          }
          if (lines.length > 0) {
            sample.textContent = lines.join("\n");
            sample.hidden = false;
          }
        } catch (err) {
          stats.textContent = this.t("edit.cannotJoin", {
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      };
      select.addEventListener("change", refreshStats);
      refreshStats();

      const errorLine = el("p", "epidbot-modal-error");
      errorLine.hidden = true;

      const actions = el("div", "epidbot-modal-actions");
      const apply = el("button", "epidbot-button epidbot-button-primary");
      apply.type = "button";
      this.bindText(apply, "edit.apply");
      apply.addEventListener("click", () => {
        if (!selectedLayer) return;
        let features;
        try {
          features = this.app.getLayerFeatures?.(selectedLayer.id) ?? [];
        } catch (err) {
          errorLine.textContent = this.t("edit.notApplied", {
            reason: err instanceof Error ? err.message : String(err),
          });
          errorLine.hidden = false;
          return;
        }
        try {
          const report = applyEditOp(
            this.app,
            { layerId: selectedLayer.id, layerName: selectedLayer.name, features },
            normalized,
          );
          done();
          this.appendEditApplied(report);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          if (err instanceof EditOpError) {
            errorLine.textContent = this.t("edit.notApplied", { reason });
            errorLine.hidden = false;
          } else {
            done();
            this.flashStatus(this.t("edit.notApplied", { reason }));
          }
        }
      });
      const cancel = el("button", "epidbot-button epidbot-button-secondary");
      cancel.type = "button";
      this.bindText(cancel, "edit.cancel");
      cancel.addEventListener("click", done);
      actions.append(apply, cancel);

      body.append(title, intro, targetLabel, summary, stats, sample, errorLine, actions);
    });
  }

  private showEditErrorModal(message: string): void {
    this.openModal((body, done) => {
      const title = el("h3", "epidbot-modal-title");
      this.bindText(title, "edit.title");
      const text = el("p", "epidbot-modal-text");
      this.bindText(text, "edit.invalidOp");
      const details = el("pre", "epidbot-edit-sample");
      details.textContent = message;
      const actions = el("div", "epidbot-modal-actions");
      const close = el("button", "epidbot-button epidbot-button-secondary");
      close.type = "button";
      this.bindText(close, "edit.cancel");
      close.addEventListener("click", done);
      actions.appendChild(close);
      body.append(title, text, details, actions);
    });
  }

  /** Success notice with a Revert chip (the host has no undo). */
  private appendEditApplied(report: ReturnType<typeof applyEditOp>): void {
    const notice = el("div", "epidbot-msg epidbot-msg-assistant epidbot-edit-notice");
    const unmatchedNote =
      report.unmatched.length > 0
        ? this.t("edit.unmatchedNote", { count: report.unmatched.length })
        : "";
    const text = el("span");
    text.textContent =
      "✅ " +
      this.t("edit.applied", {
        op: report.op,
        field: report.field,
        layer: report.layerName,
        matched: report.matched,
        note: unmatchedNote,
      });
    const revert = el("button", "epidbot-button epidbot-button-secondary");
    revert.type = "button";
    this.bindText(revert, "edit.revert");
    revert.addEventListener("click", () => {
      try {
        report.revert();
        revert.disabled = true;
        this.flashStatus(this.t("edit.reverted"));
      } catch (err) {
        this.flashStatus(
          this.t("edit.revertFailed", {
            reason: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    });
    notice.append(text, revert);
    this.transcript.appendChild(notice);
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
    const card = el("div", "epidbot-result");
    const title = el("div", "epidbot-result-title");
    const kindLabel =
      block.urlKind === "tiles"
        ? "Tiles"
        : block.artifact
          ? "EpidBot artifact"
          : block.urlKind === "csv"
            ? "CSV"
            : "Dataset";
    title.textContent = `${kindLabel} · ${block.url}`;
    const actions = el("div", "epidbot-result-actions");

    if (block.urlKind === "tiles") {
      // Tile layers are an optional capability; without them the card is noise.
      if (!this.app.addTileLayer) return null;
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

    // Vector datasets (GeoJSON/artifact/CSV) are fetched, converted when
    // needed, validated and only then placed on the map.
    const add = el("button", "epidbot-button epidbot-button-primary");
    add.type = "button";
    this.bindText(add, "results.addToMap");
    add.addEventListener("click", () => {
      void this.loadDatasetCard(block, question, index, add);
    });
    const download = el("button", "epidbot-button epidbot-button-secondary");
    download.type = "button";
    this.bindText(download, "results.downloadFile");
    download.addEventListener("click", () => {
      void this.downloadDatasetFile(block, index);
    });
    actions.append(add, download);
    card.append(title, actions);
    return card;
  }

  /** Fetch + parse + validate a dataset card, then add it as a styled layer
   * (authenticated for EpidBot artifacts and same-server URLs). */
  private async loadDatasetCard(
    block: LayerUrlResultBlock,
    question: string,
    index: number,
    add: HTMLButtonElement,
  ): Promise<void> {
    if (this.loadingDataset) {
      this.flashStatus(this.t("results.stillLoading"));
      return;
    }
    this.loadingDataset = true;
    const name = this.layerName(question, index);
    this.showStatus(this.t("results.loading", { name }));
    try {
      const blob = await this.client.downloadWithAuth(block.url, { signal: this.abort?.signal });
      const fc = await this.parseDatasetBlob(blob, block);
      if (!fc) {
        this.flashStatus(this.t("results.unreadable"));
        return;
      }
      const layerId = this.app.addGeoJsonLayer(name, fc);
      const styled = this.app.importLayerStyle?.(layerId, styleFor(fc));
      if (styled && !styled.ok) {
        this.flashStatus(this.t("results.styleFailed"));
      }
      this.cb.onLayerAdded?.({
        layerId,
        name,
        kind: "url",
        question,
        addedAt: new Date().toISOString(),
      });
      add.disabled = true;
      this.setText(add, "results.added");
      this.flashStatus(this.t("results.addedNotice", { name }));
    } catch (err) {
      this.flashStatus(
        this.t("results.loadFailed", {
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      this.loadingDataset = false;
      this.showStatus(null);
    }
  }

  /** Turn fetched bytes into a validated FeatureCollection: CSV tables are
   * converted client-side when coordinate columns exist. */
  private async parseDatasetBlob(
    blob: Blob,
    block: LayerUrlResultBlock,
  ): Promise<GeoLibreFeatureCollection | null> {
    const text = await blob.text();
    const trimmed = text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const validation = validateGeoJson(JSON.parse(trimmed));
      if (!validation.ok || !validation.fc) {
        throw new EpidBotApiError(`Invalid GeoJSON: ${validation.reason ?? "unknown"}`);
      }
      return validation.fc;
    }
    if (block.urlKind === "csv" || /\.csv(\?|#|$)/i.test(block.url)) {
      return csvToFeatureCollection(text)?.fc ?? null;
    }
    return null;
  }

  /** Download the raw bytes of a dataset card to the user's device. */
  private async downloadDatasetFile(block: LayerUrlResultBlock, index: number): Promise<void> {
    try {
      const blob = await this.client.downloadWithAuth(block.url, { signal: this.abort?.signal });
      const url = URL.createObjectURL(blob);
      this.objectUrls.push(url);
      const link = el("a");
      const path = block.url.split("?", 1)[0];
      const base = path.slice(path.lastIndexOf("/") + 1) || `epidbot-dataset-${index}`;
      link.href = url;
      link.download = decodeURIComponent(base);
      link.click();
    } catch (err) {
      this.flashStatus(
        this.t("results.loadFailed", {
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    }
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

  private async submitComposer(stopIfBusy = false): Promise<void> {
    if (this.busy) {
      // Only the explicit Stop button (a form submit) cancels the running
      // question; pressing Enter again must never interrupt it.
      if (stopIfBusy) this.abort?.abort();
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
    this.inlineBudgetInput.value = String(settings.inlineBudgetKb);
    this.artifactUploadsInput.checked = settings.artifactUploads;
    if (this.contextAttachInput) this.contextAttachInput.checked = settings.attachMapContext;
  }

  private readSettingsForm(): EpidBotSettings {
    return sanitizeSettings({
      serverUrl: this.serverUrlInput.value,
      answerLocale: this.localeSelect.value,
      pollIntervalSec: Number(this.pollIntervalInput.value),
      inlineBudgetKb: Number(this.inlineBudgetInput.value),
      artifactUploads: this.artifactUploadsInput.checked,
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
      const result = this.saveKey(enteredKey, next.serverUrl);
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

  private saveKey(key: string, serverUrl: string): ApiKeySaveResult {
    const result = saveApiKey(this.app, key, serverUrl);
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
