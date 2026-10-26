require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

const assert = require("node:assert/strict");

const {
  buildAllIncomeSummary,
  isMonthKey,
  monthDateRange,
  nextMonthKey,
  previousMonthKey,
  sumIndependentUnreportedCash,
} = require("../shared/allIncome.ts");
const { computeIncomeGaugeForEntries } = require("../shared/computeIncomeGauge.ts");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(error);
  }
}

console.log("all income");

test("month keys", () => {
  assert.equal(isMonthKey("2026-10"), true);
  assert.equal(isMonthKey("2026-13"), false);
  assert.equal(isMonthKey("2026-1"), false);
  assert.equal(previousMonthKey("2026-01"), "2025-12");
  assert.equal(previousMonthKey("2026-10"), "2026-09");
  assert.equal(nextMonthKey("2026-12"), "2027-01");
  assert.deepEqual(monthDateRange("2026-02"), { start: "2026-02-01", end: "2026-02-31" });
});

test("total is the sum of each workspace, rows sorted by income", () => {
  const summary = buildAllIncomeSummary({
    month: "2026-10",
    current: [
      { workspaceId: "uber", name: "Uber", type: "independent", income: 1180.1, expenses: 300 },
      { workspaceId: "salon", name: "Salon", type: "independent", income: 3240, expenses: 410.55 },
      { workspaceId: "target", name: "Target", type: "w2", income: 1950.2, expenses: null },
    ],
    previous: [
      { workspaceId: "salon", name: "Salon", type: "independent", income: 3000, expenses: 0 },
      { workspaceId: "target", name: "Target", type: "w2", income: 1950.2, expenses: null },
    ],
  });
  assert.equal(summary.total, 6370.3);
  assert.equal(summary.previousTotal, 4950.2);
  assert.equal(summary.change, 1420.1);
  assert.equal(summary.previousMonth, "2026-09");
  assert.deepEqual(summary.workspaces.map((w) => w.workspaceId), ["salon", "target", "uber"]);
  const salon = summary.workspaces[0];
  assert.equal(salon.net, 2829.45);
  assert.equal(salon.previousIncome, 3000);
  const target = summary.workspaces[1];
  assert.equal(target.expenses, null);
  assert.equal(target.net, null);
  // A workspace with no previous month counts as 0 then.
  assert.equal(summary.workspaces[2].previousIncome, 0);
});

test("refund months can go negative and still add up", () => {
  const summary = buildAllIncomeSummary({
    month: "2026-10",
    current: [
      { workspaceId: "a", name: "A", type: "independent", income: -50, expenses: 0 },
      { workspaceId: "b", name: "B", type: "independent", income: 200, expenses: 25 },
    ],
    previous: [],
  });
  assert.equal(summary.total, 150);
  assert.equal(summary.change, 150);
});

test("no workspaces gives zeros", () => {
  const summary = buildAllIncomeSummary({ month: "2026-10", current: [], previous: [] });
  assert.equal(summary.total, 0);
  assert.deepEqual(summary.workspaces, []);
});

test("unreported cash only counts self-employed entries", () => {
  assert.equal(
    sumIndependentUnreportedCash([
      { workspace: "independent", independent: { unreportedCash: 40.25 } },
      { workspace: "independent", independent: { unreportedCash: 10 } },
      { workspace: "w2", w2: { unreportedCash: 99 } },
      { workspace: "independent", independent: {} },
    ]),
    50.25
  );
});

test("W-2 month income matches the Home total math", () => {
  const entries = [
    { workspace: "w2", date: "2026-10-02", totals: { taxableTotal: 180, paidHours: 8 }, w2: { unreportedCash: 20 } },
    { workspace: "w2", date: "2026-10-03", totals: { taxableTotal: 95.5, paidHours: 4 }, w2: { unreportedCash: 0 } },
  ];
  assert.equal(computeIncomeGaugeForEntries(entries, { includeUnreportedInUI: false }).incomeGauge, 275.5);
  assert.equal(computeIncomeGaugeForEntries(entries, { includeUnreportedInUI: true }).incomeGauge, 295.5);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
