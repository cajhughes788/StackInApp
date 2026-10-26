require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  FORM_1099K_THRESHOLD,
  buildTaxPackageFiles,
  computeIncomeByApp,
  receiptZipName,
  scheduleCLine,
} = require("../shared/taxPackage.ts");
const { buildZip, crc32 } = require("../shared/zip.ts");

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

const day = (date, lines, extra = {}) => ({ workspace: "independent", date, independent: { incomeBreakdowns: lines }, ...extra });

console.log("tax-time package");

test("income by app: card and POS together, refunds left out, highest first", () => {
  const apps = computeIncomeByApp(
    [
      day("2026-01-02", [{ paymentMethod: "pos", services: 18000 }, { paymentMethod: "venmo", services: 400, tips: 100 }]),
      day("2026-01-03", [{ paymentMethod: "card", services: 3000 }, { paymentMethod: "cash", services: 25000 }]),
      day("2026-01-04", [{ paymentMethod: "venmo", products: 16000 }]),
      day("2026-01-05", [{ paymentMethod: "pos", services: -500 }], { kind: "refund" }),
      { workspace: "w2", date: "2026-01-06", w2: {} },
    ],
    FORM_1099K_THRESHOLD
  );
  assert.deepEqual(apps.map((a) => [a.key, a.amount, a.days]), [["cash", 25000, 1], ["card_pos", 21000, 2], ["venmo", 16500, 2]]);
  const byKey = Object.fromEntries(apps.map((a) => [a.key, a]));
  assert.equal(byKey.card_pos.over1099KAmount, true);
  assert.equal(byKey.venmo.near1099KAmount, true); // 16,500 > 75% of 20,000
  assert.equal(byKey.venmo.over1099KAmount, false);
  // Cash never gets a 1099-K
  assert.equal(byKey.cash.over1099KAmount, false);
  assert.equal(byKey.cash.near1099KAmount, false);
});

test("receipt names: date, vendor, amount; unsafe characters out; duplicates numbered", () => {
  const used = new Set();
  assert.equal(receiptZipName({ date: "2026-03-05", vendor: "Sally's/Beauty: Supply", amount: 42.5 }, "jpg", used), "Receipts/2026-03-05 Sally s Beauty Supply 42.50.jpg");
  assert.equal(receiptZipName({ date: "2026-03-05", vendor: "Sally's/Beauty: Supply", amount: 42.5 }, "jpg", used), "Receipts/2026-03-05 Sally s Beauty Supply 42.50 (2).jpg");
  assert.equal(receiptZipName({ date: "2026-03-06", vendor: "", amount: 9 }, "png", used), "Receipts/2026-03-06 Receipt 9.00.png");
});

test("Schedule C lines for the app's categories", () => {
  assert.equal(scheduleCLine("Commissions and fees"), "10");
  assert.equal(scheduleCLine("Supplies"), "22");
  assert.equal(scheduleCLine("Car and truck expenses"), "9");
  assert.equal(scheduleCLine("Something custom"), "27a (list in Part V)");
});

const data = {
  taxYear: 2026,
  workspaceName: "Salon <Studio>",
  generatedAt: "2026-10-26T12:00:00Z",
  scheduleC: {
    grossReceipts: 60000,
    returnsAndAllowances: 500,
    netIncomeFromSales: 59500,
    expenseLines: [
      { category: "Commissions and fees", line: "10", amount: 1740, count: 120 },
      { category: "Supplies", line: "22", amount: 3200.5, count: 14 },
    ],
    totalExpenses: 4940.5,
    netProfit: 54559.5,
    processingFees: 1740,
  },
  incomeByApp: [{ key: "card_pos", label: "Card / POS (Square, Stripe…)", amount: 21000, days: 2, over1099KAmount: true, near1099KAmount: false }],
  form1099K: { amountOver: 20000, transactionsOver: 200 },
  mileage: [{ date: "2026-02-01", description: "Supply run", businessMiles: 12.5, amount: 9.06 }],
  estimatedPayments: [{ paidOn: "2026-04-15", amount: 2500 }],
  expenses: [
    { date: "2026-03-05", vendor: "=HYPERLINK(evil)", description: "Color", category: "Supplies", amount: 120, receiptFile: "Receipts/a.jpg", receiptMissing: false },
    { date: "2026-03-09", vendor: "Shop", description: "Chair", category: "Supplies", amount: 300, receiptFile: null, receiptMissing: true },
  ],
};

test("package files: names, Schedule C rows, formula guard, escaped summary", () => {
  const files = buildTaxPackageFiles(data);
  assert.deepEqual(files.map((f) => f.path), [
    "Schedule C summary 2026.csv",
    "Income by payment app 2026.csv",
    "Mileage log 2026.csv",
    "Estimated tax payments 2026.csv",
    "Expenses and receipts 2026.csv",
    "Start here - 2026 summary.html",
  ]);
  const byName = Object.fromEntries(files.map((f) => [f.path, f.data]));
  assert.match(byName["Schedule C summary 2026.csv"], /"1","Gross receipts or sales","60000.00"/);
  assert.match(byName["Schedule C summary 2026.csv"], /"31","Net profit \(loss\)","54559.50"/);
  // A planted formula stays literal text
  assert.match(byName["Expenses and receipts 2026.csv"], /"'=HYPERLINK\(evil\)"/);
  assert.match(byName["Expenses and receipts 2026.csv"], /"Missing"/);
  const html = byName["Start here - 2026 summary.html"];
  assert.match(html, /Salon &lt;Studio&gt;/);
  assert.doesNotMatch(html, /<Studio>/);
  assert.match(html, /1099-K/);
  assert.match(html, /missing a receipt<\/td><td class="n">1</);
});

test("no mileage → no mileage file", () => {
  const files = buildTaxPackageFiles({ ...data, mileage: [] });
  assert.ok(!files.some((f) => f.path.startsWith("Mileage")));
});

test("the zip opens and every file checks out", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const receipt = new Uint8Array(20000).map((_, i) => (i * 7) % 256);
  const zip = buildZip([...buildTaxPackageFiles(data), { path: "Receipts/2026-03-05 Shop 120.00.jpg", data: receipt }]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "taxpkg-"));
  const file = path.join(dir, "package.zip");
  fs.writeFileSync(file, zip);
  const out = execFileSync("unzip", ["-t", file]).toString();
  assert.match(out, /No errors detected/);
  const listing = execFileSync("unzip", ["-Z1", file]).toString();
  assert.ok(listing.includes("Receipts/2026-03-05 Shop 120.00.jpg"));
  const extracted = execFileSync("unzip", ["-p", file, "Receipts/2026-03-05 Shop 120.00.jpg"]);
  assert.deepEqual(new Uint8Array(extracted), receipt);
  fs.rmSync(dir, { recursive: true, force: true });
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
