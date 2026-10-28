import { afterEach } from "vitest";

// jsdom has no object URL implementation; the panel uses it for plot blobs
// and Markdown export. Provide benign stubs when missing.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = (() => "blob:mock") as typeof URL.createObjectURL;
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
