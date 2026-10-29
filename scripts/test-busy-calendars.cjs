require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", esModuleInterop: true },
});

const assert = require("node:assert/strict");
const { parseBusyTimes } = require("../shared/busyCalendar.ts");
const {
  BusyCalendarError,
  activeBusyBlocks,
  busyAsAppointments,
  busyCalendarHost,
  busyMinutesOnDate,
  findBusyConflict,
  mergeBusyBlocks,
  normalizeBusyCalendarUrl,
} = require("../shared/busyTimes.ts");
const { bookingOpenTimes } = require("../shared/onlineBooking.ts");
const { BookingSettingsSchema } = require("../shared/schemas/booking.ts");
const { fetchPublicText, privateAddress } = require("../backend/functions/src/lib/safeFetch.ts");

let failures = 0;
const pending = [];
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      pending.push(
        result.then(
          () => console.log(`  ok  ${name}`),
          (error) => {
            failures += 1;
            console.error(`  FAIL ${name}`);
            console.error(error);
          }
        )
      );
      return;
    }
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(error);
  }
}

const CHICAGO_TZ = [
  "BEGIN:VTIMEZONE",
  "TZID:America/Chicago",
  "BEGIN:STANDARD",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0600",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "TZOFFSETFROM:-0600",
  "TZOFFSETTO:-0500",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
];

function ics(...events) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", ...CHICAGO_TZ, ...events.flat(), "END:VCALENDAR"].join("\r\n");
}
function event(uid, lines) {
  return ["BEGIN:VEVENT", `UID:${uid}`, ...lines, "END:VEVENT"];
}
const WINDOW = { fromIso: "2026-11-01T00:00:00.000Z", toIso: "2026-12-31T00:00:00.000Z", timeZone: "America/Chicago" };

console.log("links");

test("webcal becomes https; only plain https links", () => {
  assert.equal(normalizeBusyCalendarUrl(" webcal://p01-caldav.icloud.com/published/2/abc "), "https://p01-caldav.icloud.com/published/2/abc");
  assert.equal(
    normalizeBusyCalendarUrl("https://calendar.google.com/calendar/ical/x%40gmail.com/private-abc/basic.ics"),
    "https://calendar.google.com/calendar/ical/x%40gmail.com/private-abc/basic.ics"
  );
  assert.throws(() => normalizeBusyCalendarUrl("http://example.com/cal.ics"), BusyCalendarError);
  assert.throws(() => normalizeBusyCalendarUrl("https://me:pw@example.com/cal.ics"), BusyCalendarError);
  assert.throws(() => normalizeBusyCalendarUrl("my calendar"), BusyCalendarError);
  assert.equal(busyCalendarHost("https://calendar.google.com/calendar/ical/secret/basic.ics"), "calendar.google.com");
});

test("only the public internet: private, local and odd addresses are refused", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.5", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    assert.equal(privateAddress(address), true, address);
  }
  for (const address of ["142.250.72.14", "17.253.144.10", "2607:f8b0:4009:80b::200e"]) {
    assert.equal(privateAddress(address), false, address);
  }
});

test("refused before anything is fetched: http, IP addresses, local names", async () => {
  for (const url of ["http://example.com/a.ics", "https://127.0.0.1/a.ics", "https://localhost/a.ics", "https://printer.local/a.ics", "https://[::1]/a.ics"]) {
    await assert.rejects(fetchPublicText(url, { maxBytes: 1000, timeoutMs: 2000 }), /https|IP address|public internet/, url);
  }
});

console.log("\nreading a calendar");

test("a timed event in a described time zone", () => {
  const busy = parseBusyTimes(ics(event("a", ["DTSTART;TZID=America/Chicago:20261103T140000", "DTEND;TZID=America/Chicago:20261103T150000"])), WINDOW);
  assert.deepEqual(busy.timed, [{ start: "2026-11-03T20:00:00.000Z", end: "2026-11-03T21:00:00.000Z" }]);
  assert.deepEqual(busy.allDay, []);
});

test("UTC, floating (the business's zone), and a zone the file doesn't describe", () => {
  const busy = parseBusyTimes(
    ics(
      event("utc", ["DTSTART:20261104T150000Z", "DTEND:20261104T160000Z"]),
      event("floating", ["DTSTART:20261105T090000", "DTEND:20261105T100000"]),
      event("paris", ["DTSTART;TZID=Europe/Paris:20261106T090000", "DTEND;TZID=Europe/Paris:20261106T100000"])
    ),
    WINDOW
  );
  assert.deepEqual(busy.timed, [
    { start: "2026-11-04T15:00:00.000Z", end: "2026-11-04T16:00:00.000Z" },
    { start: "2026-11-05T15:00:00.000Z", end: "2026-11-05T16:00:00.000Z" },
    { start: "2026-11-06T08:00:00.000Z", end: "2026-11-06T09:00:00.000Z" },
  ]);
});

test("a length instead of an end time", () => {
  const busy = parseBusyTimes(ics(event("d", ["DTSTART:20261104T150000Z", "DURATION:PT90M"])), WINDOW);
  assert.deepEqual(busy.timed, [{ start: "2026-11-04T15:00:00.000Z", end: "2026-11-04T16:30:00.000Z" }]);
});

test("free, canceled and 521's own events don't count", () => {
  const busy = parseBusyTimes(
    ics(
      event("free", ["DTSTART:20261104T150000Z", "DTEND:20261104T160000Z", "TRANSP:TRANSPARENT"]),
      event("gone", ["DTSTART:20261104T170000Z", "DTEND:20261104T180000Z", "STATUS:CANCELLED"]),
      event("appt_1@the521app.com", ["DTSTART:20261104T190000Z", "DTEND:20261104T200000Z"])
    ),
    WINDOW
  );
  assert.deepEqual(busy.timed, []);
});

test("repeats: every one, less a skipped date, with a moved one where it moved to", () => {
  const busy = parseBusyTimes(
    ics(
      event("weekly", [
        "DTSTART;TZID=America/Chicago:20261103T150000",
        "DTEND;TZID=America/Chicago:20261103T170000",
        "RRULE:FREQ=WEEKLY;COUNT=4",
        "EXDATE;TZID=America/Chicago:20261110T150000",
      ]),
      event("weekly", ["RECURRENCE-ID;TZID=America/Chicago:20261117T150000", "DTSTART;TZID=America/Chicago:20261117T160000", "DTEND;TZID=America/Chicago:20261117T180000"])
    ),
    WINDOW
  );
  assert.deepEqual(busy.timed, [
    { start: "2026-11-03T21:00:00.000Z", end: "2026-11-03T23:00:00.000Z" },
    { start: "2026-11-17T22:00:00.000Z", end: "2026-11-18T00:00:00.000Z" },
    { start: "2026-11-24T21:00:00.000Z", end: "2026-11-24T23:00:00.000Z" },
  ]);
});

test("a repeat that started years ago still shows inside the window", () => {
  const busy = parseBusyTimes(ics(event("old", ["DTSTART:20150105T150000Z", "DTEND:20150105T160000Z", "RRULE:FREQ=WEEKLY;BYDAY=MO"])), WINDOW);
  assert.equal(busy.timed[0].start, "2026-11-02T15:00:00.000Z");
  assert.ok(busy.timed.every((block) => block.start >= WINDOW.fromIso && block.start < WINDOW.toIso));
  assert.equal(busy.timed.length, 9);
});

test("all-day events are kept apart, as dates", () => {
  const busy = parseBusyTimes(
    ics(
      event("trip", ["DTSTART;VALUE=DATE:20261120", "DTEND;VALUE=DATE:20261123"]),
      event("bday", ["DTSTART;VALUE=DATE:20261105"])
    ),
    WINDOW
  );
  assert.deepEqual(busy.timed, []);
  assert.deepEqual(busy.allDay, [
    { startDate: "2026-11-20", endDate: "2026-11-23" },
    { startDate: "2026-11-05", endDate: "2026-11-06" },
  ]);
});

test("outside the window is left out; overlapping events merge", () => {
  const busy = parseBusyTimes(
    ics(
      event("past", ["DTSTART:20261001T150000Z", "DTEND:20261001T160000Z"]),
      event("x", ["DTSTART:20261104T150000Z", "DTEND:20261104T160000Z"]),
      event("y", ["DTSTART:20261104T153000Z", "DTEND:20261104T170000Z"])
    ),
    WINDOW
  );
  assert.deepEqual(busy.timed, [{ start: "2026-11-04T15:00:00.000Z", end: "2026-11-04T17:00:00.000Z" }]);
  assert.deepEqual(mergeBusyBlocks([{ start: "2026-11-04T15:00:00.000Z", end: "2026-11-04T16:00:00.000Z" }, { start: "2026-11-04T16:00:00.000Z", end: "2026-11-04T17:00:00.000Z" }]), [
    { start: "2026-11-04T15:00:00.000Z", end: "2026-11-04T17:00:00.000Z" },
  ]);
});

test("not a calendar: a plain-English error", () => {
  assert.throws(() => parseBusyTimes("<html>Sign in</html>", WINDOW), /didn't give back a calendar/);
});

console.log("\nwhat blocks booking");

const NOW = "2026-11-02T12:00:00.000Z";

test("all-day events only block when the switch is on, the whole day in the business's zone", () => {
  const calendar = { timed: [{ start: "2026-11-04T15:00:00.000Z", end: "2026-11-04T16:00:00.000Z" }], allDay: [{ startDate: "2026-11-05", endDate: "2026-11-06" }], okAt: NOW };
  assert.equal(activeBusyBlocks([calendar], { allDayBlocks: false, timeZone: "America/Chicago", nowIso: NOW }).length, 1);
  assert.deepEqual(activeBusyBlocks([calendar], { allDayBlocks: true, timeZone: "America/Chicago", nowIso: NOW })[1], {
    start: "2026-11-05T06:00:00.000Z",
    end: "2026-11-06T06:00:00.000Z",
  });
});

test("a calendar not read in over a day stops counting", () => {
  const calendar = { timed: [{ start: "2026-11-04T15:00:00.000Z", end: "2026-11-04T16:00:00.000Z" }], allDay: [], okAt: "2026-11-01T11:00:00.000Z" };
  assert.deepEqual(activeBusyBlocks([calendar], { allDayBlocks: false, timeZone: "America/Chicago", nowIso: NOW }), []);
  assert.deepEqual(activeBusyBlocks([{ ...calendar, okAt: null }], { allDayBlocks: false, timeZone: "America/Chicago", nowIso: NOW }), []);
});

test("the booking page skips busy times, buffer included", () => {
  const settings = BookingSettingsSchema.parse({ timeZone: "America/Chicago", minNoticeHours: 0, slotStepMinutes: 30 });
  // Busy 2–3pm Wed Nov 4 in Chicago.
  const busy = busyAsAppointments([{ start: "2026-11-04T20:00:00.000Z", end: "2026-11-04T21:00:00.000Z" }]);
  const times = bookingOpenTimes({ settings, service: { minutes: 60, bufferMinutes: 15 }, date: "2026-11-04", appointments: busy, nowIso: NOW });
  // 1pm would run (with its buffer) to 2:15; 1:30, 2 and 2:30 overlap.
  assert.ok(times.includes("12:30"));
  for (const time of ["13:00", "13:30", "14:00", "14:30"]) assert.ok(!times.includes(time), time);
  assert.ok(times.includes("15:00"));
  const free = bookingOpenTimes({ settings, service: { minutes: 60, bufferMinutes: 15 }, date: "2026-11-04", appointments: [], nowIso: NOW });
  assert.ok(free.includes("14:00"));
});

test("the owner's warning names the calendar", () => {
  const blocks = [{ start: "2026-11-04T20:00:00.000Z", end: "2026-11-04T21:00:00.000Z", calendar: "Personal" }];
  assert.equal(findBusyConflict({ startAt: "2026-11-04T20:30:00.000Z", blockedUntil: "2026-11-04T21:30:00.000Z" }, blocks).calendar, "Personal");
  assert.equal(findBusyConflict({ startAt: "2026-11-04T21:00:00.000Z", blockedUntil: "2026-11-04T22:00:00.000Z" }, blocks), null);
});

test("calendar blocks: minutes on the day, cut at midnight", () => {
  const blocks = [
    { start: "2026-11-04T20:00:00.000Z", end: "2026-11-04T21:30:00.000Z", calendar: "Personal" },
    { start: "2026-11-05T04:00:00.000Z", end: "2026-11-05T08:00:00.000Z", calendar: "Late" },
  ];
  assert.deepEqual(
    busyMinutesOnDate(blocks, "2026-11-04", "America/Chicago").map(({ start, end }) => [start, end]),
    [[840, 930], [1320, 1440]]
  );
  assert.deepEqual(busyMinutesOnDate(blocks, "2026-11-05", "America/Chicago").map(({ start, end }) => [start, end]), [[0, 120]]);
  // Clocks fall back Nov 1: 10am is still 600 minutes in.
  assert.deepEqual(busyMinutesOnDate([{ start: "2026-11-01T16:00:00.000Z", end: "2026-11-01T17:00:00.000Z" }], "2026-11-01", "America/Chicago")[0].start, 600);
});

Promise.all(pending).then(() => {
  if (failures > 0) {
    console.error(`\n${failures} busy calendar test(s) failed`);
    process.exit(1);
  }
});
