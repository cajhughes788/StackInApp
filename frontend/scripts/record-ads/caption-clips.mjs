// Composites a caption into the gray letterboxed band beneath the
// recorded phone screen for each clip that has one in plan.json.
//
// That gray band isn't part of the app's page at all — it's Playwright
// padding the recording out to `recordVideo.size` (390x844) from the
// iPhone 13 device's actual viewport (390x664), solid rgb(126,126,126)
// starting at y=664. Because it's outside the live DOM, record.mjs
// can't inject a caption into it directly; instead this renders each
// caption as its own PNG (Chromium, so real fonts/CSS) and composites
// it onto that exact region with ffmpeg's `overlay` filter — which only
// blends pixels, so it works even without the font-rendering support
// the installed ffmpeg's `drawtext` filter would need.
//
// Caption text itself comes from plan.json (npm run plan:ads) — each
// scene's caption is data-aware and randomly varied per run, not a
// fixed string, so re-run plan:ads before this for genuinely new copy.
//
// Usage: npm run caption:ads   (run after cut:ads, before assemble:ads)

import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { findFfmpeg } from "./ffmpeg-util.mjs";

const OUT_DIR = path.resolve(process.cwd(), "ad-footage");
const CLIPS_DIR = path.join(OUT_DIR, "clips");

// The gray band's exact bounds — see comment above.
const BAND_Y = 664;
const BAND_WIDTH = 390;
const BAND_HEIGHT = 844 - BAND_Y; // 180
const BAND_COLOR = "rgb(126, 126, 126)"; // matches the band exactly, so text looks native to it, not pasted on

const PLAN_PATH = path.join(OUT_DIR, "plan.json");
if (!fs.existsSync(PLAN_PATH)) {
  console.error(`Missing ${PLAN_PATH}. Run \`npm run plan:ads\` first.`);
  process.exit(1);
}
const PLAN = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));

// One caption per clip label, pulled from whichever audiences are
// present in the plan. Clips without an entry (e.g. "cta-*", which get
// their headline baked in visually by make-cta.mjs) are left untouched.
const CAPTIONS = {};
for (const audience of [PLAN.w2, PLAN.independent]) {
  if (!audience) continue;
  for (const [label, scene] of Object.entries(audience.scenes)) {
    if (scene.caption) CAPTIONS[label] = scene.caption;
  }
}

function captionHtml(text) {
  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: ${BAND_WIDTH}px;
    height: ${BAND_HEIGHT}px;
    background: ${BAND_COLOR};
    display: flex;
    align-items: center;
    justify-content: center;
  }
  p {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-weight: 700;
    font-size: 21px;
    line-height: 1.4;
    color: #ffffff;
    text-align: center;
    padding: 0 22px;
    text-wrap: balance;
  }
</style>
</head>
<body><p>${text}</p></body>
</html>
`;
}

async function main() {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg.full) {
    console.error(
      "Captioning needs a full ffmpeg (for the overlay filter over a re-encode) — install one with `brew install ffmpeg`."
    );
    process.exit(1);
  }

  const clipExt = fs.readdirSync(CLIPS_DIR).find((f) => f.endsWith(".mp4")) ? "mp4" : "webm";
  if (clipExt !== "mp4") {
    console.error("Captioning needs .mp4 clips (re-run cut:ads with a full ffmpeg on PATH first).");
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: BAND_WIDTH, height: BAND_HEIGHT } });

  for (const [label, text] of Object.entries(CAPTIONS)) {
    const clipPath = path.join(CLIPS_DIR, `${label}.${clipExt}`);
    if (!fs.existsSync(clipPath)) {
      console.warn(`Skipping "${label}" — clip not found (run cut:ads first).`);
      continue;
    }

    const pngPath = path.join(OUT_DIR, `caption-${label}.png`);
    await page.setContent(captionHtml(text));
    await page.waitForTimeout(150);
    await page.screenshot({ path: pngPath });

    const tmpPath = path.join(CLIPS_DIR, `${label}.captioned.mp4`);
    console.log(`Captioning ${label}: "${text}"`);
    execFileSync(
      ffmpeg.bin,
      [
        "-y",
        "-i", clipPath,
        "-i", pngPath,
        "-filter_complex", `[0:v][1:v]overlay=0:${BAND_Y}`,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        tmpPath,
      ],
      { stdio: "inherit" }
    );
    fs.unlinkSync(pngPath);
    fs.renameSync(tmpPath, clipPath);
  }

  await browser.close();
  console.log("\nDone. Captions composited into the gray band for all defined clips.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
