require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", esModuleInterop: true },
});

const assert = require("node:assert/strict");
const {
  clientCanReschedule,
  clientRescheduleDeadline,
  formatMovedFrom,
  ownerCanReschedule,
  rescheduledAppointment,
} = require("../shared/appointmentReschedule.ts");
const { appointmentTimes } = require("../shared/appointments.ts");
const { buildAppointmentEmail } = require("../shared/appointmentEmail.ts");
const { appointmentNotificationText } = require("../shared/appointmentNotifications.ts");
const { renderPublicAppointmentPage } = require("../shared/appointmentPublicPage.ts");
const { AppointmentActionSchema, AppointmentClientMoveSchema, AppointmentSchema } = require("../shared/schemas/appointment.ts");
const { BookingSettingsSchema } = require("../shared/schemas/booking.ts");
const { InvoiceSettingsSchema } = require("../shared/schemas/invoice.ts");

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
    shareToken: "tok_0123456789abcdef",
    createdAt: NOW,
    updatedAt: NOW,
    ...merged,
  });
}

function moved(by = "client") {
  const a = appointment();
  const times = appointmentTimes({ date: "2026-12-04", startTime: "14:00", timeZone: "America/Chicago", minutes: 60, bufferMinutes: 0 });
  return rescheduledAppointment(a, { date: "2026-12-04", startTime: "14:00", times, outsideHours: false, by, nowIso: NOW });
}

console.log("who can move it, and until when");

test("the owner: waiting or confirmed, before it starts", () => {
  assert.equal(ownerCanReschedule(appointment(), NOW), true);
  assert.equal(ownerCanReschedule(appointment({ status: "requested", holdExpiresAt: "2026-12-02T12:00:00.000Z" }), NOW), true);
  assert.equal(ownerCanReschedule(appointment(), START), false);
  for (const status of ["canceled", "declined", "completed", "no_show", "expired"]) {
    assert.equal(ownerCanReschedule(appointment({ status }), NOW), false, status);
  }
});

test("the client: up to the free-cancel cutoff", () => {
  const a = appointment({ refundCutoffHours: 24 });
  assert.equal(clientRescheduleDeadline(a, 24), hoursBefore(24));
  assert.deepEqual(clientCanReschedule(a, 24, hoursBefore(25)), { ok: true, deadline: hoursBefore(24) });
  assert.deepEqual(clientCanReschedule(a, 24, hoursBefore(23)), { ok: false, reason: "late" });
  // The cutoff, not the no-refund setting, decides when there is one.
  assert.equal(clientRescheduleDeadline(appointment({ refundCutoffHours: 72 }), null), hoursBefore(72));
});

test("deposits never refunded: the owner's choice of hours, or not at all", () => {
  const a = appointment({ refundCutoffHours: null });
  assert.equal(clientRescheduleDeadline(a, 24), hoursBefore(24));
  assert.equal(clientRescheduleDeadline(a, 168), hoursBefore(168));
  assert.deepEqual(clientCanReschedule(a, null, NOW), { ok: false, reason: "off" });
  assert.equal(BookingSettingsSchema.parse({}).noRefundRescheduleHours, 24);
  assert.equal(BookingSettingsSchema.parse({ noRefundRescheduleHours: null }).noRefundRescheduleHours, null);
});

test("the client: confirmed only, and once", () => {
  assert.deepEqual(clientCanReschedule(appointment({ status: "requested", holdExpiresAt: "2026-12-02T12:00:00.000Z" }), 24, NOW), {
    ok: false,
    reason: "status",
  });
  assert.deepEqual(clientCanReschedule(moved("client"), 24, NOW), { ok: false, reason: "used" });
  // The owner moving it doesn't use up the client's move.
  assert.equal(clientCanReschedule(moved("owner"), 24, NOW).ok, true);
});

console.log("\nmoving it");

test("the new time, with where it was and who moved it", () => {
  const after = moved("owner");
  assert.equal(after.date, "2026-12-04");
  assert.equal(after.startTime, "14:00");
  assert.equal(after.startAt, "2026-12-04T20:00:00.000Z");
  assert.equal(after.endAt, "2026-12-04T21:00:00.000Z");
  assert.deepEqual(after.reschedules, [{ fromDate: "2026-12-03", fromStartTime: "10:00", fromStartAt: START, at: NOW, by: "owner" }]);
  // Deposit, link and cancellation rule stay.
  assert.equal(after.shareToken, appointment().shareToken);
  assert.deepEqual(after.deposit, appointment().deposit);
  assert.equal(formatMovedFrom(after.reschedules[0], "2026"), "Thu, Dec 3 at 10am");
  assert.deepEqual(AppointmentSchema.parse({ ...appointment(), reschedules: undefined }).reschedules, []);
});

test("the owner's action and the client's form parse", () => {
  assert.deepEqual(AppointmentActionSchema.parse({ action: "reschedule", date: "2026-12-04", startTime: "14:00" }), {
    action: "reschedule",
    date: "2026-12-04",
    startTime: "14:00",
  });
  assert.equal(AppointmentActionSchema.safeParse({ action: "reschedule", date: "Dec 4", startTime: "2pm" }).success, false);
  assert.equal(AppointmentClientMoveSchema.safeParse({ date: "2026-12-04", time: "14:00" }).success, true);
  assert.equal(AppointmentClientMoveSchema.safeParse({ date: "2026-12-04", time: "<b>" }).success, false);
});

console.log("\nthe client's page");

const settings = InvoiceSettingsSchema.parse({ businessName: "Fresh <Cuts>", businessEmail: "hi@fresh.example" });
const page = (a, move, extra = {}) =>
  renderPublicAppointmentPage(a, settings, {
    respondPath: "/b/tok/respond",
    payPath: "/b/tok/pay",
    pagePath: "/b/tok",
    invoice: null,
    depositOnline: false,
    nowIso: NOW,
    move: { movePath: "/b/tok/move", ...move },
    ...extra,
  });

test("offers a move with its deadline, or says to contact the business", () => {
  const open = page(appointment(), { check: { ok: true, deadline: hoursBefore(24) }, view: null });
  assert.match(open, /href="\/b\/tok\?move=1">Need a different time\?<\/a>/);
  assert.match(open, /You can move it once, until Dec 2 at 10am\./);
  const used = page(moved("client"), { check: { ok: false, reason: "used" }, view: null });
  assert.match(used, /You've already moved this once\. To change the time, contact Fresh &lt;Cuts&gt;\./);
  assert.match(used, /moved from Thu, Dec 3 at 10am/);
  assert.match(page(appointment(), { check: { ok: false, reason: "late" }, view: null }), /To change the time, contact/);
  assert.doesNotMatch(page(appointment(), { check: { ok: false, reason: "status" }, view: null }), /contact Fresh|Need a different time/);
});

test("the steps: days, times, then a form that posts the move", () => {
  const days = page(appointment(), { check: { ok: true, deadline: hoursBefore(24) }, view: { step: "days", days: ["2026-12-04", "2026-12-05"], moreFrom: "2026-12-20" } });
  assert.match(days, /href="\/b\/tok\?move=1&amp;date=2026-12-04"/);
  assert.match(days, /Later dates/);
  assert.match(days, /Keep my current time/);
  const times = page(appointment(), { check: { ok: true, deadline: hoursBefore(24) }, view: { step: "times", date: "2026-12-04", times: ["14:00"], taken: true } });
  assert.match(times, /href="\/b\/tok\?move=1&amp;date=2026-12-04&amp;time=14%3A00">2pm</);
  assert.match(times, /That time was just taken/);
  const confirm = page(appointment(), { check: { ok: true, deadline: hoursBefore(24) }, view: { step: "confirm", date: "2026-12-04", time: "14:00" } });
  assert.match(confirm, /Move to Fri, Dec 4 at 2pm\?/);
  assert.match(confirm, /<form method="post" action="\/b\/tok\/move"/);
  assert.match(confirm, /name="date" value="2026-12-04"/);
  assert.match(confirm, /name="time" value="14:00"/);
  // A move in progress replaces the cancel link.
  assert.doesNotMatch(confirm, /Cancel appointment/);
  assert.match(page(moved("client"), { check: { ok: false, reason: "used" }, view: null, justMoved: true }), /Your appointment is moved\. See you then!/);
});

console.log("\nemail and push");

test("moved email: the new time, the old one, and who moved it", () => {
  const after = moved("owner");
  const email = buildAppointmentEmail({
    kind: "moved",
    appointment: after,
    settings,
    link: "https://app.the521app.com/b/tok",
    depositDueOnline: false,
    movedFrom: after.reschedules[0],
    movedBy: "owner",
  });
  assert.equal(email.subject, "Moved: Haircut with Fresh <Cuts>, now Fri, Dec 4 at 2pm");
  assert.match(email.text, /^Fresh <Cuts> moved your appointment\./);
  assert.match(email.text, /It was Thu, Dec 3 at 10am\./);
  assert.match(email.text, /View appointment: https:/);
  assert.doesNotMatch(email.html, /<Cuts>/);
  const byClient = buildAppointmentEmail({ kind: "moved", appointment: moved("client"), settings, link: "x", depositDueOnline: false, movedFrom: after.reschedules[0], movedBy: "client" });
  assert.match(byClient.text, /^Your appointment with Fresh <Cuts> is moved\./);
});

test("moving a waiting request still asks them to confirm", () => {
  const waiting = { ...moved("owner"), status: "requested", holdExpiresAt: "2026-12-02T12:00:00.000Z" };
  const email = buildAppointmentEmail({ kind: "moved", appointment: waiting, settings, link: "x", depositDueOnline: true, movedFrom: waiting.reschedules[0], movedBy: "owner" });
  assert.match(email.text, /moved the time they're holding for you\. Please confirm it\./);
  assert.match(email.text, /Confirm & pay \$20\.00 deposit: x/);
});

test("owner push when the client moves it", () => {
  const text = appointmentNotificationText(moved("client"), "rescheduled");
  assert.equal(text.title, "Jordan Lee moved their appointment");
  assert.equal(text.body, "Haircut · Fri, Dec 4 at 2pm (was Thu, Dec 3 at 10am)");
});

if (failures > 0) {
  console.error(`\n${failures} appointment reschedule test(s) failed`);
  process.exit(1);
}
