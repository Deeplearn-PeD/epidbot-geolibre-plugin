/** Theme sampling for the chat panel.
 *
 * The host toggles dark mode with a class on its own root, not with the CSS
 * `color-scheme` property, so native form controls inside the panel (the
 * quick-prompts `<select>` popup in particular) follow the browser's default
 * light scheme and end up unreadable on a dark panel (registry review,
 * 2026-10-29). The sampler walks up from the host container to find the
 * first opaque background, classifies it by luminance, and the panel then
 * pins `color-scheme` plus two CSS variables (--epidbot-surface,
 * --epidbot-text) so its own controls blend with the app in both themes.
 */

export interface PanelTheme {
  dark: boolean;
  /** CSS background value for panel surfaces (selects, popovers, modals). */
  surface: string;
  /** CSS color value matching the host's text. */
  text: string;
}

/** Fallback surfaces when the host exposes no opaque background at all. */
const FALLBACK: PanelTheme = {
  dark: false,
  surface: "rgb(255, 255, 255)",
  text: "rgb(23, 23, 23)",
};

const FALLBACK_DARK: PanelTheme = {
  dark: true,
  surface: "rgb(32, 33, 36)",
  text: "rgb(226, 227, 229)",
};

/** Parse `rgb()`/`rgba()` (legacy comma and modern slash syntax); null for
 * anything else (transparent keywords, gradients, color()-functions). The
 * color function must start the string, so gradients cannot smuggle a parse
 * out of their stops. */
export function parseRgb(color: string | undefined): [number, number, number, number] | null {
  const match = /^rgba?\(([^)]+)\)/i.exec((color ?? "").trim());
  if (!match) return null;
  const parts = match[1]!.split(/[\s,/]+/).filter((part) => part !== "");
  if (parts.length < 3) return null;
  const channels: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const value = Number(parts[i]);
    if (!Number.isFinite(value)) return null;
    channels.push(value);
  }
  let alpha = 1;
  if (parts.length >= 4) {
    const raw = parts[3]!;
    alpha = raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    if (!Number.isFinite(alpha)) alpha = 1;
  }
  return [channels[0]!, channels[1]!, channels[2]!, Math.min(Math.max(alpha, 0), 1)];
}

/** WCAG relative luminance of an sRGB triple, 0 (black) to 1 (white). */
export function relativeLuminance(r: number, g: number, b: number): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Walk up from `el` to find the first opaque, classifiable background.
 * Returns the CSS color string ("" when nothing opaque was found). */
export function findOpaqueBackground(
  el: HTMLElement | null,
  computed: (node: HTMLElement) => CSSStyleDeclaration,
): string {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const rgba = parseRgb(computed(node).backgroundColor);
    if (!rgba) continue;
    const [r, g, b, a] = rgba;
    if (a >= 0.99) {
      return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    }
  }
  return "";
}

/** Classify a background color. `text` is the host's text color when known. */
export function classifyTheme(surface: string, text: string | undefined): PanelTheme {
  const rgba = parseRgb(surface);
  const fallback = FALLBACK;
  if (!rgba) return { ...fallback, ...(text ? { text } : {}) };
  const [r, g, b, a] = rgba;
  // Blend translucent surfaces over white for a stable luminance read.
  const blended = [r, g, b].map((channel) => channel * a + 255 * (1 - a));
  const dark = relativeLuminance(blended[0]!, blended[1]!, blended[2]!) < 0.5;
  const resolvedFallback = dark ? FALLBACK_DARK : fallback;
  return {
    dark,
    surface: surface,
    text: text ?? (dark ? resolvedFallback.text : fallback.text),
  };
}

/** Sample the theme behind `container`. */
export function sampleTheme(
  container: HTMLElement | null,
  computed: (node: HTMLElement) => CSSStyleDeclaration = (node) => window.getComputedStyle(node),
): PanelTheme {
  const surface = findOpaqueBackground(container, computed);
  const text = container ? computed(container).color : undefined;
  if (!surface) {
    // Nothing opaque behind the panel: fall back to the host text color's
    // own luminance (light text implies a dark app).
    const textColor = parseRgb(text ?? "");
    if (textColor) {
      const lum = relativeLuminance(textColor[0]!, textColor[1]!, textColor[2]!);
      const dark = lum > 0.5;
      const base = dark ? FALLBACK_DARK : FALLBACK;
      return { dark, surface: base.surface, text: text! };
    }
    return FALLBACK;
  }
  return classifyTheme(surface, text || undefined);
}

/** Apply the sampled theme to the panel root: theme classes, the
 * `color-scheme` (native select popups and scrollbars follow it) and the
 * surface/text variables the stylesheet consumes. */
export function applyTheme(panel: HTMLElement, container: HTMLElement): PanelTheme {
  const theme = sampleTheme(container);
  panel.classList.toggle("epidbot-theme-dark", theme.dark);
  panel.classList.toggle("epidbot-theme-light", !theme.dark);
  panel.style.colorScheme = theme.dark ? "dark" : "light";
  panel.style.setProperty("--epidbot-surface", theme.surface);
  panel.style.setProperty("--epidbot-text", theme.text);
  return theme;
}
