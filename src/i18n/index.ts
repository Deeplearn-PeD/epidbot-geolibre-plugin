/** i18n bridge: registers the catalogs once and hands out a translator that
 * resolves `plugin.epidbot.<key>` through the host, with the bundled English
 * text as the fallback (also used verbatim on hosts without translate()). */

import type { GeoLibreAppAPI } from "../lib/geolibre/host-api";
import { en } from "./en";
import { ptBR } from "./pt-BR";

export const KEY_PREFIX = "plugin.epidbot.";

const catalogs: Record<string, Record<string, string>> = {
  en,
  "pt-BR": ptBR,
};

/** Call once from activate(); registering the same keys again is a no-op. */
export function registerEpidBotTranslations(app: GeoLibreAppAPI): void {
  app.registerTranslations?.(catalogs);
}

export type Translator = (key: string, params?: Record<string, string | number>) => string;

/** Replace {{param}} placeholders; unknown params are left as written. */
export function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function createTranslator(app: GeoLibreAppAPI): Translator {
  return (key, params) => {
    const english = en[KEY_PREFIX + key] ?? key;
    const fallback = interpolate(english, params);
    return app.translate?.(KEY_PREFIX + key, fallback, params) ?? fallback;
  };
}
