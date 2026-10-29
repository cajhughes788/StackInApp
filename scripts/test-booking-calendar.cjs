require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const cal = require("../shared/bookingCalendar.ts");
const { BookingSettingsSchema } = require("../shared/schemas/booking.ts");

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

const settings = BookingSettingsSchema.parse({ timeZone: "America/Los_Angeles" });
const appt = (startTime, minutes, bufferMinutes = 0, id = startTime) => ({ id, startTime, minutes, bufferMinutes });

test("weeks start on Sunday", () => {
  assert.deepEqual(cal.calendarWeek("2026-10-28"), [
    "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31",
  ]);
  assert.equal(cal.calendarWeek("2026-10-25")[0], "2026-10-25");
  assert.equal(cal.calendarWeek("2026-10-31")[0], "2026-10-25");
  assert.equal(cal.addDays("2026-10-28", 7), "2026-11-04");
});

test("week labels", () => {
  assert.equal(cal.calendarWeekLabel(cal.calendarWeek("2026-10-14")), "October 2026");
  assert.equal(cal.calendarWeekLabel(cal.calendarWeek("2026-09-29")), "Sep – Oct 2026");
  assert.equal(cal.calendarWeekLabel(cal.calendarWeek("2026-12-30")), "Dec 2026 – Jan 2027");
  assert.deepEqual(cal.calendarDayParts("2026-10-28"), { weekday: "Wed", day: 28 });
});

test("today and now are where the business is", () => {
  const late = new Date("2026-10-28T05:30:00Z"); // 10:30pm Oct 27 in LA
  assert.equal(cal.calendarToday("America/Los_Angeles", late), "2026-10-27");
  assert.equal(cal.calendarToday("America/New_York", late), "2026-10-28");
  assert.equal(cal.calendarNowMinutes("America/Los_Angeles", late), 22 * 60 + 30);
});

test("hours shown: the week's opening to closing, stretched for appointments", () => {
  assert.deepEqual(cal.calendarHourRange(settings, []), { start: 9 * 60, end: 17 * 60 });
  assert.deepEqual(cal.calendarHourRange(settings, [appt("07:30", 30), appt("16:45", 60, 15)]), { start: 7 * 60, end: 18 * 60 });
  const closed = BookingSettingsSchema.parse({ weeklyHours: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] } });
  assert.deepEqual(cal.calendarHourRange(closed, []), { start: 8 * 60, end: 18 * 60 });
  assert.deepEqual(cal.calendarHourRange(closed, [appt("23:00", 120)]), { start: 8 * 60, end: 24 * 60 });
});

test("open blocks: weekly hours, none on a day off", () => {
  assert.deepEqual(cal.calendarOpenBlocks(settings, "2026-10-28"), [{ start: 540, end: 1020 }]);
  assert.deepEqual(cal.calendarOpenBlocks(settings, "2026-10-25"), []); // Sunday
  assert.deepEqual(cal.calendarOpenBlocks({ ...settings, daysOff: ["2026-10-28"] }, "2026-10-28"), []);
});

test("blocks: one column unless they overlap", () => {
  const blocks = cal.calendarDayBlocks([appt("10:00", 60, 15), appt("09:00", 30)]);
  assert.deepEqual(blocks.map((b) => [b.appointment.id, b.start, b.end, b.bufferEnd, b.column, b.columns]), [
    ["09:00", 540, 570, 570, 0, 1],
    ["10:00", 600, 660, 675, 0, 1],
  ]);
  const overlapping = cal.calendarDayBlocks([appt("10:00", 60), appt("10:30", 60), appt("12:00", 30)]);
  assert.deepEqual(overlapping.map((b) => [b.appointment.id, b.column, b.columns]), [
    ["10:00", 0, 2],
    ["10:30", 1, 2],
    ["12:00", 0, 1],
  ]);
  // Back to back isn't an overlap.
  assert.deepEqual(cal.calendarDayBlocks([appt("10:00", 60), appt("11:00", 60)]).map((b) => b.columns), [1, 1]);
});

test("a tapped spot rounds down to the slot step", () => {
  assert.equal(cal.calendarSlotAt(14 * 60 + 44, 30), "14:30");
  assert.equal(cal.calendarSlotAt(14 * 60 + 44, 15), "14:30");
  assert.equal(cal.calendarSlotAt(14 * 60 + 44, 60), "14:00");
  assert.equal(cal.calendarSlotAt(-5, 30), "00:00");
  assert.equal(cal.calendarSlotAt(24 * 60 + 10, 30), "23:30");
});

if (failed) process.exit(1);
