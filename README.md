# EpidBot for GeoLibre

A [GeoLibre](https://geolibre.app/) plugin that brings **EpidBot** — the AI assistant for
Brazilian public health data (DATASUS/SINAN, WHO, PAHO, ECDC and 40+ other sources) — into the
GeoLibre workspace, so epidemiological questions can be asked over the map you are already
looking at, with the answers coming back as map layers and charts.

This repository is the GeoLibre counterpart of
[`Deeplearn-PeD/epidbot-qgis-plugin`](https://github.com/Deeplearn-PeD/epidbot-qgis-plugin).
It is currently at the **planning stage**: this README is the development plan.

Status: no code yet. Target: functional parity with the QGIS plugin (v0.2.x), then GeoLibre-only
extras (assistant tools, deep links).

---

## 1. Why a GeoLibre plugin

GeoLibre is a free and open-source, cloud-native GIS that runs in the browser, on the desktop
(Tauri v2 shell + React UI + MapLibre GL JS / deck.gl), on mobile and inside Jupyter notebooks.
It has a curated plugin marketplace, and its plugin contract is a single self-contained ES
module, which makes an EpidBot client simpler and more portable than the Python QGIS plugin:

- one TypeScript codebase serving desktop, web and notebook usage;
- native right-sidebar and floating panels instead of a Qt dock;
- the same REST contract already used by the QGIS plugin and the VS Code extension;
- a path to registering EpidBot as a tool of GeoLibre's own AI assistant.

## 2. Scope of the first release (parity with the QGIS plugin)

In scope:

- a dockable **EpidBot chat panel** inside GeoLibre, with Markdown answers and inline charts;
- **API-key authentication** with the key stored through the host credential store;
- **map-context injection** — active layers (name/type/visibility), viewport bounds, map CRS and
  the current selection are sent with the question when the user allows it;
- one-click **spatial prompts**: "ask about this extent", "ask about this selection";
- **results on the map** — GeoJSON blocks from an answer become styled layers; dataset/tile URLs
  become tile layers; generated plots can be viewed, exported or sent to the print layout;
- **sessions** — pick an existing conversation, start a new one, export it as Markdown;
- **EN / pt-BR interface**, following the GeoLibre application language.

Out of scope for the first release: file upload into a session, report generation UI, knowledge
base management, streaming responses (the REST contract is submit-and-poll).

## 3. Verified host facts (researched 2026-10-28)

| Item | Finding |
|---|---|
| Upstream repository | [`opengeos/GeoLibre`](https://github.com/opengeos/GeoLibre), latest release **v3.5.2** (2026-10-28) |
| Plugin contract | [`geolibre.app/plugin-api`](https://geolibre.app/plugin-api/) and [`plugins.geolibre.app/develop`](https://plugins.geolibre.app/develop/) |
| Plugin unit | one self-contained ES module exporting a `GeoLibrePlugin` (`id`, `name`, `version`, `activate`, `deactivate`) whose `id`/`name`/`version` must match `plugin.json` |
| Manifest | `plugin.json` with `id`, `name`, `version`, `entry`, optional `style` |
| Build/packaging | official [`opengeos/geolibre-plugin-template`](https://github.com/opengeos/geolibre-plugin-template); `npm run package:geolibre` produces a reproducible zip (`plugin.json` + `dist/index.js` + `dist/style.css`) and prints its SHA-256 |
| Distribution | curated registry: PR to [`opengeos/geolibre-plugins`](https://github.com/opengeos/geolibre-plugins) adding `registry/<id>.json` pointing at a GitHub release zip pinned by `sha256` + `minGeoLibreVersion`; CI validates the zip and posts a preview build; merge publishes to `plugins.geolibre.app` |
| Security model | plugins are **trusted code with full app privileges**; the registry is an allowlist and every entry is reviewed |
| Plugin id availability | `epidbot` is free (24 plugins in the registry today: `geolibre-*`, `kml-kmz-import`, `layout-composer`, …) |
| Host API used by this plugin | `registerRightPanel` / `openRightPanel` / `closeRightPanel`, `registerFloatingPanel`, `registerToolbarMenu`, `registerMenuContribution`, `addGeoJsonLayer` / `updateGeoJsonLayer` / `removeLayer` / `listLayers` / `getLayerFeatures`, `setLayerVisibility`, `importLayerStyle`, `getSelectedFeatures`, `getViewBounds`, `getMapCrs`, `readRasterWindow`, `nativeFetch`, `credentials`, `getLocale` / `translate` / `registerTranslations`, `registerAssistantTool` / `registerAssistantToolSpec` / `registerAssistantGuidance`, `getProjectState` / `applyProjectState` |
| CORS | the EpidBot REST API reflects the request `Origin` on preflight (verified 2026-10-28: `OPTIONS /chat` from `Origin: https://geolibre.app` → `200`, `access-control-allow-origin` echoed, `access-control-allow-headers: x-api-key,content-type`, `allow-credentials: true`), so browser and webview `fetch` work without a proxy. `app.nativeFetch` remains the fallback on desktop |

## 4. EpidBot API contract

- Base URL: `https://api.epidbot.kwar-ai.com.br`
- Chat: `POST /chat` with header `X-API-Key: <key>` and a JSON body carrying the question (and the
  optional `session_id`); the response is a job id, polled with `GET /chat/{job_id}` until the
  answer is complete — the same submit-and-poll pattern as the QGIS plugin.
- Authentication: a personal key created in the web app under **Settings → API Keys**.
- Plan gate: API keys are part of the **Max and Team** plans (Team inherits every Max feature).
- Data handling: the question and the map context the user explicitly attaches are the only data
  sent; nothing is collected by the plugin itself.

## 5. Architecture

```text
src/
  geolibre.ts            # GeoLibrePlugin entry: activate/deactivate, menus, panel wiring
  panel/                 # right sidebar panel: transcript, composer, result cards (plain DOM)
  api/client.ts          # REST client: submit + poll, typed errors, retry/backoff
  api/mapContext.ts      # view bounds, CRS, layers, selection -> bounded context payload
  api/results.ts         # GeoJSON/tile/plot extraction from an answer
  settings/store.ts      # API key via app.credentials, non-secret prefs via project state
  i18n/{en,pt-BR}.ts     # registerTranslations
tests/                   # Vitest unit tests for client, context builder, result parser
scripts/                 # packaging helpers around the official template
.github/workflows/       # ci.yml (typecheck, tests, bundle budget), release-plugin.yml (zip + entry)
geolibre-plugin/         # plugin.json manifest (id: epidbot)
```

Design choices:

- **No UI framework in the bundle.** The right panel renders plain DOM, matching the host's
  contract; that keeps the module small and avoids shipping a second React copy.
- **Credentials never touch the project file.** The key goes to `app.credentials`; project state
  keeps only the session id and panel preferences, and is declared in the registry entry with
  `publishableSettings` so it can be stripped from shared exports.
- **Context is bounded and visible.** At most a handful of layers and sample feature rows,
  truncated; the panel shows exactly what will be attached, and the user can switch it off.
- **Capabilities are optional.** Every host member is called with optional chaining, so the plugin
  still loads on GeoLibre builds that predate a given API, and hides what it cannot do there.

## 6. Development plan

`F` = phase, estimate in developer-days.

### F0 — Research and setup (0.5 d)

- clone and run the plugin template; run GeoLibre Desktop locally (`npm run install:geolibre`
  drops the bundle into the app-data plugins directory);
- record which host API members exist on the targeted GeoLibre version; set
  `minGeoLibreVersion` from that matrix (provisional: `3.5.0`);
- decide the **plugin id** (`epidbot`) and the **license** (see open decisions);
- re-check the CORS preflight against the EpidBot API and the polling contract.

Done when: the template bundle loads in GeoLibre Desktop and the capability matrix is written down
in this repository.

### F1 — MVP chat panel (2 d)

- right sidebar panel with transcript and composer; toolbar entry to open it;
- API client: submit + poll, typed failures for invalid key (401), plan gate (403) and quota (429),
  with human-readable messages;
- settings surface: API key via `app.credentials`, server URL override, "attach map context" switch;
- i18n scaffolding with `registerTranslations` (EN, pt-BR).

Done when: a question typed in GeoLibre comes back as a rendered answer, with a key entered once
and remembered across restarts.

### F2 — Map context and spatial prompts (1.5 d)

- context builder: viewport bounds, CRS, layer summaries, selection summary;
- two toolbar actions: *ask about this extent*, *ask about this selection*;
- panel indicator of the exact context payload, with a preview and an off switch.

Done when: questions about the current extent return answers that reference that area, and the
context payload stays under a fixed token budget.

### F3 — Results on the map (2 d)

- GeoJSON in an answer → dialog → `addGeoJsonLayer` with a plugin default style;
- dataset/tile URLs → `addTileLayer`;
- plot images rendered in the panel with save/export;
- results and their source questions persisted in project state.

Done when: a choropleth answer about the visible area becomes a styled layer in one action, and
reopening the project restores it.

### F4 — Sessions and history (1 d)

- list, select and create sessions; Markdown export of a conversation;
- session id and panel state in `getProjectState` / `applyProjectState`.

Done when: switching between two projects restores each project's session.

### F5 — GeoLibre assistant integration (1 d)

- `registerAssistantToolSpec` for `ask_epidbot` and `add_epidbot_result`, plus a short
  `registerAssistantGuidance` text, so GeoLibre's built-in AI assistant can delegate
  epidemiological questions to EpidBot;
- progressive disclosure: the tools are only advertised while the panel is active and a key exists.

Done when: the host assistant answers "quanto de dengue no Rio em 2025?" by calling EpidBot and
adding the result to the map.

### F6 — Packaging, CI and registry submission (1 d)

- CI: typecheck, Vitest, bundle budget (≤ ~150 KB gzipped), reproducible zip;
- release workflow producing the zip plus the `registry/epidbot.json` entry with `sha256`;
- screenshots (≤ 1 MiB each) inside the zip;
- registry PR to `opengeos/geolibre-plugins` — **only after Flávio approves publishing under
  Deeplearn-PeD**.

Done when: the plugin installs from the release zip by hand, and the registry PR preview build
loads it.

### F7 — Documentation and launch (0.5 d)

- README with both install paths (zip and manifest URL);
- page under `epidbot-docs` (`user-guide/geolibre-plugin.md`, EN/PT/ES) and a manual section;
- entry in the `kwar-ai` site hub next to the QGIS block;
- an English LinkedIn post (copy in the Obsidian vault `Posts Linkedin/`).

Total: ~9–10 developer-days, plus review time in the GeoLibre registry.

## 7. Acceptance criteria

- installs in GeoLibre Desktop from a zip and in GeoLibre Web from a manifest URL;
- full chat round trip on the MapLibre renderer; on Cesium/ArcGIS the panel works and the
  map-writing actions are hidden rather than broken;
- the API key persists across restarts through the host credential store and never appears in a
  project file or in the bundle;
- GeoJSON answers become styled layers; plot images are visible and exportable;
- EN and pt-BR UI, following the app language;
- no secrets, no analytics, no remote code loading;
- CI green, including the bundle-size budget.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| GeoLibre moves fast (v3.5.2 today); the host API may shift | optional-chaining capability checks, a documented capability matrix, `minGeoLibreVersion`, pin the tested version in CI |
| Registry plugins run with full app privileges and are reviewed by hand | small, readable bundle; no `eval`, no remote code, no telemetry; publish the source |
| CORS is reflected-origin today but not contractual | re-verify preflight at each release; fall back to `app.nativeFetch` |
| Map context can be large and costly in tokens | hard caps on layers and sample rows, visible payload preview, off switch |
| Plan gate limits reach (API keys are Max/Team; 0 Max and 0 Pro accounts today) | launch to Team accounts first; revisit if the API-key gate moves to Pro |
| Answers may contain GeoJSON that is wrong or empty | validate before adding, show a confirmation dialog with feature count and a preview |

## 9. Open decisions

- **License**: GPL-2.0-or-later (parity with the QGIS plugin) or MIT (parity with the GeoLibre
  plugin template). Nothing upstream forces GPL here.
- **Publishing**: submit to the public GeoLibre registry, or distribute only via GitHub releases.
- **First audience**: Team accounts only (they already hold API keys), or wait for the plan-gate
  decision on Pro.
- **Web build**: support GeoLibre Web from day one, or desktop-only for the first release.

## 10. References

- GeoLibre: <https://geolibre.app/> · source <https://github.com/opengeos/GeoLibre>
- Plugin API: <https://geolibre.app/plugin-api/> · develop guide: <https://plugins.geolibre.app/develop/>
- Registry format: <https://plugins.geolibre.app/registry/> · marketplace: <https://plugins.geolibre.app/>
- Plugin template: <https://github.com/opengeos/geolibre-plugin-template>
- QGIS plugin (reference implementation): <https://github.com/Deeplearn-PeD/epidbot-qgis-plugin>
- EpidBot: <https://kwar-ai.com.br> · docs <https://deeplearn.ltd/epidbot-docs/>
