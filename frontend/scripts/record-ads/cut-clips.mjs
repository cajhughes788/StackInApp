// Slices the master recording produced by record.mjs into one clip per
// marker, using markers.json for the timestamps. Each marker is treated
// as the END of the segment leading up to it (segments are contiguous —
// marker[i-1].t -> marker[i].t).
//
// Usage: npm run cut:ads  (or: node scripts/record-ads/cut-clips.mjs path/to/video.webm)

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { findFfmpeg } from "./ffmpeg-util.mjs";

const OUT_DIR = path.resolve(process.cwd(), "ad-footage");
const markersPath = path.join(OUT_DIR, "markers.json");
const [, , videoArg] = process.argv;

if (!fs.existsSync(markersPath)) {
  console.error(`No markers.json found in ${OUT_DIR}. Run \`npm run record:ads\` first.`);
  process.exit(1);
}

function newestWebm() {
  const candidates = fs
    .readdirSync(OUT_DIR)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(OUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.f;
}

const videoFile = videoArg || newestWebm();
if (!videoFile) {
  console.error(`No .webm recording found in ${OUT_DIR}.`);
  process.exit(1);
}
const videoPath = path.isAbsolute(videoFile) ? videoFile : path.join(OUT_DIR, videoFile);

function resolveEncoder() {
  const ffmpeg = findFfmpeg();
  if (ffmpeg.full) {
    return {
      bin: ffmpeg.bin,
      ext: "mp4",
      args: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"],
    };
  }
  console.log("(no system ffmpeg found — using Playwright's bundled build, output will be .webm not .mp4)");
  return { bin: ffmpeg.bin, ext: "webm", args: ["-c:v", "libvpx", "-crf", "10", "-b:v", "2M"] };
}

const encoder = resolveEncoder();
const markers = JSON.parse(fs.readFileSync(markersPath, "utf8"));

const clipsDir = path.join(OUT_DIR, "clips");
fs.mkdirSync(clipsDir, { recursive: true });

let prevT = 0;
for (const { label, t } of markers) {
  const duration = Math.max(t - prevT, 0.5);
  const outPath = path.join(clipsDir, `${label}.${encoder.ext}`);
  console.log(`Cutting ${label}: ${prevT.toFixed(2)}s -> ${t.toFixed(2)}s (${duration.toFixed(2)}s)`);
  execFileSync(
    encoder.bin,
    ["-y", "-ss", String(prevT), "-i", videoPath, "-t", String(duration), ...encoder.args, outPath],
    { stdio: "inherit" }
  );
  prevT = t;
}

console.log(`\nDone. Clips written to ${clipsDir}`);
