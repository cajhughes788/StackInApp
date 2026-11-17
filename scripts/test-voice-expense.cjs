require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

// Voice expense: how a reply from the server fills the Add expense form
// (frontend/lib/voiceExpenseFill.ts) and the reply's shape (shared/voiceExpense.ts).
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
const { planExpenseFill, voiceExpenseCurrentFor, voiceExpenseHints } = require("../frontend/lib/voiceExpenseFill.ts");
const { VoiceExpenseResultSchema, VoiceExpenseRequestSchema, readSpokenCents } = require("../shared/voiceExpense.ts");

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

const VEHICLE = "Vehicle & Transportation";
const CATEGORIES = ["Supplies", "Equipment", "Marketing & Advertising", "Software & Subscriptions", VEHICLE, "Office Expenses", "Miscellaneous/ Other"];
const NO_VEHICLE = CATEGORIES.filter((c) => c !== VEHICLE);

const reply = (fields) => VoiceExpenseResultSchema.parse({
  isExpense: true,
  date: null,
  amount: null,
  vendor: null,
  description: null,
  category: null,
  categorySource: null,
  miles: null,
  parkingAndTolls: null,
  ...fields,
});

const ctx = (overrides = {}) => ({
  categories: CATEGORIES,
  vehicleCategory: VEHICLE,
  dateBounds: { start: "2026-11-01", end: "2026-11-30" },
  phoneLearned: () => undefined,
  recentCategories: [],
  fixing: false,
  ...overrides,
});

console.log("category order");

test("said beats a learned or phone category", () => {
  const plan = planExpenseFill(
    reply({ amount: 30, vendor: "Target", category: "Equipment", categorySource: "said" }),
    ctx({ phoneLearned: () => "Supplies" })
  );
  assert.equal(plan.category, "Equipment");
  assert.equal(plan.categorySource, "said");
  assert.equal(plan.questions.length, 0);
});

test("bank-learned (from the server) beats the phone", () => {
  const plan = planExpenseFill(
    reply({ amount: 30, vendor: "Sally Beauty", category: "Supplies", categorySource: "learned" }),
    ctx({ phoneLearned: () => "Equipment" })
  );
  assert.equal(plan.category, "Supplies");
  assert.equal(plan.categorySource, "learned");
});

test("phone-learned beats Claude's suggestion", () => {
  const plan = planExpenseFill(
    reply({ amount: 30, vendor: "Sally Beauty", category: "Office Expenses", categorySource: "suggested" }),
    ctx({ phoneLearned: (vendor) => (vendor === "Sally Beauty" ? "supplies" : undefined) })
  );
  assert.equal(plan.category, "Supplies", "uses the picker's own spelling");
  assert.equal(plan.categorySource, "learned");
});

test("a phone category that isn't offered anymore is ignored", () => {
  const plan = planExpenseFill(
    reply({ amount: 30, vendor: "Canva", category: "Software & Subscriptions", categorySource: "suggested" }),
    ctx({ phoneLearned: () => "Old Custom Category" })
  );
  assert.equal(plan.category, "Software & Subscriptions");
  assert.equal(plan.categorySource, "suggested");
});

test("nothing anyone can vouch for: asks, recent categories first, max 4, no vehicle", () => {
  const plan = planExpenseFill(
    reply({ amount: 64.5, vendor: "Target" }),
    ctx({ recentCategories: ["Office Expenses", VEHICLE, "Not a category", "Supplies"] })
  );
  assert.equal(plan.category, null);
  assert.equal(plan.questions.length, 1);
  const q = plan.questions[0];
  assert.equal(q.kind, "category");
  assert.equal(q.prompt, "Which category is Target?");
  assert.deepEqual(q.options.map((o) => o.category), ["Office Expenses", "Supplies", "Equipment", "Marketing & Advertising"]);
});

test("a category not in the list counts as none", () => {
  const plan = planExpenseFill(reply({ amount: 10, vendor: "X", category: "Made Up", categorySource: "suggested" }), ctx());
  assert.equal(plan.category, null);
  assert.equal(plan.categorySource, null);
  assert.equal(plan.questions[0].kind, "category");
});

console.log("mileage");

test("miles go to the vehicle category in mileage mode", () => {
  const plan = planExpenseFill(reply({ miles: 18, description: "Client visit" }), ctx());
  assert.equal(plan.category, VEHICLE);
  assert.equal(plan.vehicleMode, "mileage");
  assert.equal(plan.miles, 18);
  assert.equal(plan.amount, null);
});

test("each way asks: doubled or one way", () => {
  const plan = planExpenseFill(reply({ miles: 9, roundTrip: true }), ctx());
  assert.equal(plan.miles, null, "nothing filled until they pick");
  assert.equal(plan.vehicleMode, "mileage");
  const q = plan.questions.find((item) => item.kind === "miles");
  assert.ok(q);
  assert.deepEqual(q.options.map((o) => o.miles), [18, 9]);
  assert.equal(q.options[0].label, "18 miles (there and back)");
});

test("miles with mileage off: skipped with a note, nothing else asked", () => {
  const plan = planExpenseFill(
    reply({ miles: 12, vendor: null, description: "Drive to client" }),
    ctx({ categories: NO_VEHICLE, vehicleCategory: null })
  );
  assert.equal(plan.miles, null);
  assert.equal(plan.vehicleMode, null);
  assert.match(plan.skipped.join(" "), /Mileage isn't turned on/);
  assert.equal(plan.questions.length, 0, "no amount or vendor, so no category question");
});

test("gas plus miles: the amount is skipped because the rate covers it", () => {
  const plan = planExpenseFill(reply({ miles: 20, amount: 40, vendor: "Shell" }), ctx());
  assert.equal(plan.vehicleMode, "mileage");
  assert.equal(plan.amount, null);
  assert.equal(plan.miles, 20);
  assert.match(plan.skipped.join(" "), /\$40 wasn't added: the mileage rate/);
});

test("miles plus parking: parking stays in Parking & tolls", () => {
  const plan = planExpenseFill(reply({ miles: 14, parkingAndTolls: 12 }), ctx());
  assert.equal(plan.vehicleMode, "mileage");
  assert.equal(plan.parkingAndTolls, 12);
});

test("parking alone with vehicle on: mileage mode, Parking & tolls", () => {
  const plan = planExpenseFill(reply({ parkingAndTolls: 15, category: VEHICLE, categorySource: "said" }), ctx());
  assert.equal(plan.vehicleMode, "mileage");
  assert.equal(plan.parkingAndTolls, 15);
  assert.equal(plan.amount, null);
});

test("parking alone with mileage off: it's just the amount", () => {
  const plan = planExpenseFill(
    reply({ parkingAndTolls: 15, vendor: "SpotHero", category: "Miscellaneous/ Other", categorySource: "suggested" }),
    ctx({ categories: NO_VEHICLE, vehicleCategory: null })
  );
  assert.equal(plan.amount, 15);
  assert.equal(plan.parkingAndTolls, null);
});

test("gas at Shell with no miles: a direct vehicle expense", () => {
  const plan = planExpenseFill(reply({ amount: 42, vendor: "Shell", category: VEHICLE, categorySource: "suggested" }), ctx());
  assert.equal(plan.vehicleMode, "direct_expense");
  assert.equal(plan.amount, 42);
});

test("a direct vehicle expense with parking: parking gets a note", () => {
  const plan = planExpenseFill(reply({ amount: 42, parkingAndTolls: 8, category: VEHICLE, categorySource: "said" }), ctx());
  assert.equal(plan.vehicleMode, "direct_expense");
  assert.equal(plan.parkingAndTolls, null);
  assert.match(plan.skipped.join(" "), /\$8 for parking/);
});

console.log("dates and fixes");

test("a date outside the viewed month isn't used", () => {
  const plan = planExpenseFill(reply({ amount: 5, vendor: "A", category: "Supplies", categorySource: "said", date: "2026-10-30" }), ctx());
  assert.equal(plan.date, null);
  assert.match(plan.skipped[0], /outside the period/);
});

test("fix mode never asks about the category", () => {
  const plan = planExpenseFill(reply({ amount: 52 }), ctx({ fixing: true, currentCategory: "Supplies" }));
  assert.equal(plan.amount, 52);
  assert.equal(plan.category, null);
  assert.equal(plan.questions.length, 0);
});

test("a category already picked by hand isn't asked again", () => {
  const plan = planExpenseFill(reply({ amount: 20, vendor: "Target" }), ctx({ currentCategory: "supplies" }));
  assert.equal(plan.category, null, "the form keeps its own");
  assert.equal(plan.questions.length, 0);
});

test("fix of the amount on a mileage form: amount skipped, mode kept", () => {
  const plan = planExpenseFill(reply({ amount: 52 }), ctx({ fixing: true, currentCategory: VEHICLE, currentVehicleMode: "mileage" }));
  assert.equal(plan.vehicleMode, "mileage");
  assert.equal(plan.amount, null);
});

test("fix of the vendor on a vehicle form keeps its mode", () => {
  const plan = planExpenseFill(reply({ vendor: "Chevron" }), ctx({ fixing: true, currentCategory: VEHICLE, currentVehicleMode: "direct_expense" }));
  assert.equal(plan.vehicleMode, "direct_expense");
  assert.equal(plan.vendor, "Chevron");
});

test("voiceExpenseCurrentFor: today's date and blanks are null, numbers rounded", () => {
  const current = voiceExpenseCurrentFor({
    date: "2026-11-16",
    today: "2026-11-16",
    account: "Supplies",
    amount: "42.499",
    vendor: "  Shell ",
    description: "",
    miles: "0",
    parkingAndTolls: "abc",
  });
  assert.deepEqual(current, {
    date: null,
    amount: 42.5,
    vendor: "Shell",
    description: null,
    category: "Supplies",
    miles: null,
    parkingAndTolls: null,
  });
  const other = voiceExpenseCurrentFor({ date: "2026-11-14", today: "2026-11-16", account: "", amount: "", vendor: "", description: "Gas", miles: "18", parkingAndTolls: "" });
  assert.equal(other.date, "2026-11-14");
  assert.equal(other.category, null);
  assert.equal(other.miles, 18);
});

test("hints include vendors, short categories and trip words, capped at 100", () => {
  const vendors = Array.from({ length: 200 }, (_, i) => `Vendor ${i}`);
  const hints = voiceExpenseHints(vendors, ["Supplies", "A category name that is far too long to hint"]);
  assert.ok(hints.includes("each way"));
  assert.ok(hints.includes("Supplies"));
  assert.ok(!hints.includes("A category name that is far too long to hint"));
  assert.ok(hints.length <= 100);
});

test("request schema needs kind expense and at least one category", () => {
  const base = { kind: "expense", transcript: "42 at Shell", today: "2026-11-16", workspaceId: "w1", categories: ["Supplies"], vehicleCategory: null };
  assert.ok(VoiceExpenseRequestSchema.safeParse(base).success);
  assert.ok(!VoiceExpenseRequestSchema.safeParse({ ...base, categories: [] }).success);
  assert.ok(!VoiceExpenseRequestSchema.safeParse({ ...base, kind: "entry" }).success);
});

console.log("spoken dollars and cents");

test("a bare four-digit amount is dollars and cents", () => {
  assert.deepEqual(readSpokenCents("9121 for supplies at Winco foods", 9121), { amount: 91.21, amountAsWhole: 9121 });
  assert.deepEqual(readSpokenCents("spent 4599 at Target.", 4599), { amount: 45.99, amountAsWhole: 4599 });
  assert.deepEqual(readSpokenCents("make that 1250", 1250), { amount: 12.5, amountAsWhole: 1250 });
});

test("what people say as written stays as it is", () => {
  const whole = (transcript, amount) => assert.deepEqual(readSpokenCents(transcript, amount), { amount, amountAsWhole: null }, transcript);
  whole("1200 for a new chair", 1200); // "twelve hundred"
  whole("120 at Home Depot", 120); // three digits = whole dollars
  whole("$9121 for a laptop", 9121);
  whole("9,121 for a laptop", 9121);
  whole("9121 dollars for a laptop", 9121);
  whole("9121 bucks", 9121);
  whole("42 at Shell", 42);
  whole("1.2k for a chair", 1200);
});

test("only when the amount is that number in the words", () => {
  assert.deepEqual(readSpokenCents("paid 91.21 at Winco", 91.21), { amount: 91.21, amountAsWhole: null });
  assert.deepEqual(readSpokenCents("drove 1150 miles and spent 1234", 1234), { amount: 12.34, amountAsWhole: 1234 });
  assert.deepEqual(readSpokenCents("order 1234, paid 56", 56), { amount: 56, amountAsWhole: null });
  assert.deepEqual(readSpokenCents("anything", null), { amount: null, amountAsWhole: null });
});

test("the plan carries the whole reading only with an amount", () => {
  const plan = planExpenseFill(reply({ amount: 91.21, amountAsWhole: 9121, vendor: "WinCo", category: "Supplies", categorySource: "said" }), ctx());
  assert.equal(plan.amountAsWhole, 9121);
  const miles = planExpenseFill(reply({ amount: 91.21, amountAsWhole: 9121, miles: 10 }), ctx());
  assert.equal(miles.amount, null);
  assert.equal(miles.amountAsWhole, null);
});

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
