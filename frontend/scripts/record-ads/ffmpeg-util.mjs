import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Prefers a full system ffmpeg (supports libx264/mp4, broadly
 * compatible with ad platforms and editors). Falls back to Playwright's
 * bundled ffmpeg, which is a minimal build with only VP8/webm support
 * and no drawtext/text-overlay filter. */
export function findFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return { bin: "ffmpeg", full: true };
  } catch {
    // no system ffmpeg — fall through to the bundled one
  }

  const cacheRoot = path.join(os.homedir(), "Library/Caches/ms-playwright");
  if (fs.existsSync(cacheRoot)) {
    const dir = fs.readdirSync(cacheRoot).find((d) => d.startsWith("ffmpeg-"));
    if (dir) {
      const bin = path.join(cacheRoot, dir, "ffmpeg-mac");
      if (fs.existsSync(bin)) {
        return { bin, full: false };
      }
    }
  }

  throw new Error(
    "No usable ffmpeg found. Install one (`brew install ffmpeg`) for full support, " +
      "or run `npx playwright install chromium` to get the bundled fallback."
  );
}
