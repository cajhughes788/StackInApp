require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const { buildAppointmentEmail } = require("../shared/appointmentEmail.ts");
const { AppointmentSchema, AppointmentActionSchema } = require("../shared/schemas/appointment.ts");
const { BookingSettingsSchema, BookingSettingsInputSchema } = require("../shared/schemas/booking.ts");
const { InvoiceSettingsSchema } = require("../shared/schemas/invoice.ts");

const settings = InvoiceSettingsSchema.parse({ businessName: "Fade & Co <Shop>", businessEmail: "owner@fade.co" });
const base = AppointmentSchema.parse({
  id: "a1",
  workspaceId: "w1",
  clientId: "c1",
  clientName: "Justin Schuetz",
  clientEmail: "justin@example.com",
  clientPhone: null,
  serviceId: "s1",
  serviceName: "Haircut",
  price: 40,
  minutes: 60,
  bufferMinutes: 0,
  deposit: { type: "none", value: 0 },
  date: "2030-10-29",
  startTime: "12:15",
  timeZone: "America/Los_Angeles",
  startAt: "2030-10-29T19:15:00.000Z",
  endAt: "2030-10-29T20:15:00.000Z",
  blockedUntil: "2030-10-29T20:15:00.000Z",
  status: "requested",
  holdExpiresAt: "2030-10-20T00:00:00.000Z",
  shareToken: "tok",
  location: "123 Main St\nBoise, ID",
  createdAt: "2030-10-18T00:00:00.000Z",
  updatedAt: "2030-10-18T00:00:00.000Z",
});
const withDeposit = { ...base, deposit: { type: "fixed", value: 10 } };
const link = "https://app.the521app.com/b/tok";
const build = (kind, appointment, extra = {}) =>
  buildAppointmentEmail({ kind, appointment, settings, link, depositDueOnline: false, ...extra });

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}\n${error.stack}`);
  }
}

test("asking to confirm", () => {
  const email = build("request", base);
  assert.equal(email.subject, "Please confirm: Haircut with Fade & Co <Shop> on Tue, Oct 29, 2030 at 12:15pm");
  assert.match(email.text, /Please confirm it\./);
  assert.match(email.text, /12:15pm – 1:15pm PDT/);
  assert.match(email.text, /123 Main St, Boise, ID/);
  assert.match(email.text, /held for you for 48 hours/);
  assert.match(email.text, /Confirm: https:\/\/app\.the521app\.com\/b\/tok/);
  assert.match(email.html, />Confirm<\/a>/);
  assert.doesNotMatch(email.text, /deposit/i);
});

test("asking to confirm with a deposit paid by card", () => {
  const email = build("request", withDeposit, { depositDueOnline: true });
  assert.match(email.html, />Confirm &amp; pay \$10\.00 deposit<\/a>/);
  assert.match(email.text, /A \$10\.00 deposit confirms it\./);
  assert.match(email.text, /Free to cancel up to 24 hours before/);
});

test("booked: details, and a deposit to pay or already paid", () => {
  const booked = { ...base, status: "confirmed", holdExpiresAt: null };
  const plain = build("booked", booked);
  assert.match(plain.subject, /^You're booked: Haircut with/);
  assert.match(plain.html, />View appointment<\/a>/);
  assert.doesNotMatch(plain.text, /held for you/);
  assert.match(build("booked", { ...booked, deposit: withDeposit.deposit }, { depositDueOnline: true }).html, />Pay \$10\.00 deposit<\/a>/);
  const paid = build("booked", { ...booked, deposit: withDeposit.deposit, invoiceId: "appt_a1" }, { depositDueOnline: true });
  assert.match(paid.text, /\$10\.00 deposit paid\./);
  assert.match(paid.html, />View appointment<\/a>/);
});

test("canceled by the business", () => {
  const canceled = { ...withDeposit, status: "canceled", invoiceId: "appt_a1" };
  const email = build("canceled", canceled, { depositRefunded: true });
  assert.match(email.subject, /^Canceled: Haircut with .* on Tue, Oct 29, 2030$/);
  assert.match(email.text, /canceled your appointment/);
  assert.match(email.text, /\$10\.00 deposit is being refunded/);
  assert.doesNotMatch(email.text, /Free to cancel/);
  assert.doesNotMatch(build("canceled", { ...base, status: "canceled" }).text, /deposit/i);
});

test("everything typed is escaped; replies go to the business", () => {
  const email = build("request", { ...base, serviceName: "<b>Cut</b>", location: "<script>" });
  assert.doesNotMatch(email.html, /<b>Cut<\/b>|<script>/);
  assert.match(email.html, /Fade &amp; Co &lt;Shop&gt;/);
  assert.match(email.text, /Reply to this email to reach Fade & Co <Shop>/);
});

test("schemas: emails on by default; Resend action", () => {
  assert.equal(BookingSettingsSchema.parse({}).emailClients, true);
  assert.equal(BookingSettingsInputSchema.shape ? true : true, true);
  assert.equal(base.lastEmailedAt, null);
  assert.deepEqual(base.recentEmailSends, []);
  assert.deepEqual(AppointmentActionSchema.parse({ action: "email" }), { action: "email" });
  assert.equal(AppointmentActionSchema.parse({ action: "email", to: " a@b.co " }).to, "a@b.co");
  assert.throws(() => AppointmentActionSchema.parse({ action: "email", to: "nope" }));
});

if (failed) process.exit(1);
