/** Assistant integration tests (F5): the ask_epidbot and add_epidbot_result
 * tool specs, guidance, and progressive disclosure (tools only with a key).
 * These run through the exported plugin object, so the real client, real
 * context builder and real validation are exercised — only the network is
 * stubbed, through the host's nativeFetch like on desktop. */

import { describe, expect, it } from "vitest";
import { plugin } from "../src/geolibre";
import { createFakeApp, type FakeApp } from "./fake-app";
import type { GeoLibreAssistantToolSpec } from "../src/lib/geolibre/host-api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A nativeFetch stub implementing the submit+poll chat contract. */
function nativeFetchStub(): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const urlText = String(url);
    if (urlText.endsWith("/api/v1/chat") && init?.method === "POST") {
      return jsonResponse({ job_id: "job-1", session_id: 7 });
    }
    if (urlText.includes("/api/v1/chat/")) {
      return jsonResponse({
        status: "completed",
        session_id: 7,
        content: "Dengue cases rose in 2025.",
        images: ["plots/a.png"],
      });
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;
}

const FC = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { casos: 10 } },
    { type: "Feature", geometry: { type: "Polygon", coordinates: [[[2, 0], [3, 0], [3, 1], [2, 0]]] }, properties: { casos: 30 } },
  ],
};

function harness({ withKey = true }: { withKey?: boolean } = {}): FakeApp {
  const fake = createFakeApp();
  if (withKey) fake.credentials.set("api-key", "KEY");
  plugin.activate(fake.app);
  return fake;
}

function tool(fake: FakeApp, name: string): GeoLibreAssistantToolSpec {
  const spec = fake.tools.get(name);
  if (!spec) throw new Error(`tool ${name} not registered`);
  return spec;
}

describe("assistant registration", () => {
  it("registers both tools and guidance while a key exists", () => {
    const fake = harness();
    expect([...fake.tools.keys()].sort()).toEqual(["add_epidbot_result", "ask_epidbot"]);
    expect(fake.guidance).toHaveLength(1);
    expect(fake.guidance[0]).toContain("ask_epidbot");
    plugin.deactivate();
  });

  it("registers nothing without a key (progressive disclosure)", () => {
    const fake = harness({ withKey: false });
    expect(fake.tools.size).toBe(0);
    expect(fake.guidance).toHaveLength(0);
    plugin.deactivate();
  });

  it("withdraws the tools on deactivation", () => {
    const fake = harness();
    plugin.deactivate();
    expect(fake.tools.size).toBe(0);
    expect(fake.guidance).toHaveLength(0);
  });

  it("registers nothing on a host without assistant support", () => {
    const fake = harness();
    delete (fake.app as Record<string, unknown>).registerAssistantToolSpec;
    delete (fake.app as Record<string, unknown>).registerAssistantGuidance;
    expect(() => {
      plugin.deactivate();
      plugin.activate(fake.app);
    }).not.toThrow();
    plugin.deactivate();
  });
});

describe("ask_epidbot", () => {
  it("delegates the question and returns the answer", async () => {
    const fake = harness();
    fake.app.nativeFetch = nativeFetchStub();
    const result = (await tool(fake, "ask_epidbot").callback({
      question: "Quanto de dengue no Rio em 2025?",
    })) as { answer: string; session_id: number; images: string[] };
    expect(result.answer).toContain("Dengue cases rose in 2025.");
    expect(result.session_id).toBe(7);
    expect(result.images).toEqual(["plots/a.png"]);
    plugin.deactivate();
  });

  it("attaches map context by default and honors attach_context:false", async () => {
    const fake = harness();
    const calls: string[] = [];
    fake.app.nativeFetch = (async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      if (urlText.endsWith("/api/v1/chat")) {
        calls.push(JSON.parse(String(init?.body)).message);
        return jsonResponse({ job_id: "job-1", session_id: 7 });
      }
      return jsonResponse({ status: "completed", session_id: 7, content: "ok" });
    }) as typeof fetch;
    fake.app.getViewBounds = () => [-43.2, -23.1, -43.1, -22.9];

    await tool(fake, "ask_epidbot").callback({ question: "e aí?" });
    expect(calls[0]).toContain("[Map context]");
    expect(calls[0].trim().endsWith("e aí?")).toBe(true);

    await tool(fake, "ask_epidbot").callback({
      question: "e aí?",
      attach_context: false,
    });
    expect(calls[1]).toBe("e aí?");
    plugin.deactivate();
  });

  it("validates model-supplied input", async () => {
    const fake = harness();
    const spec = tool(fake, "ask_epidbot");
    await expect(spec.callback(undefined)).rejects.toThrow(/input must be an object/);
    await expect(spec.callback({})).rejects.toThrow(/question must be/);
    await expect(spec.callback({ question: "   " })).rejects.toThrow(/question must be/);
    await expect(spec.callback({ question: 42 })).rejects.toThrow(/question must be/);
    plugin.deactivate();
  });

  it("surfaces API failures as tool errors", async () => {
    const fake = harness();
    fake.app.nativeFetch = (async () => jsonResponse({ detail: "bad key" }, 401)) as typeof fetch;
    await expect(
      tool(fake, "ask_epidbot").callback({ question: "q" }),
    ).rejects.toThrow(/401/);
    plugin.deactivate();
  });

  it("passes the assistant's Stop signal through", async () => {
    const fake = harness();
    const controller = new AbortController();
    controller.abort();
    fake.app.nativeFetch = (async () => jsonResponse({ job_id: "job-1" })) as typeof fetch;
    await expect(
      tool(fake, "ask_epidbot").callback(
        { question: "q" },
        { signal: controller.signal },
      ),
    ).rejects.toThrow(/cancelled/i);
    plugin.deactivate();
  });
});

describe("add_epidbot_result", () => {
  it("adds a validated FeatureCollection as a styled layer", async () => {
    const fake = harness();
    const result = (await tool(fake, "add_epidbot_result").callback({
      geojson: FC,
      name: "Dengue 2025",
    })) as { layerId: string; featureCount: number; styleApplied: boolean };
    expect(result.layerId).toBe("layer-1");
    expect(result.featureCount).toBe(2);
    expect(result.styleApplied).toBe(true);
    expect(fake.addedLayers[0].name).toBe("Dengue 2025");
    // The layer is recorded in project state for provenance.
    const state = plugin.getProjectState?.() as { resultLayers: Array<Record<string, unknown>> };
    expect(state.resultLayers).toHaveLength(1);
    expect(state.resultLayers[0].name).toBe("Dengue 2025");
    plugin.deactivate();
  });

  it("rejects invalid GeoJSON and bad input", () => {
    const fake = harness();
    const spec = tool(fake, "add_epidbot_result");
    // The callback is synchronous by design; the host turns sync throws
    // into tool error results.
    expect(() => spec.callback(undefined)).toThrow(/input must be an object/);
    expect(() => spec.callback({})).toThrow(/Invalid GeoJSON/);
    expect(() =>
      spec.callback({ geojson: { type: "FeatureCollection", features: [] } }),
    ).toThrow(/Invalid GeoJSON/);
    plugin.deactivate();
  });

  it("refuses to touch the map on non-2D renderers", () => {
    const fake = harness();
    fake.renderer = "cesium";
    expect(() =>
      tool(fake, "add_epidbot_result").callback({ geojson: FC }),
    ).toThrow(/cesium/);
    expect(fake.addedLayers).toHaveLength(0);
    plugin.deactivate();
  });
});
