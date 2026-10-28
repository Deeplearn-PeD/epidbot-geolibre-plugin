/** EpidBot for GeoLibre — plugin entry point.
 *
 * Wires the host capabilities (right panel, toolbar menu, credentials, i18n)
 * to the chat client. Every optional host member is called through optional
 * chaining, so the plugin still loads on GeoLibre builds that predate an
 * API; features the host cannot support stay hidden instead of broken.
 */

import "./panel/styles.css";
import { EpidBotClient } from "./api/client";
import { buildMapContext } from "./api/mapContext";
import { registerAssistantTools } from "./assistant";
import { createTranslator, registerEpidBotTranslations } from "./i18n";
import type { GeoLibreAppAPI, GeoLibrePlugin } from "./lib/geolibre/host-api";
import { EpidBotPanel } from "./panel/panel";
import type { EpidBotSettings } from "./types";
import { loadApiKey, sanitizeProjectState } from "./settings/store";
import { PLUGIN_ID, PLUGIN_NAME, VERSION } from "./version";
import type { ResultLayerRecord } from "./types";

const PANEL_ID = `${PLUGIN_ID}-chat`;
const MENU_ID = `${PLUGIN_ID}-menu`;

/** Panel icon: a chat bubble with a locator dot, as a data URI (no remote
 * assets in the bundle). */
const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">` +
      `<path fill="#2456a6" d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5.2 4.1A1 1 0 0 1 4 20.3V17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/>` +
      `<circle fill="#fff" cx="12" cy="10" r="2.4"/>` +
      `</svg>`,
  );

/** State that survives deactivate → activate within one host session. */
interface Runtime {
  app: GeoLibreAppAPI;
  client: EpidBotClient;
  panel: EpidBotPanel | null;
  settings: EpidBotSettings;
  resultLayers: ResultLayerRecord[];
  disposers: Array<() => void>;
}

let rt: Runtime | null = null;
let savedState = sanitizeProjectState(undefined);
let assistantDisposer: (() => void) | null = null;

/** Progressive disclosure: the assistant tools are advertised only while a
 * key exists (README F5). Re-run after every settings change, since that is
 * when the key appears or disappears. */
function syncAssistantTools(): void {
  assistantDisposer?.();
  assistantDisposer = null;
  if (!rt) return;
  if (!loadApiKey(rt.app)) return;
  assistantDisposer = registerAssistantTools({
    app: rt.app,
    client: rt.client,
    getSettings: () => rt!.settings,
    getSessionId: () => rt!.panel?.getSessionId() ?? null,
    buildContext: () => buildMapContext(rt!.app),
    onLayerAdded: (record) => {
      rt?.resultLayers.push(record);
    },
  });
}

function activateRuntime(app: GeoLibreAppAPI): void {
  registerEpidBotTranslations(app);
  const t = createTranslator(app);

  const settings = { ...savedState.settings };
  // Read nativeFetch lazily: hosts may expose it any time, and tests can
  // stub it after activation. On hosts backed by nativeFetch (desktop) the
  // abort signal stays out of fetch() — its support is unspecified — so
  // Stop takes effect at the next poll boundary; browser fetch (web) gets
  // true request-level cancellation.
  const client = new EpidBotClient({
    serverUrl: settings.serverUrl,
    getApiKey: () => (rt ? loadApiKey(rt.app) : ""),
    fetchImpl: ((...args: Parameters<typeof fetch>) =>
      (rt?.app.nativeFetch ?? globalThis.fetch)(...args)) as typeof fetch,
    passSignalToFetch: typeof app.nativeFetch !== "function",
  });

  const runtime: Runtime = {
    app,
    client,
    panel: null,
    settings,
    resultLayers: [...savedState.resultLayers],
    disposers: [],
  };
  rt = runtime;

  const panel = new EpidBotPanel(app, client, t, {
    getSettings: () => runtime.settings,
    onSettingsChange: (next) => {
      runtime.settings = next;
      client.setServerUrl(next.serverUrl);
      syncAssistantTools();
    },
    getApiKey: () => loadApiKey(app),
    buildContext: () => buildMapContext(app),
    onLayerAdded: (record: ResultLayerRecord) => {
      // Cap implicitly: the project-state sanitizer keeps the last 50.
      runtime.resultLayers.push(record);
    },
  });
  runtime.panel = panel;

  // Right sidebar chat panel.
  if (app.registerRightPanel) {
    const unregister = app.registerRightPanel({
      id: PANEL_ID,
      title: () => t("panel.title"),
      icon: ICON,
      defaultWidth: 420,
      render: (container) => panel.attach(container),
    });
    runtime.disposers.push(() => {
      app.closeRightPanel?.(PANEL_ID);
      unregister();
    });
  }

  // Toolbar menu.
  if (app.registerToolbarMenu) {
    const unregister = app.registerToolbarMenu({
      id: MENU_ID,
      label: () => t("panel.title"),
      icon: ICON,
      items: [
        {
          id: `${MENU_ID}-open`,
          label: () => t("menu.open"),
          onSelect: () => app.openRightPanel?.(PANEL_ID),
        },
        {
          type: "submenu",
          id: `${MENU_ID}-ask`,
          label: () => t("menu.ask"),
          items: [
            {
              id: `${MENU_ID}-ask-extent`,
              label: () => t("menu.askExtent"),
              onSelect: () => {
                app.openRightPanel?.(PANEL_ID);
                runtime.panel?.promptExtent();
              },
            },
            {
              id: `${MENU_ID}-ask-selection`,
              label: () => t("menu.askSelection"),
              onSelect: () => {
                app.openRightPanel?.(PANEL_ID);
                runtime.panel?.promptSelection();
              },
            },
          ],
        },
        {
          id: `${MENU_ID}-new-session`,
          label: () => t("menu.newSession"),
          onSelect: () => runtime.panel?.newSession(),
        },
        {
          id: `${MENU_ID}-export`,
          label: () => t("menu.export"),
          onSelect: () => runtime.panel?.exportMarkdown(),
        },
        { type: "separator" },
        {
          id: `${MENU_ID}-settings`,
          label: () => t("menu.settings"),
          onSelect: () => {
            app.openRightPanel?.(PANEL_ID);
            runtime.panel?.openSettings();
          },
        },
      ],
    });
    runtime.disposers.push(unregister);
  }

  // Restore the project's session binding, if any.
  if (savedState.sessionId !== null) {
    panel.setSessionId(savedState.sessionId);
  }

  app.openRightPanel?.(PANEL_ID);
  syncAssistantTools();
}

function deactivateRuntime(): void {
  if (!rt) return;
  // Persist live state for a later re-activation in the same host session.
  savedState = {
    version: 1,
    settings: { ...rt.settings },
    sessionId: rt.panel?.getSessionId() ?? savedState.sessionId,
    resultLayers: [...rt.resultLayers],
  };
  assistantDisposer?.();
  assistantDisposer = null;
  for (const dispose of rt.disposers) {
    try {
      dispose();
    } catch {
      // A host that misbehaves during teardown must not block the rest.
    }
  }
  rt.panel?.dispose();
  rt = null;
}

export const plugin: GeoLibrePlugin = {
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  version: VERSION,
  // Chat is engine-neutral; map-writing actions are gated per renderer in
  // later phases (results on the map), so every engine may activate.
  engines: ["maplibre", "mapbox", "cesium", "arcgis"],
  // The session binding and preferences are project data: loading a project
  // with no EpidBot state must reset them instead of carrying the previous
  // project's session over.
  clearsStateOnProjectLoad: true,

  activate(app) {
    activateRuntime(app);
  },

  deactivate() {
    deactivateRuntime();
  },

  getProjectState() {
    if (rt) {
      return {
        version: 1,
        settings: { ...rt.settings },
        sessionId: rt.panel?.getSessionId() ?? null,
        resultLayers: [...rt.resultLayers],
      };
    }
    return savedState;
  },

  applyProjectState(_app, state) {
    savedState = sanitizeProjectState(state);
    if (rt) {
      rt.settings = savedState.settings;
      rt.resultLayers = [...savedState.resultLayers];
      rt.client.setServerUrl(savedState.settings.serverUrl);
      if (rt.panel) {
        rt.panel.applySettings(savedState.settings);
        rt.panel.setSessionId(savedState.sessionId);
      }
    }
  },
};

export default plugin;
