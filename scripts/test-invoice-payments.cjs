require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

const assert = require("node:assert/strict");

const { InvoiceSchema } = require("../shared/schemas/invoice.ts");
const {
  entryPaymentMethodFor,
  invoiceLedgerFields,
  invoicePaymentEntryMutationId,
  invoicePaymentPurposeFor,
  invoiceRefundTarget,
  invoiceWithPayments,
  refundCentsByCategory,
  invoiceAmountPaid,
  invoiceBalanceDue,
  invoiceDueNow,
  invoicePaymentOptions,
  invoicePaymentBreakdown,
  invoicePaymentCustomIncome,
  invoicePaymentRefundable,
  invoiceLatestPayment,
  splitAcrossCategories,
} = require("../shared/invoicePayments.ts");
const { invoiceDisplayStatus } = require("../shared/invoiceDisplay.ts");
const {
  InvoiceCreateInputSchema,
  InvoicePatchSchema,
  InvoiceSettingsSchema,
  InvoiceStatusActionSchema,
} = require("../shared/schemas/invoice.ts");
const { renderPublicInvoicePage } = require("../shared/invoicePublicPage.ts");
const { buildInvoiceEmail } = require("../shared/invoiceEmail.ts");

function run(name, fn) {
  fn();
  process.stdout.write(`ok - ${name}\n`);
}

function payment(id, amount, extra = {}) {
  return { id, purpose: "partial", amount, tipAmount: 0, receivedOn: "2026-10-05", via: "manual", method: "zelle", entryId: `e_${id}`, plaidTransactionId: null, stripePaymentIntentId: null, checkoutSessionId: null, feeAmount: 0, createdAt: "x", ...extra };
}

// A stored invoice doc: open, no payments yet.
function doc(overrides = {}) {
  return {
    id: "inv1",
    workspaceId: "w1",
    number: "0012",
    clientName: "Acme",
    lines: [
      { description: "Sleeve", amount: 600, category: "services" },
      { description: "Aftercare kit", amount: 200, category: "products" },
    ],
    total: 800,
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
    status: "sent",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

/* --------------------------------------------------------
 * Schema rules — payments are the source of truth
 * -------------------------------------------------------- */

run("an invoice with no payments parses with an empty ledger", () => {
  const invoice = InvoiceSchema.parse(doc());
  assert.deepEqual(invoice.payments, []);
  assert.equal(invoice.amountPaid, 0);
  assert.equal(invoice.pendingPayment, null);
  assert.equal(invoice.openCheckout, null);
});

run("the old single-payment fields are gone", () => {
  const invoice = InvoiceSchema.parse(doc({ paidAt: "2026-10-10T12:00:00.000Z", paidVia: "manual", paidEntryId: "e1" }));
  assert.equal("paidAt" in invoice, false);
  assert.equal("paidVia" in invoice, false);
  assert.equal("paidEntryId" in invoice, false);
});

run("ledger fields must match the payments", () => {
  const withPayment = invoiceWithPayments(InvoiceSchema.parse(doc()), [payment("a", 100)]);
  assert.equal(InvoiceSchema.safeParse(withPayment).success, true);
  assert.equal(InvoiceSchema.safeParse({ ...withPayment, amountPaid: 50 }).success, false);
  assert.equal(InvoiceSchema.safeParse({ ...withPayment, paymentEntryIds: [] }).success, false);
});

run("status has to agree with the money", () => {
  const open = InvoiceSchema.parse(doc());
  const full = invoiceWithPayments(open, [payment("a", 800)]);
  assert.equal(InvoiceSchema.safeParse(full).success, true);
  assert.equal(InvoiceSchema.safeParse({ ...full, status: "sent" }).success, false);
  const part = invoiceWithPayments(open, [payment("a", 100)]);
  assert.equal(InvoiceSchema.safeParse({ ...part, status: "paid" }).success, false);
  assert.equal(InvoiceSchema.safeParse({ ...part, status: "void" }).success, false);
  assert.equal(InvoiceSchema.safeParse({ ...part, status: "draft" }).success, false);
  assert.equal(InvoiceSchema.safeParse({ ...part, status: "closed", closedAt: "x" }).success, true);
});

run("payments can't exceed the total or repeat an id", () => {
  const open = InvoiceSchema.parse(doc());
  assert.equal(InvoiceSchema.safeParse(invoiceWithPayments(open, [payment("a", 500), payment("b", 400)])).success, false);
  assert.equal(InvoiceSchema.safeParse(invoiceWithPayments(open, [payment("a", 100), payment("a", 100)])).success, false);
});

run("a deposit must be less than the total", () => {
  assert.equal(InvoiceSchema.safeParse(doc({ deposit: { amount: 100, dueDate: "2026-10-08" } })).success, true);
  assert.equal(InvoiceSchema.safeParse(doc({ deposit: { amount: 800, dueDate: "2026-10-08" } })).success, false);
});

/* --------------------------------------------------------
 * Ledger operations
 * -------------------------------------------------------- */

run("applying payments moves the status with the money", () => {
  const open = InvoiceSchema.parse(doc());
  const part = invoiceWithPayments(open, [payment("a", 100)]);
  assert.equal(part.status, "sent");
  assert.equal(part.amountPaid, 100);
  assert.deepEqual(part.paymentEntryIds, ["e_a"]);
  const paid = invoiceWithPayments(part, [...part.payments, payment("b", 700)]);
  assert.equal(paid.status, "paid");
  // Taking a payment off reopens it.
  assert.equal(invoiceWithPayments(paid, [paid.payments[0]]).status, "sent");
  // A draft that's paid in full is paid; partly paid, it's open.
  assert.equal(invoiceWithPayments({ ...open, status: "draft" }, [payment("a", 800)]).status, "paid");
  assert.equal(invoiceWithPayments({ ...open, status: "draft" }, [payment("a", 80)]).status, "sent");
});

run("a closed invoice stays closed while it keeps a payment", () => {
  const closed = { ...invoiceWithPayments(InvoiceSchema.parse(doc()), [payment("d", 100)]), status: "closed", closedAt: "x" };
  assert.equal(invoiceWithPayments(closed, closed.payments).status, "closed");
  assert.equal(invoiceWithPayments(closed, []).status, "sent");
});

run("settling an invoice drops its open Checkout", () => {
  const open = { ...InvoiceSchema.parse(doc()), openCheckout: { sessionId: "cs", purpose: "full", amountCents: 80000, tipCents: 0 } };
  assert.equal(invoiceWithPayments(open, [payment("a", 100)]).openCheckout.sessionId, "cs");
  assert.equal(invoiceWithPayments(open, [payment("a", 800)]).openCheckout, null);
});

run("index fields follow each payment's links", () => {
  const ledger = invoiceLedgerFields([
    payment("m1", 100, { receivedOn: "2026-10-03" }),
    payment("b1", 200, { via: "bank_match", plaidTransactionId: "txn_1" }),
    payment("s1", 300, { via: "online", stripePaymentIntentId: "pi_1", entryId: null }),
    payment("m2", 50, { receivedOn: "2026-10-09" }),
  ]);
  assert.equal(ledger.amountPaid, 650);
  assert.deepEqual(ledger.paymentEntryIds, ["e_m1", "e_b1", "e_m2"]);
  assert.deepEqual(ledger.paymentPlaidTransactionIds, ["txn_1"]);
  assert.deepEqual(ledger.paymentIntentIds, ["pi_1"]);
  assert.equal(ledger.lastManualPaymentOn, "2026-10-09");
});

run("a payment's purpose is judged before it's applied", () => {
  const open = InvoiceSchema.parse(doc());
  assert.equal(invoicePaymentPurposeFor(open, 800), "full");
  assert.equal(invoicePaymentPurposeFor(open, 300), "partial");
  const withDeposit = { ...open, deposit: { amount: 100, dueDate: "2026-10-08", waivedAt: null } };
  assert.equal(invoicePaymentPurposeFor(withDeposit, 100), "deposit");
  assert.equal(invoicePaymentPurposeFor(withDeposit, 800), "full");
  const afterDeposit = invoiceWithPayments(withDeposit, [payment("d", 100, { purpose: "deposit" })]);
  assert.equal(invoicePaymentPurposeFor(afterDeposit, 700), "balance");
  assert.equal(invoicePaymentPurposeFor(afterDeposit, 100), "partial");
});

run("a check is booked as Other income; everything else keeps its method", () => {
  assert.equal(entryPaymentMethodFor("check"), "other");
  assert.equal(entryPaymentMethodFor("zelle"), "zelle");
  assert.equal(entryPaymentMethodFor("pos"), "pos");
});

run("each payment's Entry has its own retry-safe key", () => {
  assert.equal(invoicePaymentEntryMutationId("inv1", "manual_abc"), "invoice_inv1_manual_abc");
});

/* --------------------------------------------------------
 * Ledger helpers (deposits and partial payments are pure
 * functions here; phases 2–5 start writing them)
 * -------------------------------------------------------- */

// A parsed open invoice with ledger fields set directly — the shape later
// phases write.
function ledger(overrides = {}) {
  return { ...InvoiceSchema.parse(doc()), ...overrides };
}


run("balance and amount paid follow the payments", () => {
  const invoice = ledger({ payments: [payment("a", 100), payment("b", 250.5)] });
  assert.equal(invoiceAmountPaid(invoice), 350.5);
  assert.equal(invoiceBalanceDue(invoice), 449.5);
  assert.equal(invoiceLatestPayment(invoice).id, "b");
  assert.equal(invoiceDisplayStatus(invoice, "2026-10-20").label, "Partly paid · $449.50 due");
  assert.equal(invoiceDisplayStatus(invoice, "2026-11-01").tone, "overdue");
});

run("due now: the deposit until it's covered, then the balance", () => {
  const deposit = { amount: 100, dueDate: "2026-10-08", waivedAt: null };
  assert.deepEqual(invoiceDueNow(ledger({ deposit })), { purpose: "deposit", amount: 100, dueDate: "2026-10-08" });
  assert.deepEqual(invoiceDueNow(ledger({ deposit, payments: [payment("d", 100)] })), {
    purpose: "balance",
    amount: 700,
    dueDate: "2026-10-31",
  });
  // A waived deposit: the whole amount by the final due date.
  assert.deepEqual(invoiceDueNow(ledger({ deposit: { ...deposit, waivedAt: "x" } })), {
    purpose: "balance",
    amount: 800,
    dueDate: "2026-10-31",
  });
  assert.equal(invoiceDueNow(ledger({ status: "paid", payments: [payment("f", 800)] })), null);
});

run("payment options: deposit or everything, then the balance", () => {
  const deposit = { amount: 100, dueDate: "2026-10-08", waivedAt: null };
  assert.deepEqual(invoicePaymentOptions(ledger({ deposit })), [
    { purpose: "deposit", amount: 100 },
    { purpose: "full", amount: 800 },
  ]);
  assert.deepEqual(invoicePaymentOptions(ledger({ deposit, payments: [payment("d", 100)] })), [{ purpose: "balance", amount: 700 }]);
  assert.deepEqual(invoicePaymentOptions(ledger()), [{ purpose: "full", amount: 800 }]);
  // Nothing while a bank transfer clears, or once it's not open.
  assert.deepEqual(
    invoicePaymentOptions(ledger({ pendingPayment: { checkoutSessionId: "cs", purpose: "full", amount: 800, tipAmount: 0, startedAt: "x" } })),
    []
  );
  assert.deepEqual(invoicePaymentOptions(ledger({ status: "void" })), []);
});

run("a payment splits across the invoice's categories, tip on tips", () => {
  const lines = doc().lines; // services 600, products 200
  assert.deepEqual(invoicePaymentBreakdown(lines, 800, 0, "zelle"), { paymentMethod: "zelle", services: 600, products: 200 });
  assert.deepEqual(invoicePaymentBreakdown(lines, 100, 0, "zelle"), { paymentMethod: "zelle", services: 75, products: 25 });
  assert.deepEqual(invoicePaymentBreakdown(lines, 700, 140, "pos"), { paymentMethod: "pos", services: 525, products: 175, tips: 140 });
  // Odd cents land on the last category so the parts add up exactly.
  const parts = splitAcrossCategories(lines, 1001);
  assert.equal(parts.reduce((sum, [, cents]) => sum + cents, 0), 1001);
});

run("named custom income mirrors the breakdown for Other money", () => {
  assert.deepEqual(invoicePaymentCustomIncome(doc().lines, 100, 20, "Acme"), [
    { label: "Acme", amount: 75, category: "services" },
    { label: "Acme", amount: 25, category: "products" },
    { label: "Acme", amount: 20, category: "tips" },
  ]);
});

run("refundable per payment includes its tip, less its own refunds", () => {
  const invoice = ledger({
    status: "paid",
    payments: [payment("d", 100), payment("b", 700, { tipAmount: 140 })],
    refunds: [{ id: "r1", entryId: "re1", amount: 40, date: "2026-10-20", reason: "other", stripeRefundId: null, plaidTransactionId: null, paymentId: "b" }],
  });
  assert.equal(invoicePaymentRefundable(invoice, "d"), 100);
  assert.equal(invoicePaymentRefundable(invoice, "b"), 800);
  assert.equal(invoicePaymentRefundable(invoice, "missing"), 0);
});

run("refunds come off the latest payment with anything left", () => {
  const invoice = ledger({
    status: "paid",
    payments: [payment("d", 100), payment("b", 700)],
    refunds: [{ id: "r1", entryId: "re1", amount: 700, date: "2026-10-20", reason: "other", stripeRefundId: null, plaidTransactionId: null, paymentId: "b" }],
  });
  assert.equal(invoiceRefundTarget(invoice).id, "d");
  assert.equal(invoiceRefundTarget({ ...invoice, payments: [payment("b", 700)] }), null);
});

run("a dispute holds only the payment it's on", () => {
  const invoice = ledger({
    status: "paid",
    payments: [payment("d", 100), payment("s", 700, { via: "online", stripePaymentIntentId: "pi" })],
    dispute: { stripeDisputeId: "dp", status: "open", amount: 700, reason: null, evidenceDueBy: null, fundsWithdrawn: true, feeAmount: 15, paymentId: "s", updatedAt: "x" },
  });
  assert.equal(invoicePaymentRefundable(invoice, "s"), 0);
  assert.equal(invoicePaymentRefundable(invoice, "d"), 100);
});

run("a refund splits over the payment's own categories, tip included", () => {
  const lines = doc().lines; // services 600, products 200
  // $700 balance + $140 tip → services 525, products 175, tips 140 (840 total).
  const parts = refundCentsByCategory(lines, { amount: 700, tipAmount: 140 }, 8400);
  assert.deepEqual(parts, [["services", 5250], ["products", 1750], ["tips", 1400]]);
  const odd = refundCentsByCategory(lines, { amount: 700, tipAmount: 140 }, 1001);
  assert.equal(odd.reduce((sum, [, cents]) => sum + cents, 0), 1001);
});

/* --------------------------------------------------------
 * Deposits (phase 3)
 * -------------------------------------------------------- */

const createBase = {
  clientName: "Jordan",
  lines: [{ description: "Forearm piece", amount: 800, category: "services" }],
  issueDate: "2026-10-01",
  dueDate: "2026-10-31",
};

run("a deposit on create has to fit the invoice", () => {
  const ok = (deposit) => InvoiceCreateInputSchema.safeParse({ ...createBase, deposit }).success;
  assert.equal(ok({ amount: 100, dueDate: "2026-10-08" }), true);
  assert.equal(ok(null), true);
  assert.equal(ok({ amount: 800, dueDate: "2026-10-08" }), false); // not less than the total
  assert.equal(ok({ amount: 100, dueDate: "2026-09-30" }), false); // before the invoice date
  assert.equal(ok({ amount: 100, dueDate: "2026-11-01" }), false); // after the due date
  assert.equal(ok({ amount: 10.005, dueDate: "2026-10-08" }), false);
  // A patch is checked against whatever it carries.
  assert.equal(InvoicePatchSchema.safeParse({ deposit: { amount: 100, dueDate: "2026-10-08" } }).success, true);
  assert.equal(InvoicePatchSchema.safeParse({ deposit: null }).success, true);
  assert.equal(InvoicePatchSchema.safeParse({ dueDate: "2026-10-05", deposit: { amount: 100, dueDate: "2026-10-08" } }).success, false);
});

run("the stored invoice keeps its deposit inside its dates", () => {
  assert.equal(InvoiceSchema.safeParse(doc({ deposit: { amount: 100, dueDate: "2026-11-05" } })).success, false);
  assert.equal(InvoiceSchema.safeParse(doc({ deposit: { amount: 100, dueDate: "2026-09-30" } })).success, false);
});

run("waive_deposit is an action; settings carry a default deposit", () => {
  assert.equal(InvoiceStatusActionSchema.safeParse({ action: "waive_deposit" }).success, true);
  assert.deepEqual(InvoiceSettingsSchema.parse({}).defaultDeposit, { type: "none", value: 0, dueInDays: 7 });
  assert.equal(InvoiceSettingsSchema.safeParse({ defaultDeposit: { type: "percent", value: 25, dueInDays: 7 } }).success, true);
  assert.equal(InvoiceSettingsSchema.safeParse({ defaultDeposit: { type: "percent", value: 100, dueInDays: 7 } }).success, false);
});

run("status reads the deposit first, then the balance", () => {
  const deposit = { amount: 100, dueDate: "2026-10-08", waivedAt: null };
  const open = InvoiceSchema.parse(doc({ deposit }));
  assert.equal(invoiceDisplayStatus(open, "2026-10-05").label, "Deposit $100.00 due Oct 8, 2026");
  assert.equal(invoiceDisplayStatus(open, "2026-10-08").label, "Deposit $100.00 due today");
  assert.deepEqual(invoiceDisplayStatus(open, "2026-10-09"), { label: "Deposit overdue since Oct 8, 2026", tone: "overdue" });
  const paidDeposit = invoiceWithPayments(open, [payment("d", 100, { purpose: "deposit" })]);
  assert.equal(invoiceDisplayStatus(paidDeposit, "2026-10-09").label, "Deposit paid · $700.00 due");
  assert.equal(invoiceDisplayStatus(paidDeposit, "2026-11-01").tone, "overdue");
  const waived = { ...open, deposit: { ...deposit, waivedAt: "x" } };
  assert.equal(invoiceDisplayStatus(waived, "2026-10-09").label, "Due Oct 31, 2026");
  // A draft shows what will be asked for (its PDF and preview); void doesn't.
  assert.deepEqual(invoiceDueNow({ ...open, status: "draft" }), { purpose: "deposit", amount: 100, dueDate: "2026-10-08" });
  assert.equal(invoiceDueNow({ ...open, status: "void" }), null);
});

run("the client's page and email ask for the deposit first", () => {
  const settings = InvoiceSettingsSchema.parse({ businessName: "Ink & Co" });
  const open = InvoiceSchema.parse(doc({ deposit: { amount: 100, dueDate: "2026-10-08", waivedAt: null }, shareToken: "tok" }));
  const page = renderPublicInvoicePage(open, settings, "2026-10-05", { payPath: "/i/tok/pay" });
  assert.ok(page.includes("Deposit due Oct 8, 2026"));
  assert.ok(page.includes("Pay $100.00 deposit"));
  assert.ok(page.includes("Then $700.00 due Oct 31, 2026"));
  const after = renderPublicInvoicePage(invoiceWithPayments(open, [payment("d", 100, { purpose: "deposit" })]), settings, "2026-10-09", {
    payPath: "/i/tok/pay",
  });
  assert.ok(after.includes("Balance due"));
  assert.ok(after.includes("Pay $700.00<"));
  assert.ok(after.includes("Paid so far"));
  const email = buildInvoiceEmail({ invoice: open, settings, link: "https://x/i/tok", payableOnline: true });
  assert.ok(email.subject.includes("$100.00 deposit due Oct 8"));
  assert.ok(email.text.includes("Deposit due: $100.00"));
  assert.ok(email.text.includes("Invoice total: $800.00, the rest due Oct 31, 2026"));
});

process.stdout.write("invoice payments checks passed\n");
