require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

// Voice booking: how a reply from the server fills the New appointment form
// or picks the appointment to move (frontend/lib/voiceBookingFill.ts).
const path = require("node:path");
const Module = require("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@shared/")) {
    request = path.join(__dirname, "..", "shared", request.slice("@shared/".length));
  } else if (request.startsWith("@/")) {
    request = path.join(__dirname, "..", "frontend", request.slice(2));
  }
  return originalResolve.call(this, request, ...rest);
};

const assert = require("node:assert/strict");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(error);
  }
}
const {
  planBookingFill, planMove, resolveTime, timeReadings, startsInHours, matchServices,
  voiceBookingCurrentFor, voiceBookingHints, stashBookingFill, peekBookingFill, clearBookingFill,
} = require("../frontend/lib/voiceBookingFill.ts");
const { VoiceBookingResultSchema, VoiceBookingRequestSchema } = require("../shared/voiceBooking.ts");

// Today 2026-11-16 is a Monday. Open 9–5 weekdays, 5–9 PM Saturdays, closed Sundays.
const day = [{ start: "09:00", end: "17:00" }];
const HOURS = {
  weeklyHours: { sun: [], mon: day, tue: day, wed: day, thu: day, fri: day, sat: [{ start: "17:00", end: "21:00" }] },
  daysOff: ["2026-11-26"],
};
const t = (hour, minute = 0, meridiem = null) => ({ hour, minute, meridiem });

console.log("times");

test("AM/PM said, or a 24-hour time, is as said", () => {
  assert.deepEqual(timeReadings(t(2, 0, "pm")), ["14:00"]);
  assert.deepEqual(timeReadings(t(12, 0, "am")), ["00:00"]);
  assert.deepEqual(timeReadings(t(12, 30, null)), ["12:30"]);
  assert.deepEqual(timeReadings(t(14, 15, null)), ["14:15"]);
  assert.deepEqual(timeReadings(t(3, 0, null)), ["03:00", "15:00"]);
});

test("no AM/PM: the reading inside their hours wins", () => {
  assert.equal(resolveTime(t(10), "2026-11-19", HOURS), "10:00"); // Thu 9–5
  assert.equal(resolveTime(t(2), "2026-11-19", HOURS), "14:00");
  assert.equal(resolveTime(t(8), "2026-11-21", HOURS), "20:00"); // Sat 5–9 PM: 8 means evening
});

test("no AM/PM and the hours don't settle it: 7–11 morning, 1–6 afternoon", () => {
  assert.equal(resolveTime(t(8), "2026-11-22", HOURS), "08:00"); // Sunday, closed
  assert.equal(resolveTime(t(6), "2026-11-22", HOURS), "18:00");
  assert.equal(resolveTime(t(9, 30), null, null), "09:30");
  assert.equal(resolveTime(t(4), null, null), "16:00");
});

test("days off and closed days aren't in hours", () => {
  assert.equal(startsInHours(HOURS, "2026-11-26", "10:00"), false);
  assert.equal(startsInHours(HOURS, "2026-11-19", "17:00"), false, "the end of the block isn't a start");
});

console.log("services and clients");

const SERVICES = [
  { id: "s1", name: "Haircut" },
  { id: "s2", name: "Root color" },
  { id: "s3", name: "Full color" },
  { id: "s4", name: "Blowout" },
];

test("service matching: exact, contained, shared words", () => {
  assert.deepEqual(matchServices("haircut", SERVICES).map((s) => s.id), ["s1"]);
  assert.deepEqual(matchServices("cut", SERVICES).map((s) => s.id), ["s1"]);
  assert.deepEqual(matchServices("blow out", SERVICES).map((s) => s.id), ["s4"]);
  assert.deepEqual(matchServices("color", SERVICES).map((s) => s.id), ["s2", "s3"]);
  assert.deepEqual(matchServices("roots color touch up", SERVICES).map((s) => s.id), ["s2", "s3"]);
  assert.deepEqual(matchServices("Kids trim", SERVICES), []);
});

const saved = (name, extra = {}) => ({ id: `c_${name}`, name, nameKey: name.toLowerCase(), aliases: [], ...extra });
const CLIENTS = [saved("Jenna Morales", { email: "j@x.com" }), saved("Jenna Smith"), saved("Marcus Lee")];
const reply = (fields) => VoiceBookingResultSchema.parse({
  action: "book", clientName: null, clientEmail: null, clientPhone: null, serviceName: null, price: null, minutes: null,
  date: null, time: null, location: null, confirmNow: null, fromDate: null, fromTime: null, fromClient: null, ...fields,
});
const ctx = (overrides = {}) => ({
  services: SERVICES, savedClients: CLIENTS, hours: HOURS, today: "2026-11-16", currentDate: "2026-11-16", fixing: false, ...overrides,
});

test("a full booking: saved client, saved service, afternoon time", () => {
  const plan = planBookingFill(reply({ clientName: "Marcus", serviceName: "cut", date: "2026-11-19", time: t(2) }), ctx());
  assert.equal(plan.client.client.id, "c_Marcus Lee");
  assert.equal(plan.service.service.id, "s1");
  assert.equal(plan.date, "2026-11-19");
  assert.equal(plan.startTime, "14:00");
  assert.equal(plan.questions.length, 0);
  assert.equal(plan.askToConfirm, null);
});

test("names that fit several become questions", () => {
  const plan = planBookingFill(reply({ clientName: "Jenna", serviceName: "color" }), ctx());
  assert.equal(plan.client, null);
  assert.equal(plan.service, null);
  assert.deepEqual(plan.questions.map((q) => [q.kind, q.prompt, q.options.length]), [["client", "Which Jenna?", 2], ["service", "Which color?", 2]]);
});

test("new client, custom service, price and length, book it now", () => {
  const plan = planBookingFill(
    reply({ clientName: "Priya Patel", serviceName: "Kids trim", price: 25, minutes: 30, confirmNow: true, location: " 12 5th St " }),
    ctx()
  );
  assert.deepEqual(plan.client, { kind: "new", name: "Priya Patel" });
  assert.deepEqual(plan.service, { kind: "custom", name: "Kids trim" });
  assert.equal(plan.price, 25);
  assert.equal(plan.minutes, 30);
  assert.equal(plan.askToConfirm, false);
  assert.equal(plan.location, "12 5th St");
});

test("a past day isn't used; a time alone uses the form's date", () => {
  const plan = planBookingFill(reply({ date: "2026-11-10", time: t(8) }), ctx({ currentDate: "2026-11-21" }));
  assert.equal(plan.date, null);
  assert.match(plan.skipped[0], /already passed/);
  assert.equal(plan.startTime, "20:00", "Saturday evening hours on the form's day");
});

console.log("moving");

const APPTS = [
  { id: "a1", clientName: "Jenna Morales", serviceName: "Haircut", date: "2026-11-16", startTime: "15:00" },
  { id: "a2", clientName: "Marcus Lee", serviceName: "Haircut", date: "2026-11-16", startTime: "10:00" },
  { id: "a3", clientName: "Jenna Smith", serviceName: "Blowout", date: "2026-11-19", startTime: "15:00" },
  { id: "a4", clientName: "Jenna Morales", serviceName: "Root color", date: "2026-11-20", startTime: "11:00" },
];
const mctx = (overrides = {}) => ({ appointments: APPTS, viewedDate: "2026-11-16", today: "2026-11-16", hours: HOURS, ...overrides });
const move = (fields) => reply({ action: "move", ...fields });

test("\"move my 3 to 4\": the 3:00 on the day being viewed, to 4 PM", () => {
  const plan = planMove(move({ fromTime: t(3), time: t(4) }), mctx());
  assert.equal(plan.kind, "go");
  assert.equal(plan.choice.appointment.id, "a1");
  assert.deepEqual([plan.choice.date, plan.choice.startTime], ["2026-11-16", "16:00"]);
  const thursday = planMove(move({ fromTime: t(3), time: t(4) }), mctx({ viewedDate: "2026-11-19" }));
  assert.equal(thursday.choice.appointment.id, "a3");
});

test("\"move Jenna to Friday at 10\": both Jennas' next appointments are offered", () => {
  const plan = planMove(move({ fromClient: "Jenna", date: "2026-11-20", time: t(10) }), mctx());
  assert.equal(plan.kind, "pick");
  assert.deepEqual(plan.options.map((o) => o.appointment.id), ["a1", "a3"]);
  assert.deepEqual([plan.options[0].date, plan.options[0].startTime], ["2026-11-20", "10:00"]);
});

test("a full name and a new day keeps the time", () => {
  const plan = planMove(move({ fromClient: "Marcus Lee", date: "2026-11-18" }), mctx());
  assert.equal(plan.kind, "go");
  assert.deepEqual([plan.choice.appointment.id, plan.choice.date, plan.choice.startTime], ["a2", "2026-11-18", "10:00"]);
});

test("Thursday's 3 by date; nothing found; nothing to move to", () => {
  assert.equal(planMove(move({ fromDate: "2026-11-19", fromTime: t(3), time: t(5) }), mctx()).choice.appointment.id, "a3");
  assert.equal(planMove(move({ fromTime: t(7), time: t(8) }), mctx()).kind, "none");
  assert.match(planMove(move({ fromTime: t(3) }), mctx()).message, /when to move it to/);
  assert.match(planMove(move({ time: t(3) }), mctx()).message, /which appointment/);
});

test("moving into the past isn't offered", () => {
  const plan = planMove(move({ fromClient: "Marcus", date: "2026-11-10" }), mctx());
  assert.equal(plan.kind, "none");
  assert.match(plan.message, /already passed/);
});

console.log("current, hints, hand-off, schema");

test("voiceBookingCurrentFor", () => {
  const current = voiceBookingCurrentFor({
    clientName: " Jenna ", clientEmail: "", clientPhone: "", serviceName: "Haircut", priceText: "45.00", minutes: 60,
    date: "2026-11-19", startTime: "", location: "",
  });
  assert.deepEqual(current, {
    clientName: "Jenna", clientEmail: null, clientPhone: null, serviceName: "Haircut", price: 45, minutes: 60,
    date: "2026-11-19", startTime: null, location: null,
  });
});

test("hints and the Booking page hand-off", () => {
  const hints = voiceBookingHints(["Jenna Morales"], ["Haircut"]);
  assert.ok(hints.includes("Haircut") && hints.includes("Jenna Morales") && hints.includes("book"));
  stashBookingFill({ transcript: "book Jenna", result: reply({}) });
  assert.equal(peekBookingFill().transcript, "book Jenna");
  clearBookingFill();
  assert.equal(peekBookingFill(), null);
});

test("request schema", () => {
  const base = { kind: "booking", mode: "any", transcript: "move my 3 to 4", today: "2026-11-16" };
  assert.ok(VoiceBookingRequestSchema.safeParse(base).success);
  assert.ok(!VoiceBookingRequestSchema.safeParse({ ...base, mode: "move" }).success);
});

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
