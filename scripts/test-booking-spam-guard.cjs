require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const {
  BOOKING_FORM_MAX_AGE_MS,
  BOOKING_FORM_MIN_MS,
  BOOKING_LIMITS,
  bookingFormStampProblem,
  bookingLimitId,
  currentBookingCount,
  nextBookingCount,
  signBookingFormStamp,
} = require("../shared/bookingSpamGuard.ts");
const { OnlineBookingInputSchema } = require("../shared/schemas/appointment.ts");
const { BookingSettingsSchema } = require("../shared/schemas/booking.ts");
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

const SECRET = "test-secret";
const SLUG = "jos-cuts";
const KEY = "KEY1234567890abcdef";
const SHOWN = Date.parse("2026-12-01T12:00:00.000Z");
const stamp = signBookingFormStamp(SECRET, SLUG, KEY, SHOWN);

console.log("form stamp");

test("a form sent after a person could fill it is fine", () => {
  assert.equal(bookingFormStampProblem(SECRET, SLUG, KEY, stamp, SHOWN + 20_000), null);
});

test("a form sent faster than a person could fill it is refused", () => {
  assert.equal(bookingFormStampProblem(SECRET, SLUG, KEY, stamp, SHOWN + BOOKING_FORM_MIN_MS - 1), "too_fast");
  assert.equal(bookingFormStampProblem(SECRET, SLUG, KEY, stamp, SHOWN + BOOKING_FORM_MIN_MS), null);
});

test("a form older than two hours has timed out", () => {
  assert.equal(bookingFormStampProblem(SECRET, SLUG, KEY, stamp, SHOWN + BOOKING_FORM_MAX_AGE_MS), null);
  assert.equal(bookingFormStampProblem(SECRET, SLUG, KEY, stamp, SHOWN + BOOKING_FORM_MAX_AGE_MS + 1), "expired");
});

test("a missing or made-up stamp is refused", () => {
  const now = SHOWN + 20_000;
  assert.equal(bookingFormStampProblem(SECRET, SLUG, KEY, "", now), "forged");
  assert.equal(bookingFormStampProblem(SECRET, SLUG, KEY, `${SHOWN}.nope`, now), "forged");
  assert.equal(bookingFormStampProblem(SECRET, SLUG, KEY, signBookingFormStamp("other-secret", SLUG, KEY, SHOWN), now), "forged");
});

test("a stamp only works with its own form key, link and time", () => {
  const now = SHOWN + 20_000;
  assert.equal(bookingFormStampProblem(SECRET, SLUG, "OTHERKEY1234567890ab", stamp, now), "forged");
  assert.equal(bookingFormStampProblem(SECRET, "other-shop", KEY, stamp, now), "forged");
  const backdated = stamp.replace(String(SHOWN), String(SHOWN - 60_000));
  assert.equal(bookingFormStampProblem(SECRET, SLUG, KEY, backdated, now), "forged");
});

test("the booking form carries its stamp, and the input keeps it", () => {
  const html = renderPublicBookingPage(
    {
      slug: SLUG,
      booking: BookingSettingsSchema.parse({ timeZone: "America/Chicago" }),
      settings: InvoiceSettingsSchema.parse({ businessName: "Jo's Cuts" }),
      onlinePayments: false,
      fromWebsite: false,
      nowIso: "2026-12-01T12:00:00.000Z",
    },
    {
      step: "details",
      service: { id: "s1", name: "Cut", minutes: 60, bufferMinutes: 0, price: 40, deposit: { type: "none", value: 0 }, active: true, online: true },
      date: "2026-12-02",
      time: "10:00",
      formKey: KEY,
      formStamp: stamp,
    }
  );
  assert.match(html, new RegExp(`name="stamp" value="${stamp}"`));
  const input = OnlineBookingInputSchema.parse({ service: "s1", date: "2026-12-02", time: "10:00", key: KEY, name: "Jo", email: "jo@example.com", stamp });
  assert.equal(input.stamp, stamp);
  assert.equal(OnlineBookingInputSchema.parse({ ...input, stamp: undefined }).stamp, "");
});

console.log("limits");

const NOW = "2026-12-01T12:00:00.000Z";
function countUp(kind, times, nowIso = NOW) {
  let saved = null;
  for (let i = 0; i < times; i += 1) saved = nextBookingCount(kind, saved, nowIso);
  return saved;
}

test("the limits are 5 tries an hour, 3 per email a day, 25 per business a day", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(BOOKING_LIMITS).map(([kind, { max, windowMs }]) => [kind, [max, windowMs / 3_600_000]])),
    { visitor: [5, 1], email: [3, 24], business: [25, 24] }
  );
});

test("counts go up inside a window and stop at the limit", () => {
  for (const [kind, { max }] of Object.entries(BOOKING_LIMITS)) {
    assert.equal(currentBookingCount(countUp(kind, max - 1), NOW) < max, true, `${kind} under`);
    assert.equal(currentBookingCount(countUp(kind, max), NOW) >= max, true, `${kind} reached`);
  }
});

test("a window that has ended counts as zero and starts fresh", () => {
  const full = countUp("visitor", 5);
  assert.equal(full.windowEndsAt, "2026-12-01T13:00:00.000Z");
  const later = "2026-12-01T13:00:00.000Z";
  assert.equal(currentBookingCount(full, later), 0);
  assert.deepEqual(nextBookingCount("visitor", full, later), { count: 1, windowEndsAt: "2026-12-01T14:00:00.000Z" });
  assert.equal(currentBookingCount(null, NOW), 0);
});

test("a later count keeps the window it started in", () => {
  const first = nextBookingCount("email", null, NOW);
  const second = nextBookingCount("email", first, "2026-12-01T20:00:00.000Z");
  assert.deepEqual(second, { count: 2, windowEndsAt: "2026-12-02T12:00:00.000Z" });
});

test("limit ids are hashed, per business, and ignore email case and spaces", () => {
  const id = bookingLimitId("email", "ws1", "Jo@Example.com ");
  assert.equal(id, bookingLimitId("email", "ws1", "jo@example.com"));
  assert.notEqual(id, bookingLimitId("email", "ws2", "jo@example.com"));
  assert.notEqual(id, bookingLimitId("visitor", "ws1", "jo@example.com"));
  assert.doesNotMatch(id, /example|\//);
  assert.doesNotMatch(bookingLimitId("visitor", "ws1", "203.0.113.9"), /203/);
});

if (failures > 0) {
  console.error(`\n${failures} booking spam guard test(s) failed`);
  process.exit(1);
}
