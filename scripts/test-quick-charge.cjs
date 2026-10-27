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

console.log("pay later");

const { invoiceRemindersApply } = require("../shared/invoiceReminders.ts");
const { payLaterBlocker, quickChargeAsInvoice } = require("../shared/quickCharge.ts");
const { InvoiceStatusActionSchema } = require("../shared/schemas/invoice.ts");

const details = {
  clientName: "Jane Doe",
  clientId: "c1",
  clientEmail: "jane@example.com",
  clientPhone: null,
  dueDate: "2026-11-03",
  defaultNote: "Venmo @freshcuts",
  defaultPolicies: "48 hours' notice",
  nowIso: "2026-10-27T18:00:00Z",
};

test("an unpaid quick charge never gets reminders, even with an email and overdue", () => {
  const charge = quickCharge({ clientEmail: "jane@example.com", sharedAt: "2026-10-20T00:00:00Z", dueDate: "2026-10-20", issueDate: "2026-10-20" });
  assert.equal(invoiceRemindersApply(charge), false);
});

test("turned into an invoice: same number, link and line; who, when, note and policies filled", () => {
  const charge = quickCharge({ openCheckout: { sessionId: "cs_1", purpose: "full", amountCents: 4500, tipCents: 0 } });
  const invoice = InvoiceSchema.parse(quickChargeAsInvoice(charge, details));
  assert.equal(invoice.quickCharge, null);
  assert.equal(invoice.number, charge.number);
  assert.equal(invoice.shareToken, charge.shareToken);
  assert.deepEqual(invoice.lines, charge.lines);
  assert.equal(invoice.clientName, "Jane Doe");
  assert.equal(invoice.clientId, "c1");
  assert.equal(invoice.clientEmail, "jane@example.com");
  assert.equal(invoice.dueDate, "2026-11-03");
  assert.equal(invoice.note, "Venmo @freshcuts");
  assert.equal(invoice.policies, "48 hours' notice");
  assert.equal(invoice.openCheckout, null);
});

test("once it's an invoice, reminders apply when it's late", () => {
  const invoice = InvoiceSchema.parse(
    quickChargeAsInvoice(quickCharge({ sharedAt: "2026-10-27T17:00:00Z" }), { ...details, dueDate: "2026-10-27" })
  );
  assert.equal(invoiceRemindersApply(invoice), true);
});

test("only an unpaid charge, due today or later, can be turned into an invoice", () => {
  assert.equal(payLaterBlocker(quickCharge(), "2026-11-03"), null);
  assert.match(payLaterBlocker(quickCharge(), "2026-10-26"), /before today/);
  assert.match(payLaterBlocker(quickCharge({ status: "void" }), "2026-11-03"), /unpaid/);
});

test("the pay-later request needs a name and a real date", () => {
  const ok = InvoiceStatusActionSchema.safeParse({ action: "convert_to_invoice", clientName: "Jane", dueDate: "2026-11-03" });
  assert.equal(ok.success, true);
  assert.equal(InvoiceStatusActionSchema.safeParse({ action: "convert_to_invoice", clientName: " ", dueDate: "2026-11-03" }).success, false);
  assert.equal(InvoiceStatusActionSchema.safeParse({ action: "convert_to_invoice", clientName: "Jane", dueDate: "Nov 3" }).success, false);
  assert.equal(InvoiceStatusActionSchema.safeParse({ action: "convert_to_invoice", clientName: "Jane", clientEmail: "nope", dueDate: "2026-11-03" }).success, false);
});

if (failures > 0) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall passed");
