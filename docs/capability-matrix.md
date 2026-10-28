# GeoLibre host API capability matrix

Which `GeoLibreAppAPI` members this plugin uses, for what, and what happens on
a GeoLibre build that does not provide them. Everything except `activate`/
`deactivate`/`addGeoJsonLayer` is an optional capability and is called with
optional chaining.

**Reference version:** GeoLibre v3.5.2 (2026-10-28), per
[geolibre.app/plugin-api](https://geolibre.app/plugin-api/). Provisional
`minGeoLibreVersion` for the registry entry: **3.5.0**.

| Host member | Used since | Used by | Behavior when absent |
|---|---|---|---|
| `registerRightPanel` / `unregisterRightPanel` | 0.1.0 | chat panel | No panel; toolbar menu items still exist but opening is a no-op |
| `openRightPanel` / `closeRightPanel` | 0.1.0 | entry point, menu | Panel stays closed; no crash |
| `registerToolbarMenu` / `unregisterToolbarMenu` | 0.1.0 | "EpidBot" menu | Menu hidden |
| `credentials` (`get`/`set`/`location`) | 0.1.0 | API key storage | Key lives for the session only; settings say "current session only" |
| `getLocale` / `translate` / `registerTranslations` / `onLocaleChange` | 0.1.0 | EN / pt-BR UI | Bundled English fallback text renders |
| `nativeFetch` | 0.1.0 | API client (desktop) | Global `fetch` (CORS is reflected by the API — verified 2026-10-28) |
| `getViewBounds` | 0.2.0 (F2) | map context builder | Extent omitted from the context payload |
| `getMapCrs` / `onMapCrsChange` | 0.2.0 (F2) | map context builder | CRS falls back to "EPSG:3857 (default Web Mercator)" |
| `listLayers` / `getLayerFeatures` | 0.2.0 (F2) | map context builder; layer attachments (0.2.0); edit-review join planning (0.2.0) | Layer summaries/schema omitted from the context payload; layer attachments and write-back hidden |
| `getSelectedFeatures` / `getSelectedLayerId` | 0.2.0 (F2) | "ask about this selection"; context selection rows; "attach selected features" | Selection action shows a notice; selection rows and the selection attach scope are omitted |
| `getViewBounds` (also) | 0.2.0 | extent scope of layer attachments (client-side bbox filter) | Extent attach scope disabled |
| `updateGeoJsonLayer` | 0.2.0 | **attribute write-back**: applied edits replace the layer's features; Revert writes the snapshot back | Edit review rows hidden; write-back unavailable (announced in the UI) |
| `getMapRenderer` | 0.2.0 (F3) | map-action gating | Map actions shown (assumes 2D) |
| `addGeoJsonLayer` (guaranteed) | 0.2.0 (F3) | GeoJSON answers → layers | "Add to map" cards hidden |
| `importLayerStyle` | 0.2.0 (F3) | Mapbox GL style JSON for result layers (choropleth) | Host default style remains; a note explains it |
| `updateGeoJsonLayer` / `removeLayer` / `setLayerVisibility` | 0.2.0 (F3) | result layer management | Older behavior (re-add / leave visible) |
| `addTileLayer` | 0.2.0 (F3) | dataset/tile URL answers | Tile result cards hidden |
| `fitBounds` | 0.2.0 (F3) | zoom to a result | No zoom, layer still added |
| `registerAssistantToolSpec` / `registerAssistantGuidance` | 0.2.0 (F5) | `ask_epidbot` / `add_epidbot_result` tools + guidance | Assistant integration silently absent; the panel and its own tools are unaffected. `plugin.json` declares `assistant.description` so the host assistant can turn the plugin on |

## Plugin lifecycle flags

| Flag | Value | Why |
|---|---|---|
| `engines` | `["maplibre", "mapbox", "cesium", "arcgis"]` | Chat works on every renderer; map-writing actions are gated at runtime via `getMapRenderer()` (decision 2026-10-28) |
| `clearsStateOnProjectLoad` | `true` | The session binding and preferences are project data: loading a project without EpidBot state must reset them, not carry the previous project's session over |
| `restoresPanelCollapseState` | not set (yet) | The plugin does not persist panel open/collapsed state in 0.1.0; revisit when the panel state joins project state |

## Verification status

- [x] API surface transcribed from the published Plugin API docs (2026-10-28)
- [x] CORS preflight against `api.epidbot.kwar-ai.com.br` re-verified from
      `Origin: https://geolibre.app` (2026-10-28: 200, origin echoed,
      `x-api-key,content-type` allowed, credentials allowed)
- [x] F0–F5 host members exercised at unit level against a fake host
      (panels, menus, credentials, i18n, selection, renderer gating,
      addGeoJsonLayer/importLayerStyle/addTileLayer, assistant tool specs
      and guidance)
- [x] 0.2.0 (QGIS 0.3.0 parity) exercised at unit level: layer attachments
      (scopes, budgets, reduction, artifact upload), attribute write-back
      (validate/plan/apply/revert through `updateGeoJsonLayer`),
      authenticated artifact/CSV downloads, richer map context — 229 tests
- [ ] Members exercised in GeoLibre Desktop v3.5.x (manual step: install the
      zip built by `npm run package:geolibre`, restart, open the panel) —
      **pending, requires a desktop session**. Watch-outs for that pass:
      `updateGeoJsonLayer` semantics (style/id retention on rewrite),
      stability of host feature ids (write-back keys fall back to feature
      position within a session), and `getLayerFeatures` behavior on very
      large layers
- [ ] Re-verify this matrix and the CORS preflight at every release

## Known limitations (0.2.0)

- **No native undo for write-back.** GeoLibre has no edit-session API; the
  plugin snapshots the features before an edit and offers a **Revert** chip
  (valid while the plugin session lives). The review dialog is mandatory.
- **fid stability.** Feature keys use the host feature id when present and
  fall back to the feature's position; attachments and write-back read the
  same host arrays, so keys are consistent within one session.
- **`.gpkg`/`.zip` dataset URLs** cannot be parsed in the browser (no OGR);
  those cards offer a plain download instead.
- **Artifact uploads** are off by default and need server support (same as
  the QGIS plugin); the option only appears in the reduction dialog when the
  setting is on and a key exists.

## Registry entry plan

`registry/epidbot.json` (generated by `npm run registry:entry -- <zip-url>`)
will declare `minGeoLibreVersion: "3.5.0"` and `publishableSettings` covering
the plugin's project-state keys (`sessionId`, `settings`) so shared projects
strip them. The API key never appears in project state (enforced by tests).
