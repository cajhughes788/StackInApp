// Decides everything about today's ad BEFORE any recording happens:
// which data gets entered, what narration/captions describe it, and how
// long each line actually takes to say. record.mjs then drives the live
// recording so each scene's on-screen pacing fills its narration's real
// (measured, not estimated) duration — instead of writing a fixed line
// and hoping it happens to fit, or stretching audio/video after the
// fact to force a match.
//
// Usage: npm run plan:ads            (both audiences)
//        npm run plan:ads -- w2      (one audience only)

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import {
  OUT_DIR,
  loadState,
  todayMinusDays,
  currentWeeklyPeriodStartDaysAgo,
  currentMonthMaxDaysBack,
} from "./lib/period-helpers.mjs";
import { randomInt, randomAmount, pick } from "./lib/random-helpers.mjs";
import { renderScene } from "./lib/narration-templates.mjs";
import { ttsToMp3 } from "./lib/elevenlabs.mjs";
import { ffprobeDuration } from "./lib/ffprobe.mjs";
import { findFfmpeg } from "./ffmpeg-util.mjs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.recording") });
const { ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM" } = process.env;

const requestedAudiences = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const AUDIENCES = requestedAudiences.length > 0 ? requestedAudiences : ["w2", "independent"];

const EXPENSE_VENDORS = [
  { vendor: "Sally Beauty Supply", description: "Color + developer restock", category: "Supplies" },
  { vendor: "Ulta Professional", description: "Shears + styling tools", category: "Supplies" },
  { vendor: "Costco Business Center", description: "Bulk supplies restock", category: "Supplies" },
];

function synth(text, sceneId, ffmpegBin) {
  const mp3Path = path.join(OUT_DIR, `narration-${sceneId}.mp3`);
  console.log(`  narration: "${text}"`);
  ttsToMp3(text, mp3Path, { apiKey: ELEVENLABS_API_KEY, voiceId: ELEVENLABS_VOICE_ID });
  const duration = ffprobeDuration(ffmpegBin, mp3Path);
  console.log(`  -> ${path.basename(mp3Path)} (${duration.toFixed(2)}s)`);
  return { narrationAudio: path.basename(mp3Path), narrationDuration: duration };
}

function buildW2Plan(ffmpegBin) {
  const w2MaxDaysBack = currentWeeklyPeriodStartDaysAgo(loadState().w2PayPeriodAnchor ?? todayMinusDays(0));
  const days = new Set();
  while (days.size < Math.min(2, w2MaxDaysBack + 1)) days.add(randomInt(0, w2MaxDaysBack));
  const sorted = [...days].sort((a, b) => b - a);
  const day1 = sorted[0] ?? 0;
  const day2 = sorted[1] ?? sorted[0] ?? 0;

  const shift1 = {
    date: todayMinusDays(day1),
    rate: "18.50",
    hours: randomAmount(4, 8),
    tips: randomAmount(35, 95),
    reportedCash: randomAmount(10, 35),
    unreportedCash: randomAmount(5, 25),
  };
  const shift2 = {
    date: todayMinusDays(day2),
    rate: "18.50",
    hours: randomAmount(4, 8),
    tips: randomAmount(35, 95),
    reportedCash: randomAmount(10, 35),
    unreportedCash: randomAmount(5, 25),
  };
  const combinedTips = (Number(shift1.tips) + Number(shift2.tips)).toFixed(2);
  const combinedHours = (Number(shift1.hours) + Number(shift2.hours)).toFixed(1);

  console.log("\n[w2] shift 1:");
  const hook = renderScene("w2-hook", shift1);
  const s1 = synth(hook.narration, "w2-shift-1-logged", ffmpegBin);

  console.log("[w2] shift 2:");
  const shift2Scene = renderScene("w2-shift-2", shift2);
  const s2 = synth(shift2Scene.narration, "w2-shift-2-logged", ffmpegBin);

  console.log("[w2] grid payoff:");
  const gridScene = renderScene("w2-grid-payoff", { combinedTips, combinedHours });
  const s3 = synth(gridScene.narration, "w2-entries-grid-view", ffmpegBin);

  console.log("[w2] CTA:");
  const ctaScene = renderScene("w2-cta", {});
  const cta = synth(ctaScene.narration, "cta-w2-ad", ffmpegBin);

  return {
    workspaceType: "w2",
    scenes: {
      "w2-shift-1-logged": { data: shift1, narration: hook.narration, caption: hook.caption, ...s1 },
      "w2-shift-2-logged": { data: shift2, narration: shift2Scene.narration, caption: shift2Scene.caption, ...s2 },
      "w2-entries-grid-view": {
        data: { combinedTips, combinedHours },
        narration: gridScene.narration,
        caption: gridScene.caption,
        ...s3,
      },
    },
    cta: { narration: ctaScene.narration, ...cta },
  };
}

function buildIndependentPlan(ffmpegBin) {
  const independentDays = randomInt(0, currentMonthMaxDaysBack());
  const date = todayMinusDays(independentDays);

  const income = {
    date,
    venmo: randomAmount(80, 220),
    posSales: randomAmount(150, 400),
    cashSales: randomAmount(40, 150),
  };
  const totalIncome = (Number(income.venmo) + Number(income.posSales) + Number(income.cashSales)).toFixed(2);

  const vendor = pick(EXPENSE_VENDORS);
  const expense = { date, amount: randomAmount(25, 90), vendor: vendor.vendor, description: vendor.description, category: vendor.category };

  console.log("\n[independent] income:");
  const hook = renderScene("independent-hook", { ...income, totalIncome });
  const s1 = synth(hook.narration, "independent-income-logged", ffmpegBin);

  console.log("[independent] expense:");
  const expenseScene = renderScene("expense-logged", expense);
  const s2 = synth(expenseScene.narration, "expense-logged", ffmpegBin);

  console.log("[independent] summary payoff:");
  const summaryScene = renderScene("independent-summary-payoff", { expenseTotal: expense.amount });
  const s3 = synth(summaryScene.narration, "independent-home-summary-view", ffmpegBin);

  console.log("[independent] CTA:");
  const ctaScene = renderScene("independent-cta", {});
  const cta = synth(ctaScene.narration, "cta-independent-ad", ffmpegBin);

  return {
    workspaceType: "independent",
    scenes: {
      "independent-income-logged": { data: income, narration: hook.narration, caption: hook.caption, ...s1 },
      "expense-logged": { data: expense, narration: expenseScene.narration, caption: expenseScene.caption, ...s2 },
      "independent-home-summary-view": {
        data: { expenseTotal: expense.amount },
        narration: summaryScene.narration,
        caption: summaryScene.caption,
        ...s3,
      },
    },
    cta: { narration: ctaScene.narration, ...cta },
  };
}

function main() {
  if (!ELEVENLABS_API_KEY) {
    console.error("Missing ELEVENLABS_API_KEY in .env.recording. Get one at elevenlabs.io.");
    process.exit(1);
  }
  const ffmpeg = findFfmpeg();
  if (!ffmpeg.full) {
    console.error("Planning needs a full ffmpeg (for ffprobe) — install one with `brew install ffmpeg`.");
    process.exit(1);
  }

  const plan = { generatedAt: new Date().toISOString() };
  if (AUDIENCES.includes("w2")) plan.w2 = buildW2Plan(ffmpeg.bin);
  if (AUDIENCES.includes("independent")) plan.independent = buildIndependentPlan(ffmpeg.bin);

  const planPath = path.join(OUT_DIR, "plan.json");
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  console.log(`\nDone. Plan written to ${planPath}`);
}

main();
