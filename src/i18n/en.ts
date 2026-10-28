/** English catalog. Keys are namespaced `plugin.epidbot.` — the host's
 * registerTranslations drops anything else. Always keep the English text as
 * the translate() defaultValue fallback. */

export const en: Record<string, string> = {
  "plugin.epidbot.panel.title": "EpidBot",

  "plugin.epidbot.menu.open": "Open chat panel",
  "plugin.epidbot.menu.newSession": "New session",
  "plugin.epidbot.menu.export": "Export as Markdown",
  "plugin.epidbot.menu.settings": "Settings…",
  "plugin.epidbot.menu.ask": "Ask about the map",
  "plugin.epidbot.menu.askExtent": "Ask about this extent",
  "plugin.epidbot.menu.askSelection": "Ask about this selection",
  "plugin.epidbot.menu.editLayer": "Let EpidBot edit this layer…",

  "plugin.epidbot.prompt.extent": "What public health data is relevant for the current map extent?",
  "plugin.epidbot.prompt.selection":
    "Summarize the public health characteristics of the selected features.",
  "plugin.epidbot.prompt.noSelection":
    "No features are selected. Select features on the map first.",
  "plugin.epidbot.prompt.noExtent": "The map extent is not available here.",
  "plugin.epidbot.prompt.editLayer":
    "Add a new field to this layer with the data you can fetch (e.g. population counts). Join the data by the '{{key}}' field. Use the identifiers attached above as join keys and return the result as an epidbot-edit block.",
  "plugin.epidbot.prompt.editLayerNoKey":
    "Add a new field to this layer with the data you can fetch (e.g. population counts). Use the identifiers attached above as join keys and return the result as an epidbot-edit block.",

  "plugin.epidbot.quick.placeholder": "Quick prompts…",
  "plugin.epidbot.quick.dengue": "Summarize the latest dengue season in Brazil",
  "plugin.epidbot.quick.malaria": "Which datasets cover malaria in the Amazon?",
  "plugin.epidbot.quick.layers": "Explain the active layers on my map",
  "plugin.epidbot.quick.sinan": "How do I download SINAN data for my state?",
  "plugin.epidbot.quick.population": "What is the population at risk in my map extent?",

  "plugin.epidbot.attach.label": "Attach layer data to the message",
  "plugin.epidbot.attach.selected": "Attach selected features",
  "plugin.epidbot.attach.extent": "Attach features in view",
  "plugin.epidbot.attach.all": "Attach entire layer…",
  "plugin.epidbot.attach.identifiers": "Attach identifiers only (for edits)",
  "plugin.epidbot.attach.noLayers": "No layers on the map.",
  "plugin.epidbot.attach.pickLayer": "Attach layer — choose a layer:",
  "plugin.epidbot.attach.ok": "OK",
  "plugin.epidbot.attach.cancel": "Cancel",
  "plugin.epidbot.attach.preparing": "Preparing attachment…",
  "plugin.epidbot.attach.unavailable": "Layer attachments are not available on this map renderer.",
  "plugin.epidbot.attach.remove": "Remove attachment",
  "plugin.epidbot.attach.chipMeta": "{{count}} features, {{kb}} KB",
  "plugin.epidbot.attach.tooLargeTitle": "Attachment too large",
  "plugin.epidbot.attach.tooLarge":
    "'{{label}}' is {{size}} KB, above the {{budget}} KB inline budget.",
  "plugin.epidbot.attach.limitExtent": "Limit to current view",
  "plugin.epidbot.attach.narrowSelection": "Narrow to selected features",
  "plugin.epidbot.attach.reducePrecision": "Reduce coordinate precision",
  "plugin.epidbot.attach.uploadArtifact": "Upload as artifact (server)",
  "plugin.epidbot.attach.statsOnly": "Send statistics only",
  "plugin.epidbot.attach.dropped":
    "Attachment dropped — the map context (field names, sample values, counts) will be sent instead.",
  "plugin.epidbot.attach.failedTitle": "Attachment failed",
  "plugin.epidbot.attach.uploading": "Uploading artifact…",
  "plugin.epidbot.attach.uploadFailed": "Artifact upload failed: {{reason}}",
  "plugin.epidbot.attach.noArtifactId": "The server did not return an artifact id.",

  "plugin.epidbot.edit.title": "EpidBot wants to edit a layer",
  "plugin.epidbot.edit.intro":
    "EpidBot proposes the following change to your layer data. Review it carefully — it will modify the attributes.",
  "plugin.epidbot.edit.review": "Review field edit: {{name}} ({{type}})",
  "plugin.epidbot.edit.reviewInvalid": "Review field edit (invalid operation)",
  "plugin.epidbot.edit.invalidOp": "This edit operation is invalid:",
  "plugin.epidbot.edit.targetLabel": "Target layer",
  "plugin.epidbot.edit.opAdd": "Add",
  "plugin.epidbot.edit.opUpdate": "Update",
  "plugin.epidbot.edit.summary": "{{op}} field {{name}} ({{type}}) — join by {{key}}{{confidence}}",
  "plugin.epidbot.edit.confidenceFetched": " (values fetched from a data source)",
  "plugin.epidbot.edit.confidenceEstimated":
    " (⚠ values ESTIMATED by the model — verify before use)",
  "plugin.epidbot.edit.noMatchingLayer": "No matching layer found.",
  "plugin.epidbot.edit.cannotJoin": "Cannot join by this key: {{reason}}",
  "plugin.epidbot.edit.stats":
    "Matches {{matched}} of {{total}} values ({{unmatched}} unmatched, {{invalid}} invalid).",
  "plugin.epidbot.edit.unmatchedKeys": "Unmatched keys: {{keys}}",
  "plugin.epidbot.edit.moreRows": "… and {{count}} more",
  "plugin.epidbot.edit.apply": "Apply",
  "plugin.epidbot.edit.cancel": "Cancel",
  "plugin.epidbot.edit.applied": "{{op}} '{{field}}' on '{{layer}}': {{matched}} features{{note}}",
  "plugin.epidbot.edit.unmatchedNote": " ({{count}} keys did not match)",
  "plugin.epidbot.edit.notApplied": "Edit not applied: {{reason}}",
  "plugin.epidbot.edit.revert": "Revert",
  "plugin.epidbot.edit.reverted": "Edit reverted.",
  "plugin.epidbot.edit.revertFailed": "Could not revert: {{reason}}",

  "plugin.epidbot.context.attach": "Attach map context",
  "plugin.epidbot.context.help":
    "Sends the visible layers, the current extent, the CRS and the selection with your question.",
  "plugin.epidbot.context.preview": "Preview context",
  "plugin.epidbot.context.bytes": "{{bytes}} bytes",
  "plugin.epidbot.context.empty": "Nothing to report — no layers, extent or selection available.",
  "plugin.epidbot.context.unavailable": "Map context is not available here.",

  "plugin.epidbot.composer.placeholder": "Ask about epidemiological data…",
  "plugin.epidbot.composer.send": "Send",
  "plugin.epidbot.composer.stop": "Stop",

  "plugin.epidbot.status.submitting": "Sending question…",
  "plugin.epidbot.status.thinking": "EpidBot is thinking… (job {{job}})",
  "plugin.epidbot.status.loadingPlots": "Loading charts…",

  "plugin.epidbot.welcome.title": "EpidBot — public health data assistant",
  "plugin.epidbot.welcome.body":
    "Ask about public health and epidemiological data — Brazilian sources (DATASUS/SINAN) and international ones (WHO, PAHO, ECDC, CDC, Malaria Atlas and more). Answers can include charts and data you can add to the map.",
  "plugin.epidbot.welcome.noKey": "Add your EpidBot API key in Settings to start.",
  "plugin.epidbot.welcome.getApiKey": "Get an API key (EpidBot web app)",

  "plugin.epidbot.session.label": "Session",
  "plugin.epidbot.session.none": "New session",
  "plugin.epidbot.session.new": "New session",
  "plugin.epidbot.session.createdName": "Session {{stamp}}",
  "plugin.epidbot.session.export": "Export as Markdown",
  "plugin.epidbot.session.exportEmpty": "Nothing to export yet.",
  "plugin.epidbot.session.loadFailed": "Could not load this session's history.",

  "plugin.epidbot.settings.title": "Settings",
  "plugin.epidbot.settings.apiKey": "API key",
  "plugin.epidbot.settings.apiKeyHelp":
    "Personal key created in the EpidBot web app (Settings → API Keys). Stored in the {{storage}}.",
  "plugin.epidbot.settings.storage.keychain": "system credential store",
  "plugin.epidbot.settings.storage.browser": "browser storage",
  "plugin.epidbot.settings.storage.none": "current session only",
  "plugin.epidbot.settings.serverUrl": "Server URL",
  "plugin.epidbot.settings.locale": "Answer language",
  "plugin.epidbot.settings.pollInterval": "Poll interval (seconds)",
  "plugin.epidbot.settings.test": "Test key",
  "plugin.epidbot.settings.testing": "Testing…",
  "plugin.epidbot.settings.testOk": "Key OK — connected as {{user}}",
  "plugin.epidbot.settings.testFail": "Could not validate the key: {{reason}}",
  "plugin.epidbot.settings.save": "Save",
  "plugin.epidbot.settings.saved": "Settings saved.",

  "plugin.epidbot.error.auth": "Invalid or revoked API key. Check the key in Settings.",
  "plugin.epidbot.error.plan":
    "Your EpidBot plan does not include API keys — Max or Team required.",
  "plugin.epidbot.error.quota": "API quota exceeded. Wait a moment and try again.",
  "plugin.epidbot.error.network":
    "Could not reach EpidBot. Check the server URL and your connection.",
  "plugin.epidbot.error.timeout": "EpidBot did not answer in time. Try again.",
  "plugin.epidbot.error.cancelled": "Question cancelled.",
  "plugin.epidbot.error.server": "EpidBot returned an error (HTTP {{status}}).",
  "plugin.epidbot.error.job": "The chat job failed on the server: {{reason}}",
  "plugin.epidbot.error.unknown": "Unexpected error: {{reason}}",
  "plugin.epidbot.error.noKey": "No API key set. Open Settings to add one.",

  "plugin.epidbot.plot.download": "Save chart",
  "plugin.epidbot.plot.loadFailed": "Chart could not be loaded.",
  "plugin.epidbot.code.copy": "Copy",
  "plugin.epidbot.code.copied": "Copied",

  "plugin.epidbot.results.title": "Add to the map",
  "plugin.epidbot.results.features": "{{count}} features",
  "plugin.epidbot.results.addToMap": "Add to map",
  "plugin.epidbot.results.added": "Added ✓",
  "plugin.epidbot.results.download": "Download .geojson",
  "plugin.epidbot.results.downloadFile": "Download",
  "plugin.epidbot.results.addTile": "Add as tile layer",
  "plugin.epidbot.results.addFailed": "Could not add the layer: {{reason}}",
  "plugin.epidbot.results.styleFailed": "The layer was added, but its style could not be applied.",
  "plugin.epidbot.results.loading": "Loading '{{name}}' onto the map…",
  "plugin.epidbot.results.stillLoading": "Still loading the previous dataset…",
  "plugin.epidbot.results.addedNotice": "Layer '{{name}}' added to the map.",
  "plugin.epidbot.results.unreadable":
    "The data could not be read as GeoJSON, and the CSV has no usable coordinate columns.",
  "plugin.epidbot.results.loadFailed": "Could not load geodata: {{reason}}",

  "plugin.epidbot.settings.inlineBudget": "Inline attachment budget (KiB)",
  "plugin.epidbot.settings.inlineBudgetHelp":
    "Layer attachments above this size are reduced or uploaded as artifacts.",
  "plugin.epidbot.settings.artifactUploads":
    "Allow layer uploads as server artifacts (requires server support)",
};
