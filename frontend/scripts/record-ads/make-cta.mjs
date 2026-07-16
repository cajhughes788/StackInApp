// Renders a branded CTA end-card and turns it into one short video clip
// per ad — same visual, different narration audio — that assemble-ads.mjs
// appends to the end of each ad. Text/branding is rendered by Chromium
// (full CSS/font control) rather than ffmpeg's drawtext filter, which
// the installed ffmpeg build doesn't have.
//
// Narration audio (narration-cta-<ad>.mp3) is already synthesized by
// plan-ad.mjs, varied per run from the "w2-cta" / "independent-cta"
// template pools in lib/narration-templates.mjs — this script just
// looks for that file by the same naming convention. If it's not there
// yet (plan:ads wasn't run, or that audience wasn't in the plan), falls
// back to silent audio so every clip still has a consistent audio track
// for assemble:ads' "-c copy" concat (mixed silent/non-silent clips
// would mismatch; a clip with vs. without an audio stream at all would
// break the concat outright).
//
// Usage: npm run make:cta

import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { findFfmpeg } from "./ffmpeg-util.mjs";

const OUT_DIR = path.resolve(process.cwd(), "ad-footage");
const CLIPS_DIR = path.join(OUT_DIR, "clips");
fs.mkdirSync(CLIPS_DIR, { recursive: true });

const iconPath = path.resolve(process.cwd(), "public/icon-512.png");
const iconBase64 = fs.readFileSync(iconPath).toString("base64");

const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 390px;
    height: 844px;
    background: linear-gradient(180deg, #060a08 0%, #0d1512 55%, #0a1210 100%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 28px;
    padding: 0 36px;
    text-align: center;
  }
  /* The source PNG has an opaque black square behind the wordmark —
     "lighten" blend mode drops the black into this near-black
     background, leaving just the glowing green/gold logo visible. */
  .icon { width: 168px; height: 168px; mix-blend-mode: lighten; }
  h1 {
    color: #ffffff;
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.2;
  }
  p.sub {
    color: #9ca39e;
    font-size: 16px;
    line-height: 1.5;
    max-width: 30ch;
  }
  .cta {
    margin-top: 6px;
    background: #22c55e;
    color: #06210f;
    font-weight: 700;
    font-size: 17px;
    padding: 16px 32px;
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(34, 197, 94, 0.35);
  }
  .store {
    color: #6b726d;
    font-size: 13px;
    letter-spacing: 0.02em;
  }
</style>
</head>
<body>
  <div class="card">
    <img class="icon" src="data:image/png;base64,${iconBase64}" alt="StackIn" />
    <h1>Know What You Actually Made.</h1>
    <p class="sub">Every tip, every dollar — tracked automatically.</p>
    <div class="cta">Download Free — 30-Day Trial</div>
    <p class="store">Available on the App Store</p>
  </div>
</body>
</html>
`;

const PLAN_PATH = path.join(OUT_DIR, "plan.json");
const PLAN = fs.existsSync(PLAN_PATH) ? JSON.parse(fs.readFileSync(PLAN_PATH, "utf8")) : {};
const AD_NAMES = [PLAN.w2 && "w2-ad", PLAN.independent && "independent-ad"].filter(Boolean);
if (AD_NAMES.length === 0) {
  console.error(`No audiences found in ${PLAN_PATH} (or it doesn't exist). Run \`npm run plan:ads\` first.`);
  process.exit(1);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(html);
  await page.waitForTimeout(300);
  const pngPath = path.join(OUT_DIR, "cta.png");
  await page.screenshot({ path: pngPath });
  await browser.close();

  const ffmpeg = findFfmpeg();
  const clipExt = ffmpeg.full ? "mp4" : "webm";
  const videoArgs = ffmpeg.full
    ? ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"]
    : ["-c:v", "libvpx", "-crf", "10", "-b:v", "2M"];

  for (const adName of AD_NAMES) {
    const narrationPath = path.join(OUT_DIR, `narration-cta-${adName}.mp3`);
    const hasNarration = fs.existsSync(narrationPath);
    const outPath = path.join(CLIPS_DIR, `cta-${adName}.${clipExt}`);

    const args = hasNarration
      ? ["-y", "-loop", "1", "-i", pngPath, "-i", narrationPath, "-r", "25", ...videoArgs, "-c:a", "aac", "-shortest", outPath]
      : [
          "-y",
          "-loop", "1", "-i", pngPath,
          "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
          "-t", "3",
          "-r", "25",
          ...videoArgs,
          "-c:a", "aac",
          outPath,
        ];

    console.log(`Rendering CTA for ${adName}${hasNarration ? " (with narration)" : " (silent)"}`);
    execFileSync(ffmpeg.bin, args, { stdio: "inherit" });
    if (hasNarration) fs.unlinkSync(narrationPath);
  }

  fs.unlinkSync(pngPath);
  console.log(`\nDone. CTA clips written to ${CLIPS_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
