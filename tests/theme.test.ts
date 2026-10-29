import { describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  classifyTheme,
  findOpaqueBackground,
  parseRgb,
  relativeLuminance,
  sampleTheme,
} from "../src/panel/theme";

/** A computed-style stub for jsdom (which does no cascade). Elements with
 * no entry fall back to a transparent background on black text, like an
 * unstyled element. */
function stubStyles(styles: Map<HTMLElement, Partial<CSSStyleDeclaration>>): void {
  vi.stubGlobal(
    "getComputedStyle",
    ((node: HTMLElement) =>
      styles.get(node) ?? {
        backgroundColor: "rgba(0, 0, 0, 0)",
        color: "rgb(0, 0, 0)",
      }) as typeof window.getComputedStyle,
  );
}

function el(): HTMLElement {
  const node = document.createElement("div");
  document.body.appendChild(node);
  return node;
}

describe("parseRgb", () => {
  it("parses legacy comma and modern slash syntax", () => {
    expect(parseRgb("rgb(1, 2, 3)")).toEqual([1, 2, 3, 1]);
    expect(parseRgb("rgba(1, 2, 3, 0.5)")).toEqual([1, 2, 3, 0.5]);
    expect(parseRgb("rgb(1 2 3 / 50%)")).toEqual([1, 2, 3, 0.5]);
    expect(parseRgb("rgba(10 20 30 / 0.25)")).toEqual([10, 20, 30, 0.25]);
  });

  it("rejects transparent keywords, gradients and garbage", () => {
    expect(parseRgb("transparent")).toBeNull();
    expect(parseRgb("linear-gradient(rgb(1,2,3), white)")).toBeNull();
    expect(parseRgb("")).toBeNull();
    expect(parseRgb("rgb(a, b, c)")).toBeNull();
  });
});

describe("relativeLuminance", () => {
  it("ranks black below mid-gray below white", () => {
    const black = relativeLuminance(0, 0, 0);
    const gray = relativeLuminance(128, 128, 128);
    const white = relativeLuminance(255, 255, 255);
    expect(black).toBe(0);
    expect(white).toBeCloseTo(1);
    expect(black < gray && gray < white).toBe(true);
  });
});

describe("findOpaqueBackground", () => {
  it("walks past translucent ancestors to the first opaque one", () => {
    const parent = el();
    const child = el();
    parent.appendChild(child);
    stubStyles(
      new Map([
        [child, { backgroundColor: "rgba(0, 0, 0, 0)" } as CSSStyleDeclaration],
        [parent, { backgroundColor: " rgba(20, 21, 22, 0.85)" } as CSSStyleDeclaration],
        [document.body, { backgroundColor: "rgb(255, 0, 0)" } as CSSStyleDeclaration],
      ]),
    );
    const computed = (node: HTMLElement) => window.getComputedStyle(node);
    // The parent is translucent (a = 0.85): keep walking to the body.
    expect(findOpaqueBackground(child, computed)).toBe("rgb(255, 0, 0)");
  });
});

describe("classifyTheme", () => {
  it("classifies dark and light surfaces", () => {
    expect(classifyTheme("rgb(32, 33, 36)", "rgb(226,227,229)").dark).toBe(true);
    expect(classifyTheme("rgb(255, 255, 255)", "rgb(23,23,23)").dark).toBe(false);
  });

  it("blends translucent surfaces over white before classifying", () => {
    // A 20% black veil over white is still a light surface.
    expect(classifyTheme("rgba(0, 0, 0, 0.2)").dark).toBe(false);
    // A 90% black veil over white is dark.
    expect(classifyTheme("rgba(0, 0, 0, 0.9)").dark).toBe(true);
  });

  it("falls back to neutral surfaces for unclassifiable colors", () => {
    const theme = classifyTheme("linear-gradient(rgb(1,2,3), white)");
    expect(theme.dark).toBe(false);
    expect(theme.surface).toBe("rgb(255, 255, 255)");
  });
});

describe("sampleTheme / applyTheme", () => {
  it("adopts a dark host background and text color", () => {
    const container = el();
    stubStyles(
      new Map([
        [
          container,
          {
            backgroundColor: "rgb(24, 26, 27)",
            color: "rgb(226, 227, 229)",
          } as CSSStyleDeclaration,
        ],
      ]),
    );
    const theme = sampleTheme(container);
    expect(theme.dark).toBe(true);
    expect(theme.surface).toBe("rgb(24, 26, 27)");
    expect(theme.text).toBe("rgb(226, 227, 229)");
  });

  it("falls back to the text color's luminance when nothing is opaque", () => {
    const container = el();
    stubStyles(
      new Map([
        [
          container,
          {
            backgroundColor: "rgba(0, 0, 0, 0)",
            color: "rgb(230, 230, 230)",
          } as CSSStyleDeclaration,
        ],
      ]),
    );
    const theme = sampleTheme(container);
    expect(theme.dark).toBe(true); // light text implies a dark app
  });

  it("applyTheme pins the classes, color-scheme and CSS variables", () => {
    const container = el();
    const panel = el();
    stubStyles(
      new Map([
        [
          container,
          {
            backgroundColor: "rgb(24, 26, 27)",
            color: "rgb(226, 227, 229)",
          } as CSSStyleDeclaration,
        ],
      ]),
    );
    const theme = applyTheme(panel, container);
    expect(theme.dark).toBe(true);
    expect(panel.classList.contains("epidbot-theme-dark")).toBe(true);
    expect(panel.classList.contains("epidbot-theme-light")).toBe(false);
    expect(panel.style.colorScheme).toBe("dark");
    expect(panel.style.getPropertyValue("--epidbot-surface")).toBe("rgb(24, 26, 27)");
    expect(panel.style.getPropertyValue("--epidbot-text")).toBe("rgb(226, 227, 229)");
  });

  it("applyTheme flips to light for a light host", () => {
    const container = el();
    const panel = el();
    stubStyles(
      new Map([
        [
          container,
          {
            backgroundColor: "rgb(255, 255, 255)",
            color: "rgb(23, 23, 23)",
          } as CSSStyleDeclaration,
        ],
      ]),
    );
    applyTheme(panel, container);
    expect(panel.classList.contains("epidbot-theme-light")).toBe(true);
    expect(panel.style.colorScheme).toBe("light");
  });
});
