// Muxes the narration audio that plan-ad.mjs already synthesized (and
// measured the real duration of, before any recording happened) into
// each cut clip. Doesn't call ElevenLabs itself — that already happened
// during planning, specifically so the recorder could size each scene's
// on-screen pacing to match its narration's real length. This script
// only has a safety-net correction (atempo/tpad) for whatever small
// drift shows up between the planned duration and what actually got
// recorded.
//
// Run after caption:ads (captions are already burned into the gray
// band) and before make:cta (the CTA card gets its own matching
// narration line, already synthesized by plan-ad.mjs too).
//
// Usage: npm run narrate:ads

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ffprobeDuration } from "./lib/ffprobe.mjs";
import { findFfmpeg } from "./ffmpeg-util.mjs";

const OUT_DIR = path.resolve(process.cwd(), "ad-footage");
const CLIPS_DIR = path.join(OUT_DIR, "clips");

const PLAN_PATH = path.join(OUT_DIR, "plan.json");
if (!fs.existsSync(PLAN_PATH)) {
  console.error(`Missing ${PLAN_PATH}. Run \`npm run plan:ads\` first.`);
  process.exit(1);
}
const PLAN = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));

// scene label -> narration mp3 filename, for every scene across
// whichever audiences are present in the plan (CTA entries are handled
// separately by make-cta.mjs, which reads PLAN itself).
const NARRATION_AUDIO = {};
for (const audience of [PLAN.w2, PLAN.independent]) {
  if (!audience) continue;
  for (const [label, scene] of Object.entries(audience.scenes)) {
    if (scene.narrationAudio) NARRATION_AUDIO[label] = scene.narrationAudio;
  }
}

function muxNarration(ffmpegBin, videoPath, audioPath, outPath) {
  const videoDur = ffprobeDuration(ffmpegBin, videoPath);
  const audioDur = ffprobeDuration(ffmpegBin, audioPath);

  let audioFilter = "anull";
  let finalVideoPath = videoPath;
  let tmpExtended = null;

  // record.mjs already sized each scene's pacing to the planned
  // narration duration, so this should rarely trigger — it's a safety
  // net for drift between the plan's estimate and the real recording
  // (network hiccups, UI animation timing, etc.), not the primary
  // mechanism for matching lengths.
  if (audioDur > videoDur) {
    const neededSpeedup = audioDur / videoDur;
    if (neededSpeedup <= 1.15) {
      // Speed the narration up slightly rather than touch the video.
      audioFilter = `atempo=${neededSpeedup.toFixed(3)}`;
    } else {
      // Still too long even at a natural-sounding speed — freeze the
      // video's last frame to extend it instead of cutting speech off.
      const speedup = 1.15;
      audioFilter = `atempo=${speedup}`;
      const extendedAudioDur = audioDur / speedup;
      const padSeconds = Math.max(0, extendedAudioDur - videoDur + 0.3);
      tmpExtended = videoPath.replace(/\.mp4$/, ".extended.mp4");
      execFileSync(ffmpegBin, [
        "-y",
        "-i", videoPath,
        "-vf", `tpad=stop_mode=clone:stop_duration=${padSeconds.toFixed(2)}`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
        tmpExtended,
      ], { stdio: "inherit" });
      finalVideoPath = tmpExtended;
    }
  }

  // No "-shortest" here — video length is the pre-tuned pacing and must
  // win. If narration is shorter, the video should play out with
  // trailing silence, not get truncated to match a shorter audio track.
  // If narration was longer, the tpad step above already extended the
  // video to fit, so they're already matched by the time we get here.
  execFileSync(ffmpegBin, [
    "-y",
    "-i", finalVideoPath,
    "-i", audioPath,
    "-filter:a", audioFilter,
    "-c:v", "copy",
    "-c:a", "aac",
    outPath,
  ], { stdio: "inherit" });

  if (tmpExtended) fs.unlinkSync(tmpExtended);
}

function main() {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg.full) {
    console.error("Narration needs a full ffmpeg — install one with `brew install ffmpeg`.");
    process.exit(1);
  }

  for (const [label, audioFile] of Object.entries(NARRATION_AUDIO)) {
    const clipPath = path.join(CLIPS_DIR, `${label}.mp4`);
    const audioPath = path.join(OUT_DIR, audioFile);

    if (!fs.existsSync(clipPath)) {
      console.warn(`Skipping "${label}" — clip not found (run cut:ads + caption:ads first).`);
      continue;
    }
    if (!fs.existsSync(audioPath)) {
      console.warn(`Skipping "${label}" — ${audioFile} not found (run plan:ads first).`);
      continue;
    }

    console.log(`Muxing narration into "${label}" (${audioFile})`);
    const tmpOut = clipPath.replace(/\.mp4$/, ".narrated.mp4");
    muxNarration(ffmpeg.bin, clipPath, audioPath, tmpOut);
    fs.renameSync(tmpOut, clipPath);
  }

  console.log("\nDone. Narration muxed into clips.");
}

main();
