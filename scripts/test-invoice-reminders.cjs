require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

const assert = require("node:assert/strict");

const { InvoiceSchema, InvoiceSettingsSchema, InvoiceSettingsPatchSchema, InvoiceStatusActionSchema } = require("../shared/schemas/invoice.ts");
const { invoiceWithPayments } = require("../shared/invoicePayments.ts");
const {
  invoiceNextReminder,
  invoiceReminderDue,
  invoiceReminderSchedule,
  invoiceRemindersApply,
} = require("../shared/invoiceReminders.ts");
const { buildInvoiceEmail, buildInvoiceReminderEmail } = require("../shared/invoiceEmail.ts");

function run(name, fn) {
  fn();
  process.stdout.write(`ok - ${name}\n`);
}

const NOW = Date.parse("2026-11-01T16:00:00.000Z");

function payment(id, amount, extra = {}) {
  return { id, purpose: "partial", amount, tipAmount: 0, receivedOn: "2026-10-05", via: "manual", method: "zelle", entryId: `e_${id}`, plaidTransactionId: null, stripePaymentIntentId: null, checkoutSessionId: null, feeAmount: 0, createdAt: "x", ...extra };
}

// An open invoice, emailed and shared Oct 1, due Oct 31.
function invoice(overrides = {}) {
  return InvoiceSchema.parse({
    id: "inv1",
    workspaceId: "w1",
    number: "0012",
    clientName: "Acme",
    clientEmail: "pat@example.com",
    lines: [{ description: "Sleeve", amount: 800, category: "services" }],
    total: 800,
    issueDate: "2026-10-01",
    dueDate: "2026-10-31",
    status: "sent",
    shareToken: "tok_abcdefghijklmnop",
    sharedAt: "2026-10-01T10:00:00.000Z",
    lastEmailedAt: "2026-10-01T10:00:00.000Z",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  });
}

function sentKeys(...keys) {
  return keys.map((key) => ({ key, sentAt: "2026-10-28T15:00:00.000Z" }));
}

/* --------------------------------------------------------
 * Schema
 * -------------------------------------------------------- */

run("invoices saved before reminders parse with reminders on and none sent", () => {
  const parsed = invoice();
  assert.deepEqual(parsed.reminderSends, []);
  assert.equal(parsed.remindersPaused, false);
});

run("reminders are off by default and can be turned on in settings", () => {
  assert.equal(InvoiceSettingsSchema.parse({}).autoReminders, false);
  assert.deepEqual(InvoiceSettingsPatchSchema.parse({ autoReminders: true }), { autoReminders: true });
  // A patch that leaves it out keeps the saved value.
  assert.equal("autoReminders" in InvoiceSettingsPatchSchema.parse({ offerTips: true }), false);
});

run("set_reminders is a status action", () => {
  assert.deepEqual(InvoiceStatusActionSchema.parse({ action: "set_reminders", paused: true }), { action: "set_reminders", paused: true });
  assert.equal(InvoiceStatusActionSchema.safeParse({ action: "set_reminders" }).success, false);
});

/* --------------------------------------------------------
 * Who gets reminders
 * -------------------------------------------------------- */

run("an open, shared invoice with a client email gets reminders", () => {
  assert.equal(invoiceRemindersApply(invoice()), true);
});

run("no reminders without an email, before it's shared, or once stopped", () => {
  assert.equal(invoiceRemindersApply(invoice({ clientEmail: null })), false);
  assert.equal(invoiceRemindersApply(invoice({ sharedAt: null })), false);
  assert.equal(invoiceRemindersApply(invoice({ remindersPaused: true })), false);
});

run("no reminders for drafts, paid, void or closed invoices", () => {
  assert.equal(invoiceRemindersApply(invoice({ status: "draft" })), false);
  assert.equal(invoiceRemindersApply(invoice({ status: "void" })), false);
  const paid = invoiceWithPayments(invoice(), [payment("a", 800)]);
  assert.equal(invoiceRemindersApply(paid), false);
  const closed = { ...invoiceWithPayments(invoice(), [payment("a", 300)]), status: "closed" };
  assert.equal(invoiceRemindersApply(closed), false);
});

run("no reminders while a bank payment clears or a chargeback is open", () => {
  const pending = { checkoutSessionId: "cs_1", purpose: "full", amount: 800, tipAmount: 0, startedAt: "2026-10-30T00:00:00.000Z" };
  assert.equal(invoiceRemindersApply(invoice({ pendingPayment: pending })), false);
  const dispute = (status) => ({ stripeDisputeId: "dp_1", status, amount: 300, updatedAt: "x" });
  const partly = (status) => ({ ...invoiceWithPayments(invoice(), [payment("a", 300)]), dispute: dispute(status) });
  assert.equal(invoiceRemindersApply(partly("open")), false);
  assert.equal(invoiceRemindersApply(partly("inquiry")), false);
  assert.equal(invoiceRemindersApply(partly("won")), true);
});

/* --------------------------------------------------------
 * The schedule
 * -------------------------------------------------------- */

run("the steps are 3 days before, the due date, and 3, 7 and 14 days after", () => {
  const schedule = invoiceReminderSchedule(invoice());
  assert.deepEqual(
    schedule.map((r) => [r.step, r.sendOn]),
    [
      ["before_3", "2026-10-28"],
      ["due", "2026-10-31"],
      ["overdue_3", "2026-11-03"],
      ["overdue_7", "2026-11-07"],
      ["overdue_14", "2026-11-14"],
    ]
  );
  assert.equal(schedule[0].key, "balance:2026-10-31:before_3");
  assert.equal(schedule[0].amount, 800);
});

run("steps on or before the day it was shared are dropped", () => {
  const late = invoice({ issueDate: "2026-10-29", sharedAt: "2026-10-29T18:00:00.000Z" });
  assert.deepEqual(invoiceReminderSchedule(late).map((r) => r.step), ["due", "overdue_3", "overdue_7", "overdue_14"]);
  const sameDay = invoice({ issueDate: "2026-10-31", sharedAt: "2026-10-31T09:00:00.000Z" });
  assert.deepEqual(invoiceReminderSchedule(sameDay).map((r) => r.step), ["overdue_3", "overdue_7", "overdue_14"]);
});

run("a step goes out on its day", () => {
  assert.equal(invoiceReminderDue(invoice(), "2026-10-28", NOW).step, "before_3");
  assert.equal(invoiceReminderDue(invoice(), "2026-10-31", NOW).step, "due");
  assert.equal(invoiceReminderDue(invoice(), "2026-11-14", NOW).step, "overdue_14");
  assert.equal(invoiceReminderDue(invoice(), "2026-10-30", NOW), null);
});

run("each step goes out once", () => {
  const sent = invoice({ reminderSends: sentKeys("balance:2026-10-31:due") });
  assert.equal(invoiceReminderDue(sent, "2026-10-31", NOW), null);
  assert.equal(invoiceReminderDue(sent, "2026-11-03", NOW).step, "overdue_3");
});

run("a missed run sends the next day, but never a backlog", () => {
  assert.equal(invoiceReminderDue(invoice(), "2026-11-01", NOW).step, "due");
  assert.equal(invoiceReminderDue(invoice(), "2026-11-02", NOW), null);
  // Turned on long after the due date: nothing until the next step's day.
  assert.equal(invoiceReminderDue(invoice(), "2026-11-10", NOW), null);
  assert.equal(invoiceReminderDue(invoice(), "2026-11-20", NOW), null);
});

run("no reminder within 2 days of the user emailing it", () => {
  const emailed = invoice({ lastEmailedAt: "2026-10-30T20:00:00.000Z" });
  assert.equal(invoiceReminderDue(emailed, "2026-10-31", Date.parse("2026-10-31T16:00:00.000Z")), null);
  assert.equal(invoiceReminderDue(emailed, "2026-11-03", Date.parse("2026-11-03T16:00:00.000Z")).step, "overdue_3");
});

run("a changed due date starts the steps over", () => {
  const moved = invoice({ dueDate: "2026-11-15", reminderSends: sentKeys("balance:2026-10-31:before_3") });
  assert.equal(invoiceReminderDue(moved, "2026-11-12", NOW).key, "balance:2026-11-15:before_3");
});

run("a deposit owed gets its own steps; paying it starts the balance's", () => {
  const withDeposit = invoice({ deposit: { amount: 200, dueDate: "2026-10-10" } });
  const deposit = invoiceReminderDue(withDeposit, "2026-10-10", NOW);
  assert.equal(deposit.key, "deposit:2026-10-10:due");
  assert.equal(deposit.amount, 200);
  const depositPaid = invoiceWithPayments(withDeposit, [payment("d", 200, { purpose: "deposit" })]);
  const balance = invoiceReminderDue(depositPaid, "2026-10-28", NOW);
  assert.equal(balance.key, "balance:2026-10-31:before_3");
  assert.equal(balance.amount, 600);
});

run("a waived deposit moves reminders to the full amount", () => {
  const waived = invoice({ deposit: { amount: 200, dueDate: "2026-10-10", waivedAt: "2026-10-09T00:00:00.000Z" } });
  assert.equal(invoiceReminderDue(waived, "2026-10-10", NOW), null);
  assert.equal(invoiceReminderDue(waived, "2026-10-31", NOW).amount, 800);
});

run("the next reminder is the first step still to go out", () => {
  assert.equal(invoiceNextReminder(invoice(), "2026-10-20").step, "before_3");
  assert.equal(invoiceNextReminder(invoice(), "2026-10-31").step, "due");
  const dueSent = invoice({ reminderSends: sentKeys("balance:2026-10-31:due") });
  assert.equal(invoiceNextReminder(dueSent, "2026-10-31").step, "overdue_3");
  assert.equal(invoiceNextReminder(invoice(), "2026-11-15"), null);
  assert.equal(invoiceNextReminder(invoice({ remindersPaused: true }), "2026-10-20"), null);
});

/* --------------------------------------------------------
 * The reminder email
 * -------------------------------------------------------- */

const settings = InvoiceSettingsSchema.parse({ businessName: "Ink & Co", businessEmail: "ink@example.com" });
const link = "https://app.the521app.com/i/tok_abcdefghijklmnop";

run("each step has its own subject and opening line", () => {
  const email = (step, inv = invoice()) => buildInvoiceReminderEmail({ invoice: inv, settings, link, payableOnline: true, step });
  assert.equal(email("before_3").subject, "Reminder: Invoice #0012 from Ink & Co — $800.00 due Oct 31");
  assert.equal(email("due").subject, "Due today: Invoice #0012 from Ink & Co — $800.00");
  assert.equal(email("overdue_7").subject, "Past due: Invoice #0012 from Ink & Co — $800.00 was due Oct 31");
  assert.ok(email("before_3").text.startsWith("Reminder from Ink & Co: A friendly reminder: Invoice #0012 is due Oct 31, 2026."));
  assert.ok(email("overdue_3").text.includes("If you've already paid, thank you — you can ignore this."));
  const deposit = email("due", invoice({ deposit: { amount: 200, dueDate: "2026-10-10" } }));
  assert.equal(deposit.subject, "Due today: Invoice #0012 from Ink & Co — $200.00 deposit");
  assert.ok(deposit.text.includes("The deposit for Invoice #0012 is due today."));
});

run("the reminder keeps the pay button and link, and escapes the business name", () => {
  const email = buildInvoiceReminderEmail({ invoice: invoice(), settings, link, payableOnline: true, step: "overdue_14" });
  assert.ok(email.html.includes("Pay $800.00 now"));
  assert.ok(email.html.includes(`href="${link}"`));
  assert.ok(email.text.includes(`Pay now: ${link}`));
  assert.ok(email.html.includes("Ink &amp; Co"));
  assert.equal(email.html.includes("Ink & Co"), false);
  assert.equal(email.html.includes("sent you Invoice"), false);
});

run("the invoice email itself is unchanged", () => {
  const email = buildInvoiceEmail({ invoice: invoice(), settings, link, payableOnline: false });
  assert.equal(email.subject, "Invoice #0012 from Ink & Co — $800.00 due Oct 31");
  assert.ok(email.text.startsWith("Ink & Co sent you Invoice #0012."));
  assert.ok(email.html.includes("sent you Invoice #0012"));
});

process.stdout.write("invoice reminder checks passed\n");
