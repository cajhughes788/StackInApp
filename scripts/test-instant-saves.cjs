require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const { AppointmentCreateInputSchema } = require("../shared/schemas/appointment.ts");
const { ClientCreateInputSchema } = require("../shared/schemas/client.ts");

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

const booking = {
  clientMutationId: "appt_abcdef123456",
  clientName: "Justin",
  serviceId: null,
  serviceName: "Cut",
  price: 40,
  minutes: 60,
  bufferMinutes: 0,
  deposit: { type: "none", value: 0 },
  date: "2030-01-02",
  startTime: "10:00",
  askToConfirm: true,
};

test("a booking can carry the link the app made", () => {
  assert.equal(AppointmentCreateInputSchema.parse(booking).shareToken, undefined);
  const token = "AbCdEfGhIjKlMnOpQrSt_-";
  assert.equal(AppointmentCreateInputSchema.parse({ ...booking, shareToken: token }).shareToken, token);
  assert.throws(() => AppointmentCreateInputSchema.parse({ ...booking, shareToken: "short" }));
  assert.throws(() => AppointmentCreateInputSchema.parse({ ...booking, shareToken: "has spaces in it and is long enough" }));
});

test("a new client can carry the id the app made", () => {
  assert.equal(ClientCreateInputSchema.parse({ name: "Ana" }).id, undefined);
  assert.equal(ClientCreateInputSchema.parse({ name: "Ana", id: "aB3dE6gH9jK2mN5pQ8sT" }).id, "aB3dE6gH9jK2mN5pQ8sT");
  assert.throws(() => ClientCreateInputSchema.parse({ name: "Ana", id: "../other" }));
  assert.throws(() => ClientCreateInputSchema.parse({ name: "Ana", id: "short" }));
});

if (failed) process.exit(1);
