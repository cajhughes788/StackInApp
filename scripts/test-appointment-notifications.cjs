require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const { appointmentNotificationText } = require("../shared/appointmentNotifications.ts");
const { AppointmentSchema } = require("../shared/schemas/appointment.ts");

const appointment = AppointmentSchema.parse({
  id: "a1",
  workspaceId: "w1",
  clientId: "c1",
  clientName: "Justin Schuetz",
  clientEmail: null,
  clientPhone: null,
  serviceId: "s1",
  bufferMinutes: 0,
  holdExpiresAt: null,
  shareToken: null,
  serviceName: "Haircut",
  price: 40,
  minutes: 60,
  deposit: { type: "fixed", value: 10 },
  date: "2026-10-29",
  startTime: "12:15",
  timeZone: "America/Los_Angeles",
  startAt: "2026-10-29T19:15:00.000Z",
  endAt: "2026-10-29T20:15:00.000Z",
  blockedUntil: "2026-10-29T20:15:00.000Z",
  status: "canceled",
  createdAt: "2026-10-27T00:00:00.000Z",
  updatedAt: "2026-10-27T00:00:00.000Z",
});
const paid = { ...appointment, invoiceId: "appt_a1" };

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

test("cancel with no deposit paid", () => {
  const text = appointmentNotificationText(appointment, "canceled");
  assert.equal(text.title, "Justin Schuetz canceled");
  assert.match(text.body, /^Haircut · .*Oct 29.* at 12:15pm$/);
});

test("cancel says whether the deposit went back", () => {
  assert.match(appointmentNotificationText(paid, "canceled", { depositRefunded: true }).body, /\$10\.00 deposit refunded$/);
  assert.match(appointmentNotificationText(paid, "canceled", { depositRefunded: false }).body, /\$10\.00 deposit kept$/);
});

test("confirm, can't make it, and online booking", () => {
  assert.equal(appointmentNotificationText(appointment, "confirmed").title, "Justin Schuetz confirmed");
  assert.match(appointmentNotificationText(paid, "confirmed").body, /\$10\.00 deposit paid$/);
  const declined = appointmentNotificationText(appointment, "declined");
  assert.equal(declined.title, "Justin Schuetz can't make it");
  assert.match(declined.body, /the time is open again$/);
  assert.equal(appointmentNotificationText(appointment, "booked").title, "New booking: Justin Schuetz");
});

if (failed) process.exit(1);
