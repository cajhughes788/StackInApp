require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const {
  BookingSettingsInputSchema,
  BookingSettingsSchema,
  BookingServiceSchema,
  DEFAULT_BOOKING_WEEKLY_HOURS,
  bookingDayHoursProblem,
  bookingServiceProblem,
  isValidTimeZone,
} = require("../shared/schemas/booking.ts");

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

function service(extra = {}) {
  return {
    id: "svc_1",
    name: "Haircut",
    price: 40,
    minutes: 45,
    deposit: { type: "none", value: 0 },
    bufferMinutes: 10,
    active: true,
    ...extra,
  };
}

function input(extra = {}) {
  return {
    services: [service()],
    weeklyHours: DEFAULT_BOOKING_WEEKLY_HOURS,
    daysOff: ["2026-12-25"],
    minNoticeHours: 2,
    maxDaysAhead: 60,
    slotStepMinutes: 30,
    timeZone: "America/Chicago",
    ...extra,
  };
}

console.log("services");

test("a plain service is fine", () => {
  assert.equal(BookingServiceSchema.safeParse(service()).success, true);
});

test("needs a name, a whole-minute length of 5 min to 12 hours", () => {
  assert.equal(BookingServiceSchema.safeParse(service({ name: "  " })).success, false);
  assert.equal(BookingServiceSchema.safeParse(service({ minutes: 4 })).success, false);
  assert.equal(BookingServiceSchema.safeParse(service({ minutes: 721 })).success, false);
  assert.equal(BookingServiceSchema.safeParse(service({ minutes: 30.5 })).success, false);
});

test("a fixed deposit can equal the price but not exceed it", () => {
  assert.equal(bookingServiceProblem(service({ deposit: { type: "fixed", value: 40 } })), null);
  assert.match(bookingServiceProblem(service({ deposit: { type: "fixed", value: 40.01 } })), /more than the price/);
  assert.equal(BookingServiceSchema.safeParse(service({ deposit: { type: "fixed", value: 50 } })).success, false);
});

test("a percent deposit has to be under 100%", () => {
  assert.equal(bookingServiceProblem(service({ deposit: { type: "percent", value: 25 } })), null);
  assert.match(bookingServiceProblem(service({ deposit: { type: "percent", value: 100 } })), /under 100%/);
});

test("a deposit type needs an amount", () => {
  assert.match(bookingServiceProblem(service({ deposit: { type: "fixed", value: 0 } })), /enter the deposit/);
});

console.log("hours");

test("blocks have to end after they start", () => {
  assert.equal(bookingDayHoursProblem([{ start: "09:00", end: "17:00" }]), null);
  assert.match(bookingDayHoursProblem([{ start: "17:00", end: "09:00" }]), /end after/);
  assert.match(bookingDayHoursProblem([{ start: "09:00", end: "09:00" }]), /end after/);
});

test("a lunch break (two blocks) is fine, in any order; overlaps aren't", () => {
  assert.equal(bookingDayHoursProblem([{ start: "13:00", end: "17:00" }, { start: "09:00", end: "12:00" }]), null);
  assert.equal(bookingDayHoursProblem([{ start: "09:00", end: "12:00" }, { start: "12:00", end: "17:00" }]), null);
  assert.match(bookingDayHoursProblem([{ start: "09:00", end: "13:00" }, { start: "12:00", end: "17:00" }]), /overlap/);
});

test("times must look like 09:00", () => {
  const bad = { ...DEFAULT_BOOKING_WEEKLY_HOURS, mon: [{ start: "9am", end: "17:00" }] };
  assert.equal(BookingSettingsInputSchema.safeParse(input({ weeklyHours: bad })).success, false);
});

console.log("settings");

test("a full setup saves", () => {
  assert.equal(BookingSettingsInputSchema.safeParse(input()).success, true);
});

test("a bad day names the day", () => {
  const bad = { ...DEFAULT_BOOKING_WEEKLY_HOURS, wed: [{ start: "12:00", end: "10:00" }] };
  const parsed = BookingSettingsInputSchema.safeParse(input({ weeklyHours: bad }));
  assert.equal(parsed.success, false);
  assert.match(parsed.error.issues[0].message, /^Wednesday:/);
});

test("two services can't share an id", () => {
  const parsed = BookingSettingsInputSchema.safeParse(input({ services: [service(), service({ name: "Beard" })] }));
  assert.equal(parsed.success, false);
});

test("start times every 15, 30 or 60 minutes only", () => {
  assert.equal(BookingSettingsInputSchema.safeParse(input({ slotStepMinutes: 20 })).success, false);
  assert.equal(BookingSettingsInputSchema.safeParse(input({ slotStepMinutes: 60 })).success, true);
});

test("time zones are checked; blank means use the workspace's", () => {
  assert.equal(isValidTimeZone("America/Denver"), true);
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
  assert.equal(BookingSettingsInputSchema.safeParse(input({ timeZone: "Mars/Olympus" })).success, false);
  assert.equal(BookingSettingsInputSchema.safeParse(input({ timeZone: "" })).success, true);
});

test("notice and how far ahead stay in range", () => {
  assert.equal(BookingSettingsInputSchema.safeParse(input({ minNoticeHours: -1 })).success, false);
  assert.equal(BookingSettingsInputSchema.safeParse(input({ maxDaysAhead: 0 })).success, false);
  assert.equal(BookingSettingsInputSchema.safeParse(input({ maxDaysAhead: 366 })).success, false);
});

test("nothing saved yet reads as Mon–Fri 9–5, no services", () => {
  const settings = BookingSettingsSchema.parse({});
  assert.deepEqual(settings.services, []);
  assert.deepEqual(settings.weeklyHours.mon, [{ start: "09:00", end: "17:00" }]);
  assert.deepEqual(settings.weeklyHours.sun, []);
  assert.equal(settings.slotStepMinutes, 30);
  assert.equal(settings.minNoticeHours, 2);
  assert.equal(settings.maxDaysAhead, 60);
  assert.equal(settings.timeZone, "");
});

if (failures > 0) {
  console.error(`\n${failures} booking test(s) failed`);
  process.exit(1);
}
