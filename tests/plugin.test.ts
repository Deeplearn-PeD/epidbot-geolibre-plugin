import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { plugin } from "../src/geolibre";
import { VERSION } from "../src/version";
import { createFakeApp } from "./fake-app";
import type { GeoLibreAppAPI } from "../src/lib/geolibre/host-api";

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(root, "geolibre-plugin", "plugin.json"), "utf8"),
) as { id: string; name: string; version: string; entry: string; style: string };
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  version: string;
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("plugin identity", () => {
  it("matches plugin.json, package.json and the version module", () => {
    expect(plugin.id).toBe(manifest.id);
    expect(plugin.name).toBe(manifest.name);
    expect(plugin.version).toBe(manifest.version);
    expect(plugin.version).toBe(pkg.version);
    expect(plugin.version).toBe(VERSION);
    expect(plugin.id).toBe("epidbot");
  });

  it("declares every renderer and project-state reset", () => {
    expect(plugin.engines).toEqual(["maplibre", "mapbox", "cesium", "arcgis"]);
    expect(plugin.clearsStateOnProjectLoad).toBe(true);
  });
});

describe("lifecycle", () => {
  it("registers the panel and toolbar menu, and opens the panel", () => {
    const fake = createFakeApp();
    plugin.activate(fake.app);
    expect(fake.panels.has("epidbot-chat")).toBe(true);
    expect(fake.menus.has("epidbot-menu")).toBe(true);
    expect(fake.openedPanels).toContain("epidbot-chat");

    plugin.deactivate();
    expect(fake.panels.has("epidbot-chat")).toBe(false);
    expect(fake.menus.has("epidbot-menu")).toBe(false);
    expect(fake.closedPanels).toContain("epidbot-chat");
  });

  it("round-trips project state without ever serializing a key", () => {
    const fake = createFakeApp();
    plugin.activate(fake.app);

    plugin.applyProjectState?.(fake.app, {
      version: 1,
      settings: {
        serverUrl: "https://staging.example.com",
        answerLocale: "pt-BR",
        pollIntervalSec: 2,
        attachMapContext: false,
      },
      sessionId: 42,
    });
    const state = plugin.getProjectState?.() as {
      version: number;
      settings: Record<string, unknown>;
      sessionId: number | null;
    };
    expect(state.version).toBe(1);
    expect(state.sessionId).toBe(42);
    expect(state.settings.answerLocale).toBe("pt-BR");
    expect(JSON.stringify(state)).not.toMatch(/api-?key/i);

    // clearsStateOnProjectLoad: the host passes undefined on a project load
    // without EpidBot state, which must reset the session binding.
    plugin.applyProjectState?.(fake.app, undefined);
    const reset = plugin.getProjectState?.() as { sessionId: number | null };
    expect(reset.sessionId).toBeNull();

    plugin.deactivate();
  });

  it("keeps state valid when applied before activation", () => {
    const fake = createFakeApp();
    expect(() =>
      plugin.applyProjectState?.(fake.app, { version: 1, garbage: true }),
    ).not.toThrow();
    const state = plugin.getProjectState?.() as { version: number; sessionId: number | null };
    expect(state.version).toBe(1);
    expect(state.sessionId).toBeNull();
  });

  it("activates without throwing on a host with no optional capabilities", () => {
    const bare = {
      addGeoJsonLayer: () => "l",
    } as unknown as GeoLibreAppAPI;
    expect(() => plugin.activate(bare)).not.toThrow();
    expect(() => plugin.deactivate()).not.toThrow();
  });

  it("renders the panel DOM through the host render hook", async () => {
    const fake = createFakeApp();
    plugin.activate(fake.app);
    const panel = fake.panels.get("epidbot-chat")!;
    const container = document.createElement("div");
    const cleanup = panel.render(container);
    expect(typeof cleanup).toBe("function");
    await flush();
    expect(container.querySelector(".epidbot-panel")).not.toBeNull();
    cleanup?.();
    expect(container.querySelector(".epidbot-panel")).toBeNull();
    plugin.deactivate();
  });
});
