# EpidBot for GeoLibre

[![CI](https://github.com/Deeplearn-PeD/epidbot-geolibre-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/Deeplearn-PeD/epidbot-geolibre-plugin/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Deeplearn-PeD/epidbot-geolibre-plugin)](https://github.com/Deeplearn-PeD/epidbot-geolibre-plugin/releases/latest)
[![License: MIT](https://img.shields.io/github/license/Deeplearn-PeD/epidbot-geolibre-plugin)](LICENSE)
[![GeoLibre](https://img.shields.io/badge/GeoLibre-%E2%89%A5%203.5.0-2456a6)](https://geolibre.app/)

A [GeoLibre](https://geolibre.app/) plugin that brings **EpidBot** — the AI assistant for
Brazilian public health data (DATASUS/SINAN, WHO, PAHO, ECDC and 40+ other sources) — into the
GeoLibre workspace, so epidemiological questions can be asked over the map you are already
looking at, with the answers coming back as map layers and charts.

This repository is the GeoLibre counterpart of
[`Deeplearn-PeD/epidbot-qgis-plugin`](https://github.com/Deeplearn-PeD/epidbot-qgis-plugin).

Status: **0.2.0 — feature parity with the QGIS plugin 0.3.0** (chat panel, API
client, settings, i18n, map context with layer schemas, results on the map,
sessions, assistant tools, layer exchange with budgets and interactive
reduction, attribute write-back with review + revert, authenticated artifact
downloads/uploads, quick prompts — 229 unit tests, CI, reproducible zip).
Next: F6 (registry submission — pipeline ready, PR pending), F7 (docs page
under `epidbot-docs` and launch — held until the API-key plan gate opens to
Pro; README install paths done).

License: MIT (see [LICENSE](LICENSE)).

---

## Install

Requirements: **GeoLibre Desktop or Web ≥ 3.5.0** and an EpidBot account on
the **Max or Team** plan with a personal API key created in the EpidBot web
app under *Settings → API Keys*.

### From a release zip (Desktop)

1. Download `epidbot-<version>.zip` from the
   [latest release](https://github.com/Deeplearn-PeD/epidbot-geolibre-plugin/releases/latest)
   (the zip is attached to the release by CI and pinned by SHA-256).
2. In GeoLibre Desktop, install the plugin from the zip
   (*Plugins → Install from file/zip*, or drop the unzipped folder into your
   user plugins directory) and restart the app.
3. Open the **EpidBot** panel from the right sidebar or the toolbar menu and
   paste your API key under ⚙ *Settings*.

### From a manifest URL (Web)

Once the plugin is in the curated registry
([`opengeos/geolibre-plugins`](https://github.com/opengeos/geolibre-plugins),
submission in progress), it installs from the
[GeoLibre plugin marketplace](https://plugins.geolibre.app/) directly and is
updated with the app. While the submission is pending, GeoLibre Web can load
a development build via a manifest URL served with
`npm run serve:geolibre` (see *Development* below).

## Features

- **Chat panel** — a right-sidebar panel (also a floating panel and toolbar
  menu entry) for epidemiological questions without leaving the map.
  Answers render with Markdown, framed code blocks with a copy button, and
  inline chart thumbnails.
- **Map integration** — EpidBot understands your map and can feed it back:
  - *Map-context injection* — visible layers (with field schemas, sample
    values, feature and selection counts), the viewport extent and CRS are
    prepended to prompts when you allow it; a preview shows the exact
    payload.
  - *Spatial prompts* — one-click menu actions to ask about the current view
    or the features you have selected.
  - *"Add to map"* — GeoJSON blocks, dataset URLs and EpidBot artifacts in
    answers become styled map layers with one click; CSVs with
    latitude/longitude columns become point layers.
- **Layer exchange** — send layers *to* EpidBot: attach selected features,
  the features in view, a whole layer, or identifiers only (for edit
  requests). A configurable inline budget (default 64 KiB) triggers an
  interactive reduction flow: narrow to view/selection, reduce coordinate
  precision, upload the layer as a server artifact, or send statistics only.
- **Attribute write-back** — ask EpidBot to enrich your layers ("add a field
  with population counts"): proposed edits arrive as reviewable
  `epidbot-edit` operations and are only applied after you inspect a preview
  (matched features, unmatched keys, value samples). Because GeoLibre has no
  edit-session undo, the panel keeps a snapshot and offers a **Revert**
  button after every applied edit.
- **API-key authentication** — the key is sent as `X-API-Key` on every
  request and stored in the host credential store (system keychain on
  desktop, browser storage on the web) — never in project files.
- **Sessions** — pick an existing conversation, start a new one, or let the
  server auto-create one. The session binding travels with the GeoLibre
  project; conversations export to Markdown.
- **Quick prompts** — preset prompts (dengue season summary, SINAN
  downloads, layer explanations…) from a dropdown above the composer.
- **GeoLibre assistant integration** — the host AI assistant can delegate
  epidemiological questions to EpidBot (`ask_epidbot`) and place GeoJSON
  answers on the map (`add_epidbot_result`).
- **Internationalized** — English and Brazilian Portuguese UI, following the
  app language.

## Configuration

Open ⚙ *Settings* at the top of the panel. The API key lives in the host
credential store; everything else is non-secret project data (stripped from
shared projects via the registry's `publishableSettings`).

| Setting | Meaning |
|---|---|
| API key | Personal EpidBot key (Max or Team plan), sent as `X-API-Key` on every request |
| Server URL | EpidBot API base URL: `https://api.epidbot.kwar-ai.com.br` (pre-filled default) |
| Answer language | `en` / `pt-BR` (sent as `locale` to `/chat`) |
| Poll interval | Seconds between job-status polls (default 1.5 s) |
| Inline attachment budget | KiB budget for layer attachments before the reduction flow kicks in (default 64) |
| Artifact uploads | Allow over-budget layers to be uploaded as server artifacts (requires server support; off by default) |
| Attach map context | Send layers/extent/CRS/selection with questions (toggle above the composer) |

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

## 2. Scope (parity with the QGIS plugin, 0.3.0 feature set)

In scope:

- a dockable **EpidBot chat panel** inside GeoLibre, with Markdown answers, framed code
  blocks with a copy button, and inline charts;
- **API-key authentication** with the key stored through the host credential store;
- **map-context injection** — layer schemas (field names and inferred types), sample
  values of categorical fields, feature and selection counts, viewport bounds and CRS
  are sent with the question when the user allows it;
- one-click **spatial prompts**: "ask about this extent", "ask about this selection";
- **layer exchange** (QGIS 0.3.0) — attach layer data to prompts: selected features,
  features in view, the whole layer, or identifiers only, with a configurable inline
  budget (default 64 KiB) and an interactive reduction flow (narrow to view /
  narrow to selection / reduce coordinate precision / upload as server artifact /
  send statistics only);
- **attribute write-back** (QGIS 0.3.0) — ```epidbot-edit blocks in answers become
  reviewable operations (add/update field, join by a semantic key or fid); the review
  dialog shows matched/unmatched/invalid counts and sample rows before anything is
  written, and a **Revert** chip restores the previous attributes afterwards (the host
  has no edit session or undo, so the plugin keeps the snapshot);
- **results on the map** — GeoJSON blocks from an answer become styled layers;
  dataset/tile URLs and EpidBot **artifacts** become layers (artifact and same-server
  downloads are authenticated); CSVs with latitude/longitude columns become point
  layers client-side; plots are viewable and exportable;
- **sessions** — pick an existing conversation, start a new one, export it as Markdown;
- **quick prompts** — preset prompts from a dropdown;
- **EN / pt-BR interface**, following the GeoLibre application language.

Not supported (documented host limitations): `.gpkg`/`.zip` dataset URLs cannot be
read in the browser (no OGR); report-generation UI, knowledge-base management and
streaming responses remain out of scope. Artifact uploads additionally require server
support and are off by default (matching the QGIS plugin).

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

Exact surface, matching the QGIS plugin's `core/api_client.py` (the `/chat`
shorthand below means `/api/v1/chat`; every path carries the `/api/v1` prefix):

- Base URL: `https://api.epidbot.kwar-ai.com.br`
- Chat: `POST /api/v1/chat` with header `X-API-Key: <key>` and body
  `{"message": <question>, "session_id": <id|null>, "locale": "en"|"pt-BR",
  "artifact_ids": [<id>…]?}`;
  the response carries `job_id` (and the server-created `session_id` when the
  caller sent none). `GET /api/v1/chat/{job_id}` is polled (~1.5 s, growing
  1.15×, capped) until `status` is `completed` (`content`, `images`,
  `session_id`), `failed` or `cancelled` — the same submit-and-poll pattern as
  the QGIS plugin.
- Session history: `GET /api/v1/sessions`, `POST /api/v1/sessions`
  (`{"name": ...}`), `GET /api/v1/sessions/{id}/messages`.
- Plots: `GET /api/v1/sessions/plots/{filename}` (authenticated; fetched as a
  blob since `<img>` cannot send the key header).
- Artifacts: `POST /api/v1/artifacts` (multipart upload of a layer file,
  authenticated; the response carries the new artifact id) — used for layer
  attachments that exceed the inline budget when the user opts in. Artifact
  URLs (`…/api/v1/artifacts/{id}`) appearing in answers are downloaded with
  the API key and added as layers.
- Connection test: `GET /api/v1/auth/me`.
- Errors: 401 invalid key, 403 plan gate, 429 quota; 502/503/504 and network
  failures are retried with backoff.
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
- decide the **plugin id** (`epidbot`) and the **license** — both settled: id `epidbot`, license MIT
  (decided 2026-10-28);
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
- registry PR to `opengeos/geolibre-plugins` — publishing in the public registry is approved
  (2026-10-28), so the PR goes out with the first release candidate.

Done when: the plugin installs from the release zip by hand, and the registry PR preview build
loads it.

### F7 — Documentation and launch (0.5 d)

- README with both install paths (zip and manifest URL) — **done (0.2.0)**;
- page under `epidbot-docs` (`user-guide/geolibre-plugin.md`, EN/PT/ES) and a manual section
  — pending (no plugin pages exist there yet, not even for QGIS);
- entry in the `kwar-ai` site hub next to the QGIS block — pending;
- an English LinkedIn post (copy in the Obsidian vault `Posts Linkedin/`) — pending,
  held until the launch gate opens.

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

## 9. Decisions

Settled on 2026-10-28:

- **License**: MIT, matching the GeoLibre plugin template; nothing upstream requires GPL.
- **Publishing**: submit to the public GeoLibre registry (`opengeos/geolibre-plugins`), with the
  source staying in this repository and the registry pointing at a release zip pinned by SHA-256.
- **First audience**: launch waits for the plan gate to open to **Pro** (decided 2026-10-28).
  Development and testing still need at least one Max/Team API key — secure it during F0.
- **Web build**: GeoLibre Web is supported from the first release, alongside Desktop
  (decided 2026-10-28; the CORS preflight is already verified).
- **Renderers**: all four engines are declared; on `cesium`/`arcgis` the chat works and
  map-writing actions are hidden at runtime via `getMapRenderer()` (decided 2026-10-28).

## 10. References

- GeoLibre: <https://geolibre.app/> · source <https://github.com/opengeos/GeoLibre>
- Plugin API: <https://geolibre.app/plugin-api/> · develop guide: <https://plugins.geolibre.app/develop/>
- Registry format: <https://plugins.geolibre.app/registry/> · marketplace: <https://plugins.geolibre.app/>
- Plugin template: <https://github.com/opengeos/geolibre-plugin-template>
- QGIS plugin (reference implementation): <https://github.com/Deeplearn-PeD/epidbot-qgis-plugin>
- EpidBot: <https://kwar-ai.com.br> · docs <https://deeplearn.ltd/epidbot-docs/>
