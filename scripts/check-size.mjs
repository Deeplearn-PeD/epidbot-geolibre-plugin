// Fails the build when the gzipped plugin bundle exceeds the size budget
// (README F6: <= ~150 KB gzipped). Prints each file's raw and gzip size.
//
//   npm run check:size            # default budget: 150 KiB
//   BUNDLE_BUDGET_BYTES=200000 npm run check:size

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(
  await readFile(join(rootDir, "geolibre-plugin", "plugin.json"), "utf8"),
);
const budgetBytes = Number(process.env.BUNDLE_BUDGET_BYTES ?? 150 * 1024);

const files = ["dist/index.js"];
if (manifest.style) files.push(manifest.style);

let totalGzip = 0;
for (const rel of files) {
  let data;
  try {
    data = await readFile(join(rootDir, "geolibre-plugin", rel));
  } catch {
    console.error(`check-size: missing ${rel}; run "npm run build:geolibre" first.`);
    process.exit(1);
  }
  const gz = gzipSync(data);
  totalGzip += gz.length;
  console.log(
    `${rel}: ${(data.length / 1024).toFixed(1)} KiB raw, ` +
      `${(gz.length / 1024).toFixed(1)} KiB gzipped, ` +
      `sha256 ${createHash("sha256").update(data).digest("hex").slice(0, 16)}…`,
  );
}

console.log(
  `Total: ${(totalGzip / 1024).toFixed(1)} KiB gzipped ` +
    `(budget ${(budgetBytes / 1024).toFixed(0)} KiB)`,
);
if (totalGzip > budgetBytes) {
  console.error("check-size: bundle exceeds the size budget.");
  process.exit(1);
}
