require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

// Accuracy suite for the self-employed tax estimate (shared/estimatedTax).
// Every household's expected numbers were worked out by hand, line by line
// in the order of the IRS forms (Schedule SE, Form 8959, Form 8995, 1040),
// with the arithmetic in the comments — so the code is checked against an
// independent calculation, not against itself. When a new tax year is
// added, add a worked household for it here.

const assert = require("node:assert/strict");

const {
  computeFederalEstimate,
  computeSafeHarborTarget,
  computeChildTaxCredit,
  taxFromBrackets,
  round2,
} = require("../shared/estimatedTax/calculate.ts");
const {
  getEstimatedTaxYear,
  missingTaxYearMessage,
  SUPPORTED_ESTIMATED_TAX_YEARS,
} = require("../shared/estimatedTax/years/index.ts");
const { assessTaxDataHealth } = require("../shared/estimatedTax/dataHealth.ts");
const { computeQuarterlyEstimate, pickNextQuarter } = require("../shared/estimatedTax/quarterly.ts");
const { PAYROLL_2026 } = require("../shared/tax/tables/payroll2026.ts");

const T2026 = getEstimatedTaxYear(2026);

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

// Cents can differ by rounding order between a form worked by hand and
// code; anything more is a real error.
function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= 0.02, `${label}: expected ${expected}, got ${actual}`);
}

function expectLines(estimate, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (key === "totalTax" || key === "marginalRate") continue;
    near(estimate.lines[key], value, key);
  }
  if ("totalTax" in expected) near(estimate.totalTax, expected.totalTax, "totalTax");
  if ("marginalRate" in expected) assert.equal(estimate.marginalRate, expected.marginalRate, "marginalRate");
}

console.log("estimated tax — 2026 tables");

test("no silent fallback: unsupported years return nothing", () => {
  assert.equal(getEstimatedTaxYear(2025), null);
  assert.equal(getEstimatedTaxYear(2027), null);
  assert.match(missingTaxYearMessage(2027), /aren't available yet/);
  assert.equal(missingTaxYearMessage(2026), null);
});

test("tripwire: the current calendar year has a table", () => {
  const year = new Date().getFullYear();
  assert.ok(
    getEstimatedTaxYear(year),
    `No estimated tax table for ${year}. Add shared/estimatedTax/years/${year}.ts (checklist in years/index.ts). Supported: ${SUPPORTED_ESTIMATED_TAX_YEARS.join(", ")}`
  );
});

test("2026 figures match their published sources", () => {
  assert.equal(T2026.federal.single.standardDeduction, 16100);
  assert.equal(T2026.federal.marriedJoint.standardDeduction, 32200);
  assert.equal(T2026.federal.headOfHousehold.standardDeduction, 24150);
  assert.equal(T2026.selfEmployment.socialSecurityWageBase, 184500);
  // One wage base across the app: the payroll table must agree.
  assert.equal(T2026.selfEmployment.socialSecurityWageBase, PAYROLL_2026.socialSecurityWageBase);
  assert.equal(T2026.qbi.threshold.single, 201750);
  assert.equal(T2026.qbi.threshold.marriedJoint, 403500);
  assert.equal(T2026.childTaxCredit.perChild, 2200);
  assert.deepEqual(T2026.quarters.map((q) => q.dueDate), ["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
});

test("table shape: brackets ascend and end open; periods end in the tax year", () => {
  for (const [status, { brackets }] of Object.entries(T2026.federal)) {
    for (let i = 1; i < brackets.length; i += 1) {
      const prev = brackets[i - 1];
      assert.ok(prev.upTo != null && (brackets[i].upTo == null || brackets[i].upTo > prev.upTo), `${status} bracket ${i}`);
      assert.ok(brackets[i].rate > prev.rate, `${status} rate ${i}`);
    }
    assert.equal(brackets[brackets.length - 1].upTo, null, `${status} top bracket open`);
  }
  for (const q of T2026.quarters) assert.ok(q.periodEnd.startsWith("2026-"), `Q${q.quarter} period`);
});

test("bracket math at the edges", () => {
  const single = T2026.federal.single.brackets;
  assert.equal(taxFromBrackets(0, single), 0);
  assert.equal(taxFromBrackets(12400, single), 1240); // 10% × 12,400
  assert.equal(taxFromBrackets(50400, single), 5800); // 1,240 + 12% × 38,000
  assert.equal(taxFromBrackets(105700, single), 17966); // 5,800 + 22% × 55,300
});

test("rounding is half-up to the cent despite float noise", () => {
  assert.equal(round2(46175 * 0.029), 1339.08); // 1,339.075
  assert.equal(round2(2410.335), 2410.34);
  assert.equal(round2(-0.005), -0); // sign of zero doesn't matter for money
});

console.log("\nworked households");

test("A: single, $50,000 profit, nothing else", () => {
  // SE: 50,000 × 0.9235 = 46,175.00
  //     SS 46,175 × 12.4% = 5,725.70 ; Medicare 46,175 × 2.9% = 1,339.08
  //     SE tax 7,064.78 ; half 3,532.39
  // AGI 50,000 − 3,532.39 = 46,467.61 ; − 16,100 = 30,367.61
  // QBI (50,000 − 3,532.39) × 20% = 9,293.52, capped at 20% × 30,367.61 = 6,073.52
  // Taxable 24,294.09 → 1,240 + 12% × 11,894.09 (1,427.29) = 2,667.29
  // Total 2,667.29 + 7,064.78 = 9,732.07 (19.5% of profit)
  const e = computeFederalEstimate(T2026, { filingStatus: "single", selfEmploymentProfit: 50000 });
  expectLines(e, {
    netEarningsFromSelfEmployment: 46175,
    socialSecurityTax: 5725.7,
    medicareTax: 1339.08,
    selfEmploymentTax: 7064.78,
    selfEmploymentTaxDeduction: 3532.39,
    adjustedGrossIncome: 46467.61,
    taxableIncomeBeforeQbi: 30367.61,
    qbiDeduction: 6073.52,
    taxableIncome: 24294.09,
    incomeTax: 2667.29,
    totalTax: 9732.07,
    marginalRate: 0.12,
  });
  assert.deepEqual(e.unsupported, []);
});

test("B: married joint, $90,000 profit + $60,000 W-2, two children", () => {
  // SE: 90,000 × 0.9235 = 83,115 ; SS room 184,500 − 60,000 = 124,500 (no cap hit)
  //     SS 10,306.26 ; Medicare 2,410.34 ; SE tax 12,716.60 ; half 6,358.30
  // Add'l Medicare: 60,000 + 83,115 < 250,000 → 0
  // AGI 150,000 − 6,358.30 = 143,641.70 ; − 32,200 = 111,441.70
  // QBI (90,000 − 6,358.30) × 20% = 16,728.34 (cap 22,288.34)
  // Taxable 94,713.36 → 2,480 + 12% × 69,913.36 (8,389.60) = 10,869.60
  // CTC 2 × 2,200 = 4,400 (AGI under 400,000) → income tax 6,469.60
  // Total 6,469.60 + 12,716.60 = 19,186.20
  const e = computeFederalEstimate(T2026, {
    filingStatus: "marriedJoint",
    selfEmploymentProfit: 90000,
    w2Wages: 60000,
    qualifyingChildren: 2,
  });
  expectLines(e, {
    socialSecurityTax: 10306.26,
    medicareTax: 2410.34,
    selfEmploymentTax: 12716.6,
    additionalMedicareTax: 0,
    adjustedGrossIncome: 143641.7,
    qbiDeduction: 16728.34,
    taxableIncome: 94713.36,
    incomeTaxBeforeCredits: 10869.6,
    childTaxCredit: 4400,
    incomeTax: 6469.6,
    totalTax: 19186.2,
    marginalRate: 0.12,
  });
});

test("C: single, $170,000 W-2 + $40,000 profit — wage base and Additional Medicare", () => {
  // SE: 40,000 × 0.9235 = 36,940 ; SS room 184,500 − 170,000 = 14,500
  //     SS 14,500 × 12.4% = 1,798.00 ; Medicare 36,940 × 2.9% = 1,071.26
  //     SE tax 2,869.26 ; half 1,434.63
  // Add'l Medicare: threshold 200,000 − wages 170,000 = 30,000 left;
  //     36,940 − 30,000 = 6,940 × 0.9% = 62.46
  // AGI 210,000 − 1,434.63 = 208,565.37 ; − 16,100 = 192,465.37 (under 201,750)
  // QBI (40,000 − 1,434.63) × 20% = 7,713.07
  // Taxable 184,752.30 → 17,966 + 24% × 79,052.30 (18,972.55) = 36,938.55
  // Total 36,938.55 + 2,869.26 + 62.46 = 39,870.27
  const e = computeFederalEstimate(T2026, { filingStatus: "single", selfEmploymentProfit: 40000, w2Wages: 170000 });
  expectLines(e, {
    socialSecurityTaxableEarnings: 14500,
    socialSecurityTax: 1798,
    medicareTax: 1071.26,
    selfEmploymentTax: 2869.26,
    additionalMedicareTax: 62.46,
    adjustedGrossIncome: 208565.37,
    qbiDeduction: 7713.07,
    taxableIncome: 184752.3,
    incomeTax: 36938.55,
    totalTax: 39870.27,
    marginalRate: 0.24,
  });
  assert.deepEqual(e.unsupported, []);
});

test("D: under $400 of net earnings owes no SE tax", () => {
  // 400 × 0.9235 = 369.40 < 400 → no SE tax; AGI 400 < standard deduction
  const e = computeFederalEstimate(T2026, { filingStatus: "single", selfEmploymentProfit: 400 });
  expectLines(e, { selfEmploymentTax: 0, taxableIncome: 0, totalTax: 0 });
});

test("E: a business loss offsets W-2 wages, no SE tax or QBI", () => {
  // AGI 50,000 − 10,000 = 40,000 ; − 16,100 = 23,900
  // Tax 1,240 + 12% × 11,500 = 2,620
  const e = computeFederalEstimate(T2026, { filingStatus: "single", selfEmploymentProfit: -10000, w2Wages: 50000 });
  expectLines(e, { selfEmploymentTax: 0, adjustedGrossIncome: 40000, qbiDeduction: 0, taxableIncome: 23900, totalTax: 2620 });
});

test("F: $1,500 side business gets the $400 minimum QBI deduction", () => {
  // SE: 1,500 × 0.9235 = 1,385.25 ; SS 171.77 ; Medicare 40.17 ; SE 211.94 ; half 105.97
  // AGI 31,500 − 105.97 = 31,394.03 ; − 16,100 = 15,294.03
  // QBI 1,394.03 × 20% = 278.81 → minimum 400 (QBI ≥ 1,000); cap 3,058.81
  // Taxable 14,894.03 → 1,240 + 12% × 2,494.03 (299.28) = 1,539.28
  // Total 1,539.28 + 211.94 = 1,751.22
  const e = computeFederalEstimate(T2026, { filingStatus: "single", selfEmploymentProfit: 1500, w2Wages: 30000 });
  expectLines(e, { selfEmploymentTax: 211.94, qbiDeduction: 400, taxableIncome: 14894.03, incomeTax: 1539.28, totalTax: 1751.22 });
});

test("G: high earner above the QBI threshold is flagged, SS capped", () => {
  // SE: 300,000 × 0.9235 = 277,050 ; SS 184,500 × 12.4% = 22,878 ;
  //     Medicare 8,034.45 ; SE 30,912.45 ; Add'l (277,050 − 200,000) × 0.9% = 693.45
  const e = computeFederalEstimate(T2026, { filingStatus: "single", selfEmploymentProfit: 300000 });
  expectLines(e, { socialSecurityTax: 22878, medicareTax: 8034.45, selfEmploymentTax: 30912.45, additionalMedicareTax: 693.45 });
  assert.deepEqual(e.unsupported, ["qbi_above_threshold"]);
});

test("H: head of household uses its own deduction and brackets", () => {
  // SE: 60,000 × 0.9235 = 55,410 ; SS 6,870.84 ; Medicare 1,606.89 ; SE 8,477.73 ; half 4,238.87 (4,238.865)
  // AGI 55,761.13 ; − 24,150 = 31,611.13 ; QBI (55,761.13) × 20% = 11,152.23 capped at 6,322.23
  // Taxable 25,288.90 → 1,770 + 12% × 7,588.90 (910.67) = 2,680.67 ; CTC 1 × 2,200 → 480.67
  // Total 480.67 + 8,477.73 = 8,958.40
  const e = computeFederalEstimate(T2026, { filingStatus: "headOfHousehold", selfEmploymentProfit: 60000, qualifyingChildren: 1 });
  expectLines(e, {
    selfEmploymentTax: 8477.73,
    standardDeduction: 24150,
    qbiDeduction: 6322.23,
    taxableIncome: 25288.9,
    incomeTaxBeforeCredits: 2680.67,
    childTaxCredit: 2200,
    incomeTax: 480.67,
    totalTax: 8958.4,
  });
});

test("child tax credit: phase-out and never below zero tax", () => {
  // Over by 10,500.40 → 11 × $50 = 550 off 4,400 → 3,850
  assert.equal(computeChildTaxCredit(T2026, "single", 2, 210500.4, 99999), 3850);
  // Only up to the income tax owed
  assert.equal(computeChildTaxCredit(T2026, "single", 3, 30000, 900), 900);
  assert.equal(computeChildTaxCredit(T2026, "marriedJoint", 1, 400000, 99999), 2200);
});

console.log("\nno tax on tips");
const { TIPPED_OCCUPATIONS } = require("../shared/estimatedTax/tippedOccupations.ts");

test("official list: 71 occupations, unique codes", () => {
  assert.equal(TIPPED_OCCUPATIONS.length, 71);
  assert.equal(new Set(TIPPED_OCCUPATIONS.map((o) => o.code)).size, 71);
  assert.equal(TIPPED_OCCUPATIONS.find((o) => o.code === "603").title, "Barbers, Hairdressers, Hairstylists, and Cosmetologists");
});

test("I: stylist, $60,000 profit incl. $12,000 tips", () => {
  // SE: 55,410 → SE tax 8,477.73 ; half 4,238.87 ; AGI 55,761.13
  // Tips: min(12,000, cap 25,000, net 55,761.13) = 12,000
  // Taxable before QBI 55,761.13 − 16,100 − 12,000 = 27,661.13
  // QBI min(11,152.23, 20% × 27,661.13 = 5,532.23) = 5,532.23
  // Taxable 22,128.90 → 1,240 + 12% × 9,728.90 (1,167.47) = 2,407.47
  // Total 2,407.47 + 8,477.73 = 10,885.20
  // (Without the deduction 12,037.20: saves 1,152, not 12% × 12,000,
  //  because the QBI deduction shrinks with taxable income.)
  const e = computeFederalEstimate(T2026, { filingStatus: "single", selfEmploymentProfit: 60000, tips: { amount: 12000, occupationCode: "603" } });
  assert.equal(e.tipsDeductionStatus, "applied");
  expectLines(e, { tipsDeduction: 12000, taxableIncomeBeforeQbi: 27661.13, qbiDeduction: 5532.23, taxableIncome: 22128.9, incomeTax: 2407.47, totalTax: 10885.2 });
  const without = computeFederalEstimate(T2026, { filingStatus: "single", selfEmploymentProfit: 60000 });
  near(without.totalTax, 12037.2, "without tips deduction");
});

test("J: phase-out and the net-income limit", () => {
  // $180,000 W-2 + $20,000 business, all tips (wait staff)
  // SE: 18,470 ; SS room 4,500 → 558.00 ; Med 535.63 ; SE 1,093.63 ; half 546.82
  // AGI 199,453.18 ; cap 25,000 − 10% × 49,453.18 = 20,054.68
  // Net business income 19,453.18 is the limit → deduction 19,453.18
  // Taxable before QBI 199,453.18 − 16,100 − 19,453.18 = 163,900.00
  // QBI 20% × 19,453.18 = 3,890.64 ; taxable 160,009.36
  // 17,966 + 24% × 54,309.36 (13,034.25) = 31,000.25 ; total 32,093.88
  const e = computeFederalEstimate(T2026, { filingStatus: "single", selfEmploymentProfit: 20000, w2Wages: 180000, tips: { amount: 20000, occupationCode: "102" } });
  expectLines(e, {
    selfEmploymentTax: 1093.63,
    adjustedGrossIncome: 199453.18,
    tipsDeduction: 19453.18,
    taxableIncomeBeforeQbi: 163900,
    qbiDeduction: 3890.64,
    taxableIncome: 160009.36,
    incomeTax: 31000.25,
    totalTax: 32093.88,
  });
});

test("tips deduction left out when it doesn't apply", () => {
  const run = (patch) => computeFederalEstimate(T2026, { filingStatus: "single", selfEmploymentProfit: 60000, tips: { amount: 12000, occupationCode: "603" }, ...patch });
  assert.equal(run({ filingStatus: "marriedSeparate" }).tipsDeductionStatus, "married_separately");
  assert.equal(run({ tips: { amount: 12000, occupationCode: "206" } }).tipsDeductionStatus, "specified_service");
  assert.equal(run({ tips: { amount: 12000, occupationCode: "none" } }).tipsDeductionStatus, "not_tipped_occupation");
  assert.equal(run({ tips: { amount: 12000, occupationCode: null } }).tipsDeductionStatus, "occupation_not_chosen");
  assert.equal(run({ tips: { amount: 0, occupationCode: "603" } }).tipsDeductionStatus, "no_tips");
  const high = run({ selfEmploymentProfit: 500000 });
  assert.equal(high.tipsDeductionStatus, "phased_out");
  for (const e of [run({ filingStatus: "marriedSeparate" }), run({ tips: { amount: 12000, occupationCode: "206" } })]) {
    assert.equal(e.lines.tipsDeduction, 0);
  }
  // SE tax is still owed on tips either way
  near(run({}).lines.selfEmploymentTax, run({ tips: { amount: 0, occupationCode: null } }).lines.selfEmploymentTax, "SE tax unchanged");
});

console.log("\nstate tax (2026)");
const { computeStateTax } = require("../shared/estimatedTax/states.ts");
const stateFor = (code, input) => computeStateTax(T2026.states, code, { qualifyingChildren: 0, w2Wages: 0, ...input });
// Household A: single, $50,000 profit, federal AGI 46,467.61
const A = { filingStatus: "single", federalAgi: 46467.61, selfEmploymentProfit: 50000 };

test("flat states on household A", () => {
  // GA (46,467.61 − 15,000) × 4.99% = 1,570.23
  near(stateFor("GA", A).tax, 1570.23, "GA");
  // IL (46,467.61 − 2,925) × 4.95% = 2,155.36
  near(stateFor("IL", A).tax, 2155.36, "IL");
  // NC (46,467.61 − 12,750) × 3.99% = 1,345.33
  near(stateFor("NC", A).tax, 1345.33, "NC");
  // MI (46,467.61 − 5,900) × 4.25% = 1,724.12
  near(stateFor("MI", A).tax, 1724.12, "MI");
  // KY (46,467.61 − 3,360) × 3.5% = 1,508.77
  near(stateFor("KY", A).tax, 1508.77, "KY");
  // PA 50,000 × 3.07% = 1,535.00 (half of SE tax not deductible)
  near(stateFor("PA", A).tax, 1535, "PA");
  assert.match(stateFor("PA", A).localTaxNote, /local earned income tax/);
});

test("household B (married joint, 2 children): dependents and two exemptions", () => {
  const B = { filingStatus: "marriedJoint", federalAgi: 143641.7, selfEmploymentProfit: 90000, w2Wages: 60000, qualifyingChildren: 2 };
  // GA (143,641.70 − 30,000 − 2 × 5,000) × 4.99% = 5,171.72
  near(stateFor("GA", B).tax, 5171.72, "GA");
  // IL (143,641.70 − 4 × 2,925) × 4.95% = 6,531.11
  near(stateFor("IL", B).tax, 6531.11, "IL");
});

test("Illinois exemption ends over $250,000 AGI; PA business loss doesn't offset wages", () => {
  near(stateFor("IL", { filingStatus: "single", federalAgi: 300000, selfEmploymentProfit: 300000 }).tax, 14850, "IL no exemption");
  near(stateFor("PA", { filingStatus: "single", federalAgi: 40000, selfEmploymentProfit: -10000, w2Wages: 50000 }).tax, 1535, "PA loss");
});

test("no-tax, not-included and not-chosen states", () => {
  for (const code of ["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"]) assert.equal(stateFor(code, A).status, "none", code);
  for (const code of ["CA", "NY", "OH", "CO", "UT", "ID", "AZ", "IN", "IA"]) assert.equal(stateFor(code, A).status, "not_included", code);
  assert.equal(stateFor(null, A).status, "not_chosen");
  // Every rule cites a source
  for (const [code, rule] of Object.entries(T2026.states)) assert.ok(rule.source.length > 20, code);
});

console.log("\npenalty-free (safe harbor) target");

test("smaller of 100% of last year or 90% of this year", () => {
  const r = computeSafeHarborTarget(T2026, { filingStatus: "single", priorYearTax: 8000, priorYearAgi: 60000, currentYearTax: 9732.07 });
  assert.equal(r.annualTarget, 8000);
  assert.equal(r.basis, "prior_year");
  assert.equal(r.currentYearTarget, 8758.86);
});

test("110% when last year's AGI was over $150,000", () => {
  const r = computeSafeHarborTarget(T2026, { filingStatus: "single", priorYearTax: 30000, priorYearAgi: 160000, currentYearTax: null });
  assert.equal(r.annualTarget, 33000);
  assert.equal(r.basis, "prior_year_high_income");
  const lower = computeSafeHarborTarget(T2026, { filingStatus: "single", priorYearTax: 30000, priorYearAgi: 160000, currentYearTax: 20000 });
  assert.equal(lower.annualTarget, 18000);
  assert.equal(lower.basis, "current_year");
});

test("married filing separately: 110% above $75,000", () => {
  const r = computeSafeHarborTarget(T2026, { filingStatus: "marriedSeparate", priorYearTax: 10000, priorYearAgi: 80000, currentYearTax: null });
  assert.equal(r.annualTarget, 11000);
});

test("no tax last year → nothing required; nothing known → no target", () => {
  assert.equal(computeSafeHarborTarget(T2026, { filingStatus: "single", priorYearTax: 0, priorYearAgi: 20000, currentYearTax: 5000 }).annualTarget, 0);
  const unknown = computeSafeHarborTarget(T2026, { filingStatus: "single", priorYearTax: null, priorYearAgi: null, currentYearTax: null });
  assert.equal(unknown.annualTarget, null);
  assert.equal(unknown.basis, null);
});

console.log("\nquarterly payments (annualized income method)");

// Jan–May $4,000/month, Jun–Aug $6,000 (busy summer), Sep 1–10 $1,000.
const busySummer = [
  ...["01", "02", "03", "04", "05"].map((m) => ({ month: `2026-${m}`, profit: 4000, w2Wages: 0 })),
  ...["06", "07", "08"].map((m) => ({ month: `2026-${m}`, profit: 6000, w2Wages: 0 })),
  { month: "2026-09", profit: 1000, w2Wages: 0 },
];
const quarterlyBase = {
  today: "2026-09-10",
  filingStatus: "single",
  qualifyingChildren: 0,
  months: busySummer,
  priorYearTax: 12000,
  priorYearAgi: 50000,
  ytdWithholding: null,
  withholdingAsOf: null,
  estimatedPaymentsMade: 3000,
};

test("next due date", () => {
  assert.equal(pickNextQuarter(T2026, "2026-02-10").quarter, 1);
  assert.equal(pickNextQuarter(T2026, "2026-04-15").quarter, 1);
  assert.equal(pickNextQuarter(T2026, "2026-04-16").quarter, 2);
  assert.equal(pickNextQuarter(T2026, "2026-10-26").quarter, 4);
  assert.equal(pickNextQuarter(T2026, "2027-01-05").dueDate, "2027-01-15");
});

test("Q3 after Aug 31: Jan–Aug income × 1.5, smaller of annualized and last year", () => {
  // Jan–Aug profit 38,000 × 1.5 = 57,000 (September's partial month left out)
  // Tax on 57,000 single: SE 52,639.50 → SS 6,527.30 + Med 1,526.55 = 8,053.85 ; half 4,026.93
  //   AGI 52,973.07 ; − 16,100 = 36,873.07 ; QBI capped 7,374.61 ; taxable 29,498.46
  //   1,240 + 12% × 17,098.46 (2,051.82) = 3,291.82 ; total 11,345.67
  // Annualized cumulative 11,345.67 × 22.5% × 3 = 7,658.33
  // Last year 12,000 → 25% × 3 = 9,000 → penalty-free 9,000 − 3,000 paid = 6,000
  // Based on earnings min(7,658.33, 9,000) − 3,000 = 4,658.33
  const r = computeQuarterlyEstimate(T2026, quarterlyBase);
  assert.equal(r.quarter, 3);
  assert.equal(r.dueDate, "2026-09-15");
  assert.equal(r.basis, "period_complete");
  near(r.annualized.profit, 57000, "annualized profit");
  near(r.annualized.estimate.totalTax, 11345.67, "annualized tax");
  near(r.penaltyFree, 6000, "penalty-free");
  near(r.basedOnEarnings, 4658.33, "based on earnings");
  assert.equal(r.belowEstimatesThreshold, false);
  // 11,345.67 / 57,000 of each business dollar
  near(r.businessTaxRate * 57000, 11345.67, "business tax rate");
});

test("range: year-so-far pace vs last-three-months pace", () => {
  // Year so far: 39,000 over 253 days × 365 = 56,264.82
  // Last three months: Jun–Aug 18,000 / 92 days × 112 days left = 21,913.04 → 60,913.04
  const r = computeQuarterlyEstimate(T2026, quarterlyBase);
  near(r.range.yearPace.lines.totalIncome, 56264.82, "year pace profit");
  near(r.range.recentPace.lines.totalIncome, 60913.04, "recent pace profit");
  assert.equal(r.range.low, r.range.yearPace.totalTax);
  assert.equal(r.range.high, r.range.recentPace.totalTax);
  assert.ok(r.range.low < r.range.high);
});

test("before the period ends, the year-to-date pace is used", () => {
  const r = computeQuarterlyEstimate(T2026, { ...quarterlyBase, today: "2026-10-26" });
  assert.equal(r.quarter, 4);
  assert.equal(r.basis, "year_to_date_pace");
  near(r.annualized.profit, r.range.yearPace.lines.totalIncome, "pace profit");
});

test("withholding from a real pay stub counts evenly through the year", () => {
  // 3,000 withheld through Jun 30 (day 181) → 3,000 × 365 / 181 = 6,049.72 a year
  // By Q3: 75% → 4,537.29
  const r = computeQuarterlyEstimate(T2026, { ...quarterlyBase, ytdWithholding: 3000, withholdingAsOf: "2026-06-30", estimatedPaymentsMade: 0 });
  near(r.annualWithholding, 6049.72, "annual withholding");
  near(r.withholdingCredit, 4537.29, "credit by Q3");
  near(r.penaltyFree, 9000 - 4537.29, "penalty-free after withholding");
});

test("under $1,000 owed after withholding → no estimated payments needed", () => {
  const small = [{ month: "2026-01", profit: 300, w2Wages: 0 }, { month: "2026-02", profit: 300, w2Wages: 0 }];
  const r = computeQuarterlyEstimate(T2026, { ...quarterlyBase, today: "2026-03-05", months: small, priorYearTax: null, estimatedPaymentsMade: 0 });
  assert.equal(r.belowEstimatesThreshold, true);
  assert.equal(r.basedOnEarnings, 0);
  assert.equal(r.penaltyFree, null);
});

test("no tax last year → penalty-free amount is $0", () => {
  const r = computeQuarterlyEstimate(T2026, { ...quarterlyBase, priorYearTax: 0 });
  assert.equal(r.penaltyFree, 0);
});

test("tips are annualized with the income and deducted", () => {
  // Jan–Aug tips 1,000/month → 8,000 × 1.5 = 12,000
  const withTips = busySummer.map((m) => ({ ...m, tips: m.month <= "2026-08" ? 1000 : 0 }));
  const r = computeQuarterlyEstimate(T2026, { ...quarterlyBase, months: withTips, occupationCode: "603" });
  near(r.annualized.tips, 12000, "annualized tips");
  near(r.annualized.estimate.lines.tipsDeduction, 12000, "deduction");
  assert.ok(r.annualized.estimate.totalTax < computeQuarterlyEstimate(T2026, quarterlyBase).annualized.estimate.totalTax);
});

test("state flows into the quarterly estimate and the safe-to-spend rate", () => {
  const ga = computeQuarterlyEstimate(T2026, { ...quarterlyBase, stateCode: "GA" });
  const tx = computeQuarterlyEstimate(T2026, { ...quarterlyBase, stateCode: "TX" });
  assert.equal(ga.state.annualized.status, "included");
  assert.ok(ga.state.low > 0 && ga.state.low <= ga.state.high);
  assert.equal(tx.state.annualized.status, "none");
  assert.ok(ga.businessTaxRate > tx.businessTaxRate);
  // Penalty-free amount stays federal
  assert.equal(ga.penaltyFree, tx.penaltyFree);
});

test("in January after the year: the full year, factor 1", () => {
  const full = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, profit: 4000, w2Wages: 0 }));
  const r = computeQuarterlyEstimate(T2026, { ...quarterlyBase, today: "2027-01-05", months: full });
  assert.equal(r.quarter, 4);
  assert.equal(r.basis, "period_complete");
  near(r.annualized.profit, 48000, "full-year profit");
});

console.log("\nreminders");
const { pickTaxReminder, buildTaxReminderMessage } = require("../shared/estimatedTax/reminders.ts");

test("a week before and on the due date; skipped if paid this quarter", () => {
  assert.equal(pickTaxReminder(T2026, "2027-01-08", []).key, "2027-01-15:week_before");
  assert.equal(pickTaxReminder(T2026, "2026-09-15", []).kind, "due_today");
  assert.equal(pickTaxReminder(T2026, "2026-09-15", [{ taxYear: 2026, paidOn: "2026-09-01" }]), null);
  // A Q2 payment doesn't count for Q3
  assert.equal(pickTaxReminder(T2026, "2026-09-15", [{ taxYear: 2026, paidOn: "2026-06-10" }]).kind, "due_today");
  assert.equal(pickTaxReminder(T2026, "2026-09-14", []), null);
  assert.match(buildTaxReminderMessage(pickTaxReminder(T2026, "2027-01-08", []), 6548.2).body, /\$6,549/);
});

console.log("\ndata health");

const healthy = {
  today: "2026-10-26",
  taxYear: 2026,
  hasTaxYearTable: true,
  profile: {
    filingStatus: "single",
    qualifyingChildren: 0,
    businessStartDate: null,
    situation: { spouseHasIncome: false, investmentOrRentalIncome: false, itemizesDeductions: false },
    priorYearTax: 8000,
  },
  firstRecordDate: "2026-01-03",
  uncategorizedExpenseCount: 0,
  pendingBankReviewCount: 0,
  pendingImportCount: 0,
};
const withProfile = (patch) => ({ ...healthy, profile: { ...healthy.profile, ...patch } });
const codes = (result) => result.issues.map((issue) => issue.code);

test("clean records and answers → ready", () => {
  const r = assessTaxDataHealth(healthy);
  assert.equal(r.status, "ready");
  assert.equal(r.canShowEstimate, true);
  assert.equal(r.canShowSafeHarbor, true);
});

test("missing year table blocks everything", () => {
  const r = assessTaxDataHealth({ ...healthy, hasTaxYearTable: false });
  assert.equal(r.status, "unsupported");
  assert.equal(r.canShowEstimate, false);
  assert.equal(r.canShowSafeHarbor, false);
});

test("unanswered questions → needs_profile", () => {
  const r = assessTaxDataHealth(withProfile({ filingStatus: null, qualifyingChildren: null, situation: { spouseHasIncome: null, investmentOrRentalIncome: false, itemizesDeductions: false } }));
  assert.equal(r.status, "needs_profile");
  assert.deepEqual(codes(r), ["missing_filing_status", "missing_children", "situation_unanswered"]);
  assert.equal(r.canShowSafeHarbor, false); // no filing status for the 110% rule
});

test("complex situation → no estimate, safe harbor still shown", () => {
  const r = assessTaxDataHealth(withProfile({ situation: { spouseHasIncome: false, investmentOrRentalIncome: true, itemizesDeductions: false } }));
  assert.equal(r.status, "unsupported");
  assert.equal(r.canShowEstimate, false);
  assert.equal(r.canShowSafeHarbor, true);
});

test("records starting in March look like missing income — unless the business started then", () => {
  const late = assessTaxDataHealth({ ...healthy, firstRecordDate: "2026-03-03" });
  assert.deepEqual(codes(late), ["missing_earlier_months"]);
  assert.match(late.issues[0].message, /Mar 3/);
  assert.equal(late.status, "needs_records");
  const started = assessTaxDataHealth({ ...withProfile({ businessStartDate: "2026-03-01" }), firstRecordDate: "2026-03-03" });
  assert.equal(started.status, "ready");
});

test("under two months of history → wait", () => {
  const r = assessTaxDataHealth({ ...withProfile({ businessStartDate: "2026-09-15" }), firstRecordDate: "2026-09-16" });
  assert.deepEqual(codes(r), ["too_little_history"]);
  assert.equal(r.canShowEstimate, false);
  const none = assessTaxDataHealth({ ...healthy, firstRecordDate: null });
  assert.deepEqual(codes(none), ["no_records"]);
});

test("a few unreviewed items warn; ten or more block", () => {
  const rough = assessTaxDataHealth({ ...healthy, pendingBankReviewCount: 3, uncategorizedExpenseCount: 1 });
  assert.equal(rough.status, "rough");
  assert.equal(rough.canShowEstimate, true);
  assert.equal(rough.issues[0].message, "Review 3 bank transactions for a better estimate.");
  assert.equal(rough.issues[1].message, "Categorize 1 expense for a better estimate.");
  const blocked = assessTaxDataHealth({ ...healthy, pendingImportCount: 12 });
  assert.equal(blocked.status, "needs_records");
  assert.equal(blocked.canShowEstimate, false);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
