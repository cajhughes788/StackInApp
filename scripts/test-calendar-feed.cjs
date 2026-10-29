require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const feed = require("../shared/calendarFeed.ts");
const { AppointmentSchema } = require("../shared/schemas/appointment.ts");

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

const nowIso = "2026-10-27T20:00:00.000Z";
const make = (over) =>
  AppointmentSchema.parse({
    id: "a1", workspaceId: "w", clientId: "c", clientName: "Justin Schuetz", clientEmail: "j@example.com",
    clientPhone: "2085551234", serviceId: null, serviceName: "Haircut", price: 40, minutes: 60, bufferMinutes: 0,
    deposit: { type: "fixed", value: 10 }, date: "2026-10-29", startTime: "12:15", timeZone: "America/Los_Angeles",
    startAt: "2026-10-29T19:15:00.000Z", endAt: "2026-10-29T20:15:00.000Z", blockedUntil: "2026-10-29T20:15:00.000Z",
    status: "confirmed", holdExpiresAt: null, shareToken: "t", location: "3101 N 10th St\nBoise, ID",
    createdAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T01:02:03.000Z", ...over,
  });
const build = (appointments, deposits = {}) =>
  feed.buildCalendarFeed({ appointments, deposits, businessName: "Fade, Co; Shop", timeZone: "America/Los_Angeles", nowIso });

test("a calendar file with one event per appointment that's happening", () => {
  const ics = build([
    make({}),
    make({ id: "a2", status: "requested", holdExpiresAt: "2026-10-28T00:00:00.000Z" }),
    make({ id: "a3", status: "canceled" }),
    make({ id: "a4", status: "declined" }),
    make({ id: "a5", status: "requested", holdExpiresAt: "2026-10-27T00:00:00.000Z" }), // expired
    make({ id: "a6", status: "completed" }),
    make({ id: "a7", status: "no_show" }),
  ]);
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 4);
  for (const id of ["a1", "a2", "a6", "a7"]) assert.match(ics, new RegExp(`UID:${id}@the521app\\.com`));
  assert.match(ics, /X-WR-CALNAME:521 Bookings/);
  assert.ok(ics.includes("X-WR-CALDESC:Appointments for Fade\\, Co\\; Shop\\, from 521."))
});

test("event details: UTC times, title, place, notes", () => {
  const ics = build([make({})], { a1: "paid" });
  assert.match(ics, /DTSTART:20261029T191500Z\r\n/);
  assert.match(ics, /DTEND:20261029T201500Z\r\n/);
  assert.match(ics, /LAST-MODIFIED:20261027T010203Z/);
  assert.match(ics, /SUMMARY:Haircut · Justin Schuetz\r\n/);
  assert.match(ics, /LOCATION:3101 N 10th St\\, Boise\\, ID/);
  const unfolded = ics.replace(/\r\n /g, "");
  assert.match(unfolded, /DESCRIPTION:Phone: \(208\) 555-1234\\nEmail: j@example\.com\\nPrice: \$40\.00\\nDeposit: \$10\.00 paid\\nManage it in 521\./);
  assert.match(ics, /STATUS:CONFIRMED/);
});

test("waiting ones are marked; deposits due by default", () => {
  const ics = build([make({ status: "requested", holdExpiresAt: "2026-10-28T00:00:00.000Z" })]).replace(/\r\n /g, "");
  assert.match(ics, /SUMMARY:Waiting: Haircut · Justin Schuetz/);
  assert.match(ics, /STATUS:TENTATIVE/);
  assert.match(ics, /Waiting for the client to confirm\./);
  assert.match(ics, /Deposit: \$10\.00 due/);
});

test("abandoned online bookings stay out", () => {
  const ics = build([make({ source: "online", status: "requested", holdExpiresAt: "2026-10-27T00:00:00.000Z" })]);
  assert.doesNotMatch(ics, /BEGIN:VEVENT/);
});

test("long lines fold at 75 bytes", () => {
  const ics = build([make({ serviceName: "A very long service name ".repeat(3).trim() })]);
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.match(ics.replace(/\r\n /g, ""), /SUMMARY:(A very long service name ){2}A very long service name · Justin/);
});

test("subscribe links", () => {
  assert.equal(feed.calendarFeedUrl("tok"), "https://app.the521app.com/cal/tok.ics");
  assert.equal(feed.calendarFeedWebcalUrl("tok"), "webcal://app.the521app.com/cal/tok.ics");
  const google = new URL(feed.googleCalendarSubscribeUrl("tok"));
  assert.equal(google.origin + google.pathname, "https://accounts.google.com/ServiceLogin");
  assert.equal(google.searchParams.get("passive"), "true");
  assert.equal(google.searchParams.get("continue"), "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fapp.the521app.com%2Fcal%2Ftok.ics");
  const outlook = new URL(feed.outlookCalendarSubscribeUrl("tok"));
  assert.equal(outlook.origin + outlook.pathname, "https://outlook.live.com/mail/");
  assert.equal(outlook.searchParams.get("prompt"), "select_account");
  assert.equal(outlook.searchParams.get("deeplink"), "calendar/0/addfromweb?url=https%3A%2F%2Fapp.the521app.com%2Fcal%2Ftok.ics&name=521%20Bookings");
});

if (failed) process.exit(1);
