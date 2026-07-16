// Concatenates the per-marker clips (from cut-clips.mjs, captioned by
// caption-clips.mjs and narrated by narrate-clips.mjs) into one
// rough-cut file per ad, in story order, plus that ad's own CTA
// end-card (npm run make:cta) at the end.
//
// Usage: npm run assemble:ads

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { findFfmpeg } from "./ffmpeg-util.mjs";

const OUT_DIR = path.resolve(process.cwd(), "ad-footage");
const clipsDir = path.join(OUT_DIR, "clips");
const roughcutsDir = path.join(OUT_DIR, "roughcuts");

if (!fs.existsSync(clipsDir)) {
  console.error(`No clips found in ${clipsDir}. Run \`npm run cut:ads\` first.`);
  process.exit(1);
}

const clipExt = fs.readdirSync(clipsDir).find((f) => f.endsWith(".mp4")) ? "mp4" : "webm";

// Story order per ad — deliberately excludes "logged-in" and the
// workspace-settings clips (onboarding, not part of the demo hook).
const ADS = {
  "w2-ad": ["w2-shift-1-logged", "w2-shift-2-logged", "w2-entries-grid-view", "cta-w2-ad"],
  "independent-ad": [
    "independent-income-logged",
    "expense-logged",
    "independent-home-summary-view",
    "cta-independent-ad",
  ],
};

const ffmpeg = findFfmpeg();
if (!ffmpeg.full) {
  console.error(
    "Concatenation needs a full ffmpeg — Playwright's bundled build has no concat " +
      "demuxer/protocol at all (it's a minimal build for screen recording only, not general " +
      "transcoding). Install one with `brew install ffmpeg` and re-run."
  );
  process.exit(1);
}
fs.mkdirSync(roughcutsDir, { recursive: true });

for (const [adName, clipLabels] of Object.entries(ADS)) {
  const clipPaths = clipLabels.map((label) => path.join(clipsDir, `${label}.${clipExt}`));
  const missing = clipPaths.filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    console.warn(`Skipping "${adName}" — missing clip(s): ${missing.map((p) => path.basename(p)).join(", ")}`);
    continue;
  }

  const listPath = path.join(roughcutsDir, `${adName}.concat.txt`);
  const listContent = clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listPath, listContent);

  const outPath = path.join(roughcutsDir, `${adName}.${clipExt}`);
  console.log(`Assembling ${adName}: ${clipLabels.join(" -> ")}`);
  execFileSync(ffmpeg.bin, ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath], {
    stdio: "inherit",
  });
  fs.unlinkSync(listPath);
}

console.log(`\nDone. Rough cuts written to ${roughcutsDir}`);
