/** A GeoLibreAppAPI test double: in-memory panels/menus/credential store and
 * a translate() that resolves registered catalogs like the host does. */

import { interpolate } from "../src/i18n";
import type {
  GeoLibreAppAPI,
  GeoLibreAssistantToolSpec,
  GeoLibreFeatureCollection,
  GeoLibreFeatureInput,
  GeoLibrePluginCredentials,
  GeoLibreRightPanelRegistration,
  GeoLibreToolbarMenu,
} from "../src/lib/geolibre/host-api";

export interface FakeApp {
  app: GeoLibreAppAPI;
  panels: Map<string, GeoLibreRightPanelRegistration>;
  menus: Map<string, GeoLibreToolbarMenu>;
  credentials: Map<string, string>;
  catalogs: Record<string, Record<string, string>>;
  openedPanels: string[];
  closedPanels: string[];
  /** Features reported by getSelectedFeatures (mutable in tests). */
  selectedFeatures: GeoLibreFeatureInput[];
  selectedLayerId: string | null;
  /** Layers added through addGeoJsonLayer / addTileLayer. */
  addedLayers: Array<{ name: string; data: GeoLibreFeatureCollection }>;
  addedTiles: Array<{ name: string; url: string }>;
  /** Active renderer reported by getMapRenderer. */
  renderer: "maplibre" | "mapbox" | "cesium" | "arcgis";
  /** Assistant tool specs and guidance registered by the plugin. */
  tools: Map<string, GeoLibreAssistantToolSpec>;
  guidance: string[];
}

export function createFakeApp(): FakeApp {
  const panels = new Map<string, GeoLibreRightPanelRegistration>();
  const menus = new Map<string, GeoLibreToolbarMenu>();
  const credentials = new Map<string, string>();
  const catalogs: Record<string, Record<string, string>> = {};
  const openedPanels: string[] = [];
  const closedPanels: string[] = [];
  const selectedFeatures: GeoLibreFeatureInput[] = [];
  let selectedLayerId: string | null = null;
  const addedLayers: Array<{ name: string; data: GeoLibreFeatureCollection }> = [];
  const addedTiles: Array<{ name: string; url: string }> = [];
  let renderer: FakeApp["renderer"] = "maplibre";
  const tools = new Map<string, GeoLibreAssistantToolSpec>();
  const guidance: string[] = [];

  const store: GeoLibrePluginCredentials = {
    get: (name) => credentials.get(name) ?? "",
    set: (name, value) => {
      if (value === "") {
        credentials.delete(name);
      } else {
        credentials.set(name, value);
      }
      return true;
    },
    location: () => "browser",
  };

  const app = {
    registerRightPanel: (panel: GeoLibreRightPanelRegistration) => {
      panels.set(panel.id, panel);
      return () => panels.delete(panel.id);
    },
    unregisterRightPanel: (id: string) => {
      panels.delete(id);
    },
    openRightPanel: (id: string) => {
      openedPanels.push(id);
      return true;
    },
    closeRightPanel: (id: string) => {
      closedPanels.push(id);
    },
    registerToolbarMenu: (menu: GeoLibreToolbarMenu) => {
      menus.set(menu.id, menu);
      return () => menus.delete(menu.id);
    },
    unregisterToolbarMenu: (id: string) => {
      menus.delete(id);
    },
    credentials: store,
    getLocale: () => "en",
    onLocaleChange: () => () => {},
    registerTranslations: (resources: Record<string, Record<string, string>>) => {
      // Mirror the host's rule: only plugin.epidbot.* keys are accepted.
      for (const [locale, entries] of Object.entries(resources)) {
        const accepted: Record<string, string> = {};
        for (const [key, value] of Object.entries(entries)) {
          if (key.startsWith("plugin.epidbot.")) accepted[key] = value;
        }
        catalogs[locale] = { ...(catalogs[locale] ?? {}), ...accepted };
      }
    },
    translate: (
      key: string,
      defaultValue: string,
      params?: Record<string, string | number>,
    ) => {
      const entry = catalogs.en?.[key];
      return interpolate(entry !== undefined ? entry : defaultValue, params);
    },
    getSelectedFeatures: () => selectedFeatures,
    getSelectedLayerId: () => selectedLayerId,
    addGeoJsonLayer: (name: string, data: GeoLibreFeatureCollection) => {
      addedLayers.push({ name, data });
      return `layer-${addedLayers.length}`;
    },
    importLayerStyle: () => ({ ok: true }),
    addTileLayer: (name: string, url: string) => {
      addedTiles.push({ name, url });
      return `tile-${addedTiles.length}`;
    },
    getMapRenderer: () => renderer,
    registerAssistantToolSpec: (spec: GeoLibreAssistantToolSpec) => {
      tools.set(spec.name, spec);
      return () => tools.delete(spec.name);
    },
    registerAssistantGuidance: (text: string) => {
      guidance.push(text);
      return () => {
        const index = guidance.indexOf(text);
        if (index !== -1) guidance.splice(index, 1);
      };
    },
  } as unknown as GeoLibreAppAPI;

  return {
    app,
    panels,
    menus,
    credentials,
    catalogs,
    openedPanels,
    closedPanels,
    selectedFeatures,
    set selectedLayerId(value: string | null) {
      selectedLayerId = value;
    },
    get selectedLayerId() {
      return selectedLayerId;
    },
    addedLayers,
    addedTiles,
    set renderer(value: FakeApp["renderer"]) {
      renderer = value;
    },
    get renderer() {
      return renderer;
    },
    tools,
    guidance,
  };
}
