require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const { normalizeAppPayerKey } = require("../shared/plaidClassification.ts");
const { applyPayerDecision, payerMemoryEffect } = require("../shared/payerMemory.ts");
const { PayerMemorySchema } = require("../shared/schemas/payerMemory.ts");
const { ImportItemPatchSchema, ImportItemSchema } = require("../shared/schemas/import.ts");

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

function decide(existing, outcome, extra = {}) {
  return applyPayerDecision(existing, {
    workspaceId: "ws1",
    payerKey: "venmo:jane doe",
    displayName: "Jane Doe",
    source: "venmo_csv",
    outcome,
    incomeCategory: outcome === "business" ? "services" : null,
    nowIso: "2026-10-26T12:00:00.000Z",
    ...extra,
  });
}

console.log("payer key");

test("name variants of one person share a key", () => {
  const key = "venmo:jane doe";
  for (const name of ["Jane Doe", "jane doe", "  Jane   Doe ", "@Jane Doe", "Jane Doe 💇‍♀️", "💅 JANE DOE 👍🏽"]) {
    assert.equal(normalizeAppPayerKey("venmo_csv", name), key, name);
  }
});

test("prefixed by source", () => {
  assert.equal(normalizeAppPayerKey("cash_app_csv", "Jane Doe"), "cash_app:jane doe");
});

test("different people stay different", () => {
  assert.notEqual(normalizeAppPayerKey("venmo_csv", "Jane Doe"), normalizeAppPayerKey("venmo_csv", "Jane Do"));
});

test("no key without a usable name or for non-app sources", () => {
  assert.equal(normalizeAppPayerKey("venmo_csv", ""), null);
  assert.equal(normalizeAppPayerKey("venmo_csv", null), null);
  assert.equal(normalizeAppPayerKey("venmo_csv", "💇 @ "), null);
  assert.equal(normalizeAppPayerKey("square_csv", "Jane Doe"), null);
  assert.equal(normalizeAppPayerKey("bank_csv", "Jane Doe"), null);
});

test("slashes can't break the Firestore doc id", () => {
  assert.equal(normalizeAppPayerKey("venmo_csv", "Jane/Doe"), "venmo:jane doe");
});

console.log("decisions");

test("first decision creates a valid memory", () => {
  const { memory, suggestAlwaysPersonal } = decide(null, "business");
  PayerMemorySchema.parse(memory);
  assert.equal(memory.lastOutcome, "business");
  assert.equal(memory.incomeCategory, "services");
  assert.equal(memory.businessCount, 1);
  assert.equal(memory.mode, "ask_every_time");
  assert.equal(suggestAlwaysPersonal, false);
});

test("'always personal?' is offered on the 2nd personal decision, once ever", () => {
  const first = decide(null, "personal");
  assert.equal(first.suggestAlwaysPersonal, false);
  const second = decide(first.memory, "personal");
  assert.equal(second.suggestAlwaysPersonal, true);
  assert.ok(second.memory.suggestedAlwaysPersonalAt);
  const third = decide(second.memory, "personal");
  assert.equal(third.suggestAlwaysPersonal, false);
});

test("business decisions never suggest anything", () => {
  let m = null;
  for (let i = 0; i < 4; i++) {
    const r = decide(m, "business");
    assert.equal(r.suggestAlwaysPersonal, false);
    m = r.memory;
  }
  assert.equal(m.mode, "ask_every_time");
});

test("a personal decision keeps the last business category", () => {
  const biz = decide(null, "business").memory;
  const per = decide(biz, "personal").memory;
  assert.equal(per.incomeCategory, "services");
  assert.equal(per.lastOutcome, "personal");
});

test("saving an always-personal payer as business switches them back to asking", () => {
  const m = { ...decide(null, "personal").memory, mode: "always_personal" };
  assert.equal(decide(m, "business").memory.mode, "ask_every_time");
});

test("marking an always-business payer personal switches them back to asking", () => {
  const m = { ...decide(null, "business").memory, mode: "always_business" };
  assert.equal(decide(m, "personal").memory.mode, "ask_every_time");
});

console.log("on import");

test("no memory -> nothing happens", () => {
  assert.deepEqual(payerMemoryEffect(null), { action: "none" });
});

test("always personal -> sorted as personal", () => {
  const m = { ...decide(null, "personal").memory, mode: "always_personal" };
  assert.deepEqual(payerMemoryEffect(m), { action: "sort_personal" });
});

test("always business -> pre-filled, never auto-saved", () => {
  const m = { ...decide(null, "business").memory, mode: "always_business" };
  assert.deepEqual(payerMemoryEffect(m), { action: "prefill_business", incomeCategory: "services" });
});

test("ask every time -> hint only", () => {
  assert.deepEqual(payerMemoryEffect(decide(null, "business").memory), {
    action: "hint", lastOutcome: "business", incomeCategory: "services",
  });
  assert.deepEqual(payerMemoryEffect(decide(null, "personal").memory), {
    action: "hint", lastOutcome: "personal", incomeCategory: null,
  });
});

console.log("import schemas");

test("item patch accepts rememberPayer and payerMemory", () => {
  const parsed = ImportItemPatchSchema.parse({
    status: "rejected",
    rememberPayer: true,
    payerMemory: { applied: null, lastOutcome: "personal", incomeCategory: null },
  });
  assert.equal(parsed.rememberPayer, true);
});

test("rememberPayer is never stored on an item", () => {
  const item = ImportItemSchema.parse({
    id: "i1", workspaceId: "ws1", batchId: "b1", importedAt: "x", source: "venmo_csv",
    createdAt: "x", updatedAt: "x", version: 1, rememberPayer: true,
  });
  assert.equal("rememberPayer" in item, false);
});

if (failures > 0) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall passed");
