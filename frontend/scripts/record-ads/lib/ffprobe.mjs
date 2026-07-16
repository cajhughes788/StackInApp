import { execFileSync } from "node:child_process";

export function ffprobeDuration(ffmpegBin, filePath) {
  const ffprobeBin = ffmpegBin.replace(/ffmpeg(-mac)?$/, "ffprobe$1");
  const out = execFileSync(ffprobeBin, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]).toString().trim();
  return parseFloat(out);
}
