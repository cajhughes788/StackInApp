require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

const assert = require("node:assert/strict");

const {
  pickPaidInvoices,
  selectOpenInvoiceCandidates,
  selectManuallyPaidInvoiceCandidates,
  INVOICE_MATCH_MAX_CANDIDATES,
  resolveChosenInvoiceGroup,
  invoiceGroupFee,
  allocateInvoiceFee,
  invoiceIncomeBreakdown,
} = require("../shared/invoiceMatching.ts");
const {
  InvoiceSchema,
  InvoiceCreateInputSchema,
  InvoicePatchSchema,
  InvoiceStatusActionSchema,
} = require("../shared/schemas/invoice.ts");
const {
  dueDateForTerms,
  formatInvoiceMoney,
  formatInvoiceDate,
  invoiceDisplayStatus,
  invoiceBalanceDue,
  invoiceFileName,
  textColorOnAccent,
} = require("../shared/invoiceDisplay.ts");
const { renderPublicInvoicePage, escapeHtml } = require("../shared/invoicePublicPage.ts");
const { InvoiceSettingsSchema, InvoiceSettingsPatchSchema } = require("../shared/schemas/invoice.ts");
const { PlaidPendingTransactionSchema } = require("../shared/schemas/plaidPendingTransaction.ts");

function run(name, fn) {
  fn();
  process.stdout.write(`ok - ${name}\n`);
}

function invoice(overrides) {
  return {
    id: overrides.number,
    status: "sent",
    clientName: "Acme",
    issueDate: "2026-09-01",
    dueDate: "2026-10-01",
    paidVia: null,
    paidAt: null,
    ...overrides,
  };
}

function deposit(amount, overrides = {}) {
  return { date: "2026-10-10", amount, merchantName: null, rawName: "DEPOSIT", payerLabel: null, ...overrides };
}

const stripe = { merchantName: "Stripe", rawName: "STRIPE TRANSFER ST-X1Y2" };

run("exact single invoice", () => {
  const match = pickPaidInvoices(deposit(450), [invoice({ number: "0012", total: 450 }), invoice({ number: "0013", total: 300 })]);
  assert.equal(match.kind, "exact");
  assert.deepEqual(match.invoices.map((i) => i.number), ["0012"]);
  assert.equal(match.feeAmount, 0);
  assert.deepEqual(match.alternatives, []);
});

run("exact single beats a combined group of the same amount", () => {
  const match = pickPaidInvoices(deposit(450), [
    invoice({ number: "0010", total: 200 }),
    invoice({ number: "0011", total: 250 }),
    invoice({ number: "0012", total: 450, dueDate: "2026-10-05" }),
  ]);
  assert.equal(match.kind, "exact");
  assert.deepEqual(match.invoices.map((i) => i.number), ["0012"]);
});

run("two checks deposited together", () => {
  const match = pickPaidInvoices(deposit(900), [
    invoice({ number: "0012", total: 450, clientName: "Acme" }),
    invoice({ number: "0015", total: 450, clientName: "Rivera" }),
    invoice({ number: "0016", total: 125 }),
  ]);
  assert.equal(match.kind, "combined");
  assert.deepEqual(match.invoices.map((i) => i.number), ["0012", "0015"]);
  assert.equal(match.invoiceTotal, 900);
});

run("three invoices can combine; float totals compare in cents", () => {
  const match = pickPaidInvoices(deposit(0.3 + 100.1 + 49.6), [
    invoice({ number: "a", total: 0.3 }),
    invoice({ number: "b", total: 100.1 }),
    invoice({ number: "c", total: 49.6 }),
  ]);
  assert.equal(match.kind, "combined");
  assert.equal(match.invoices.length, 3);
});

run("no group uses the same invoice twice", () => {
  assert.equal(pickPaidInvoices(deposit(900), [invoice({ number: "0012", total: 450 })]), null);
});

run("Stripe payout net of fees", () => {
  const match = pickPaidInvoices(deposit(436.65, stripe), [invoice({ number: "0012", total: 450 })]);
  assert.equal(match.kind, "net_of_fees");
  assert.equal(match.feeAmount, 13.35);
  assert.equal(Math.round((match.invoiceTotal - match.feeAmount) * 100), 43665);
});

run("fees never apply to a non-processor deposit", () => {
  assert.equal(pickPaidInvoices(deposit(436.65), [invoice({ number: "0012", total: 450 })]), null);
  assert.equal(pickPaidInvoices(deposit(436.65, { merchantName: "Venmo", rawName: "VENMO CASHOUT" }), [invoice({ number: "0012", total: 450 })]), null);
});

run("fees never apply when the deposit is larger than the invoices", () => {
  assert.equal(pickPaidInvoices(deposit(460, stripe), [invoice({ number: "0012", total: 450 })]), null);
});

run("fee cap is 5% + $1", () => {
  // 5% of 450 = 22.50, + 1.00 = 23.50 max fee
  assert.equal(pickPaidInvoices(deposit(426.5, stripe), [invoice({ number: "0012", total: 450 })]).feeAmount, 23.5);
  assert.equal(pickPaidInvoices(deposit(426.49, stripe), [invoice({ number: "0012", total: 450 })]), null);
});

run("payer memory picks between same-amount invoices", () => {
  const match = pickPaidInvoices(deposit(450, { payerLabel: "Rivera Design LLC" }), [
    invoice({ number: "0012", total: 450, clientName: "Acme" }),
    invoice({ number: "0019", total: 450, clientName: "Rivera Design", dueDate: "2026-10-08" }),
  ]);
  assert.deepEqual(match.invoices.map((i) => i.number), ["0019"]);
  assert.deepEqual(match.alternatives, []);
});

run("a real tie comes back with alternatives, oldest due first", () => {
  const match = pickPaidInvoices(deposit(450), [
    invoice({ number: "0019", total: 450, clientName: "Lee", dueDate: "2026-10-08" }),
    invoice({ number: "0012", total: 450, clientName: "Acme", dueDate: "2026-10-01" }),
  ]);
  assert.deepEqual(match.invoices.map((i) => i.number), ["0012"]);
  assert.deepEqual(match.alternatives.map((g) => g.map((i) => i.number)), [["0019"]]);
});

run("short names don't match a payer on containment", () => {
  const match = pickPaidInvoices(deposit(450, { payerLabel: "Al Jones" }), [
    invoice({ number: "0012", total: 450, clientName: "Al" }),
    invoice({ number: "0013", total: 450, clientName: "Bea" }),
  ]);
  assert.equal(match.alternatives.length, 1);
});

run("open candidates: only sent invoices inside the date window", () => {
  const picked = selectOpenInvoiceCandidates(
    [
      invoice({ number: "sent", total: 1 }),
      invoice({ number: "draft", total: 1, status: "draft" }),
      invoice({ number: "void", total: 1, status: "void" }),
      invoice({ number: "paid", total: 1, status: "paid" }),
      invoice({ number: "future", total: 1, issueDate: "2026-10-11" }),
      invoice({ number: "stale", total: 1, dueDate: "2026-07-01" }),
    ],
    "2026-10-10"
  );
  assert.deepEqual(picked.map((i) => i.number), ["sent"]);
});

run("open candidates: capped at the oldest-due invoices", () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    invoice({ number: String(i).padStart(4, "0"), total: 10, dueDate: `2026-09-${String(30 - i).padStart(2, "0")}` })
  );
  const picked = selectOpenInvoiceCandidates(many, "2026-10-10");
  assert.equal(picked.length, INVOICE_MATCH_MAX_CANDIDATES);
  assert.equal(picked[0].dueDate, "2026-09-11");
});

run("manually-paid candidates: recent manual payments only", () => {
  const picked = selectManuallyPaidInvoiceCandidates(
    [
      invoice({ number: "recent", total: 450, status: "paid", paidVia: "manual", paidAt: "2026-10-01T15:00:00Z" }),
      invoice({ number: "old", total: 450, status: "paid", paidVia: "manual", paidAt: "2026-09-01T15:00:00Z" }),
      invoice({ number: "bank", total: 450, status: "paid", paidVia: "bank_match", paidAt: "2026-10-01T15:00:00Z" }),
      invoice({ number: "open", total: 450 }),
    ],
    "2026-10-10"
  );
  assert.deepEqual(picked.map((i) => i.number), ["recent"]);
});

run("invoice schema: total must equal its lines", () => {
  const base = {
    id: "i1",
    workspaceId: "w1",
    number: "0001",
    clientName: "Acme",
    lines: [
      { description: "Design", amount: 0.1, category: "services" },
      { description: "Print", amount: 0.2, category: "products" },
    ],
    total: 0.3,
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
    status: "sent",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  };
  assert.equal(InvoiceSchema.safeParse(base).success, true);
  assert.equal(InvoiceSchema.safeParse({ ...base, total: 0.4 }).success, false);
});

run("pending transactions from before invoicing parse with no match", () => {
  const parsed = PlaidPendingTransactionSchema.parse({
    id: "t1",
    workspaceId: "w1",
    plaidItemId: "p1",
    plaidTransactionId: "t1",
    accountId: "a1",
    date: "2026-10-10",
    amount: -450,
    merchantName: null,
    rawName: "DEPOSIT",
    personalFinanceCategoryPrimary: "INCOME",
    suggestedExpenseAccount: null,
    isBusinessGuess: null,
    confidence: 0,
    status: "pending",
    createdAt: "2026-10-10T00:00:00Z",
    updatedAt: "2026-10-10T00:00:00Z",
  });
  assert.equal(parsed.invoiceMatch, null);
  assert.equal(parsed.direction, "income");
});


run("chosen group: the suggestion or an alternative, ids in any order", () => {
  const match = pickPaidInvoices(deposit(900), [
    invoice({ number: "a", total: 450 }),
    invoice({ number: "b", total: 450 }),
    invoice({ number: "c", total: 450 }),
  ]);
  assert.equal(match.kind, "combined");
  assert.equal(match.alternatives.length, 2);
  assert.deepEqual(resolveChosenInvoiceGroup(match, ["b", "a"]).map((i) => i.invoiceId), ["a", "b"]);
  assert.deepEqual(resolveChosenInvoiceGroup(match, ["c", "b"]).map((i) => i.invoiceId), ["b", "c"]);
  assert.equal(resolveChosenInvoiceGroup(match, ["a"]), null);
  assert.equal(resolveChosenInvoiceGroup(match, ["a", "zzz"]), null);
});

run("group fee: worked out per chosen group, never negative, only for fee matches", () => {
  const feeMatch = pickPaidInvoices(deposit(436.65, stripe), [invoice({ number: "0012", total: 450 })]);
  assert.equal(invoiceGroupFee(feeMatch, feeMatch.invoices, 436.65), 13.35);
  assert.equal(invoiceGroupFee(feeMatch, feeMatch.invoices, 460), null);
  const exact = pickPaidInvoices(deposit(450), [invoice({ number: "0012", total: 450 })]);
  assert.equal(invoiceGroupFee(exact, exact.invoices, 450), 0);
  assert.equal(invoiceGroupFee(exact, exact.invoices, 440), null);
});

run("fee split across invoices adds up to the fee exactly", () => {
  const shares = allocateInvoiceFee([{ amount: 100 }, { amount: 100 }, { amount: 100 }], 10);
  assert.deepEqual(shares, [3.33, 3.33, 3.34]);
  assert.deepEqual(allocateInvoiceFee([{ amount: 450 }], 0), [0]);
  const uneven = allocateInvoiceFee([{ amount: 300 }, { amount: 150.5 }], 13.07);
  assert.equal(Math.round(uneven.reduce((a, b) => a + b, 0) * 100), 1307);
});

run("invoice lines become one breakdown, summed per category", () => {
  const breakdown = invoiceIncomeBreakdown(
    [
      { description: "Design", amount: 0.1, category: "services" },
      { description: "Revisions", amount: 0.2, category: "services" },
      { description: "Prints", amount: 40, category: "products" },
    ],
    "zelle"
  );
  assert.deepEqual(breakdown, { paymentMethod: "zelle", services: 0.3, products: 40 });
});

run("create input: cents-only amounts, due on or after issue, trimmed names", () => {
  const base = {
    clientName: "  Acme  ",
    lines: [{ description: "Design", amount: 450, category: "services" }],
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
  };
  const ok = InvoiceCreateInputSchema.safeParse(base);
  assert.equal(ok.success, true);
  assert.equal(ok.data.clientName, "Acme");
  assert.equal(InvoiceCreateInputSchema.safeParse({ ...base, lines: [{ ...base.lines[0], amount: 10.005 }] }).success, false);
  assert.equal(InvoiceCreateInputSchema.safeParse({ ...base, lines: [{ ...base.lines[0], amount: 0.29 }] }).success, true);
  assert.equal(InvoiceCreateInputSchema.safeParse({ ...base, dueDate: "2026-09-30" }).success, false);
  assert.equal(InvoiceCreateInputSchema.safeParse({ ...base, issueDate: "2026-13-01" }).success, false);
  assert.equal(InvoiceCreateInputSchema.safeParse({ ...base, lines: [] }).success, false);
  assert.equal(InvoiceCreateInputSchema.safeParse({ ...base, clientMutationId: "has spaces" }).success, false);
});

run("patch input: partial, but dates still checked when both are given", () => {
  assert.equal(InvoicePatchSchema.safeParse({ clientName: "Lee" }).success, true);
  assert.equal(InvoicePatchSchema.safeParse({ issueDate: "2026-10-05", dueDate: "2026-10-01" }).success, false);
});

run("status actions: mark_paid needs a date and payment method", () => {
  assert.equal(InvoiceStatusActionSchema.safeParse({ action: "send" }).success, true);
  assert.equal(InvoiceStatusActionSchema.safeParse({ action: "mark_paid" }).success, false);
  assert.equal(
    InvoiceStatusActionSchema.safeParse({ action: "mark_paid", paidDate: "2026-10-10", paymentMethod: "zelle" }).success,
    true
  );
  assert.equal(InvoiceStatusActionSchema.safeParse({ action: "delete" }).success, false);
});

run("terms set the due date, across month and year ends", () => {
  assert.equal(dueDateForTerms("2026-10-15", "due_on_receipt"), "2026-10-15");
  assert.equal(dueDateForTerms("2026-10-15", "net_15"), "2026-10-30");
  assert.equal(dueDateForTerms("2026-12-20", "net_30"), "2027-01-19");
});

run("display formatting: money, dates, file names", () => {
  assert.equal(formatInvoiceMoney(1042.5), "$1,042.50");
  assert.equal(formatInvoiceMoney(0.1 + 0.2), "$0.30");
  assert.equal(formatInvoiceDate("2026-10-15"), "Oct 15, 2026");
  assert.equal(invoiceFileName({ number: "0012", clientName: "Acme Coffee / Roasters!" }), "Invoice-0012-Acme-Coffee-Roasters.pdf");
  assert.equal(invoiceFileName({ number: "0012", clientName: "日本" }), "Invoice-0012.pdf");
});

run("display status and balance follow the invoice status", () => {
  const sent = { status: "sent", dueDate: "2026-11-14", paidAt: null, total: 100 };
  assert.deepEqual(invoiceDisplayStatus(sent, "2026-10-20"), { label: "Due Nov 14, 2026", tone: "open" });
  assert.equal(invoiceDisplayStatus(sent, "2026-11-14").label, "Due today");
  assert.equal(invoiceDisplayStatus(sent, "2026-11-15").tone, "overdue");
  assert.equal(invoiceDisplayStatus({ ...sent, status: "paid", paidAt: "2026-10-18T12:00:00.000Z" }, "2026-10-20").label, "Paid Oct 18, 2026");
  assert.equal(invoiceBalanceDue(sent), 100);
  assert.equal(invoiceBalanceDue({ ...sent, status: "paid" }), 0);
  assert.equal(invoiceBalanceDue({ ...sent, status: "void" }), 0);
});

run("accent text color stays readable", () => {
  assert.equal(textColorOnAccent("#2FA866"), "#161B1E");
  assert.equal(textColorOnAccent("#542752"), "#FFFFFF");
  assert.equal(textColorOnAccent("#000000"), "#FFFFFF");
});

run("settings: defaults, validation, and patches that don't reset other fields", () => {
  const defaults = InvoiceSettingsSchema.parse({});
  assert.equal(defaults.accentColor, "#2FA866");
  assert.equal(defaults.defaultTerms, "net_30");
  assert.equal(defaults.logoDataUrl, null);
  assert.deepEqual(InvoiceSettingsPatchSchema.parse({ businessName: "Maria" }), { businessName: "Maria" });
  assert.equal(InvoiceSettingsPatchSchema.safeParse({ accentColor: "green" }).success, false);
  assert.equal(InvoiceSettingsPatchSchema.safeParse({ businessEmail: "" }).success, true);
  assert.equal(InvoiceSettingsPatchSchema.safeParse({ businessEmail: "nope" }).success, false);
  assert.equal(InvoiceSettingsPatchSchema.safeParse({ logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" }).success, true);
  assert.equal(InvoiceSettingsPatchSchema.safeParse({ logoDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }).success, false);
  assert.equal(InvoiceSettingsPatchSchema.safeParse({ logoDataUrl: 'data:image/png;base64,AAA" onerror="x' }).success, false);
});

run("public page escapes everything the workspace typed", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  const evil = "<img src=x onerror=alert(1)>";
  const html = renderPublicInvoicePage(
    {
      id: "i", workspaceId: "w", number: "0001", clientName: evil, clientEmail: null,
      lines: [{ description: evil, amount: 10, category: "services" }],
      total: 10, issueDate: "2026-10-01", dueDate: "2026-10-31", note: evil, shareToken: "t",
      status: "sent", paidAt: null, paidVia: null, paidEntryId: null, paidPlaidTransactionId: null, paidFeeAmount: 0,
      createdAt: "x", updatedAt: "x",
    },
    InvoiceSettingsSchema.parse({ businessName: evil, businessPhone: "<b>1</b>" }),
    "2026-10-15"
  );
  assert.equal(html.includes("<img src=x"), false);
  assert.equal(html.includes("<b>1</b>"), false);
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("How to pay"));
});

run("public page: void and paid invoices say so and owe nothing", () => {
  const base = {
    id: "i", workspaceId: "w", number: "0001", clientName: "Acme", clientEmail: null,
    lines: [{ description: "Work", amount: 10, category: "services" }],
    total: 10, issueDate: "2026-10-01", dueDate: "2026-10-31", note: "Venmo @me", shareToken: "t",
    paidVia: null, paidEntryId: null, paidPlaidTransactionId: null, paidFeeAmount: 0, createdAt: "x", updatedAt: "x",
  };
  const settings = InvoiceSettingsSchema.parse({});
  const voided = renderPublicInvoicePage({ ...base, status: "void", paidAt: null }, settings, "2026-10-15");
  assert.ok(voided.includes("voided"));
  assert.equal(voided.includes("Venmo @me"), false);
  const paid = renderPublicInvoicePage({ ...base, status: "paid", paidAt: "2026-10-10T12:00:00.000Z" }, settings, "2026-10-15");
  assert.ok(paid.includes("Paid Oct 10, 2026"));
  assert.ok(paid.includes("$0.00"));
});

const { paymentAccountStatusFrom, PaymentAccountActionSchema } = require("../shared/schemas/paymentAccount.ts");

run("Stripe account status: onboarding, verifying, active, restricted", () => {
  assert.equal(paymentAccountStatusFrom({ details_submitted: false }).status, "onboarding");
  assert.equal(
    paymentAccountStatusFrom({ details_submitted: true, charges_enabled: false, payouts_enabled: false, requirements: { pending_verification: ["individual.id_number"], disabled_reason: "requirements.pending_verification" } }).status,
    "verifying"
  );
  const active = paymentAccountStatusFrom({ details_submitted: true, charges_enabled: true, payouts_enabled: true, requirements: { currently_due: [] } });
  assert.equal(active.status, "active");
  assert.equal(active.chargesEnabled, true);
  const due = paymentAccountStatusFrom({ details_submitted: true, charges_enabled: false, payouts_enabled: false, requirements: { currently_due: ["external_account"], past_due: ["external_account", "individual.dob.day"], disabled_reason: "requirements.past_due" } });
  assert.equal(due.status, "restricted");
  assert.equal(due.requirementsDueCount, 2);
  // Still taking payments, but something's due before a deadline.
  assert.equal(paymentAccountStatusFrom({ details_submitted: true, charges_enabled: true, payouts_enabled: true, requirements: { currently_due: ["tos_acceptance.date"] } }).status, "restricted");
  assert.equal(paymentAccountStatusFrom({ details_submitted: true, charges_enabled: false, payouts_enabled: false, requirements: { disabled_reason: "rejected.fraud" } }).status, "restricted");
});

run("Stripe account: bank transfer capability status", () => {
  assert.equal(paymentAccountStatusFrom({ details_submitted: true, capabilities: { us_bank_account_ach_payments: "active" } }).achStatus, "active");
  assert.equal(paymentAccountStatusFrom({ details_submitted: true, capabilities: { us_bank_account_ach_payments: "pending" } }).achStatus, "pending");
  assert.equal(paymentAccountStatusFrom({ details_submitted: true }).achStatus, "unrequested");
});

run("payment account actions validate", () => {
  assert.equal(PaymentAccountActionSchema.safeParse({ action: "onboard", client: "native" }).success, true);
  assert.equal(PaymentAccountActionSchema.safeParse({ action: "onboard" }).success, false);
  assert.equal(PaymentAccountActionSchema.safeParse({ action: "set_accept_online", acceptOnline: true }).success, true);
  assert.equal(PaymentAccountActionSchema.safeParse({ action: "delete" }).success, false);
});

const { matchStripePayout } = require("../shared/stripePayouts.ts");

run("Stripe payouts: exact amount within 3 days, closest wins, never twice", () => {
  const payouts = [
    { id: "po_a", amount: 436.65, arrivalDate: "2026-10-18", status: "paid", matchedPendingTransactionId: null },
    { id: "po_b", amount: 436.65, arrivalDate: "2026-10-21", status: "in_transit", matchedPendingTransactionId: null },
    { id: "po_c", amount: 120.0, arrivalDate: "2026-10-19", status: "paid", matchedPendingTransactionId: "t9" },
  ];
  const dep = (over) => ({ date: "2026-10-19", amount: 436.65, merchantName: null, rawName: "MARIA LOPEZ DESIGN PAYOUT", ...over });
  assert.equal(matchStripePayout(dep({}), payouts).id, "po_a");
  assert.equal(matchStripePayout(dep({ date: "2026-10-21" }), payouts).id, "po_b");
  assert.equal(matchStripePayout(dep({ date: "2026-10-25" }), payouts), null);
  assert.equal(matchStripePayout(dep({ amount: 436.64 }), payouts), null);
  assert.equal(matchStripePayout(dep({ amount: 120 }), payouts), null, "already matched");
  assert.equal(matchStripePayout(dep({ merchantName: "Venmo", rawName: "VENMO CASHOUT" }), payouts), null);
  assert.equal(matchStripePayout(dep({ rawName: "SQ *SQUARE INC TRANSFER" }), payouts), null);
  assert.equal(matchStripePayout(dep({ merchantName: "Stripe", rawName: "STRIPE TRANSFER" }), payouts).id, "po_a");
  assert.equal(matchStripePayout(dep({}), [{ ...payouts[0], status: "failed" }]), null);
});

run("public page: Pay button only when payable, and not after returning paid", () => {
  const base = {
    id: "i", workspaceId: "w", number: "0016", clientName: "Acme", clientEmail: null,
    lines: [{ description: "Work", amount: 100, category: "services" }],
    total: 100, issueDate: "2026-10-01", dueDate: "2026-10-31", note: "Venmo @me", shareToken: "t",
    status: "sent", paidAt: null, paidVia: null, paidEntryId: null, paidPlaidTransactionId: null, paidFeeAmount: 0,
    createdAt: "x", updatedAt: "x",
  };
  const settings = InvoiceSettingsSchema.parse({});
  const plain = renderPublicInvoicePage(base, settings, "2026-10-15");
  assert.equal(plain.includes("Pay $100.00"), false);
  assert.ok(plain.includes("How to pay"));
  const payable = renderPublicInvoicePage(base, settings, "2026-10-15", { payPath: "/i/tok/pay" });
  assert.ok(payable.includes('action="/i/tok/pay"'));
  assert.ok(payable.includes("Pay $100.00"));
  assert.ok(payable.includes("Other ways to pay"));
  const back = renderPublicInvoicePage(base, settings, "2026-10-15", { payPath: "/i/tok/pay", justPaid: true });
  assert.equal(back.includes("Pay $100.00"), false);
  assert.ok(back.includes("payment is being processed"));
  const clearing = renderPublicInvoicePage({ ...base, pendingPaymentAt: "2026-10-18T12:00:00.000Z" }, settings, "2026-10-19", { payPath: "/i/tok/pay" });
  assert.equal(clearing.includes("Pay $100.00"), false);
  assert.ok(clearing.includes("bank payment is on its way"));
  assert.ok(renderPublicInvoicePage(base, settings, "2026-10-15", { payPath: "/i/tok/pay", bankTransfer: true }).includes("or bank account"));
  const paid = renderPublicInvoicePage({ ...base, status: "paid", paidAt: "2026-10-10T12:00:00.000Z" }, settings, "2026-10-15", { payPath: "/i/tok/pay" });
  assert.equal(paid.includes("<form"), false);
});

// ------------------------------------------------------------
// Phase 4: refunds as their own entries
// ------------------------------------------------------------
const { EntrySchema } = require("../shared/schemas/entry.ts");
const { computeEntry } = require("../shared/computeEntry.ts");
const { computeIncomeGaugeForEntries } = require("../shared/computeIncomeGauge.ts");
const { invoiceRefundableAmount, invoiceRefundedTotal } = require("../shared/schemas/invoice.ts");

function indEntry(over) {
  return {
    id: over.id ?? "e", workspace: "independent", date: "2026-10-22", notes: "",
    independent: { hours: 0, incomeBreakdowns: [], unreportedCash: 0, unreportedCashTips: 0, customIncome: [], ...over.independent },
    ...over.top,
  };
}
const refundInfo = (reason) => ({ reason, invoiceId: "i16", invoiceNumber: "0016", clientName: "Acme", stripeRefundId: null, stripeDisputeId: null });

run("refund entries: negative only on refunds, positive only on won disputes", () => {
  const refund = indEntry({ top: { kind: "refund", refund: refundInfo("requested_by_client") }, independent: { incomeBreakdowns: [{ paymentMethod: "pos", services: -200 }] } });
  assert.equal(EntrySchema.safeParse(refund).success, true);
  assert.equal(EntrySchema.safeParse({ ...refund, independent: { ...refund.independent, incomeBreakdowns: [{ paymentMethod: "pos", services: 200 }] } }).success, false);
  const won = indEntry({ top: { kind: "refund", refund: refundInfo("dispute_reversed") }, independent: { incomeBreakdowns: [{ paymentMethod: "pos", services: 450 }] } });
  assert.equal(EntrySchema.safeParse(won).success, true);
  assert.equal(EntrySchema.safeParse({ ...won, independent: { ...won.independent, incomeBreakdowns: [{ paymentMethod: "pos", services: -450 }] } }).success, false);
  // Ordinary entries can't go negative or carry refund details.
  assert.equal(EntrySchema.safeParse(indEntry({ independent: { incomeBreakdowns: [{ paymentMethod: "pos", services: -5 }] } })).success, false);
  assert.equal(EntrySchema.safeParse(indEntry({ top: { refund: refundInfo("other") }, independent: { incomeBreakdowns: [{ paymentMethod: "pos", services: 5 }] } })).success, false);
  assert.equal(EntrySchema.safeParse(indEntry({ top: { kind: "refund" }, independent: { incomeBreakdowns: [{ paymentMethod: "pos", services: -5 }] } })).success, false);
  // Existing entries without kind still parse.
  assert.equal(EntrySchema.safeParse(indEntry({ independent: { incomeBreakdowns: [{ paymentMethod: "zelle", services: 100 }] } })).success, true);
});

run("refunds net out of income totals but aren't days worked", () => {
  const settings = { independent: {} };
  const paid = indEntry({ id: "p", top: { date: "2026-10-18" }, independent: { incomeBreakdowns: [{ paymentMethod: "pos", services: 1042.5 }] } });
  paid.date = "2026-10-18";
  const refund = indEntry({ id: "r", top: { kind: "refund", refund: refundInfo("requested_by_client") }, independent: { incomeBreakdowns: [{ paymentMethod: "pos", services: -200 }] } });
  for (const e of [paid, refund]) e.totals = computeEntry(e, settings);
  assert.equal(refund.totals.dayTotal, -200);
  const gauge = computeIncomeGaugeForEntries([paid, refund], { includeUnreportedInUI: false });
  assert.equal(Math.round(gauge.incomeGauge * 100), 84250);
  assert.equal(gauge.daysWorked, 1);
});

run("named-payer refunds net their own custom income", () => {
  const { getNonCustomOtherIncome } = require("../shared/independentIncome.ts");
  const independent = {
    incomeBreakdowns: [{ paymentMethod: "other", services: -40 }],
    customIncome: [{ label: "Acme", amount: -40, category: "services" }],
  };
  assert.equal(getNonCustomOtherIncome(independent).total, 0);
});

run("refundable amount: total less refunds and disputed money", () => {
  const base = { status: "paid", total: 1042.5, refunds: [{ amount: 200 }], dispute: null };
  assert.equal(invoiceRefundedTotal(base), 200);
  assert.equal(invoiceRefundableAmount(base), 842.5);
  assert.equal(invoiceRefundableAmount({ ...base, dispute: { fundsWithdrawn: true, status: "open", amount: 842.5 } }), 0);
  assert.equal(invoiceRefundableAmount({ ...base, dispute: { fundsWithdrawn: true, status: "won", amount: 842.5 } }), 842.5);
  assert.equal(invoiceRefundableAmount({ ...base, status: "sent" }), 0);
});

run("display status: partly refunded, refunded, disputed", () => {
  const paid = { status: "paid", dueDate: "2026-11-14", paidAt: "2026-10-18T12:00:00.000Z", total: 100, refunds: [], dispute: null };
  assert.equal(invoiceDisplayStatus({ ...paid, refunds: [{ amount: 40 }] }, "2026-10-22").label, "Paid · partly refunded");
  assert.equal(invoiceDisplayStatus({ ...paid, refunds: [{ amount: 100 }] }, "2026-10-22").label, "Refunded");
  assert.equal(invoiceDisplayStatus({ ...paid, dispute: { status: "open" } }, "2026-10-22").label, "Disputed");
  assert.equal(invoiceDisplayStatus({ ...paid, dispute: { status: "won" } }, "2026-10-22").label, "Paid Oct 18, 2026");
});

run("payment streams: a refund nets its stream and keeps shares at 100%", () => {
  const Module = require("node:module");
  const path = require("node:path");
  const original = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith("@shared/")) request = path.join(__dirname, "..", "shared", request.slice(8));
    return original.call(this, request, ...rest);
  };
  try {
    const { computeIncomeStreams } = require("../frontend/lib/incomeStreams.ts");
    const paid = indEntry({ id: "p", independent: { incomeBreakdowns: [{ paymentMethod: "pos", services: 1042.5 }] } });
    const zelle = indEntry({ id: "z", independent: { incomeBreakdowns: [{ paymentMethod: "other", services: 480 }], customIncome: [{ label: "Maple Dental", amount: 480, category: "services" }] } });
    const cardRefund = indEntry({ id: "r1", top: { kind: "refund", refund: refundInfo("requested_by_client") }, independent: { incomeBreakdowns: [{ paymentMethod: "pos", services: -200 }] } });
    const namedRefund = indEntry({ id: "r2", top: { kind: "refund", refund: refundInfo("other") }, independent: { incomeBreakdowns: [{ paymentMethod: "other", services: -80 }], customIncome: [{ label: "Maple Dental", amount: -80, category: "services" }] } });
    const { total, streams } = computeIncomeStreams([paid, zelle, cardRefund, namedRefund], { includePersonalCash: false });
    assert.equal(Math.round(total * 100), 124250);
    const pos = streams.find((s) => s.key === "pos");
    assert.equal(pos.amount, 842.5);
    assert.ok(pos.days.some((d) => d.amount === -200) || pos.days.some((d) => d.entries.some((e) => e.amount === -200)));
    assert.equal(streams.find((s) => s.key === "named:maple dental").amount, 400);
    assert.equal(streams.find((s) => s.key === "other"), undefined);
    assert.equal(Math.round(streams.reduce((sum, s) => sum + s.share, 0) * 1000), 1000);
  } finally {
    Module._resolveFilename = original;
  }
});

process.stdout.write("invoice matching checks passed\n");
