import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(root, "geolibre-plugin", "plugin.json"), "utf8"),
) as { id: string; version: string; description: string; assistant?: { description: string } };
const zipPath = join(root, "geolibre-plugin", `${manifest.id}-${manifest.version}.zip`);
const zipUrl = `https://github.com/Deeplearn-PeD/epidbot-geolibre-plugin/releases/download/v${manifest.version}/${manifest.id}-${manifest.version}.zip`;

describe("registry entry (F6)", () => {
  it("keeps the assistant declaration within the host's 300-char limit", () => {
    const assistant = manifest.assistant?.description ?? "";
    expect(assistant.length).toBeGreaterThan(0);
    expect(assistant.length).toBeLessThanOrEqual(300);
  });

  // The entry is generated from the built zip; when the zip is absent
  // (fresh checkout, CI's test job) there is nothing to assert yet — the
  // release workflow generates it for real.
  (existsSync(zipPath) ? it : it.skip)("generates the full registry entry", () => {
    const stdout = execFileSync("node", ["scripts/registry-entry.mjs", zipUrl], {
      cwd: root,
      encoding: "utf8",
    });
    const entry = JSON.parse(stdout) as Record<string, unknown>;
    expect(entry.id).toBe("epidbot");
    expect(entry.version).toBe(manifest.version);
    expect(entry.license).toBe("MIT");
    expect(entry.manifestUrl).toBe("plugins/epidbot/plugin.json");
    expect(entry.minGeoLibreVersion).toBe("3.5.0");
    expect(entry.categories).toEqual(["Data", "Visualization", "Analysis"]);
    expect(entry.publishableSettings).toEqual(["settings", "sessionId", "resultLayers"]);
    expect(entry.repository).toContain("epidbot-geolibre-plugin");
    expect(entry.issues).toContain("/issues");
    const source = entry.source as { url: string; sha256: string };
    expect(source.url).toBe(zipUrl);
    expect(source.sha256).toBe(createHash("sha256").update(readFileSync(zipPath)).digest("hex"));
  });
});
