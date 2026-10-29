require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const {
  appointmentDayWords,
  appointmentReminderKey,
  appointmentReminderNudgeText,
  dueAppointmentReminder,
  formatReminderMoment,
} = require("../shared/appointmentReminders.ts");
const { buildAppointmentEmail } = require("../shared/appointmentEmail.ts");
const { appointmentTimes } = require("../shared/appointments.ts");
const { AppointmentSchema } = require("../shared/schemas/appointment.ts");
const { BookingSettingsInputSchema, BookingSettingsSchema } = require("../shared/schemas/booking.ts");
const { InvoiceSettingsSchema } = require("../shared/schemas/invoice.ts");
const { bookingButtonCode, websiteBookingUrl } = require("../shared/onlineBooking.ts");

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

// Booked Dec 1; the appointment is Dec 3, 10am Chicago = 16:00 UTC.
const BOOKED = "2026-12-01T12:00:00.000Z";
const START = "2026-12-03T16:00:00.000Z";
const hoursBefore = (hours) => new Date(Date.parse(START) - hours * 3_600_000).toISOString();

function appointment(extra = {}) {
  const base = { date: "2026-12-03", startTime: "10:00", timeZone: "America/Chicago", minutes: 60, bufferMinutes: 0 };
  const merged = { ...base, ...extra };
  return AppointmentSchema.parse({
    id: "a1",
    workspaceId: "ws",
    clientId: "c1",
    clientName: "Jordan Lee",
    clientEmail: "jordan@example.com",
    clientPhone: null,
    serviceId: "svc_1",
    serviceName: "Haircut",
    price: 80,
    deposit: { type: "fixed", value: 20 },
    ...appointmentTimes(merged),
    status: "confirmed",
    holdExpiresAt: null,
    shareToken: "tok",
    createdAt: BOOKED,
    updatedAt: BOOKED,
    ...merged,
  });
}

test("reminders default to 1 day before; old saves read as their times", () => {
  assert.deepEqual(BookingSettingsSchema.parse({}).reminders, [24]);
  assert.deepEqual(BookingSettingsSchema.parse({ reminders: "off" }).reminders, []);
  assert.deepEqual(BookingSettingsSchema.parse({ reminders: "day" }).reminders, [24]);
  assert.deepEqual(BookingSettingsSchema.parse({ reminders: "day_and_hours" }).reminders, [24, 2]);
  assert.equal(BookingSettingsInputSchema.shape.reminders.parse(undefined), undefined);
});

test("up to two, from the list, different, earliest first", () => {
  assert.deepEqual(BookingSettingsSchema.parse({ reminders: [2, 168] }).reminders, [168, 2]);
  assert.throws(() => BookingSettingsSchema.parse({ reminders: "weekly" }));
  assert.throws(() => BookingSettingsSchema.parse({ reminders: [5] }));
  assert.throws(() => BookingSettingsSchema.parse({ reminders: [24, 24] }));
  assert.throws(() => BookingSettingsSchema.parse({ reminders: [168, 24, 2] }));
});

test("1 day before: due from 24 hours out until it starts", () => {
  const a = appointment();
  assert.equal(dueAppointmentReminder(a, [24], hoursBefore(25)), null);
  assert.equal(dueAppointmentReminder(a, [24], hoursBefore(24)), 24);
  assert.equal(dueAppointmentReminder(a, [24], hoursBefore(1)), 24);
  assert.equal(dueAppointmentReminder(a, [24], START), null);
});

test("two reminders: the earlier gives way once the later is due", () => {
  const a = appointment();
  assert.equal(dueAppointmentReminder(a, [24, 2], hoursBefore(23)), 24);
  assert.equal(dueAppointmentReminder(a, [24, 2], hoursBefore(2)), 2);
  assert.equal(dueAppointmentReminder(a, [24, 2], hoursBefore(0.5)), 2);
  // Any pair from the list.
  const early = appointment({ createdAt: "2026-11-20T12:00:00.000Z", updatedAt: "2026-11-20T12:00:00.000Z" });
  assert.equal(dueAppointmentReminder(early, [168, 1], hoursBefore(169)), null);
  assert.equal(dueAppointmentReminder(early, [168, 1], hoursBefore(100)), 168);
  assert.equal(dueAppointmentReminder(early, [168, 1], hoursBefore(1)), 1);
  assert.equal(dueAppointmentReminder(early, [72, 4], hoursBefore(48)), 72);
});

test("off, or not confirmed: nothing", () => {
  assert.equal(dueAppointmentReminder(appointment(), [], hoursBefore(3)), null);
  for (const status of ["requested", "canceled", "declined", "expired", "completed", "no_show"]) {
    assert.equal(dueAppointmentReminder(appointment({ status }), [24, 2], hoursBefore(3)), null, status);
  }
});

test("booked after a reminder's time: that one is skipped", () => {
  // Booked 5 hours ahead: no "1 day before", but the 2-hour one still comes.
  const late = appointment({ createdAt: hoursBefore(5), updatedAt: hoursBefore(5) });
  assert.equal(dueAppointmentReminder(late, [24], hoursBefore(4)), null);
  assert.equal(dueAppointmentReminder(late, [24, 2], hoursBefore(4)), null);
  assert.equal(dueAppointmentReminder(late, [24, 2], hoursBefore(2)), 2);
  // Booked 1 hour ahead: neither.
  const last = appointment({ createdAt: hoursBefore(1), updatedAt: hoursBefore(1) });
  assert.equal(dueAppointmentReminder(last, [24, 2], hoursBefore(0.5)), null);
  // Asked days ago but only confirmed 5 hours ahead counts as booked then.
  const confirmedLate = appointment({ respondedAt: hoursBefore(5) });
  assert.equal(dueAppointmentReminder(confirmedLate, [24], hoursBefore(4)), null);
});

test("each reminder is keyed to the appointment's time", () => {
  const a = appointment();
  const moved = appointment({ date: "2026-12-04" });
  assert.notEqual(appointmentReminderKey(a, 24), appointmentReminderKey(a, 2));
  assert.notEqual(appointmentReminderKey(a, 24), appointmentReminderKey(moved, 24));
  assert.notEqual(appointmentReminderKey(a, "nudge"), appointmentReminderKey(moved, "nudge"));
});

test("today / tomorrow / a date, in the business's time zone", () => {
  const a = appointment();
  assert.equal(appointmentDayWords(a, hoursBefore(20)), "tomorrow");
  assert.equal(appointmentDayWords(a, hoursBefore(2)), "today");
  assert.equal(appointmentDayWords(a, hoursBefore(60)), "on Thu, Dec 3");
  // 11pm Chicago on Dec 2 is already Dec 3 in UTC: still "tomorrow".
  assert.equal(appointmentDayWords(a, "2026-12-03T05:00:00.000Z"), "tomorrow");
  assert.equal(formatReminderMoment(hoursBefore(24), "America/Chicago"), "Wed, Dec 2 at 10am");
});

const settings = InvoiceSettingsSchema.parse({ businessName: "Fresh Cuts", businessEmail: "hi@fresh.example" });
function reminderEmail(extra, nowIso) {
  return buildAppointmentEmail({
    kind: "reminder",
    appointment: appointment(extra),
    settings,
    link: "https://app.the521app.com/b/tok",
    depositDueOnline: false,
    nowIso,
  });
}

test("reminder email: when, the balance, and how to cancel", () => {
  const email = reminderEmail({ invoiceId: "appt_a1", refundCutoffHours: 12 }, hoursBefore(23));
  assert.equal(email.subject, "Reminder: Haircut with Fresh Cuts tomorrow at 10am");
  assert.match(email.text, /Your appointment with Fresh Cuts is tomorrow\./);
  assert.match(email.text, /\$20\.00 deposit paid\. \$60\.00 due at your appointment\./);
  assert.match(email.text, /Can't make it\? You can cancel from your appointment page\./);
  assert.match(email.text, /Free to cancel until Wed, Dec 2 at 10pm\./);
  assert.match(email.html, /View appointment/);
});

test("reminder email never offers a refund the client can't get", () => {
  // Past the 24-hour cutoff.
  const past = reminderEmail({ invoiceId: "appt_a1", refundCutoffHours: 24 }, hoursBefore(23));
  assert.doesNotMatch(past.text, /Free to cancel|refund/i);
  // Deposits never refunded.
  assert.doesNotMatch(reminderEmail({ invoiceId: "appt_a1", refundCutoffHours: null }, hoursBefore(30)).text, /Free to cancel/);
  // No deposit paid: no money or cancel-fee lines.
  const unpaid = reminderEmail({ deposit: { type: "none", value: 0 } }, hoursBefore(23));
  assert.doesNotMatch(unpaid.text, /deposit|Free to cancel/);
});

test("a reminder days ahead says how many, and the date", () => {
  const email = reminderEmail({}, hoursBefore(72));
  assert.match(email.text, /Your appointment with Fresh Cuts is in 3 days, on Thu, Dec 3\./);
  assert.equal(email.subject, "Reminder: Haircut with Fresh Cuts on Thu, Dec 3 at 10am");
});

test("2-hour reminder says today", () => {
  assert.equal(reminderEmail({}, hoursBefore(2)).subject, "Reminder: Haircut with Fresh Cuts today at 10am");
});

test("owner nudge for a client with no email", () => {
  const text = appointmentReminderNudgeText(appointment({ clientEmail: null }), hoursBefore(23));
  assert.equal(text.title, "Tomorrow 10am: Jordan Lee has no email for a reminder");
  assert.equal(text.body, "Tap to text them their appointment link.");
  assert.match(appointmentReminderNudgeText(appointment(), hoursBefore(60)).title, /^Thu, Dec 3 10am:/);
});

test("website button: a plain link tagged as from the website, text escaped", () => {
  assert.equal(websiteBookingUrl("fresh-cuts"), "https://app.the521app.com/book/fresh-cuts?via=site");
  const code = bookingButtonCode({ slug: "fresh-cuts", label: '<b>"Hi"</b>', color: "#ECEBE6" });
  assert.match(code, /^<a href="https:\/\/app\.the521app\.com\/book\/fresh-cuts\?via=site" target="_blank" rel="noopener"/);
  assert.match(code, /&lt;b&gt;&quot;Hi&quot;&lt;\/b&gt;<\/a>$/);
  assert.match(code, /color:#161B1E/); // dark text on a light button
  assert.doesNotMatch(code, /<script/);
  const fallback = bookingButtonCode({ slug: "fresh-cuts", label: "  ", color: "red;x" });
  assert.match(fallback, /background:#2FA866;color:#FFFFFF/);
  assert.match(fallback, />Book now<\/a>$/);
});

if (failures > 0) {
  console.error(`\n${failures} appointment reminder test(s) failed`);
  process.exit(1);
}
