require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const {
  InvoiceSchema,
  InvoiceSettingsSchema,
  QuickChargeInputSchema,
  WALK_IN_CLIENT_NAME,
} = require("../shared/schemas/invoice.ts");
const { invoiceCheckoutAmounts, invoiceOffersTip } = require("../shared/invoicePayments.ts");
const { renderPublicInvoicePage } = require("../shared/invoicePublicPage.ts");
const { buildClientRows } = require("../shared/clients.ts");

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

function quickCharge(extra = {}) {
  return InvoiceSchema.parse({
    id: "cmid_abc",
    workspaceId: "ws",
    number: "0013",
    clientName: WALK_IN_CLIENT_NAME,
    lines: [{ description: "Fade + beard", quantity: 1, rate: 45, amount: 45, category: "services" }],
    total: 45,
    issueDate: "2026-10-27",
    dueDate: "2026-10-27",
    status: "sent",
    shareToken: "tok",
    quickCharge: { askForTip: true },
    createdAt: "2026-10-27T17:00:00Z",
    updatedAt: "2026-10-27T17:00:00Z",
    ...extra,
  });
}

const settings = InvoiceSettingsSchema.parse({ businessName: "Fresh Cuts", offerTips: false });
const page = (invoice, options = { payPath: "/i/tok/pay" }) => renderPublicInvoicePage(invoice, settings, "2026-10-27", options);

console.log("quick charge input");

test("amount: $0.50 minimum, whole cents", () => {
  const base = { date: "2026-10-27", clientMutationId: "abc123" };
  assert.equal(QuickChargeInputSchema.safeParse({ ...base, amount: 0.49 }).success, false);
  assert.equal(QuickChargeInputSchema.safeParse({ ...base, amount: 12.345 }).success, false);
  assert.equal(QuickChargeInputSchema.safeParse({ ...base, amount: 0.5 }).success, true);
});

test("tip is asked for by default; name and description are optional", () => {
  const parsed = QuickChargeInputSchema.parse({ amount: 45, date: "2026-10-27", clientMutationId: "abc123" });
  assert.equal(parsed.askForTip, true);
  assert.equal(parsed.clientName, undefined);
  assert.equal(parsed.description, undefined);
});

test("a retry-safe id and a real date are required", () => {
  assert.equal(QuickChargeInputSchema.safeParse({ amount: 45, date: "2026-10-27" }).success, false);
  assert.equal(QuickChargeInputSchema.safeParse({ amount: 45, date: "10/27/2026", clientMutationId: "a" }).success, false);
});

console.log("tips");

test("a quick charge's own switch beats the invoice setting", () => {
  assert.equal(invoiceOffersTip(quickCharge(), false), true);
  assert.equal(invoiceOffersTip(quickCharge({ quickCharge: { askForTip: false } }), true), false);
  assert.equal(invoiceOffersTip({ quickCharge: null }, true), true);
});

test("checkout adds a 20% tip only when the charge asks for one", () => {
  const withTip = invoiceCheckoutAmounts(quickCharge(), { tip: "20" }, invoiceOffersTip(quickCharge(), false));
  assert.deepEqual(withTip, { purpose: "full", amountCents: 4500, tipCents: 900 });
  const noTipCharge = quickCharge({ quickCharge: { askForTip: false } });
  const noTip = invoiceCheckoutAmounts(noTipCharge, { tip: "20" }, invoiceOffersTip(noTipCharge, true));
  assert.equal(noTip.tipCents, 0);
});

console.log("pay page");

test("short pay screen: business, what for, amount, tip, Pay — no invoice parts", () => {
  const html = page(quickCharge());
  assert.match(html, /Fresh Cuts/);
  assert.match(html, /Fade \+ beard/);
  assert.match(html, /\$45\.00/);
  assert.match(html, /type="radio" name="tip"/);
  assert.match(html, /Card, Apple Pay or Google Pay/);
  assert.doesNotMatch(html, /Invoice #/);
  assert.doesNotMatch(html, /class="label">Billed to/);
  assert.doesNotMatch(html, /Policies/);
  assert.doesNotMatch(html, /bank account/);
});

test("no tip picker when the charge doesn't ask", () => {
  assert.doesNotMatch(page(quickCharge({ quickCharge: { askForTip: false } })), /type="radio" name="tip"/);
});

test("canceled and paid charges show no Pay button", () => {
  const voided = page(quickCharge({ status: "void" }));
  assert.match(voided, /This charge was canceled/);
  assert.doesNotMatch(voided, /id="paybtn"/);
  assert.doesNotMatch(page(quickCharge(), { payPath: null }), /id="paybtn"/);
});

test("regular invoices keep the full invoice page", () => {
  const regular = quickCharge({ quickCharge: null, clientName: "Jane Doe" });
  assert.match(page(regular), /Invoice #0013/);
});

console.log("clients");

test("a walk-in quick charge belongs to no client; a named one does", () => {
  const client = {
    id: "c1", workspaceId: "ws", name: "Jane Doe", nameKey: "jane doe", email: null, phone: null, address: null,
    notes: "", aliases: [], archived: false, createdAt: "x", updatedAt: "x",
  };
  const rows = buildClientRows([client], {}, [
    quickCharge(),
    quickCharge({ id: "q2", clientName: "Jane Doe", clientId: "c1" }),
  ], "2026-10-27");
  assert.deepEqual(rows.map((r) => [r.name, r.invoices.length]), [["Jane Doe", 1]]);
});

if (failures > 0) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall passed");
