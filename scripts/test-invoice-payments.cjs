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

function run(name, fn) {
  fn();
  process.stdout.write(`ok - ${name}\n`);
}

// A stored invoice doc as phase-1 write paths leave it: single-payment
// fields only, no ledger.
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

const paidManual = {
  status: "paid",
  paidAt: "2026-10-10T12:00:00.000Z",
  paidVia: "manual",
  paidMethod: "zelle",
  paidEntryId: "e1",
};

/* --------------------------------------------------------
 * Legacy → ledger conversion
 * -------------------------------------------------------- */

run("draft, sent and void invoices have no payments", () => {
  for (const status of ["draft", "sent", "void"]) {
    const invoice = InvoiceSchema.parse(doc({ status }));
    assert.deepEqual(invoice.payments, []);
    assert.equal(invoice.amountPaid, 0);
    assert.deepEqual(invoice.paymentEntryIds, []);
    assert.equal(invoice.pendingPayment, null);
  }
});

run("a manually paid invoice becomes one legacy payment for the total", () => {
  const invoice = InvoiceSchema.parse(doc(paidManual));
  assert.equal(invoice.payments.length, 1);
  const [payment] = invoice.payments;
  assert.equal(payment.id, "legacy");
  assert.equal(payment.purpose, "full");
  assert.equal(payment.amount, 800);
  assert.equal(payment.tipAmount, 0);
  assert.equal(payment.receivedOn, "2026-10-10");
  assert.equal(payment.via, "manual");
  assert.equal(payment.method, "zelle");
  assert.equal(payment.entryId, "e1");
  assert.equal(invoice.amountPaid, 800);
  assert.deepEqual(invoice.paymentEntryIds, ["e1"]);
  assert.equal(invoice.lastManualPaymentOn, "2026-10-10");
});

run("a bank-matched payment keeps its deposit, fee and method", () => {
  const invoice = InvoiceSchema.parse(
    doc({
      status: "paid",
      paidAt: "2026-10-12T12:00:00.000Z",
      paidVia: "bank_match",
      paidMethod: "pos",
      paidEntryId: "e2",
      paidPlaidTransactionId: "txn_1",
      paidFeeAmount: 24.1,
    })
  );
  const [payment] = invoice.payments;
  assert.equal(payment.via, "bank_match");
  assert.equal(payment.plaidTransactionId, "txn_1");
  assert.equal(payment.feeAmount, 24.1);
  assert.deepEqual(invoice.paymentPlaidTransactionIds, ["txn_1"]);
  assert.equal(invoice.lastManualPaymentOn, null);
});

run("an online payment keeps its PaymentIntent and Checkout session", () => {
  const invoice = InvoiceSchema.parse(
    doc({
      status: "paid",
      paidAt: "2026-10-12T18:30:00.000Z",
      paidVia: "online",
      paidMethod: null,
      paidEntryId: "e3",
      paidStripePaymentIntentId: "pi_1",
      checkoutSessionId: "cs_1",
      paidFeeAmount: 23.5,
    })
  );
  const [payment] = invoice.payments;
  assert.equal(payment.via, "online");
  // No method recorded on older online payments: booked under Card / POS.
  assert.equal(payment.method, "pos");
  assert.equal(payment.stripePaymentIntentId, "pi_1");
  assert.equal(payment.checkoutSessionId, "cs_1");
  assert.deepEqual(invoice.paymentIntentIds, ["pi_1"]);
  assert.equal(invoice.openCheckout, null);
});

run("an open Checkout and a clearing bank transfer map to their own fields", () => {
  const open = InvoiceSchema.parse(doc({ checkoutSessionId: "cs_open" }));
  assert.deepEqual(open.openCheckout, { sessionId: "cs_open", purpose: "full", amountCents: 80000, tipCents: 0 });
  assert.equal(open.pendingPayment, null);

  const clearing = InvoiceSchema.parse(doc({ checkoutSessionId: "cs_ach", pendingPaymentAt: "2026-10-15T09:00:00.000Z" }));
  assert.equal(clearing.openCheckout, null);
  assert.deepEqual(clearing.pendingPayment, {
    checkoutSessionId: "cs_ach",
    purpose: "full",
    amount: 800,
    tipAmount: 0,
    startedAt: "2026-10-15T09:00:00.000Z",
  });
});

run("refunds point at the payment they return", () => {
  const invoice = InvoiceSchema.parse(
    doc({ ...paidManual, refunds: [{ id: "manual_r1", entryId: "r1", amount: 50, date: "2026-10-20", reason: "other" }] })
  );
  assert.equal(invoice.refunds[0].paymentId, "legacy");
  assert.equal(invoicePaymentRefundable(invoice, "legacy"), 750);
});

run("a stale stored ledger never outlives the fields it came from", () => {
  // Reopened by a merge write that only cleared the paid* fields.
  const reopened = InvoiceSchema.parse(
    doc({
      status: "sent",
      paidAt: null,
      paidVia: null,
      paidEntryId: null,
      payments: [{ id: "legacy", purpose: "full", amount: 800, receivedOn: "2026-10-10", via: "manual", method: "zelle", entryId: "e1", createdAt: "x" }],
      amountPaid: 800,
      paymentEntryIds: ["e1"],
    })
  );
  assert.deepEqual(reopened.payments, []);
  assert.equal(reopened.amountPaid, 0);
  assert.deepEqual(reopened.paymentEntryIds, []);
});

run("a backfilled receivedOn is kept for the same entry", () => {
  const stored = { id: "legacy", purpose: "full", amount: 800, receivedOn: "2026-10-11", via: "online", method: "pos", entryId: "e3", createdAt: "x" };
  const online = { status: "paid", paidAt: "2026-10-12T03:00:00.000Z", paidVia: "online", paidEntryId: "e3" };
  assert.equal(InvoiceSchema.parse(doc({ ...online, payments: [stored] })).payments[0].receivedOn, "2026-10-11");
  // A different entry (paid again after a reopen) takes the new date.
  assert.equal(
    InvoiceSchema.parse(doc({ ...online, paidEntryId: "e4", payments: [stored] })).payments[0].receivedOn,
    "2026-10-12"
  );
});

run("parsing twice gives the same invoice", () => {
  const once = InvoiceSchema.parse(doc(paidManual));
  assert.deepEqual(InvoiceSchema.parse(once), once);
});

run("the closed status parses and displays", () => {
  const closed = InvoiceSchema.parse(doc({ status: "closed", closedAt: "2026-10-20T00:00:00.000Z" }));
  assert.equal(closed.status, "closed");
  assert.equal(invoiceDisplayStatus(closed, "2026-10-21").label, "Closed");
  assert.equal(invoiceBalanceDue(closed), 0);
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

function payment(id, amount, extra = {}) {
  return { id, purpose: "partial", amount, tipAmount: 0, receivedOn: "2026-10-05", via: "manual", method: "zelle", entryId: `e_${id}`, plaidTransactionId: null, stripePaymentIntentId: null, checkoutSessionId: null, feeAmount: 0, createdAt: "x", ...extra };
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

process.stdout.write("invoice payments checks passed\n");
