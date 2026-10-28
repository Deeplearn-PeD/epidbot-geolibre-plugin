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

  "plugin.epidbot.prompt.extent":
    "What public health data is relevant for the current map extent?",
  "plugin.epidbot.prompt.selection":
    "Summarize the public health characteristics of the selected features.",
  "plugin.epidbot.prompt.noSelection":
    "No features are selected. Select features on the map first.",
  "plugin.epidbot.prompt.noExtent": "The map extent is not available here.",

  "plugin.epidbot.context.attach": "Attach map context",
  "plugin.epidbot.context.help":
    "Sends the visible layers, the current extent, the CRS and the selection with your question.",
  "plugin.epidbot.context.preview": "Preview context",
  "plugin.epidbot.context.bytes": "{{bytes}} bytes",
  "plugin.epidbot.context.empty":
    "Nothing to report — no layers, extent or selection available.",
  "plugin.epidbot.context.unavailable": "Map context is not available here.",

  "plugin.epidbot.composer.placeholder": "Ask about epidemiological data…",
  "plugin.epidbot.composer.send": "Send",
  "plugin.epidbot.composer.stop": "Stop",

  "plugin.epidbot.status.submitting": "Sending question…",
  "plugin.epidbot.status.thinking": "EpidBot is thinking… (job {{job}})",
  "plugin.epidbot.status.loadingPlots": "Loading charts…",

  "plugin.epidbot.welcome.title": "EpidBot — public health data assistant",
  "plugin.epidbot.welcome.body":
    "Ask about Brazilian public health data (DATASUS/SINAN, WHO, PAHO and 40+ other sources). Answers can include charts and data you can add to the map.",
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
  "plugin.epidbot.results.addTile": "Add as tile layer",
  "plugin.epidbot.results.addFailed": "Could not add the layer: {{reason}}",
  "plugin.epidbot.results.styleFailed":
    "The layer was added, but its style could not be applied.",
};
