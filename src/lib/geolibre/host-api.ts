/**
 * GeoLibre host-plugin contract — the subset this plugin uses.
 *
 * Transcribed from the published Plugin API (geolibre.app/plugin-api) for the
 * GeoLibre 3.5.x line. Only `activate`/`deactivate` are guaranteed; every
 * other member is an optional capability and must be called with optional
 * chaining, degrading gracefully on hosts that predate it. See
 * docs/capability-matrix.md for how each member is used and what the fallback
 * is.
 */

/** Engine-neutral viewport/CRS bounds, [west, south, east, north] in degrees. */
export type GeoLibreBounds = [number, number, number, number];

export interface GeoLibreFeatureCollection {
  type: "FeatureCollection";
  features: unknown[];
}

export interface GeoLibreLayerSummary {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  opacity: number;
}

export interface GeoLibreSelection {
  layerId: string | null;
  features: GeoLibreFeatureInput[];
}

/** Structural GeoJSON feature (geometry may be null on filtered layers). */
export interface GeoLibreFeatureInput {
  type: "Feature";
  geometry?: unknown | null;
  properties?: Record<string, unknown> | null;
  id?: string | number | null;
}

export interface GeoLibreMapCrs {
  id: string;
  code: string;
  wmsSrs?: string;
}

/** Credential storage: names are scoped by the host to `plugin.<id>.<name>`.
 * Reads are synchronous; `set` returns false when the value lasts only for
 * the session; setting "" deletes. */
export interface GeoLibrePluginCredentials {
  get(name: string): string;
  set(name: string, value: string): boolean;
  location(): "keychain" | "browser";
}

export interface GeoLibreRightPanelRegistration {
  id: string;
  /** A getter re-localizes the title live on language changes. */
  title: string | (() => string);
  icon?: string;
  defaultWidth?: number;
  deactivatePluginOnClose?: boolean;
  /** Fill the panel body with your own DOM. May return a cleanup function. */
  render: (container: HTMLElement) => void | (() => void);
  onOpen?: () => void;
  onCollapse?: () => void;
  onClose?: () => void;
}

export type GeoLibreToolbarLabel = string | (() => string);

export type GeoLibreToolbarMenuItem =
  | {
      type?: "action";
      id: string;
      label: GeoLibreToolbarLabel;
      icon?: string;
      disabled?: boolean;
      onSelect: () => void;
    }
  | {
      type: "submenu";
      id: string;
      label: GeoLibreToolbarLabel;
      icon?: string;
      items: GeoLibreToolbarMenuItem[];
    }
  | { type: "separator"; id?: string };

export interface GeoLibreToolbarMenu {
  id: string;
  label: GeoLibreToolbarLabel;
  icon?: string;
  items: GeoLibreToolbarMenuItem[];
}

/** The surface GeoLibre exposes to an active plugin. */
export interface GeoLibreAssistantToolSpec {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  callback: (
    input: unknown,
    context?: { signal?: AbortSignal },
  ) => unknown | Promise<unknown>;
}

/** The surface GeoLibre exposes to an active plugin. */
export interface GeoLibreAppAPI {
  // -- Panels and menus -----------------------------------------------------
  registerRightPanel?: (panel: GeoLibreRightPanelRegistration) => () => void;
  unregisterRightPanel?: (id: string) => void;
  openRightPanel?: (id: string) => boolean;
  collapseRightPanel?: (id: string) => void;
  closeRightPanel?: (id: string) => void;
  getActiveRightPanel?: () => string | null;
  registerToolbarMenu?: (menu: GeoLibreToolbarMenu) => () => void;
  unregisterToolbarMenu?: (id: string) => void;

  // -- Credentials and i18n -------------------------------------------------
  credentials?: GeoLibrePluginCredentials;
  getLocale?: () => string;
  onLocaleChange?: (listener: (locale: string) => void) => () => void;
  translate?: (
    key: string,
    defaultValue: string,
    params?: Record<string, string | number>,
  ) => string;
  /** Only string values under `plugin.<plugin-id>.` are accepted. */
  registerTranslations?: (
    resources: Record<string, Record<string, string>>,
  ) => void;

  // -- Networking -----------------------------------------------------------
  /** Desktop only: fetch through the native client (no CORS, cookie jar). */
  nativeFetch?: typeof globalThis.fetch;

  // -- Read-only map queries (engine-neutral) --------------------------------
  listLayers?: () => GeoLibreLayerSummary[];
  getLayerFeatures?: (layerId: string) => GeoLibreFeatureInput[];
  getSelectedFeatures?: () => GeoLibreFeatureInput[];
  getSelectedLayerId?: () => string | null;
  getViewBounds?: () => GeoLibreBounds | null;
  getMapCrs?: () => GeoLibreMapCrs | null;
  onMapCrsChange?: (listener: (crs: GeoLibreMapCrs | null) => void) => () => void;
  getMapRenderer?: () => "maplibre" | "mapbox" | "cesium" | "arcgis";

  // -- Map writing (2D renderers; hidden on cesium/arcgis) -------------------
  addGeoJsonLayer: (name: string, data: GeoLibreFeatureCollection, sourcePath?: string) => string;
  /** Dress a layer with an SLD, QGIS QML or Mapbox GL style JSON (detected
   * from the content); merged over the layer's current style. */
  importLayerStyle?: (
    layerId: string,
    text: string,
  ) => { ok: boolean; reason?: string; warnings?: string[] };
  updateGeoJsonLayer?: (layerId: string, data: GeoLibreFeatureCollection) => boolean;
  removeLayer?: (layerId: string) => void;
  setLayerVisibility?: (layerId: string, visible: boolean) => void;
  addTileLayer?: (
    name: string,
    url: string,
    options?: Record<string, unknown>,
  ) => string;
  fitBounds?: (bounds: GeoLibreBounds) => void;

  // -- AI assistant (activation-only; omitted from other lifecycle hooks) ----
  /** Register a declarative assistant tool: plain JSON Schema plus a
   * callback. Input is NOT validated — the callback must validate it. The
   * callback's second argument carries { signal } for the assistant's Stop. */
  registerAssistantToolSpec?: (spec: GeoLibreAssistantToolSpec) => () => void;
  /** Text appended to the assistant's system prompt (≤ 4000 chars). */
  registerAssistantGuidance?: (text: string) => () => void;
}

/** The object a plugin's GeoLibre entry point must export. */
export interface GeoLibrePlugin {
  /** Stable plugin id; must match `plugin.json`'s `id`. */
  id: string;
  /** Display name; must match `plugin.json`'s `name`. */
  name: string;
  /** Semantic version; must match `plugin.json`'s `version`. */
  version: string;
  /** Renderers this plugin supports. Defaults to `["maplibre"]`. */
  engines?: ("maplibre" | "mapbox" | "cesium" | "arcgis")[];
  /**
   * The plugin's project state is project data: every project load calls
   * applyProjectState, with undefined when the file has no state for it, so
   * the previous project's session does not carry over.
   */
  clearsStateOnProjectLoad?: boolean;
  activate: (app: GeoLibreAppAPI) => boolean | void | Promise<boolean | void>;
  deactivate: (app: GeoLibreAppAPI) => void;
  getProjectState?: () => unknown;
  applyProjectState?: (app: GeoLibreAppAPI, state: unknown) => boolean | void;
}
