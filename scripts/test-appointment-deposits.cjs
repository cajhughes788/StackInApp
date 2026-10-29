require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const {
  MIN_ONLINE_DEPOSIT,
  appointmentDepositAmount,
  appointmentDepositOnline,
  appointmentInvoiceFields,
  appointmentInvoiceId,
  appointmentMoney,
  appointmentRefundCutoffAt,
  cancellationPolicyText,
  clientCanCancel,
  clientCancelRefunds,
  depositCheckoutWindow,
  refundCutoffLabel,
} = require("../shared/appointmentDeposits.ts");
const { appointmentHoldsTime, appointmentTimes } = require("../shared/appointments.ts");
const { AppointmentActionSchema, AppointmentResponseSchema, AppointmentSchema } = require("../shared/schemas/appointment.ts");
const { BookingSettingsInputSchema, BookingSettingsSchema } = require("../shared/schemas/booking.ts");
const { InvoiceSchema, InvoiceSettingsSchema } = require("../shared/schemas/invoice.ts");
const { invoiceDisplayStatus } = require("../shared/invoiceDisplay.ts");
const { invoiceWithPayments } = require("../shared/invoicePayments.ts");
const { renderPublicAppointmentPage } = require("../shared/appointmentPublicPage.ts");

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

const NOW = "2026-12-01T12:00:00.000Z";

// Dec 3, 10am Chicago = 16:00 UTC.
function appointment(extra = {}) {
  const base = { date: "2026-12-03", startTime: "10:00", timeZone: "America/Chicago", minutes: 60, bufferMinutes: 0 };
  const merged = { ...base, ...extra };
  return AppointmentSchema.parse({
    id: "a1",
    workspaceId: "ws",
    clientId: "c1",
    clientName: "Jordan Lee",
    clientEmail: null,
    clientPhone: null,
    serviceId: "svc_1",
    serviceName: "Haircut",
    price: 80,
    deposit: { type: "fixed", value: 20 },
    ...appointmentTimes(merged),
    status: "confirmed",
    holdExpiresAt: null,
    shareToken: "tok",
    createdAt: NOW,
    updatedAt: NOW,
    ...merged,
  });
}

function payment(extra = {}) {
  return {
    id: "stripe_pi_1",
    purpose: "deposit",
    amount: 20,
    tipAmount: 0,
    receivedOn: "2026-12-01",
    via: "online",
    method: "pos",
    entryId: "e1",
    plaidTransactionId: null,
    stripePaymentIntentId: "pi_1",
    checkoutSessionId: "cs_1",
    feeAmount: 0.88,
    createdAt: NOW,
    ...extra,
  };
}

function refund(extra = {}) {
  return {
    id: "re_1",
    entryId: "e2",
    amount: 20,
    date: "2026-12-02",
    reason: "requested_by_client",
    stripeRefundId: "re_1",
    plaidTransactionId: null,
    paymentId: "stripe_pi_1",
    ...extra,
  };
}

console.log("amounts");

test("a fixed deposit, or a percent of the booked price to the cent", () => {
  assert.equal(appointmentDepositAmount(appointment()), 20);
  assert.equal(appointmentDepositAmount(appointment({ price: 45.5, deposit: { type: "percent", value: 25 } })), 11.38);
  assert.equal(appointmentDepositAmount(appointment({ deposit: { type: "none", value: 0 } })), 0);
});

test("paid online only with card payments on and at least Stripe's $0.50", () => {
  assert.equal(appointmentDepositOnline(appointment(), true), true);
  assert.equal(appointmentDepositOnline(appointment(), false), false);
  assert.equal(appointmentDepositOnline(appointment({ deposit: { type: "fixed", value: 0.49 } }), true), false);
  assert.equal(appointmentDepositOnline(appointment({ deposit: { type: "fixed", value: MIN_ONLINE_DEPOSIT } }), true), true);
  assert.equal(appointmentDepositOnline(appointment({ deposit: { type: "none", value: 0 } }), true), false);
});

console.log("money");

test("due until paid; none without a deposit", () => {
  assert.deepEqual(appointmentMoney(appointment(), null), { kind: "due", amount: 20 });
  assert.deepEqual(appointmentMoney(appointment({ deposit: { type: "none", value: 0 } }), null), { kind: "none" });
});

test("paid shows what's held now; all of it given back is refunded", () => {
  assert.deepEqual(appointmentMoney(appointment(), { payments: [payment()], refunds: [] }), {
    kind: "paid",
    amount: 20,
    paidOn: "2026-12-01",
  });
  assert.deepEqual(appointmentMoney(appointment(), { payments: [payment()], refunds: [refund({ amount: 5 })] }), {
    kind: "paid",
    amount: 15,
    paidOn: "2026-12-01",
  });
  assert.deepEqual(appointmentMoney(appointment(), { payments: [payment()], refunds: [refund()] }), { kind: "refunded", amount: 20 });
});

console.log("cancellation rule");

test("the cutoff is that many hours before the start", () => {
  assert.equal(appointmentRefundCutoffAt(appointment()), "2026-12-02T16:00:00.000Z");
  assert.equal(appointmentRefundCutoffAt(appointment({ refundCutoffHours: 168 })), "2026-11-26T16:00:00.000Z");
  assert.equal(appointmentRefundCutoffAt(appointment({ refundCutoffHours: null })), null);
});

test("canceling before the cutoff refunds; at or after it, the deposit is kept", () => {
  const a = appointment();
  assert.equal(clientCancelRefunds(a, "2026-12-02T15:59:59.000Z"), true);
  assert.equal(clientCancelRefunds(a, "2026-12-02T16:00:00.000Z"), false);
  assert.equal(clientCancelRefunds(appointment({ refundCutoffHours: null }), NOW), false);
});

test("the client can cancel a confirmed appointment until it starts", () => {
  assert.equal(clientCanCancel(appointment(), NOW), true);
  assert.equal(clientCanCancel(appointment(), "2026-12-03T16:00:00.000Z"), false);
  assert.equal(clientCanCancel(appointment({ status: "requested", holdExpiresAt: "2026-12-02T00:00:00.000Z" }), NOW), false);
});

test("the rule in words", () => {
  assert.equal(refundCutoffLabel(24), "24 hours");
  assert.equal(refundCutoffLabel(48), "2 days");
  assert.equal(refundCutoffLabel(72), "3 days");
  assert.equal(refundCutoffLabel(168), "1 week");
  assert.match(cancellationPolicyText(24), /Free to cancel up to 24 hours before your appointment\. After that, the deposit is kept\./);
  assert.equal(cancellationPolicyText(null), "Deposits aren't refunded if you cancel.");
});

test("booking settings default to 24 hours; null means never; old app saves leave it out", () => {
  assert.equal(BookingSettingsSchema.parse({}).refundCutoffHours, 24);
  assert.equal(BookingSettingsSchema.parse({ refundCutoffHours: null }).refundCutoffHours, null);
  const input = {
    services: [],
    weeklyHours: BookingSettingsSchema.parse({}).weeklyHours,
    daysOff: [],
    minNoticeHours: 2,
    maxDaysAhead: 60,
    slotStepMinutes: 30,
    timeZone: "",
  };
  assert.equal(BookingSettingsInputSchema.parse(input).refundCutoffHours, undefined);
  assert.equal(BookingSettingsInputSchema.safeParse({ ...input, refundCutoffHours: 200 }).success, false);
});

test("appointments booked before deposits read with the default rule and no invoice", () => {
  const a = appointment();
  assert.equal(a.refundCutoffHours, 24);
  assert.equal(a.invoiceId, null);
  assert.equal(a.depositCheckout, null);
  assert.equal(a.canceledBy, null);
});

console.log("paying near the end of the hold");

test("plenty of hold left: checkout closes with the hold, which stays as it is", () => {
  const now = Date.parse(NOW);
  const window = depositCheckoutWindow("2026-12-01T20:00:00.000Z", now);
  assert.equal(window.expiresAtSeconds, Date.parse("2026-12-01T20:00:00.000Z") / 1000);
  assert.equal(window.holdExpiresAt, null);
});

test("10 minutes left: the hold stretches to cover Stripe's shortest checkout", () => {
  const now = Date.parse(NOW);
  const window = depositCheckoutWindow("2026-12-01T12:10:00.000Z", now);
  assert.equal(window.holdExpiresAt, "2026-12-01T12:31:00.000Z");
  assert.equal(window.expiresAtSeconds, Date.parse("2026-12-01T12:31:00.000Z") / 1000);
});

test("a hold days away still gives a checkout Stripe allows (under 24 hours)", () => {
  const now = Date.parse(NOW);
  const window = depositCheckoutWindow("2026-12-03T00:00:00.000Z", now);
  assert.equal(window.expiresAtSeconds, now / 1000 + 23 * 3600);
  assert.equal(window.holdExpiresAt, null);
});

test("a stretched hold keeps the time from anyone else", () => {
  const extended = depositCheckoutWindow("2026-12-01T12:10:00.000Z", Date.parse(NOW)).holdExpiresAt;
  const held = appointment({ status: "requested", holdExpiresAt: extended });
  assert.equal(appointmentHoldsTime(held, "2026-12-01T12:20:00.000Z"), true);
  assert.equal(appointmentHoldsTime(held, "2026-12-01T12:31:00.000Z"), false);
});

console.log("statuses and actions");

test("a no-show keeps its time like a finished one", () => {
  assert.equal(appointmentHoldsTime(appointment({ status: "no_show" }), NOW), true);
});

test("record deposit needs a date, a method and a retry key; clients can cancel", () => {
  assert.equal(
    AppointmentActionSchema.safeParse({ action: "record_deposit", paidDate: "2026-12-01", paymentMethod: "cash", clientMutationId: "m1" }).success,
    true
  );
  assert.equal(AppointmentActionSchema.safeParse({ action: "record_deposit", paidDate: "2026-12-01", clientMutationId: "m1" }).success, false);
  assert.equal(AppointmentActionSchema.safeParse({ action: "no_show" }).success, true);
  assert.equal(AppointmentResponseSchema.safeParse("cancel").success, true);
});

console.log("the invoice behind an appointment");

test("one line at the booked price, the deposit due today, the rest due on the day", () => {
  const fields = appointmentInvoiceFields(appointment(), "2026-12-01");
  assert.equal(appointmentInvoiceId("a1"), "appt_a1");
  assert.equal(fields.lines.length, 1);
  assert.match(fields.lines[0].description, /^Haircut — Thu, Dec 3 at 10am$/);
  assert.equal(fields.total, 80);
  assert.equal(fields.issueDate, "2026-12-01");
  assert.equal(fields.dueDate, "2026-12-03");
  assert.deepEqual(fields.deposit, { amount: 20, dueDate: "2026-12-01", waivedAt: null });
  assert.match(fields.policies, /24 hours/);
});

test("a deposit of the whole price is a full payment, and the invoice parses", () => {
  const whole = appointmentInvoiceFields(appointment({ deposit: { type: "fixed", value: 80 } }), "2026-12-01");
  assert.equal(whole.deposit, null);
  for (const fields of [whole, appointmentInvoiceFields(appointment(), "2026-12-01")]) {
    const invoice = InvoiceSchema.parse({
      id: "appt_a1",
      workspaceId: "ws",
      number: "0007",
      clientName: "Jordan Lee",
      ...fields,
      appointmentId: "a1",
      remindersPaused: true,
      status: "sent",
      createdAt: NOW,
      updatedAt: NOW,
    });
    assert.equal(invoice.appointmentId, "a1");
  }
});

test("booked on the day itself, everything is due that day", () => {
  assert.equal(appointmentInvoiceFields(appointment(), "2026-12-03").dueDate, "2026-12-03");
});

test("a closed invoice whose deposit was refunded says so, not 'kept'", () => {
  const base = InvoiceSchema.parse({
    id: "appt_a1",
    workspaceId: "ws",
    number: "0007",
    clientName: "Jordan Lee",
    ...appointmentInvoiceFields(appointment(), "2026-12-01"),
    status: "sent",
    createdAt: NOW,
    updatedAt: NOW,
  });
  const paid = { ...invoiceWithPayments(base, [payment()]), status: "closed" };
  assert.equal(invoiceDisplayStatus(paid, "2026-12-05").label, "Closed · $20.00 kept");
  assert.equal(invoiceDisplayStatus({ ...paid, refunds: [refund()] }, "2026-12-05").label, "Closed · refunded");
});

console.log("client's page");

const settings = InvoiceSettingsSchema.parse({ businessName: "Fresh <Cuts>" });
const page = (a, options = {}) =>
  renderPublicAppointmentPage(a, settings, {
    respondPath: "/b/tok/respond",
    payPath: "/b/tok/pay",
    pagePath: "/b/tok",
    invoice: null,
    depositOnline: true,
    nowIso: NOW,
    ...options,
  });
const waiting = () => appointment({ status: "requested", holdExpiresAt: "2026-12-03T00:00:00.000Z" });

test("a waiting request with an online deposit confirms by paying", () => {
  const html = page(waiting());
  assert.match(html, /formaction="\/b\/tok\/pay">Confirm &amp; pay \$20\.00 deposit/);
  assert.doesNotMatch(html, /value="confirm"/);
  assert.match(html, /I can&#39;t make it|I can't make it/);
  assert.match(html, /\$20\.00, paid now to book/);
  assert.match(html, /Free to cancel up to 24 hours before/);
});

test("without online payments it confirms as before, deposit paid at the appointment", () => {
  const html = page(waiting(), { depositOnline: false });
  assert.match(html, /value="confirm">Confirm appointment/);
  assert.doesNotMatch(html, /\/b\/tok\/pay/);
  assert.match(html, /paid at your appointment/);
});

test("a confirmed appointment with the deposit owed offers Pay, and Cancel", () => {
  const html = page(appointment());
  assert.match(html, /action="\/b\/tok\/pay"[\s\S]*Pay \$20\.00 deposit/);
  assert.match(html, /href="\/b\/tok\?cancel=1">Cancel appointment/);
});

test("once paid: no Pay button, the deposit shows paid", () => {
  const html = page(appointment(), { invoice: { payments: [payment()], refunds: [] } });
  assert.doesNotMatch(html, /\/b\/tok\/pay/);
  assert.match(html, /\$20\.00 paid/);
});

test("back from Stripe before the webhook lands: payment received, confirming", () => {
  assert.match(page(waiting(), { justPaid: true }), /Payment received — confirming your booking/);
  assert.match(page(appointment(), { justPaid: true, invoice: { payments: [payment()], refunds: [] } }), /Deposit received — you're booked/);
});

test("the cancel step says the deposit comes back before the cutoff", () => {
  const html = page(appointment(), { askingToCancel: true, invoice: { payments: [payment()], refunds: [] } });
  assert.match(html, /Cancel this appointment\?/);
  assert.match(html, /Your \$20\.00 deposit will be refunded to your card\./);
  assert.match(html, /name="answer" value="cancel">Yes, cancel appointment/);
  assert.match(html, /href="\/b\/tok">Keep my appointment/);
});

test("after the cutoff it says the deposit is kept; a cash deposit is for the business", () => {
  const late = page(appointment(), { askingToCancel: true, nowIso: "2026-12-03T00:00:00.000Z", invoice: { payments: [payment()], refunds: [] } });
  assert.match(late, /less than 24 hours before your appointment, so your \$20\.00 deposit won&#39;t be refunded|won't be refunded/);
  const cash = page(appointment(), {
    askingToCancel: true,
    invoice: { payments: [payment({ id: "manual_1", via: "manual", method: "cash", stripePaymentIntentId: null })], refunds: [] },
  });
  assert.match(cash, /Contact Fresh &lt;Cuts&gt; about your \$20\.00 deposit/);
});

test("canceled: refunded or kept, in words", () => {
  const refunded = page(appointment({ status: "canceled", canceledBy: "client" }), { invoice: { payments: [payment()], refunds: [refund()] } });
  assert.match(refunded, /You canceled this appointment\. Your deposit was refunded/);
  const kept = page(appointment({ status: "canceled", canceledBy: "client" }), { invoice: { payments: [payment()], refunds: [] } });
  assert.match(kept, /deposit was kept, per the cancellation policy/);
  const byOwner = page(appointment({ status: "canceled", canceledBy: "owner" }), { invoice: { payments: [payment()], refunds: [refund()] } });
  assert.match(byOwner, /This appointment was canceled\. Your deposit was refunded/);
});

test("a no-show shows Missed and that the deposit was kept", () => {
  const html = page(appointment({ status: "no_show" }), { invoice: { payments: [payment()], refunds: [] }, nowIso: "2026-12-04T00:00:00.000Z" });
  assert.match(html, />Missed</);
  assert.match(html, /missed, so the deposit was kept/);
  assert.doesNotMatch(html, /Cancel appointment/);
});

if (failures > 0) {
  console.error(`\n${failures} appointment deposit test(s) failed`);
  process.exit(1);
}
