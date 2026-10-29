require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const {
  appointmentEndTime,
  appointmentHoldExpiresAt,
  appointmentLocationLine,
  appointmentMapLinks,
  appointmentHoldsTime,
  appointmentStatus,
  appointmentTimes,
  appointmentsOverlap,
  bookingHoursWarning,
  findAppointmentConflict,
  formatBookingTime,
} = require("../shared/appointments.ts");
const { AppointmentCreateInputSchema, AppointmentSchema } = require("../shared/schemas/appointment.ts");
const { BookingSettingsSchema } = require("../shared/schemas/booking.ts");
const { renderPublicAppointmentPage } = require("../shared/appointmentPublicPage.ts");
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

function appointment(extra = {}) {
  const base = {
    date: "2026-12-03",
    startTime: "10:00",
    timeZone: "America/Chicago",
    minutes: 60,
    bufferMinutes: 15,
  };
  const merged = { ...base, ...extra };
  const times = appointmentTimes(merged);
  return AppointmentSchema.parse({
    id: "a1",
    workspaceId: "ws",
    clientId: "c1",
    clientName: "Jordan Lee",
    clientEmail: null,
    clientPhone: null,
    serviceId: "svc_1",
    serviceName: "Haircut",
    price: 40,
    deposit: { type: "none", value: 0 },
    ...times,
    status: "confirmed",
    holdExpiresAt: null,
    shareToken: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...merged,
  });
}

function input(extra = {}) {
  return {
    clientMutationId: "abc123",
    clientName: "Jordan Lee",
    serviceId: null,
    serviceName: "Kids cut",
    price: 25,
    minutes: 30,
    bufferMinutes: 0,
    deposit: { type: "none", value: 0 },
    date: "2026-12-03",
    startTime: "10:00",
    askToConfirm: true,
    ...extra,
  };
}

console.log("times");

test("wall-clock time in the workspace's zone becomes UTC", () => {
  const times = appointmentTimes({ date: "2026-12-03", startTime: "10:00", timeZone: "America/Chicago", minutes: 45, bufferMinutes: 15 });
  assert.equal(times.startAt, "2026-12-03T16:00:00.000Z");
  assert.equal(times.endAt, "2026-12-03T16:45:00.000Z");
  assert.equal(times.blockedUntil, "2026-12-03T17:00:00.000Z");
});

test("daylight saving is respected (summer is UTC-5 in Chicago)", () => {
  const times = appointmentTimes({ date: "2027-07-01", startTime: "10:00", timeZone: "America/Chicago", minutes: 30, bufferMinutes: 0 });
  assert.equal(times.startAt, "2027-07-01T15:00:00.000Z");
});

test("an unknown time zone gives no times", () => {
  assert.equal(appointmentTimes({ date: "2026-12-03", startTime: "10:00", timeZone: "Mars/Olympus", minutes: 30, bufferMinutes: 0 }), null);
});

test("end time wraps past midnight; times read like 9:30am", () => {
  assert.equal(appointmentEndTime("23:30", 60), "00:30");
  assert.equal(appointmentEndTime("09:15", 45), "10:00");
  assert.equal(formatBookingTime("09:30"), "9:30am");
  assert.equal(formatBookingTime("12:00"), "12pm");
  assert.equal(formatBookingTime("00:00"), "12am");
});

console.log("double-booking");

test("overlapping times conflict; back-to-back don't", () => {
  const a = appointment();
  assert.equal(appointmentsOverlap(a, appointment({ startTime: "10:30" })), true);
  // a ends 11:00 + 15 min buffer, so 11:15 is the first free start.
  assert.equal(appointmentsOverlap(a, appointment({ startTime: "11:00" })), true);
  assert.equal(appointmentsOverlap(a, appointment({ startTime: "11:15" })), false);
  // The new one's own buffer counts too: 9:00 for 45 min + 15 min buffer ends at 10:00.
  assert.equal(appointmentsOverlap(a, appointment({ startTime: "09:00", minutes: 45 })), false);
  assert.equal(appointmentsOverlap(a, appointment({ startTime: "09:00", minutes: 50 })), true);
});

test("canceled, declined and expired appointments free their time", () => {
  const candidate = appointment({ id: "new", startTime: "10:30" });
  for (const status of ["canceled", "declined", "expired"]) {
    assert.equal(findAppointmentConflict(candidate, [appointment({ status })], NOW), null, status);
  }
  for (const status of ["confirmed", "completed"]) {
    assert.ok(findAppointmentConflict(candidate, [appointment({ status })], NOW), status);
  }
});

test("a waiting request holds its time until the hold lapses", () => {
  const held = appointment({ status: "requested", holdExpiresAt: appointmentHoldExpiresAt(NOW) });
  const candidate = appointment({ id: "new", startTime: "10:30" });
  assert.ok(findAppointmentConflict(candidate, [held], NOW));
  assert.equal(findAppointmentConflict(candidate, [held], "2026-12-03T12:00:00.000Z"), null);
});

test("an appointment doesn't conflict with itself", () => {
  const a = appointment();
  assert.equal(findAppointmentConflict(a, [a], NOW, a.id), null);
});

console.log("48-hour hold");

test("the hold lasts 48 hours", () => {
  assert.equal(appointmentHoldExpiresAt(NOW), "2026-12-03T12:00:00.000Z");
});

test("a request reads as expired once its hold passes", () => {
  const held = { status: "requested", holdExpiresAt: "2026-12-03T12:00:00.000Z" };
  assert.equal(appointmentStatus(held, "2026-12-03T11:59:59.000Z"), "requested");
  assert.equal(appointmentStatus(held, "2026-12-03T12:00:00.000Z"), "expired");
  assert.equal(appointmentHoldsTime(held, "2026-12-03T12:00:00.000Z"), false);
  assert.equal(appointmentStatus({ status: "confirmed", holdExpiresAt: null }, "2030-01-01T00:00:00.000Z"), "confirmed");
});

console.log("outside your hours");

const settings = BookingSettingsSchema.parse({
  weeklyHours: {
    sun: [],
    mon: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }],
    tue: [{ start: "09:00", end: "17:00" }],
    wed: [{ start: "09:00", end: "17:00" }],
    thu: [{ start: "09:00", end: "17:00" }],
    fri: [{ start: "09:00", end: "17:00" }],
    sat: [],
  },
  daysOff: ["2026-12-25"],
});

test("inside the hours: no warning", () => {
  // 2026-12-07 is a Monday.
  assert.equal(bookingHoursWarning(settings, "2026-12-07", "09:00", 180), null);
  assert.equal(bookingHoursWarning(settings, "2026-12-07", "13:00", 60), null);
});

test("running into the lunch break or past closing warns, with the hours", () => {
  assert.equal(
    bookingHoursWarning(settings, "2026-12-07", "11:30", 60),
    "That's outside your Monday hours (9am–12pm, 1pm–5pm)."
  );
  assert.match(bookingHoursWarning(settings, "2026-12-08", "16:30", 60), /outside your Tuesday hours/);
});

test("closed days and days off warn", () => {
  assert.equal(bookingHoursWarning(settings, "2026-12-06", "10:00", 30), "You're closed on Sundays.");
  assert.equal(bookingHoursWarning(settings, "2026-12-25", "10:00", 30), "That's on one of your days off.");
});

console.log("new appointment input");

test("a custom service with its own price is fine", () => {
  assert.equal(AppointmentCreateInputSchema.safeParse(input()).success, true);
  assert.equal(AppointmentCreateInputSchema.safeParse(input({ serviceId: "svc_1", price: 55 })).success, true);
});

test("needs a client name and a service name", () => {
  assert.equal(AppointmentCreateInputSchema.safeParse(input({ clientName: " " })).success, false);
  assert.equal(AppointmentCreateInputSchema.safeParse(input({ serviceName: "" })).success, false);
});

test("the deposit rules match services", () => {
  assert.equal(AppointmentCreateInputSchema.safeParse(input({ deposit: { type: "fixed", value: 30 } })).success, false);
  assert.equal(AppointmentCreateInputSchema.safeParse(input({ deposit: { type: "percent", value: 50 } })).success, true);
});

test("save as a new service is off unless asked", () => {
  assert.equal(AppointmentCreateInputSchema.parse(input()).saveAsService, false);
});

console.log("client's page");

const page = (a, options = {}) =>
  renderPublicAppointmentPage(a, InvoiceSettingsSchema.parse({ businessName: "Fresh <Cuts>" }), {
    respondPath: "/b/tok/respond",
    payPath: "/b/tok/pay",
    pagePath: "/b/tok",
    invoice: null,
    depositOnline: false,
    nowIso: NOW,
    ...options,
  });

test("a waiting request shows Confirm and Can't make it", () => {
  const html = page(appointment({ status: "requested", holdExpiresAt: "2026-12-03T12:00:00.000Z" }));
  assert.match(html, /Confirm appointment/);
  assert.match(html, /I can&#39;t make it|I can't make it/);
  assert.match(html, /action="\/b\/tok\/respond"/);
  assert.match(html, /holding this time for you until Dec 3 at 6am/);
});

test("a confirmed one shows no buttons", () => {
  const html = page(appointment({ status: "confirmed" }), { justAnswered: true });
  assert.doesNotMatch(html, /Confirm appointment/);
  assert.match(html, /You're booked\. See you then!/);
});

test("owner-typed text is escaped", () => {
  const html = page(appointment({ serviceName: "<script>x</script>" }));
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /Fresh &lt;Cuts&gt;/);
});

test("the time shows in the business's zone with its name", () => {
  const html = page(appointment());
  assert.match(html, /Thu, Dec 3 · 10am – 11am/);
  assert.match(html, /\(CST\)/);
});

console.log("address");

test("old appointments read as no address", () => {
  assert.equal(appointment().location, "");
});

test("an address on one line, and map links that carry it", () => {
  assert.equal(appointmentLocationLine("123 Main St\n  Suite 4 \n\nBoise, ID"), "123 Main St, Suite 4, Boise, ID");
  const maps = appointmentMapLinks("12 Elm St & Co\nBoise");
  assert.equal(maps.apple, "https://maps.apple.com/?q=12%20Elm%20St%20%26%20Co%2C%20Boise");
  assert.equal(maps.google, "https://www.google.com/maps/search/?api=1&query=12%20Elm%20St%20%26%20Co%2C%20Boise");
});

test("an appointment can have its own address, or leave it to Booking setup", () => {
  assert.equal(AppointmentCreateInputSchema.parse(input({ location: " 9 Oak Ave " })).location, "9 Oak Ave");
  assert.equal(AppointmentCreateInputSchema.parse(input()).location, undefined);
});

test("the client page shows Where with directions, escaped; nothing when blank", () => {
  const html = page(appointment({ location: "12 <b>Elm</b> St\nBoise" }));
  assert.match(html, /Where/);
  assert.match(html, /12 &lt;b&gt;Elm&lt;\/b&gt; St/);
  assert.match(html, /Apple Maps/);
  assert.match(html, /Google Maps/);
  assert.doesNotMatch(page(appointment()), /Apple Maps/);
});

if (failures > 0) {
  console.error(`\n${failures} appointment test(s) failed`);
  process.exit(1);
}
