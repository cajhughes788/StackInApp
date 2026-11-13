require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const {
  daysBetween,
  invoiceFieldsForSchedule,
  nextScheduleDate,
  planScheduleRun,
  scheduleEndLabel,
  scheduleEndReached,
  scheduleNextDateFrom,
  scheduleStatusLine,
} = require("../shared/invoiceSchedules.ts");
const {
  InvoiceScheduleCreateInputSchema,
  InvoiceSchedulePatchSchema,
  InvoiceScheduleSchema,
} = require("../shared/schemas/invoiceSchedule.ts");
const { InvoiceSchema } = require("../shared/schemas/invoice.ts");
const { formatInvoiceDate } = require("../shared/invoiceDisplay.ts");

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

// The dates a schedule makes, starting from (and including) its anchor.
function run(anchor, frequency, count) {
  const dates = [anchor];
  while (dates.length < count) dates.push(nextScheduleDate(dates[dates.length - 1], frequency, anchor));
  return dates;
}

function schedule(extra = {}) {
  return InvoiceScheduleSchema.parse({
    id: "s1",
    workspaceId: "ws",
    clientName: "Jo Martinez",
    clientId: "c1",
    clientEmail: "jo@example.com",
    lines: [
      { description: "Monthly bookkeeping", quantity: 1, rate: 400, amount: 400, category: "services" },
      { description: "Payroll", quantity: 2, rate: 37.5, amount: 75, category: "services" },
    ],
    total: 475,
    note: "Venmo @jo",
    policies: "Net 15.",
    dueInDays: 15,
    frequency: "monthly",
    anchorDate: "2026-10-01",
    nextDate: "2026-11-01",
    end: { type: "never" },
    sendMode: "email",
    status: "active",
    invoicesMade: 1,
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-01T12:00:00Z",
    ...extra,
  });
}

console.log("dates");

test("weekly and every 2 weeks step by 7 and 14 days, across months and years", () => {
  assert.deepEqual(run("2026-12-24", "weekly", 3), ["2026-12-24", "2026-12-31", "2027-01-07"]);
  assert.deepEqual(run("2026-12-24", "biweekly", 3), ["2026-12-24", "2027-01-07", "2027-01-21"]);
});

test("monthly keeps the day; the 31st falls back in short months and comes back", () => {
  assert.deepEqual(run("2027-01-31", "monthly", 5), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
  assert.deepEqual(run("2026-11-15", "monthly", 3), ["2026-11-15", "2026-12-15", "2027-01-15"]);
});

test("leap years: Feb 29 when there is one", () => {
  assert.deepEqual(run("2028-01-30", "monthly", 3), ["2028-01-30", "2028-02-29", "2028-03-30"]);
  assert.deepEqual(run("2028-02-29", "yearly", 5), ["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
});

test("every 3 months keeps the day too", () => {
  assert.deepEqual(run("2026-11-30", "quarterly", 4), ["2026-11-30", "2027-02-28", "2027-05-30", "2027-08-30"]);
});

test("the next one comes after the first invoice and after today", () => {
  // Started today: one period on.
  assert.equal(scheduleNextDateFrom("2026-11-06", "monthly", "2026-11-06", { includeToday: false }), "2026-12-06");
  // From an older invoice: the first date after today, the missed ones aren't made.
  assert.equal(scheduleNextDateFrom("2026-08-01", "monthly", "2026-11-06", { includeToday: false }), "2026-12-01");
  assert.equal(scheduleNextDateFrom("2026-10-01", "monthly", "2026-11-01", { includeToday: false }), "2026-12-01");
  // Back-dated into the future: after that invoice.
  assert.equal(scheduleNextDateFrom("2026-11-20", "weekly", "2026-11-06", { includeToday: false }), "2026-11-27");
  // Resumed on one of its dates: today still counts.
  assert.equal(scheduleNextDateFrom("2026-10-01", "monthly", "2026-12-01", { includeToday: true }), "2026-12-01");
});

console.log("making invoices");

test("nothing until its date; on it, that date's invoice, then the next date", () => {
  assert.deepEqual(planScheduleRun(schedule(), "2026-10-31"), { kind: "wait" });
  assert.deepEqual(planScheduleRun(schedule(), "2026-11-01"), { kind: "make", date: "2026-11-01", nextDate: "2026-12-01", endsAfter: false });
});

test("after a gap, only the latest date due is made — no pile-up", () => {
  assert.deepEqual(planScheduleRun(schedule({ nextDate: "2026-08-01" }), "2026-11-06"), {
    kind: "make",
    date: "2026-11-01",
    nextDate: "2026-12-01",
    endsAfter: false,
  });
});

test("a paused or ended schedule makes nothing", () => {
  assert.deepEqual(planScheduleRun(schedule({ status: "paused" }), "2026-11-06"), { kind: "wait" });
  assert.deepEqual(planScheduleRun(schedule({ status: "ended" }), "2026-11-06"), { kind: "wait" });
});

test("'after 6 invoices' makes the 6th and then ends; never a 7th", () => {
  const end = { type: "count", count: 6 };
  assert.equal(planScheduleRun(schedule({ end, invoicesMade: 4 }), "2026-11-01").endsAfter, false);
  const sixth = planScheduleRun(schedule({ end, invoicesMade: 5 }), "2026-11-01");
  assert.equal(sixth.kind, "make");
  assert.equal(sixth.endsAfter, true);
  assert.deepEqual(planScheduleRun(schedule({ end, invoicesMade: 6 }), "2026-11-01"), { kind: "end" });
});

test("'on a date' makes invoices up to that date and ends with the last", () => {
  const end = { type: "date", date: "2026-12-15" };
  assert.equal(planScheduleRun(schedule({ end }), "2026-11-01").endsAfter, false);
  const last = planScheduleRun(schedule({ end, nextDate: "2026-12-01" }), "2026-12-01");
  assert.equal(last.kind, "make");
  assert.equal(last.endsAfter, true);
  assert.deepEqual(planScheduleRun(schedule({ end, nextDate: "2027-01-01" }), "2027-01-01"), { kind: "end" });
  assert.equal(scheduleEndReached({ type: "never" }, 999, "2099-01-01"), false);
});

test("each repeat bills exactly the same, dated its day and due on the same terms", () => {
  const fields = invoiceFieldsForSchedule(schedule(), "2026-12-01");
  assert.equal(fields.total, 475);
  assert.deepEqual(fields.lines, schedule().lines);
  assert.equal(fields.clientName, "Jo Martinez");
  assert.equal(fields.clientId, "c1");
  assert.equal(fields.note, "Venmo @jo");
  assert.equal(fields.policies, "Net 15.");
  assert.equal(fields.issueDate, "2026-12-01");
  assert.equal(fields.dueDate, "2026-12-16");
  assert.equal(invoiceFieldsForSchedule(schedule({ dueInDays: 0 }), "2026-12-01").dueDate, "2026-12-01");
  // It reads as a valid invoice, tied back to its schedule.
  const invoice = InvoiceSchema.parse({
    id: "sched_s1_2026-12-01",
    workspaceId: "ws",
    number: "0042",
    ...fields,
    status: "draft",
    scheduleId: "s1",
    createdAt: "2026-12-01T14:00:00Z",
    updatedAt: "2026-12-01T14:00:00Z",
  });
  assert.equal(invoice.scheduleId, "s1");
  assert.equal(invoice.deposit, null);
});

test("terms are kept as days: an invoice due in 15 days repeats due in 15 days", () => {
  assert.equal(daysBetween("2026-11-06", "2026-11-21"), 15);
  assert.equal(daysBetween("2026-02-20", "2026-03-07"), 15);
});

console.log("inputs and labels");

test("a schedule's total must match its lines", () => {
  assert.throws(() => schedule({ total: 500 }));
});

test("the inputs the app sends are checked", () => {
  const base = { invoiceId: "i1", frequency: "monthly", end: { type: "never" }, sendMode: "email", clientMutationId: "abc" };
  assert.equal(InvoiceScheduleCreateInputSchema.safeParse(base).success, true);
  assert.equal(InvoiceScheduleCreateInputSchema.safeParse({ ...base, end: { type: "count", count: 1 } }).success, false);
  assert.equal(InvoiceScheduleCreateInputSchema.safeParse({ ...base, frequency: "daily" }).success, false);
  assert.equal(InvoiceSchedulePatchSchema.safeParse({ action: "pause" }).success, true);
  assert.equal(InvoiceSchedulePatchSchema.safeParse({ action: "edit", dueInDays: 400 }).success, false);
  assert.equal(InvoiceSchedulePatchSchema.safeParse({ action: "edit", frequency: "quarterly", sendMode: "draft" }).success, true);
});

test("invoices that aren't repeats default to no schedule", () => {
  const invoice = InvoiceSchema.parse({
    id: "i1",
    workspaceId: "ws",
    number: "0001",
    clientName: "Jo",
    lines: [{ description: "Work", quantity: 1, rate: 100, amount: 100, category: "services" }],
    total: 100,
    issueDate: "2026-11-06",
    dueDate: "2026-11-06",
    status: "sent",
    createdAt: "2026-11-06T12:00:00Z",
    updatedAt: "2026-11-06T12:00:00Z",
  });
  assert.equal(invoice.scheduleId, null);
});

test("list lines and end labels read plainly", () => {
  const short = (date) => formatInvoiceDate(date).replace(/, \d{4}$/, "");
  assert.equal(scheduleStatusLine(schedule(), short), "Monthly · next Nov 1");
  assert.equal(scheduleStatusLine(schedule({ status: "paused" }), short), "Monthly · paused");
  assert.equal(scheduleStatusLine(schedule({ status: "ended" }), short), "Ended");
  assert.equal(scheduleEndLabel({ type: "count", count: 6 }, formatInvoiceDate), "6 invoices in all");
  assert.equal(scheduleEndLabel({ type: "date", date: "2027-06-30" }, formatInvoiceDate), "Until Jun 30, 2027");
  assert.equal(scheduleEndLabel({ type: "never" }, formatInvoiceDate), "Never ends");
});

if (failures > 0) {
  console.error(`\n${failures} repeating invoice test(s) failed`);
  process.exit(1);
}
