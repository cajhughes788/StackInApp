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
  invoiceCheckoutAmounts,
} = require("../shared/invoicePayments.ts");
const { invoiceDisplayStatus, invoicePaidNotification } = require("../shared/invoiceDisplay.ts");
const {
  InvoiceCreateInputSchema,
  InvoicePatchSchema,
  InvoiceSettingsSchema,
  InvoiceStatusActionSchema,
} = require("../shared/schemas/invoice.ts");
const { renderPublicInvoicePage } = require("../shared/invoicePublicPage.ts");
const { buildInvoiceEmail } = require("../shared/invoiceEmail.ts");
const {
  pickPaidInvoices,
  openInvoiceTargets,
  manualPaymentTargets,
  invoiceGroupFee,
  resolveChosenInvoiceGroup,
} = require("../shared/invoiceMatching.ts");

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

run("every payment, check and Cash App included, is booked under its own method", () => {
  assert.equal(entryPaymentMethodFor("check"), "check");
  assert.equal(entryPaymentMethodFor("cash_app"), "cash_app");
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

/* --------------------------------------------------------
 * Bank matching on deposits, balances and tips (phase 4)
 * -------------------------------------------------------- */

function bank(amount, overrides = {}) {
  return { date: "2026-10-12", amount, merchantName: null, rawName: "ONLINE TRANSFER", payerLabel: null, ...overrides };
}

const withDeposit = (overrides = {}) =>
  InvoiceSchema.parse(doc({ deposit: { amount: 100, dueDate: "2026-10-08", waivedAt: null }, ...overrides }));

run("an invoice with a deposit owed offers the deposit or everything", () => {
  const targets = openInvoiceTargets([withDeposit()], "2026-10-12");
  assert.deepEqual(targets.map((t) => [t.purpose, t.total]), [["deposit", 100], ["full", 800]]);
  const deposit = pickPaidInvoices(bank(100), targets, { tips: true });
  assert.equal(deposit.kind, "exact");
  assert.deepEqual([deposit.invoices[0].purpose, deposit.invoices[0].amount], ["deposit", 100]);
  const full = pickPaidInvoices(bank(800), targets, { tips: true });
  assert.deepEqual([full.invoices[0].purpose, full.invoices[0].amount], ["full", 800]);
  // Never the deposit and the whole thing of one invoice together.
  assert.equal(pickPaidInvoices(bank(900), targets), null);
});

run("after the deposit, what's left is the balance", () => {
  const paidDeposit = invoiceWithPayments(withDeposit(), [payment("d", 100, { purpose: "deposit" })]);
  const targets = openInvoiceTargets([paidDeposit], "2026-10-12");
  assert.deepEqual(targets.map((t) => [t.purpose, t.total]), [["balance", 700]]);
  assert.equal(pickPaidInvoices(bank(700), targets).invoices[0].purpose, "balance");
});

run("balance plus a tip, when tips are allowed", () => {
  const paidDeposit = invoiceWithPayments(withDeposit(), [payment("d", 100, { purpose: "deposit" })]);
  const targets = openInvoiceTargets([paidDeposit], "2026-10-12");
  const tipped = pickPaidInvoices(bank(840), targets, { tips: true });
  assert.equal(tipped.kind, "with_tip");
  assert.deepEqual([tipped.invoices[0].amount, tipped.invoices[0].tipAmount], [700, 140]);
  assert.equal(tipped.invoiceTotal, 840);
  assert.equal(tipped.feeAmount, 0);
  assert.equal(invoiceGroupFee(tipped, tipped.invoices, 840), 0);
  // Off by default (the already-paid check), capped at half the payment,
  // never on a deposit, never on a processor payout.
  assert.equal(pickPaidInvoices(bank(840), targets), null);
  assert.equal(pickPaidInvoices(bank(1051), targets, { tips: true }), null);
  assert.ok(pickPaidInvoices(bank(1050), targets, { tips: true }));
  assert.equal(pickPaidInvoices(bank(120), openInvoiceTargets([withDeposit()], "2026-10-12"), { tips: true }), null);
  assert.equal(pickPaidInvoices(bank(840, { merchantName: "Square", rawName: "SQ *SQUARE INC" }), targets, { tips: true }), null);
});

run("the smallest tip wins; equal tips are a choice", () => {
  const a = invoiceWithPayments(InvoiceSchema.parse(doc({ id: "a", number: "0001", total: 600, lines: [{ description: "x", amount: 600, category: "services" }] })), []);
  const b = InvoiceSchema.parse(doc({ id: "b", number: "0002", total: 650, lines: [{ description: "y", amount: 650, category: "services" }] }));
  const tipped = pickPaidInvoices(bank(700), openInvoiceTargets([a, b], "2026-10-12"), { tips: true });
  assert.deepEqual([tipped.invoices[0].invoiceId, tipped.invoices[0].tipAmount], ["b", 50]);
  assert.deepEqual(tipped.alternatives, []);
  const twin = InvoiceSchema.parse(doc({ id: "c", number: "0003", total: 650, lines: [{ description: "z", amount: 650, category: "services" }] }));
  const choice = pickPaidInvoices(bank(700), openInvoiceTargets([b, twin], "2026-10-12"), { tips: true });
  assert.equal(choice.alternatives.length, 1);
  assert.equal(resolveChosenInvoiceGroup(choice, ["c"])[0].tipAmount, 50);
});

run("a deposit and another client's invoice can arrive together", () => {
  const other = InvoiceSchema.parse(doc({ id: "o", number: "0009", clientName: "Bo", total: 250, lines: [{ description: "x", amount: 250, category: "services" }] }));
  const combined = pickPaidInvoices(bank(350), openInvoiceTargets([withDeposit(), other], "2026-10-12"));
  assert.equal(combined.kind, "combined");
  assert.deepEqual(
    combined.invoices.map((ref) => [ref.invoiceId, ref.purpose, ref.amount]).sort(),
    [["inv1", "deposit", 100], ["o", "full", 250]]
  );
});

run("already recorded: a bank deposit matches a hand-recorded payment, tip included", () => {
  const recorded = invoiceWithPayments(withDeposit(), [
    payment("d", 100, { purpose: "deposit", receivedOn: "2026-10-10" }),
    payment("b", 300, { purpose: "partial", tipAmount: 40, receivedOn: "2026-10-11" }),
  ]);
  const targets = manualPaymentTargets([recorded], "2026-10-12");
  assert.deepEqual(targets.map((t) => [t.purpose, t.total]), [["deposit", 100], ["partial", 340]]);
  assert.equal(pickPaidInvoices(bank(100), targets).invoices[0].purpose, "deposit");
  assert.equal(pickPaidInvoices(bank(340), targets).invoices[0].amount, 340);
  // Both arriving in one deposit is the same money twice over: one invoice.
  assert.equal(pickPaidInvoices(bank(440), targets), null);
  // Too long ago, or not recorded by hand, isn't a candidate.
  assert.deepEqual(manualPaymentTargets([recorded], "2026-11-12"), []);
  const online = invoiceWithPayments(withDeposit(), [payment("s", 100, { via: "online", receivedOn: "2026-10-10" })]);
  assert.deepEqual(manualPaymentTargets([online], "2026-10-12"), []);
});

/* --------------------------------------------------------
 * Online checkout amounts (phase 5)
 * -------------------------------------------------------- */

run("checkout charges the chosen option, from the invoice not the request", () => {
  const open = withDeposit();
  assert.deepEqual(invoiceCheckoutAmounts(open, {}, true), { purpose: "deposit", amountCents: 10000, tipCents: 0 });
  assert.deepEqual(invoiceCheckoutAmounts(open, { purpose: "full" }, true), { purpose: "full", amountCents: 80000, tipCents: 0 });
  // An option the invoice doesn't offer falls back to the first one.
  assert.equal(invoiceCheckoutAmounts(open, { purpose: "balance" }, true).purpose, "deposit");
  assert.equal(invoiceCheckoutAmounts({ ...open, status: "paid" }, {}, true), null);
});

run("tips: presets and custom, only on a finishing payment, only when offered", () => {
  const open = withDeposit();
  assert.equal(invoiceCheckoutAmounts(open, { purpose: "full", tip: "20" }, true).tipCents, 16000);
  assert.equal(invoiceCheckoutAmounts(open, { purpose: "full", tip: "15" }, true).tipCents, 12000);
  assert.equal(invoiceCheckoutAmounts(open, { purpose: "full", tip: "custom", customTip: "$45.50" }, true).tipCents, 4550);
  // Never on a deposit; never when the business doesn't ask for tips.
  assert.equal(invoiceCheckoutAmounts(open, { purpose: "deposit", tip: "20" }, true).tipCents, 0);
  assert.equal(invoiceCheckoutAmounts(open, { purpose: "full", tip: "20" }, false).tipCents, 0);
  // Anything odd is no tip: unknown percent, bad text, more than the payment.
  assert.equal(invoiceCheckoutAmounts(open, { purpose: "full", tip: "50" }, true).tipCents, 0);
  assert.equal(invoiceCheckoutAmounts(open, { purpose: "full", tip: "custom", customTip: "lots" }, true).tipCents, 0);
  assert.equal(invoiceCheckoutAmounts(open, { purpose: "full", tip: "custom", customTip: "800.01" }, true).tipCents, 0);
  assert.equal(invoiceCheckoutAmounts(open, { purpose: "full", tip: "custom", customTip: "800" }, true).tipCents, 80000);
  // After the deposit, the balance takes the tip.
  const paidDeposit = invoiceWithPayments(open, [payment("d", 100, { purpose: "deposit" })]);
  assert.deepEqual(invoiceCheckoutAmounts(paidDeposit, { tip: "20" }, true), { purpose: "balance", amountCents: 70000, tipCents: 14000 });
});

run("settings: tips are off unless turned on", () => {
  assert.equal(InvoiceSettingsSchema.parse({}).offerTips, false);
  assert.equal(InvoiceSettingsSchema.parse({ offerTips: true }).offerTips, true);
});

run("the invoice page offers the deposit or everything, and a tip when asked", () => {
  const open = InvoiceSchema.parse(doc({ deposit: { amount: 100, dueDate: "2026-10-08", waivedAt: null }, shareToken: "tok" }));
  const tipsOn = InvoiceSettingsSchema.parse({ offerTips: true });
  const page = renderPublicInvoicePage(open, tipsOn, "2026-10-05", { payPath: "/i/tok/pay" });
  assert.ok(page.includes('name="purpose" value="deposit" data-amount="10000" checked'));
  assert.ok(page.includes('name="purpose" value="full" data-amount="80000"'));
  assert.ok(page.includes("(when paying in full)"));
  for (const v of ["0", "15", "20", "25", "custom"]) assert.ok(page.includes(`name="tip" value="${v}"`));
  assert.ok(page.includes('name="customTip"'));
  // Tips off: no picker. One option: a hidden choice.
  const tipsOff = renderPublicInvoicePage(open, InvoiceSettingsSchema.parse({}), "2026-10-05", { payPath: "/i/tok/pay" });
  assert.equal(tipsOff.includes('name="tip" value='), false);
  const plain = renderPublicInvoicePage(InvoiceSchema.parse(doc({ shareToken: "tok" })), tipsOn, "2026-10-05", { payPath: "/i/tok/pay" });
  assert.ok(plain.includes('type="hidden" name="purpose" value="full"'));
  assert.ok(plain.includes("Add a tip"));
  assert.equal(plain.includes("(when paying in full)"), false);
  // Nothing payable online: no form at all.
  assert.equal(renderPublicInvoicePage(open, tipsOn, "2026-10-05", {}).includes("payform"), false);
});

run("phone numbers read the same on every invoice; contact lines don't break", () => {
  const { formatInvoicePhone } = require("../shared/invoiceDisplay.ts");
  for (const typed of ["2087142103", "208-714-2103", "(208) 714 2103", "+1 208 714 2103", "1-208-714-2103"]) {
    assert.equal(formatInvoicePhone(typed), "(208) 714-2103");
  }
  assert.equal(formatInvoicePhone("+44 20 7946 0958"), "+44 20 7946 0958");
  assert.equal(formatInvoicePhone("208-714-2103 ext 4"), "208-714-2103 ext 4");
  const page = renderPublicInvoicePage(
    InvoiceSchema.parse(doc()),
    InvoiceSettingsSchema.parse({ businessName: "The 521 App", businessEmail: "me@example.com", businessPhone: "2087142103" }),
    "2026-10-05"
  );
  assert.ok(page.includes('class="email" href="mailto:me@example.com"'));
  assert.ok(page.includes('class="phone" href="tel:2087142103">(208) 714-2103</a>'));
  assert.ok(page.includes('class="billed"'));
});

/* --------------------------------------------------------
 * Invoice fields: quantity × rate, addresses, policies
 * -------------------------------------------------------- */

run("a line is quantity × rate, worked out to the cent", () => {
  const parse = (line) => InvoiceCreateInputSchema.parse({ ...createBase, lines: [{ description: "x", category: "services", ...line }] }).lines[0];
  assert.deepEqual(parse({ quantity: 3, rate: 150 }), { description: "x", quantity: 3, rate: 150, amount: 450, category: "services" });
  assert.equal(parse({ quantity: 1.5, rate: 85 }).amount, 127.5);
  assert.equal(parse({ quantity: 0.33, rate: 10.01 }).amount, 3.3); // 3.3033 → $3.30
  // Just an amount still works: 1 × it.
  assert.deepEqual(parse({ amount: 200 }), { description: "x", quantity: 1, rate: 200, amount: 200, category: "services" });
  const bad = (line) => InvoiceCreateInputSchema.safeParse({ ...createBase, lines: [{ description: "x", category: "services", ...line }] }).success;
  assert.equal(bad({ quantity: 2 }), false); // no rate or amount
  assert.equal(bad({ quantity: 1.555, rate: 10 }), false); // three decimals
  assert.equal(bad({ quantity: 0.001, rate: 1 }), false);
  // The total and a deposit check use the worked-out amounts.
  const input = InvoiceCreateInputSchema.parse({ ...createBase, lines: [{ description: "x", category: "services", quantity: 4, rate: 50 }] });
  assert.equal(input.lines[0].amount, 200);
  assert.equal(
    InvoiceCreateInputSchema.safeParse({ ...createBase, lines: [{ description: "x", category: "services", quantity: 4, rate: 50 }], deposit: { amount: 250, dueDate: "2026-10-08" } }).success,
    false
  );
});

run("lines saved before quantities read as 1 × their amount", () => {
  const old = InvoiceSchema.parse(doc());
  assert.deepEqual(old.lines[0], { description: "Sleeve", quantity: 1, rate: 600, amount: 600, category: "services" });
  assert.equal(old.clientAddress, null);
  assert.equal(old.policies, "");
});

run("the client page shows quantities, addresses and policies", () => {
  const invoice = InvoiceSchema.parse(
    doc({
      lines: [
        { description: "Session", quantity: 3, rate: 150, amount: 450, category: "services" },
        { description: "Aftercare kit", amount: 350, category: "products" },
      ],
      clientEmail: "jordan@example.com",
      clientAddress: "12 Oak St\nBoise, ID 83702",
      policies: "Deposits are non-refundable.",
    })
  );
  const settings = InvoiceSettingsSchema.parse({ businessName: "Ink & Co", businessAddress: "1 Main St\nBoise, ID" });
  const page = renderPublicInvoicePage(invoice, settings, "2026-10-05");
  assert.ok(page.includes('<div class="qty">3 × $150.00</div>'));
  assert.equal(page.includes("1 × $350.00"), false);
  assert.ok(page.includes('<div class="sub">jordan@example.com</div>'));
  assert.ok(page.includes("12 Oak St\nBoise, ID 83702"));
  assert.ok(page.includes('<div class="address">1 Main St\nBoise, ID</div>'));
  assert.ok(page.includes("Policies &amp; terms"));
  assert.ok(page.includes("Deposits are non-refundable."));
  // A void invoice drops its policies.
  assert.equal(renderPublicInvoicePage({ ...invoice, status: "void" }, settings, "2026-10-05").includes("Policies &amp; terms"), false);
});

run("the owner's paid notification says what came in and what's left", () => {
  const open = InvoiceSchema.parse(doc());
  const full = invoiceWithPayments(open, [payment("a", 800, { purpose: "full", tipAmount: 120 })]);
  assert.deepEqual(invoicePaidNotification(full, full.payments[0]), {
    title: "Acme paid $800.00 + $120.00 tip",
    body: "Invoice #0012 is paid in full.",
  });
  const withDeposit = InvoiceSchema.parse(doc({ deposit: { amount: 200, dueDate: "2026-10-10" } }));
  const deposit = invoiceWithPayments(withDeposit, [payment("d", 200, { purpose: "deposit" })]);
  assert.deepEqual(invoicePaidNotification(deposit, deposit.payments[0]), {
    title: "Acme paid the $200.00 deposit",
    body: "Invoice #0012 · $600.00 left, due Oct 31, 2026.",
  });
  const part = invoiceWithPayments(open, [payment("p", 300)]);
  assert.equal(invoicePaidNotification(part, part.payments[0]).title, "Acme paid $300.00");
  assert.equal(invoicePaidNotification(part, part.payments[0]).body, "Invoice #0012 · $500.00 left, due Oct 31, 2026.");
  // The balance after a deposit finishes it.
  const rest = invoiceWithPayments(withDeposit, [payment("d", 200, { purpose: "deposit" }), payment("b", 600, { purpose: "balance" })]);
  assert.equal(invoicePaidNotification(rest, rest.payments[1]).body, "Invoice #0012 is paid in full.");
});

process.stdout.write("invoice payments checks passed\n");
