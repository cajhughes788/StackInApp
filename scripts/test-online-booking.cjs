require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const {
  bookingDateRange,
  bookingOpenDays,
  bookingOpenTimes,
  bookingSlugFrom,
  bookingSlugProblem,
  publicBookingUrl,
} = require("../shared/onlineBooking.ts");
const { appointmentTimes } = require("../shared/appointments.ts");
const { AppointmentSchema, OnlineBookingInputSchema } = require("../shared/schemas/appointment.ts");
const { BookingSettingsInputSchema, BookingSettingsSchema } = require("../shared/schemas/booking.ts");
const { InvoiceSettingsSchema } = require("../shared/schemas/invoice.ts");
const { renderPublicBookingPage } = require("../shared/bookingPublicPage.ts");

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

// Tue Dec 1 2026, 6am in Chicago.
const NOW = "2026-12-01T12:00:00.000Z";
const TZ = "America/Chicago";

function settings(extra = {}) {
  return BookingSettingsSchema.parse({ timeZone: TZ, minNoticeHours: 0, slotStepMinutes: 60, ...extra });
}
const cut = { minutes: 60, bufferMinutes: 0 };

function booked(date, startTime, extra = {}) {
  const base = { date, startTime, timeZone: TZ, minutes: 60, bufferMinutes: 0, ...extra };
  return AppointmentSchema.parse({
    id: `a_${date}_${startTime}`,
    workspaceId: "ws",
    clientId: "c1",
    clientName: "Someone Else",
    clientEmail: null,
    clientPhone: null,
    serviceId: "s",
    serviceName: "Cut",
    price: 40,
    deposit: { type: "none", value: 0 },
    ...appointmentTimes(base),
    status: "confirmed",
    holdExpiresAt: null,
    shareToken: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...base,
  });
}

function open(extra = {}) {
  return bookingOpenTimes({ settings: settings(extra.settings), service: extra.service ?? cut, date: extra.date ?? "2026-12-02", appointments: extra.appointments ?? [], nowIso: extra.now ?? NOW });
}

console.log("link");

test("link names: lowercase letters, numbers and single dashes, 3–40 long, not reserved", () => {
  assert.equal(bookingSlugProblem("fresh-cuts"), null);
  assert.equal(bookingSlugProblem("ab"), "Use at least 3 characters.");
  assert.match(bookingSlugProblem("Fresh"), /lowercase/);
  assert.match(bookingSlugProblem("-fresh"), /lowercase/);
  assert.match(bookingSlugProblem("fresh--cuts"), /lowercase/);
  assert.match(bookingSlugProblem("a".repeat(41)), /at most 40/);
  assert.match(bookingSlugProblem("admin"), /reserved/);
});

test("a link from the business name", () => {
  assert.equal(bookingSlugFrom("Fresh Cuts ATX!"), "fresh-cuts-atx");
  assert.equal(bookingSlugFrom("Café & Co."), "cafe-and-co");
  assert.equal(bookingSlugFrom("  "), "");
  assert.equal(bookingSlugFrom("X"), "");
  assert.equal(bookingSlugProblem(bookingSlugFrom("A".repeat(60))), null);
  assert.equal(publicBookingUrl("fresh-cuts"), "https://app.the521app.com/book/fresh-cuts");
});

test("online booking starts off with no link; old app saves leave both out", () => {
  const s = BookingSettingsSchema.parse({});
  assert.equal(s.onlineBookingEnabled, false);
  assert.equal(s.bookingSlug, "");
  const input = BookingSettingsInputSchema.parse({
    services: [],
    weeklyHours: s.weeklyHours,
    daysOff: [],
    minNoticeHours: 2,
    maxDaysAhead: 60,
    slotStepMinutes: 30,
    timeZone: "",
  });
  assert.equal(input.onlineBookingEnabled, undefined);
  assert.equal(input.bookingSlug, undefined);
});

console.log("open times");

test("every slot step from the start of the hours, while the whole service fits", () => {
  // Weekdays 9–5, hourly, 1-hour service: 9am … 4pm.
  assert.deepEqual(open(), ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
  // 45 minutes every 30: last start 4:00 (ends 4:45), not 4:30.
  const times = open({ settings: { slotStepMinutes: 30 }, service: { minutes: 45, bufferMinutes: 0 } });
  assert.equal(times[0], "09:00");
  assert.equal(times[times.length - 1], "16:00");
});

test("steps count from each block's start, and lunch breaks are skipped", () => {
  const hours = { wed: [{ start: "09:15", end: "12:00" }, { start: "13:00", end: "15:00" }] };
  const times = open({ settings: { weeklyHours: { ...settings().weeklyHours, ...hours } } });
  assert.deepEqual(times, ["09:15", "10:15", "13:00", "14:00"]);
});

test("closed days and days off have nothing", () => {
  assert.deepEqual(open({ date: "2026-12-06" }), []); // Sunday
  assert.deepEqual(open({ settings: { daysOff: ["2026-12-02"] } }), []);
});

test("other appointments block their time plus buffer; back-to-back is fine", () => {
  const busy = [booked("2026-12-02", "10:00", { bufferMinutes: 30 })];
  const times = open({ settings: { slotStepMinutes: 30 }, appointments: busy });
  assert.equal(times.includes("09:00"), true); // ends at 10:00 sharp
  assert.equal(times.includes("09:30"), false);
  assert.equal(times.includes("10:00"), false);
  assert.equal(times.includes("10:30"), false); // inside the buffer
  assert.equal(times.includes("11:30"), true);
});

test("canceled and expired appointments free their time", () => {
  const freed = [
    booked("2026-12-02", "10:00", { status: "canceled" }),
    booked("2026-12-02", "11:00", { status: "requested", holdExpiresAt: "2026-12-01T11:00:00.000Z" }),
  ];
  assert.equal(open({ appointments: freed }).includes("10:00"), true);
  assert.equal(open({ appointments: freed }).includes("11:00"), true);
  const held = [booked("2026-12-02", "11:00", { status: "requested", holdExpiresAt: "2026-12-01T13:00:00.000Z" })];
  assert.equal(open({ appointments: held }).includes("11:00"), false);
});

test("minimum notice hides times too soon", () => {
  // Now is 6am Tue Dec 1 in Chicago; 4 hours' notice → 10am is the first.
  const times = open({ date: "2026-12-01", settings: { minNoticeHours: 4 } });
  assert.equal(times[0], "10:00");
  // Later today with no notice: past times are gone.
  assert.equal(open({ date: "2026-12-01", now: "2026-12-01T19:30:00.000Z" })[0], "14:00");
});

test("nothing before today or past 'book up to'", () => {
  assert.deepEqual(open({ date: "2026-11-30" }), []);
  assert.deepEqual(bookingDateRange(settings({ maxDaysAhead: 14 }), NOW), { first: "2026-12-01", last: "2026-12-15" });
  assert.deepEqual(open({ date: "2026-12-16", settings: { maxDaysAhead: 14 } }), []);
  assert.notDeepEqual(open({ date: "2026-12-15", settings: { maxDaysAhead: 14 } }), []);
});

test("the night clocks spring forward, a time that doesn't exist isn't offered", () => {
  // Sun Mar 14 2027 in Chicago: 2:00–2:59am don't exist.
  const night = { sun: [{ start: "01:00", end: "04:00" }] };
  const times = open({
    date: "2027-03-14",
    now: "2027-03-01T12:00:00.000Z",
    settings: { weeklyHours: { ...settings().weeklyHours, ...night }, maxDaysAhead: 60 },
  });
  assert.deepEqual(times, ["01:00", "03:00"]);
});

test("open days skip full and closed days, up to the limit, from a date on", () => {
  const days = bookingOpenDays({ settings: settings(), service: cut, appointments: [], nowIso: NOW, limit: 5 });
  assert.deepEqual(days, ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-07"]);
  const later = bookingOpenDays({ settings: settings(), service: cut, appointments: [], nowIso: NOW, from: "2026-12-07", limit: 2 });
  assert.deepEqual(later, ["2026-12-07", "2026-12-08"]);
  // A 9-hour service never fits 9–5.
  assert.deepEqual(bookingOpenDays({ settings: settings(), service: { minutes: 540, bufferMinutes: 0 }, appointments: [], nowIso: NOW, limit: 5 }), []);
});

console.log("booking form");

test("name and email required, phone optional, a key per form", () => {
  const ok = { service: "s1", date: "2026-12-02", time: "10:00", key: "k".repeat(22), name: "Jordan", email: "j@example.com" };
  assert.equal(OnlineBookingInputSchema.safeParse(ok).success, true);
  assert.equal(OnlineBookingInputSchema.parse(ok).phone, "");
  assert.equal(OnlineBookingInputSchema.safeParse({ ...ok, email: "nope" }).success, false);
  assert.equal(OnlineBookingInputSchema.safeParse({ ...ok, name: " " }).success, false);
  assert.equal(OnlineBookingInputSchema.safeParse({ ...ok, key: "short" }).success, false);
});

test("appointments made before online booking read as the owner's", () => {
  assert.equal(booked("2026-12-02", "10:00").source, "owner");
});

console.log("booking page");

const services = [
  { id: "s1", name: "Skin <fade>", price: 80, minutes: 45, deposit: { type: "fixed", value: 20 }, bufferMinutes: 0, active: true },
  { id: "s2", name: "Beard trim", price: 25, minutes: 20, deposit: { type: "none", value: 0 }, bufferMinutes: 0, active: true },
  { id: "s3", name: "Hidden", price: 10, minutes: 15, deposit: { type: "none", value: 0 }, bufferMinutes: 0, active: false },
];
const context = (extra = {}) => ({
  slug: "fresh-cuts",
  booking: { ...settings(), services, location: "1200 Main St" },
  settings: InvoiceSettingsSchema.parse({ businessName: "Fresh <Cuts>", defaultPolicies: "Be on time." }),
  onlinePayments: true,
  nowIso: NOW,
  ...extra,
});

test("services: active ones only, escaped, each a link to its days", () => {
  const html = renderPublicBookingPage(context(), { step: "services" });
  assert.match(html, /Skin &lt;fade&gt;/);
  assert.match(html, /45 min · \$20\.00 deposit/);
  assert.match(html, /href="\/book\/fresh-cuts\?service=s1"/);
  assert.doesNotMatch(html, /Hidden/);
  assert.match(html, /Fresh &lt;Cuts&gt;/);
  assert.doesNotMatch(html, /<fade>|<Cuts>/);
});

test("days link to their times; Later dates when there are more", () => {
  const html = renderPublicBookingPage(context(), { step: "days", service: services[0], days: ["2026-12-02"], moreFrom: "2026-12-20" });
  assert.match(html, /href="\/book\/fresh-cuts\?service=s1&amp;date=2026-12-02">.*Wed, Dec 2/);
  assert.match(html, /from=2026-12-20">Later dates/);
  assert.match(renderPublicBookingPage(context(), { step: "days", service: services[0], days: [], moreFrom: null }), /No open times right now/);
});

test("times show in the business's zone; a taken time says so", () => {
  const html = renderPublicBookingPage(context(), { step: "times", service: services[0], date: "2026-12-02", times: ["09:00", "13:30"], taken: true });
  assert.match(html, /times in CST/);
  assert.match(html, /time=13%3A30">1:30pm/);
  assert.match(html, /That time was just taken/);
});

test("details: posts name, email, phone and the form key; pays the deposit by card", () => {
  const html = renderPublicBookingPage(context(), { step: "details", service: services[0], date: "2026-12-02", time: "10:00", formKey: "KEY1234567890abcdef" });
  assert.match(html, /action="\/book\/fresh-cuts\/book"/);
  assert.match(html, /name="key" value="KEY1234567890abcdef"/);
  assert.match(html, /name="name"[^>]*required/);
  assert.match(html, /name="email"[^>]*required/);
  assert.match(html, /name="website"/);
  assert.match(html, /Book &amp; pay \$20\.00 deposit/);
  assert.match(html, /Free to cancel up to 24 hours before/);
  assert.match(html, /Be on time\./);
});

test("details: no deposit, or no card payments, books without paying", () => {
  assert.match(
    renderPublicBookingPage(context(), { step: "details", service: services[1], date: "2026-12-02", time: "10:00", formKey: "KEY1234567890abcdef" }),
    />Book appointment</
  );
  const off = renderPublicBookingPage(context({ onlinePayments: false }), { step: "details", service: services[0], date: "2026-12-02", time: "10:00", formKey: "KEY1234567890abcdef" });
  assert.match(off, />Book appointment</);
  assert.match(off, /deposit is paid at your appointment/);
});

test("a form error shows above the form with what they typed, escaped", () => {
  const html = renderPublicBookingPage(context(), {
    step: "details",
    service: services[1],
    date: "2026-12-02",
    time: "10:00",
    formKey: "KEY1234567890abcdef",
    error: "Enter a valid email.",
    values: { name: '"><script>', email: "bad", phone: "" },
  });
  assert.match(html, /Enter a valid email\./);
  assert.match(html, /value="&quot;&gt;&lt;script&gt;"/);
  assert.doesNotMatch(html, /<script>/);
});

if (failures > 0) {
  console.error(`\n${failures} online booking test(s) failed`);
  process.exit(1);
}
