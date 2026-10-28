/** A GeoLibreAppAPI test double: in-memory panels/menus/credential store and
 * a translate() that resolves registered catalogs like the host does. */

import { interpolate } from "../src/i18n";
import type {
  GeoLibreAppAPI,
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
}

export function createFakeApp(): FakeApp {
  const panels = new Map<string, GeoLibreRightPanelRegistration>();
  const menus = new Map<string, GeoLibreToolbarMenu>();
  const credentials = new Map<string, string>();
  const catalogs: Record<string, Record<string, string>> = {};
  const openedPanels: string[] = [];
  const closedPanels: string[] = [];

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
    addGeoJsonLayer: () => "layer-id",
  } as GeoLibreAppAPI;

  return {
    app,
    panels,
    menus,
    credentials,
    catalogs,
    openedPanels,
    closedPanels,
  };
}
