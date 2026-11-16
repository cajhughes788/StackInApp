require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

// Voice entry: how a reply from the server fills the Add entry form
// (frontend/lib/voiceEntryFill.ts) and the reply's shape (shared/voiceEntry.ts).
const path = require("node:path");
const Module = require("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@shared/")) {
    request = path.join(__dirname, "..", "shared", request.slice("@shared/".length));
  } else if (request.startsWith("@/")) {
    request = path.join(__dirname, "..", "frontend", request.slice(2));
  }
  return originalResolve.call(this, request, ...rest);
};

const assert = require("node:assert/strict");
const { planVoiceFill, voiceFieldsFor, toTwelveHour, hoursBetween } = require("../frontend/lib/voiceEntryFill.ts");
const { VoiceEntryResultSchema, VoiceEntryRequestSchema } = require("../shared/voiceEntry.ts");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(error);
  }
}

const w2InOut = {
  mode: "w2",
  showNotes: true,
  showHoursSection: true,
  showHoursManual: false,
  showInOutTimes: true,
  showRate: true,
  showTips: true,
  showReportedCash: true,
  showUnreportedCash: false,
  showBreakDeduction: true,
  showCustomDeductions: false,
};
const w2HoursNoTips = { ...w2InOut, showHoursManual: true, showInOutTimes: false, showTips: false, showReportedCash: false };
const indie = {
  mode: "independent",
  showNotes: true,
  showHours: true,
  showVenmo: true,
  showAppleCash: false,
  showZelle: false,
  showChecks: false,
  showCashApp: false,
  showPosSales: true,
  showCashSales: true,
  showSourceTips: true,
  showIndependentUnreportedCash: false,
  showCustomIncome: false,
};
const indieCashOnly = { ...indie, showVenmo: false, showPosSales: false, showSourceTips: false };

const reply = (overrides) => ({
  isEntry: true,
  date: null,
  hours: null,
  inTime: null,
  outTime: null,
  positionId: null,
  amounts: [],
  notes: null,
  ...overrides,
});
const ctx = (visibility, tipsEnabled = false) => ({ visibility, tipsEnabled, dateBounds: { start: "2026-11-01", end: "2026-11-30" } });

test("12-hour times", () => {
  assert.deepEqual(toTwelveHour("09:00"), { time: "9:00", period: "AM" });
  assert.deepEqual(toTwelveHour("17:30"), { time: "5:30", period: "PM" });
  assert.deepEqual(toTwelveHour("00:00"), { time: "12:00", period: "AM" });
  assert.deepEqual(toTwelveHour("12:15"), { time: "12:15", period: "PM" });
  assert.equal(toTwelveHour("25:00"), null);
});

test("hours between times, past midnight too", () => {
  assert.equal(hoursBetween("09:00", "17:00"), 8);
  assert.equal(hoursBetween("16:00", "00:30"), 8.5);
});

test("W-2 in/out form: '270 today, 9 to 5' fills times and asks where $270 goes", () => {
  const plan = planVoiceFill(
    reply({ inTime: "09:00", outTime: "17:00", amounts: [{ target: "unsure", category: null, amount: 270 }] }),
    ctx(w2InOut)
  );
  assert.deepEqual(plan.inOut, { inTime: "9:00", inPeriod: "AM", outTime: "5:00", outPeriod: "PM" });
  assert.equal(plan.hours, null);
  assert.equal(plan.amounts.length, 0);
  assert.equal(plan.questions.length, 1);
  assert.deepEqual(plan.questions[0].options.map((o) => o.field), ["tips", "reportedCash"]);
});

test("W-2 with no tip fields: an unsure amount is left out with a reason", () => {
  const plan = planVoiceFill(
    reply({ inTime: "09:00", outTime: "17:00", amounts: [{ target: "unsure", category: null, amount: 270 }] }),
    ctx(w2HoursNoTips)
  );
  assert.equal(plan.hours, "8");
  assert.equal(plan.questions.length, 0);
  assert.equal(plan.amounts.length, 0);
  assert.match(plan.skipped[0], /\$270 wasn't added: your pay is worked out/);
});

test("W-2 card tips go straight to Card tips", () => {
  const plan = planVoiceFill(reply({ amounts: [{ target: "cardTips", category: null, amount: 40 }] }), ctx(w2InOut));
  assert.deepEqual(plan.amounts, [{ field: "tips", category: null, amount: 40 }]);
});

test("independent: payment methods and tips land in their own fields", () => {
  const plan = planVoiceFill(
    reply({
      hours: 6,
      amounts: [
        { target: "cashSales", category: null, amount: 200 },
        { target: "cashTips", category: null, amount: 40 },
        { target: "venmo", category: "tips", amount: 15 },
        { target: "venmo", category: null, amount: 60 },
      ],
    }),
    ctx(indie, true)
  );
  assert.equal(plan.hours, "6");
  assert.deepEqual(plan.amounts, [
    { field: "cashSales", category: null, amount: 200 },
    { field: "cashTips", category: null, amount: 40 },
    { field: "venmo", category: "tips", amount: 15 },
    { field: "venmo", category: null, amount: 60 },
  ]);
  assert.equal(plan.questions.length, 0);
});

test("independent: two amounts for the same field are put together", () => {
  const plan = planVoiceFill(
    reply({ amounts: [{ target: "cashSales", category: null, amount: 100.5 }, { target: "cashSales", category: null, amount: 20.25 }] }),
    ctx(indie, true)
  );
  assert.deepEqual(plan.amounts, [{ field: "cashSales", category: null, amount: 120.75 }]);
});

test("independent: unsure amount asks among the shown sources", () => {
  const plan = planVoiceFill(reply({ amounts: [{ target: "unsure", category: null, amount: 270 }] }), ctx(indie, true));
  assert.equal(plan.questions.length, 1);
  assert.deepEqual(plan.questions[0].options.map((o) => o.label), ["Venmo", "Card / POS", "Cash"]);
});

test("independent with one source: unsure amount goes there without asking", () => {
  const plan = planVoiceFill(reply({ amounts: [{ target: "unsure", category: null, amount: 270 }] }), ctx(indieCashOnly));
  assert.deepEqual(plan.amounts, [{ field: "cashSales", category: null, amount: 270 }]);
  assert.equal(plan.questions.length, 0);
});

test("independent: tips with no method asks among tips places", () => {
  const plan = planVoiceFill(reply({ amounts: [{ target: "tipsUnsure", category: null, amount: 40 }] }), ctx(indie, true));
  assert.equal(plan.questions.length, 1);
  assert.equal(plan.questions[0].isTips, true);
  assert.deepEqual(plan.questions[0].options.map((o) => o.label), ["Card tips", "Cash tips", "Venmo tips"]);
});

test("a field not on this form becomes a question, not a hidden value", () => {
  const plan = planVoiceFill(reply({ amounts: [{ target: "zelle", category: null, amount: 80 }] }), ctx(indie, true));
  assert.equal(plan.amounts.length, 0);
  assert.equal(plan.questions.length, 1);
});

test("date outside the period on screen is left alone", () => {
  const plan = planVoiceFill(reply({ date: "2026-10-30" }), ctx(indie, true));
  assert.equal(plan.date, null);
  assert.equal(plan.skipped.length, 1);
  assert.equal(planVoiceFill(reply({ date: "2026-11-14" }), ctx(indie, true)).date, "2026-11-14");
});

test("server fields list follows the form", () => {
  assert.deepEqual(voiceFieldsFor(w2InOut, false), ["cardTips", "reportedCash"]);
  assert.deepEqual(voiceFieldsFor(indie, true), ["venmo", "posSales", "cashSales", "posTips", "cashTips"]);
  assert.deepEqual(voiceFieldsFor(indieCashOnly, false), ["cashSales"]);
});

test("reply and request shapes", () => {
  assert.equal(VoiceEntryResultSchema.safeParse(reply({ amounts: [{ target: "unsure", category: null, amount: 270 }] })).success, true);
  assert.equal(VoiceEntryResultSchema.safeParse(reply({ inTime: "9am" })).success, false);
  assert.equal(VoiceEntryRequestSchema.safeParse({ transcript: " ", today: "2026-11-16", workspaceType: "w2", fields: [] }).success, false);
  assert.equal(
    VoiceEntryRequestSchema.safeParse({ transcript: "270 today", today: "2026-11-16", workspaceType: "w2", fields: ["cardTips"] }).success,
    true
  );
});

if (failures > 0) {
  console.log(`\n${failures} voice entry test(s) failed`);
  process.exit(1);
}
console.log("\nvoice entry tests passed");
