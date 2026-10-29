require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const {
  appointmentCanFinish,
  appointmentFinishFromInvoice,
  appointmentFinishLines,
  appointmentFinishSummary,
  appointmentLeftToPay,
  appointmentNeedsPayment,
} = require("../shared/appointmentCheckout.ts");
const { appointmentInvoiceFields } = require("../shared/appointmentDeposits.ts");
const { appointmentTimes } = require("../shared/appointments.ts");
const { renderPublicInvoicePage } = require("../shared/invoicePublicPage.ts");
const { invoiceLedgerFields } = require("../shared/invoicePayments.ts");
const { AppointmentActionSchema, AppointmentSchema } = require("../shared/schemas/appointment.ts");
const { InvoiceSchema, InvoiceSettingsSchema } = require("../shared/schemas/invoice.ts");

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

// Dec 3, 10am Chicago = 16:00 UTC; $80 with a $20 deposit.
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

const DEPOSIT_PAYMENT = {
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
};

function depositInvoice(extra = {}) {
  const a = appointment();
  const payments = extra.payments ?? [DEPOSIT_PAYMENT];
  return InvoiceSchema.parse({
    id: "appt_a1",
    workspaceId: "ws",
    number: "0007",
    clientName: "Jordan Lee",
    ...appointmentInvoiceFields(a, "2026-12-01"),
    appointmentId: "a1",
    status: "sent",
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
    payments,
    ...invoiceLedgerFields(payments),
  });
}

console.log("what's owed");

test("the rest after the deposit", () => {
  const summary = appointmentFinishSummary(appointment(), depositInvoice(), [], 0);
  assert.deepEqual(summary, { ok: true, total: 80, paid: 20, due: 60 });
  assert.equal(appointmentLeftToPay(appointment(), depositInvoice()), 60);
  assert.equal(appointmentLeftToPay(appointment(), null), 80);
});

test("extras add their own lines; a discount comes off the service", () => {
  const built = appointmentFinishLines(appointment(), [{ description: "Beard trim", amount: 15 }], 10);
  assert.equal(built.total, 85);
  assert.equal(built.lines.length, 2);
  assert.match(built.lines[0].description, /^Haircut — .* \(\$10\.00 off\)$/);
  assert.equal(built.lines[0].amount, 70);
  assert.deepEqual(
    { description: built.lines[1].description, amount: built.lines[1].amount, category: built.lines[1].category },
    { description: "Beard trim", amount: 15, category: "services" }
  );
  const summary = appointmentFinishSummary(appointment(), depositInvoice(), [{ description: "Beard trim", amount: 15 }], 10);
  assert.equal(summary.due, 65);
});

test("cents add up exactly", () => {
  const built = appointmentFinishLines(appointment({ price: 45.1 }), [{ description: "Wax", amount: 0.2 }], 0.1);
  assert.equal(built.total, 45.2);
});

test("a whole-service discount leaves only the extras", () => {
  const built = appointmentFinishLines(appointment(), [{ description: "Product", amount: 25 }], 80);
  assert.equal(built.lines.length, 1);
  assert.equal(built.total, 25);
});

test("errors: discount over the service, nothing to charge, at or below what's paid", () => {
  assert.match(appointmentFinishLines(appointment(), [], 81).error, /can't be more than the \$80\.00 service/);
  assert.match(appointmentFinishLines(appointment(), [], 80).error, /nothing to charge/);
  const covered = appointmentFinishSummary(appointment(), depositInvoice(), [], 60);
  assert.equal(covered.ok, false);
  assert.match(covered.error, /no more than the \$20\.00 already paid/);
});

console.log("\nwhen it shows");

test("from the appointment's day on, in the business's time zone", () => {
  const a = appointment();
  assert.equal(appointmentCanFinish(a, null, NOW), false); // Dec 1
  // 1am UTC Dec 3 is still Dec 2 in Chicago.
  assert.equal(appointmentCanFinish(a, null, "2026-12-03T01:00:00.000Z"), false);
  assert.equal(appointmentCanFinish(a, null, "2026-12-03T07:00:00.000Z"), true);
  assert.equal(appointmentCanFinish(a, null, "2026-12-10T07:00:00.000Z"), true);
  for (const status of ["requested", "canceled", "no_show", "declined", "expired"]) {
    assert.equal(appointmentCanFinish(appointment({ status }), null, "2026-12-03T17:00:00.000Z"), false, status);
  }
});

test("a finished appointment comes back only while its money is open", () => {
  const done = appointment({ status: "completed" });
  assert.equal(appointmentCanFinish(done, depositInvoice(), NOW), true);
  assert.equal(appointmentCanFinish(done, depositInvoice({ status: "closed" }), NOW), false);
  assert.equal(appointmentCanFinish(done, null, NOW), false);
});

test("Needs you: over and unfinished, or a QR finish never paid", () => {
  const after = "2026-12-03T17:30:00.000Z";
  assert.equal(appointmentNeedsPayment(appointment(), null, "2026-12-03T16:30:00.000Z"), false); // still on
  assert.equal(appointmentNeedsPayment(appointment(), null, after), true);
  const done = appointment({ status: "completed" });
  assert.equal(appointmentNeedsPayment(done, depositInvoice({ quickCharge: { askForTip: true } }), after), true);
  // Pay later: chased by the invoice's own reminders, not here.
  assert.equal(appointmentNeedsPayment(done, depositInvoice(), after), false);
  assert.equal(appointmentNeedsPayment(done, null, after), false);
  assert.equal(appointmentNeedsPayment(appointment({ status: "canceled" }), null, after), false);
});

console.log("\ncoming back to it");

test("reopens with the extras and discount it was finished with", () => {
  const a = appointment();
  const built = appointmentFinishLines(a, [{ description: "Beard trim", amount: 15 }], 10);
  assert.deepEqual(appointmentFinishFromInvoice(a, { lines: built.lines }), {
    extras: [{ description: "Beard trim", amount: 15 }],
    discount: 10,
  });
  const allOff = appointmentFinishLines(a, [{ description: "Product", amount: 25 }], 80);
  assert.deepEqual(appointmentFinishFromInvoice(a, { lines: allOff.lines }), {
    extras: [{ description: "Product", amount: 25 }],
    discount: 80,
  });
  assert.deepEqual(appointmentFinishFromInvoice(a, null), { extras: [], discount: 0 });
});

console.log("\nthe action");

test("finish parses with defaults and rejects bad money", () => {
  const parsed = AppointmentActionSchema.parse({ action: "finish", way: "qr", clientMutationId: "m1" });
  assert.deepEqual(
    { extras: parsed.extras, discount: parsed.discount, askForTip: parsed.askForTip, tipAmount: parsed.tipAmount },
    { extras: [], discount: 0, askForTip: true, tipAmount: 0 }
  );
  const bad = (extra) => AppointmentActionSchema.safeParse({ action: "finish", way: "paid", clientMutationId: "m1", ...extra }).success;
  assert.equal(bad({ discount: -5 }), false);
  assert.equal(bad({ discount: 1.005 }), false);
  assert.equal(bad({ tipAmount: -1 }), false);
  assert.equal(bad({ extras: [{ description: "", amount: 5 }] }), false);
  assert.equal(bad({ extras: [{ description: "Wax", amount: 0 }] }), false);
  assert.equal(bad({ way: "venmo" }), false);
  assert.equal(bad({ extras: [{ description: "Wax", amount: 12.5 }], tipAmount: 5, paymentMethod: "cash" }), true);
});

console.log("\nthe client's pay screen");

test("a QR finish after a deposit shows what's left, not the whole bill", () => {
  const settings = InvoiceSettingsSchema.parse({ businessName: "Fresh Cuts" });
  const invoice = depositInvoice({ quickCharge: { askForTip: true }, shareToken: "t".repeat(22) });
  const html = renderPublicInvoicePage(invoice, settings, "2026-12-03");
  assert.match(html, /<div class="due">\$60\.00<\/div>/);
  assert.match(html, /\$20\.00 already paid of \$80\.00/);
  // A plain quick charge, nothing paid: just the amount.
  const plain = renderPublicInvoicePage(depositInvoice({ quickCharge: { askForTip: true }, payments: [], deposit: null }), settings, "2026-12-03");
  assert.match(plain, /<div class="due">\$80\.00<\/div>/);
  assert.doesNotMatch(plain, /already paid/);
});

if (failures > 0) {
  console.error(`\n${failures} appointment checkout test(s) failed`);
  process.exit(1);
}
