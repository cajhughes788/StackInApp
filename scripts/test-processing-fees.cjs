require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

// The CSV parsers live in the frontend and import "@shared/…".
const path = require("node:path");
const Module = require("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@shared/")) {
    request = path.join(__dirname, "..", "shared", request.slice("@shared/".length));
  }
  return originalResolve.call(this, request, ...rest);
};

const assert = require("node:assert/strict");

const { IncomeBreakdownSchema, EntrySchema } = require("../shared/schemas/entry.ts");
const {
  buildProcessingFeeItems,
  getEntryProcessingFees,
  isProcessingFeeTrackingOn,
  sumEntryProcessingFees,
  supportsProcessingFee,
} = require("../shared/processingFees.ts");
const { getIndependentCategorizedIncomeTotals } = require("../shared/independentIncome.ts");
const {
  parseSquareCsvToImportBatch,
  parseStripeCsvToImportBatch,
} = require("../frontend/lib/imports/csvImportParsers.ts");

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

function entry(lines, extra = {}) {
  return {
    workspace: "independent",
    date: "2026-10-05",
    notes: "",
    independent: { hours: 0, incomeBreakdowns: lines, unreportedCash: 0, unreportedCashTips: 0, customIncome: [] },
    ...extra,
  };
}

console.log("processing fees");

test("an income line takes a fee up to its total", () => {
  assert.equal(IncomeBreakdownSchema.safeParse({ paymentMethod: "pos", services: 100, fee: 3 }).success, true);
  assert.equal(IncomeBreakdownSchema.safeParse({ paymentMethod: "pos", services: 80, tips: 20, fee: 100 }).success, true);
  const tooBig = IncomeBreakdownSchema.safeParse({ paymentMethod: "pos", services: 100, fee: 101 });
  assert.equal(tooBig.success, false);
  assert.match(tooBig.error.issues[0].message, /can't be more than the payment/);
  assert.equal(IncomeBreakdownSchema.safeParse({ paymentMethod: "pos", services: 100, fee: -1 }).success, false);
});

test("a saved entry keeps its fee and income stays the full sale", () => {
  const parsed = EntrySchema.parse(entry([{ paymentMethod: "pos", services: 100, fee: 3 }]));
  assert.equal(parsed.independent.incomeBreakdowns[0].fee, 3);
  assert.equal(getIndependentCategorizedIncomeTotals(parsed.independent).total, 100);
});

test("only fee-keeping sources support a fee", () => {
  for (const method of ["card", "pos", "cash_app", "venmo"]) assert.equal(supportsProcessingFee(method), true, method);
  for (const method of ["cash", "check", "zelle", "apple_cash", "other"]) assert.equal(supportsProcessingFee(method), false, method);
  assert.equal(isProcessingFeeTrackingOn({ trackProcessingFees: true }), true);
  assert.equal(isProcessingFeeTrackingOn({}), false);
  assert.equal(isProcessingFeeTrackingOn(null), false);
});

test("fees add up across lines and entries; refunds carry none", () => {
  const sale = entry([
    { paymentMethod: "pos", services: 100, fee: 3 },
    { paymentMethod: "venmo", services: 50, fee: 0.95 },
    { paymentMethod: "cash", services: 40 },
  ]);
  assert.equal(getEntryProcessingFees(sale), 3.95);
  const refund = entry([{ paymentMethod: "pos", services: -100 }], { kind: "refund" });
  assert.equal(getEntryProcessingFees(refund), 0);
  assert.equal(getEntryProcessingFees({ workspace: "w2", w2: {} }), 0);
  assert.equal(sumEntryProcessingFees([sale, sale, refund]), 7.9);
});

test("P&L expense items: one per line with a fee", () => {
  const items = buildProcessingFeeItems(
    [
      entry([{ paymentMethod: "pos", services: 100, fee: 3 }, { paymentMethod: "cash", services: 10 }], { id: "e1", notes: "Saturday" }),
      entry([{ paymentMethod: "cash_app", products: 20, fee: 0.5 }], { id: "e2", date: "2026-10-06" }),
      entry([{ paymentMethod: "pos", services: -100, fee: 3 }], { id: "e3", kind: "refund" }),
    ],
    { pos: "Card / POS", cash_app: "Cash App" }
  );
  assert.deepEqual(items, [
    { id: "e1-0-fee", date: "2026-10-05", label: "Saturday", description: "Card / POS processing fee", amount: 3 },
    { id: "e2-0-fee", date: "2026-10-06", label: "Cash App", description: "Cash App processing fee", amount: 0.5 },
  ]);
});

const squareCsv = [
  "Date,Time,Gross Sales,Net Sales,Tip,Total Collected,Fees,Net Total,Transaction ID,Customer Name",
  '10/05/2026,10:15:00,$90.00,$90.00,$10.00,$100.00,-$2.90,$97.10,T1,Ana',
  '10/05/2026,11:00:00,$40.00,$40.00,$0.00,$40.00,$0.00,$40.00,T2,',
].join("\n");

test("Square: full sale from Total Collected, fee from Fees (tracking on)", () => {
  const batch = parseSquareCsvToImportBatch("sq.csv", squareCsv, { trackFees: true });
  assert.equal(batch.items.length, 2);
  assert.equal(batch.items[0].amount, 100);
  assert.equal(batch.items[0].fee, 2.9);
  assert.equal(batch.items[0].counterparty, "Ana");
  assert.equal(batch.items[1].amount, 40);
  assert.equal(batch.items[1].fee, null);
});

test("Square with tracking off: same full sale, no fee kept", () => {
  const batch = parseSquareCsvToImportBatch("sq.csv", squareCsv);
  assert.equal(batch.items[0].amount, 100);
  assert.equal(batch.items[0].fee, null);
});

test("Stripe: Amount is the sale whatever the column order", () => {
  const csv = ["id,Created (UTC),Net,Fee,Amount,Description", "ch_1,2026-10-05 10:00,97.10,2.90,100.00,Haircut"].join("\n");
  const batch = parseStripeCsvToImportBatch("st.csv", csv, { trackFees: true });
  assert.equal(batch.items[0].amount, 100);
  assert.equal(batch.items[0].fee, 2.9);
});

test("Net-only file: net plus fee rebuilds the sale when tracking", () => {
  const csv = ["Date,Net,Fee", "2026-10-05,97.10,2.90"].join("\n");
  assert.equal(parseStripeCsvToImportBatch("n.csv", csv, { trackFees: true }).items[0].amount, 100);
  // Off: what landed, as before.
  const off = parseStripeCsvToImportBatch("n.csv", csv).items[0];
  assert.equal(off.amount, 97.1);
  assert.equal(off.fee, null);
});

test("Gross and net without a fee column: the difference is the fee", () => {
  const csv = ["Date,Gross,Net", "2026-10-05,100.00,97.00"].join("\n");
  const item = parseStripeCsvToImportBatch("g.csv", csv, { trackFees: true }).items[0];
  assert.equal(item.amount, 100);
  assert.equal(item.fee, 3);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
