require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

const assert = require("node:assert/strict");
const { availableImportSources } = require("../shared/importVisibility.ts");

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

console.log("import visibility");

test("Venmo on -> Venmo", () => {
  assert.deepEqual(availableImportSources({ enableVenmo: true }), ["venmo_csv"]);
});

test("Card / POS on -> Square, Stripe", () => {
  assert.deepEqual(availableImportSources({ enablePosSales: true }), ["square_csv", "stripe_csv"]);
});

test("old tipped card-tips setting counts as Card / POS", () => {
  assert.deepEqual(
    availableImportSources({ isTippedIndependent: true, askCardTips: true }),
    ["square_csv", "stripe_csv"]
  );
});

test("Venmo + Card / POS -> all three in order", () => {
  assert.deepEqual(
    availableImportSources({ enableVenmo: true, enablePosSales: true }),
    ["venmo_csv", "square_csv", "stripe_csv"]
  );
});

test("nothing on -> empty (panel hidden), never Bank", () => {
  assert.deepEqual(availableImportSources({}), []);
  assert.deepEqual(availableImportSources(undefined), []);
  assert.deepEqual(availableImportSources(null), []);
});

test("sources without a CSV parser don't show", () => {
  assert.deepEqual(
    availableImportSources({ enableCashApp: true, enableZelle: true, enableChecks: true, enableApplePay: true, enableCashSales: true }),
    []
  );
});

if (failures > 0) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall passed");
