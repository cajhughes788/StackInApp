// Needs a paid ElevenLabs plan — the free tier blocks API access to
// library voices entirely ("Free users cannot use library voices via
// the API"), even though those same voices work fine in their web app.

import fs from "node:fs";
import { execFileSync } from "node:child_process";

export function ttsToMp3(text, outPath, { apiKey, voiceId }) {
  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY in .env.recording. Get one at elevenlabs.io.");
  }
  const body = JSON.stringify({
    text,
    model_id: "eleven_multilingual_v2",
    voice_settings: { stability: 0.45, similarity_boost: 0.75 },
  });
  execFileSync(
    "curl",
    [
      "-s",
      "-X", "POST",
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      "-H", `xi-api-key: ${apiKey}`,
      "-H", "Content-Type: application/json",
      "-H", "Accept: audio/mpeg",
      "-d", body,
      "-o", outPath,
    ],
    { stdio: "inherit" }
  );
  // ElevenLabs returns JSON (not audio) on error — curl still writes
  // that JSON to outPath with exit code 0, so check the actual content.
  const buf = fs.readFileSync(outPath);
  if (buf.slice(0, 1).toString() === "{") {
    throw new Error(`ElevenLabs API error for "${text.slice(0, 40)}...": ${buf.toString("utf8")}`);
  }
}
