require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

const assert = require("node:assert/strict");

const {
  beginHydrationSync,
  beginRevalidationSync,
  completeSync,
  createResourceSyncMeta,
  shouldRevalidateByTtl,
} = require("../frontend/lib/sync/resourceSync.ts");

const {
  getForegroundRefreshThresholdMs,
  shouldForceForegroundRefresh,
  shouldRefreshForForegroundReason,
} = require("../frontend/lib/sync/foregroundRefreshPolicy.ts");

function run(name, fn) {
  fn();
  process.stdout.write(`ok - ${name}\n`);
}

run("hydration without cached data enters hydrating state", () => {
  const initial = createResourceSyncMeta();
  const next = beginHydrationSync(initial, { hasRenderableData: false });

  assert.equal(next.syncState, "hydrating");
  assert.equal(next.lastSyncSource, "cache");
});

run("hydration with cached data becomes silent revalidation", () => {
  const initial = createResourceSyncMeta();
  const next = beginHydrationSync(initial, { hasRenderableData: true });

  assert.equal(next.syncState, "revalidating");
  assert.equal(next.lastSyncSource, "cache");
});

run("completed sync preserves timestamps and source", () => {
  const initial = beginRevalidationSync(createResourceSyncMeta(), {
    source: "backend",
  });
  const next = completeSync(initial, {
    source: "backend",
    lastSuccessfulSyncAt: 123,
    localUpdatedAt: 456,
  });

  assert.equal(next.syncState, "ready");
  assert.equal(next.lastSuccessfulSyncAt, 123);
  assert.equal(next.localUpdatedAt, 456);
  assert.equal(next.lastSyncSource, "backend");
});

run("ttl revalidation only triggers after threshold", () => {
  assert.equal(shouldRevalidateByTtl(1_000, 500, 1_400), false);
  assert.equal(shouldRevalidateByTtl(1_000, 500, 1_600), true);
});

run("foreground refresh policy uses reason-specific thresholds", () => {
  assert.equal(getForegroundRefreshThresholdMs("focus"), 60_000);
  assert.equal(getForegroundRefreshThresholdMs("resume"), 20_000);
  assert.equal(shouldForceForegroundRefresh("initial"), true);
  assert.equal(shouldForceForegroundRefresh("focus"), false);
});

run("foreground refresh skips fresh resources on focus and refreshes stale ones", () => {
  const now = 100_000;

  assert.equal(
    shouldRefreshForForegroundReason([now - 10_000, now - 15_000], "focus", now),
    false
  );

  assert.equal(
    shouldRefreshForForegroundReason([now - 70_000, now - 15_000], "focus", now),
    true
  );
});

// ------------------------------------------------------------
// W-2 pay math (computeEntry v2 + shared/entryPay + shared/hourlyRates)
// Unpaid breaks are excluded from pay (paid hours × rate), never deducted
// again later; v1-stored entries must read identically through entryPay.
// ------------------------------------------------------------
const { computeEntry, W2_CALC_VERSION } = require("../shared/computeEntry.ts");
const { getEntryGross, getEntryHourlyPay } = require("../shared/entryPay.ts");
const { getRateOptions, getEntryPositionTitle } = require("../shared/hourlyRates.ts");

const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 0.005, `${label}: ${actual} !== ${expected}`);

// 6h clocked, 30-min unpaid break, $10/hr, $20 tips, $1.65 meal
const breakShift = {
  workspace: "w2",
  date: "2026-10-06",
  w2: {
    hours: 6, rate: 10, tips: 20, reportedCash: 0,
    breakDeduction: true, breakMinutes: 30,
    appliedCustomDeductions: [{ label: "Meal", amount: 1.65 }],
  },
};

run("w2 pay uses paid hours; break excluded from gross, not deducted again", () => {
  const t = computeEntry(breakShift, { w2: {} });
  near(t.paidHours, 5.5, "paidHours");
  near(t.hourlyPay, 55, "hourlyPay");
  near(t.dayTotal, 75, "dayTotal");
  near(t.taxableTotal, 73.35, "taxableTotal (home Day Total)");
  assert.equal(t.calcVersion, W2_CALC_VERSION);
});

run("v1-stored entries read identically to v2 through entryPay", () => {
  const v2 = { ...breakShift, totals: computeEntry(breakShift, { w2: {} }) };
  const v1 = {
    ...breakShift,
    totals: { totalHours: 6, paidHours: 5.5, breakDeductionAmount: 5, customDeductionsAmount: 1.65, dayTotal: 80, taxableTotal: 73.35 },
  };
  near(getEntryGross(v1), getEntryGross(v2), "gross");
  near(getEntryHourlyPay(v1), getEntryHourlyPay(v2), "hourly pay");
  near(v1.totals.taxableTotal, v2.totals.taxableTotal, "home Day Total unchanged");
});

run("shifts without a break are unchanged by the paid-hours model", () => {
  const t = computeEntry({ workspace: "w2", date: "2026-10-06", w2: { hours: 4, rate: 3.35, tips: 10, appliedCustomDeductions: [] } }, { w2: {} });
  near(t.hourlyPay, 13.4, "hourlyPay");
  near(t.dayTotal, 23.4, "dayTotal");
});

run("entryPay handles flat legacy rows and leaves independent alone", () => {
  near(getEntryHourlyPay({ dayTotal: 30, tips: 10, reportedCash: 0 }), 20, "flat legacy row");
  near(getEntryGross({ workspace: "independent", totals: { dayTotal: 99 } }), 99, "independent gross");
  near(getEntryHourlyPay({ workspace: "independent", totals: { dayTotal: 99 } }), 0, "independent hourly");
});

run("rate options and position titles", () => {
  const settings = { w2: { defaultHourlyRate: 3.35, additionalRates: [{ id: "b", title: "Bartender", rate: 8.5 }, { id: "x", title: "  ", rate: 1 }] } };
  const options = getRateOptions(settings);
  assert.deepEqual(options.map((o) => o.title), ["Default", "Bartender"]);
  assert.equal(getEntryPositionTitle(undefined, { w2: { defaultRateTitle: "Server" } }), "Server");
  assert.equal(getEntryPositionTitle({ positionId: "custom" }, settings), "Custom");
  assert.equal(getEntryPositionTitle({ positionId: "b", positionTitle: "Bartender (old)" }, settings), "Bartender (old)");
});

// ------------------------------------------------------------
// Plaid merchant keys: raw descriptors keep digits now; the legacy key
// (digits stripped) must still be derivable so old merchant memory resolves.
// ------------------------------------------------------------
const { normalizePlaidMerchantKey, legacyPlaidMerchantKey, resolvePlaidDisplayName } = require("../shared/plaidClassification.ts");

run("plaid merchant keys: enriched names unchanged, raw descriptors keep digits", () => {
  assert.equal(normalizePlaidMerchantKey("Target 1147", "TARGET 1147 SEATTLE"), "target");
  assert.equal(legacyPlaidMerchantKey("Target 1147", "TARGET 1147 SEATTLE"), "target");
  assert.equal(normalizePlaidMerchantKey(null, "ZELLE TO J SMITH 88213"), "zelle to j smith 88213");
  assert.equal(legacyPlaidMerchantKey(null, "ZELLE TO J SMITH 88213"), "zelle to j smith");
  assert.equal(resolvePlaidDisplayName(null, "POS DEBIT ************1234"), "Unknown merchant");
  assert.equal(resolvePlaidDisplayName(null, "Joe's Diner"), "Joe's Diner");
});

process.stdout.write("sync behavior checks passed\n");
