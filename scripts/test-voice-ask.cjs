require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

// Ask 521: periods and answers worked out on the phone
// (frontend/lib/voiceAskAnswer.ts).
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
const {
  resolvePeriod, monthsIn, sameStretch, statementIncome, statementExpenses, answerQuestion, pageHref, plHref, money, logTargetAllowed,
} = require("../frontend/lib/voiceAskAnswer.ts");
const { VoiceAskRequestSchema } = require("../shared/voiceAsk.ts");

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

const TODAY = "2026-11-18"; // a Wednesday
const P = (kind, extra = {}) => ({ kind, month: null, quarter: null, year: null, date: null, ...extra });
const span = (period) => {
  const r = resolvePeriod(period, TODAY);
  return [r.start, r.end, r.label];
};

console.log("periods");

test("days and weeks (Monday to Sunday)", () => {
  assert.deepEqual(span(P("today")), ["2026-11-18", "2026-11-18", "today"]);
  assert.deepEqual(span(P("yesterday")), ["2026-11-17", "2026-11-17", "yesterday"]);
  assert.deepEqual(span(P("this_week")), ["2026-11-16", "2026-11-22", "this week (Nov 16–22)"]);
  assert.deepEqual(span(P("last_week")), ["2026-11-09", "2026-11-15", "last week (Nov 9–15)"]);
  assert.deepEqual(resolvePeriod(P("this_week"), "2026-11-22").start, "2026-11-16", "Sunday is the end of the week");
  assert.deepEqual(span(P("day", { date: "2026-11-13" })), ["2026-11-13", "2026-11-13", "on Nov 13"]);
});

test("months: a month named without a year is the latest one that has started", () => {
  assert.deepEqual(span(P("this_month")), ["2026-11-01", "2026-11-30", "this month (November)"]);
  assert.deepEqual(span(P("last_month")), ["2026-10-01", "2026-10-31", "last month (October)"]);
  assert.deepEqual(span(P("month", { month: 10 })), ["2026-10-01", "2026-10-31", "in October"]);
  assert.deepEqual(span(P("month", { month: 12 })), ["2025-12-01", "2025-12-31", "in December 2025"]);
  assert.deepEqual(span(P("month", { month: 2 })), ["2026-02-01", "2026-02-28", "in February"]);
  assert.deepEqual(resolvePeriod(P("last_month"), "2026-01-10").start, "2025-12-01");
});

test("quarters and years", () => {
  assert.deepEqual(span(P("this_quarter")), ["2026-10-01", "2026-12-31", "this quarter (Q4)"]);
  assert.deepEqual(span(P("last_quarter")), ["2026-07-01", "2026-09-30", "last quarter (Q3)"]);
  assert.deepEqual(span(P("quarter", { quarter: 1 })), ["2026-01-01", "2026-03-31", "in Q1"]);
  assert.deepEqual(resolvePeriod(P("last_quarter"), "2026-02-01").label, "last quarter (Q4 2025)");
  assert.deepEqual(span(P("this_year")), ["2026-01-01", "2026-12-31", "this year"]);
  assert.deepEqual(span(P("last_year")), ["2025-01-01", "2025-12-31", "last year (2025)"]);
});

test("months a range touches stop at today", () => {
  assert.deepEqual(monthsIn({ start: "2026-09-20", end: "2026-12-31" }, TODAY), ["2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(monthsIn({ start: "2025-12-01", end: "2026-01-31" }, TODAY), ["2025-12", "2026-01"]);
  assert.deepEqual(monthsIn({ start: "2026-12-01", end: "2026-12-31" }, TODAY), []);
});

test("comparing to last month uses the same stretch so far", () => {
  const thisMonth = resolvePeriod(P("this_month"), TODAY);
  const lastMonth = resolvePeriod(P("last_month"), TODAY);
  assert.deepEqual([sameStretch(thisMonth, lastMonth, TODAY).start, sameStretch(thisMonth, lastMonth, TODAY).end], ["2026-10-01", "2026-10-18"]);
  const october = resolvePeriod(P("month", { month: 10 }), TODAY);
  assert.equal(sameStretch(october, resolvePeriod(P("month", { month: 9 }), TODAY), TODAY).end, "2026-09-30", "a finished month compares whole");
});

console.log("money from P&L statements");

const item = (date, amount) => ({ id: `${date}-${amount}`, date, label: "x", description: null, amount });
function statement(month, { services = [], tips = [], refunds = [], expenses = {} } = {}) {
  const [y, m] = month.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const sum = (list) => list.reduce((s, i) => s + i.amount, 0);
  const byCategory = Object.entries(expenses).map(([category, items]) => ({ category, amount: sum(items), count: items.length, items }));
  return {
    id: month, workspaceId: "w", workspaceType: "independent", periodType: "month", periodKey: month,
    periodStart: `${month}-01`, periodEnd: end, label: month,
    income: {
      services: sum(services), tips: sum(tips), products: 0, other: 0,
      total: sum(services) + sum(tips) - sum(refunds),
      categories: [
        { category: "services", label: "Services", amount: sum(services), count: services.length, items: services },
        { category: "tips", label: "Tips", amount: sum(tips), count: tips.length, items: tips },
      ],
      refunds: sum(refunds), refundItems: refunds,
    },
    expenses: { byCategory, total: byCategory.reduce((s, c) => s + c.amount, 0) },
    netProfit: 0, hours: { total: 0, avgPerWeek: 0 }, meta: {},
  };
}
const STATEMENTS = [
  statement("2026-10", {
    services: [item("2026-10-05", 500), item("2026-10-20", 300)],
    tips: [item("2026-10-20", 60)],
    expenses: { Supplies: [item("2026-10-02", 80)], "Vehicle & Transportation": [item("2026-10-10", 42)] },
  }),
  statement("2026-11", {
    services: [item("2026-11-03", 200), item("2026-11-16", 150), item("2026-11-17", 120)],
    tips: [item("2026-11-17", 30)],
    refunds: [item("2026-11-17", 20)],
    expenses: { Supplies: [item("2026-11-16", 25.5)] },
  }),
];

test("whole months use the statement total; part of a month adds its lines", () => {
  assert.equal(statementIncome(STATEMENTS, { start: "2026-10-01", end: "2026-10-31" }), 860);
  assert.equal(statementIncome(STATEMENTS, { start: "2026-11-16", end: "2026-11-22" }), 280, "150 + 120 + 30 tips − 20 refund");
  assert.equal(statementIncome(STATEMENTS, { start: "2026-11-16", end: "2026-11-22" }, "tips"), 30);
  assert.equal(statementIncome(STATEMENTS, { start: "2026-01-01", end: "2026-12-31" }), 860 + 480);
});

test("expenses, all or one category (case doesn't matter)", () => {
  assert.equal(statementExpenses(STATEMENTS, { start: "2026-10-01", end: "2026-11-30" }), 147.5);
  assert.equal(statementExpenses(STATEMENTS, { start: "2026-01-01", end: "2026-12-31" }, "vehicle & transportation"), 42);
  assert.equal(statementExpenses(STATEMENTS, { start: "2026-11-01", end: "2026-11-15" }, "Supplies"), 0);
});

console.log("answers");

const NOW = "2026-11-18T18:00:00.000Z";
const appt = (id, date, startTime, clientName, status = "confirmed") => ({
  id, date, startTime, clientName, serviceName: "Haircut", status, holdExpiresAt: null, startAt: `${date}T${startTime}:00.000Z`,
});
const invoice = (id, number, clientName, total, dueDate, paid = 0) => ({
  id, number, clientName, status: "sent", quickCharge: null, total, dueDate, deposit: null, payments: paid ? [{ amount: paid }] : [], refunds: [],
});
const DATA = {
  today: TODAY, nowIso: NOW, workspaceType: "independent", includeUnreported: false,
  statements: STATEMENTS,
  entries: [],
  invoices: [invoice("i1", 12, "Jenna Morales", 160, "2026-11-01"), invoice("i2", 13, "Marcus Lee", 400, "2026-12-01", 100)],
  appointments: [appt("a1", "2026-11-19", "15:00", "Jenna Morales"), appt("a2", "2026-11-19", "10:00", "Marcus Lee"), appt("a3", "2026-11-20", "09:00", "Jenna Smith", "canceled")],
  clientRows: [
    { key: "jenna morales", name: "Jenna Morales", client: { id: "c1" }, thisYear: 640, lifetime: 1200 },
    { key: "jenna smith", name: "Jenna Smith", client: { id: "c2" }, thisYear: 90, lifetime: 90 },
  ],
};
const Q = (topic, extra = {}) => ({ intent: "question", topic, period: null, comparePeriod: null, category: null, client: null, page: null, form: null, ...extra });

test("income this week and last month, with a P&L link", () => {
  const week = answerQuestion(Q("income", { period: P("this_week") }), DATA);
  assert.equal(week.text, "You've made $280 this week (Nov 16–22).");
  assert.equal(week.link.href, "/app/profitloss?type=month&key=2026-11");
  const october = answerQuestion(Q("income", { period: P("last_month") }), DATA);
  assert.equal(october.text, "You made $860 last month (October).");
  assert.equal(october.link.href, "/app/profitloss?type=month&key=2026-10");
});

test("no period means this month; tips; expenses on one category", () => {
  assert.equal(answerQuestion(Q("income"), DATA).text, "You've made $480 this month (November).");
  assert.equal(answerQuestion(Q("tips", { period: P("this_year") }), DATA).text, "$90 in tips this year.");
  assert.equal(
    answerQuestion(Q("expenses", { period: P("this_year"), category: "Vehicle & Transportation" }), DATA).text,
    "You spent $42 on Vehicle & Transportation this year."
  );
});

test("profit shows income and expenses", () => {
  const profit = answerQuestion(Q("profit", { period: P("month", { month: 10 }) }), DATA);
  assert.equal(profit.text, "Your profit in October is $738.");
  assert.deepEqual(profit.details, ["Income $860", "Expenses $122"]);
});

test("comparing this month to last month at the same point", () => {
  const compare = answerQuestion(Q("compare_income", { period: P("this_month") }), DATA);
  assert.equal(compare.text, "$480 this month (November), $20 less than last month (October) at this point.");
});

test("who owes me / what's overdue", () => {
  const owed = answerQuestion(Q("owed"), DATA);
  assert.equal(owed.text, "You're owed $460 on 2 invoices.");
  assert.deepEqual(owed.items.map((i) => i.label), ["Marcus Lee · $300", "Jenna Morales · $160"]);
  const overdue = answerQuestion(Q("overdue"), DATA);
  assert.equal(overdue.text, "$160 is overdue on 1 invoice.");
  assert.equal(overdue.link.href, "/app/invoices?filter=overdue");
});

test("appointments on a day, soonest first, canceled left out", () => {
  const tomorrow = answerQuestion(Q("appointments", { period: P("day", { date: "2026-11-19" }) }), DATA);
  assert.equal(tomorrow.text, "2 appointments on Nov 19, starting 10 AM with Marcus Lee.");
  assert.deepEqual(tomorrow.items.map((i) => i.label), ["10 AM · Marcus Lee", "3 PM · Jenna Morales"]);
  assert.equal(answerQuestion(Q("appointments", { period: P("day", { date: "2026-11-20" }) }), DATA).text, "Nothing booked on Nov 20.");
});

test("next appointment, for anyone or one client", () => {
  assert.equal(answerQuestion(Q("next_appointment"), DATA).text, "Marcus Lee, tomorrow at 10 AM — Haircut.");
  assert.equal(answerQuestion(Q("next_appointment", { client: "Jenna" }), DATA).text, "Jenna Morales, tomorrow at 3 PM — Haircut.");
  assert.equal(answerQuestion(Q("next_appointment", { client: "Olivia" }), DATA).text, "Olivia has nothing booked.");
});

test("what a client paid; a first name for two asks which", () => {
  assert.equal(answerQuestion(Q("client_paid", { client: "Jenna Morales" }), DATA).text, "Jenna Morales has paid you $640 this year.");
  assert.equal(answerQuestion(Q("client_paid", { client: "Jenna Smith", period: P("all_time") }), DATA).text, "Jenna Smith has paid you $90 in all.");
  const which = answerQuestion(Q("client_paid", { client: "Jenna" }), DATA);
  assert.equal(which.text, "Which Jenna?");
  assert.equal(which.items.length, 2);
});

test("W-2: pay and tips from entries; self-employed questions explained", () => {
  const w2 = {
    ...DATA, workspaceType: "w2",
    entries: [
      { date: "2026-11-16", workspace: "w2", w2: { tips: 40, unreportedCash: 0 }, totals: { taxableTotal: 180, paidHours: 7.5 } },
      { date: "2026-11-17", workspace: "w2", w2: { tips: 25, unreportedCash: 10 }, totals: { taxableTotal: 150, paidHours: 6 } },
      { date: "2026-11-02", workspace: "w2", w2: { tips: 10, unreportedCash: 0 }, totals: { taxableTotal: 100, paidHours: 4 } },
    ],
  };
  assert.equal(answerQuestion(Q("income", { period: P("this_week") }), w2).text, "You've made $330 this week (Nov 16–22).");
  assert.equal(answerQuestion(Q("tips", { period: P("this_week") }), w2).text, "$65 in tips this week (Nov 16–22).");
  assert.equal(answerQuestion(Q("hours", { period: P("this_week") }), w2).text, "13.5 hours worked this week (Nov 16–22).");
  assert.equal(answerQuestion(Q("income", { period: P("this_week") }), { ...w2, includeUnreported: true }).text, "You've made $340 this week (Nov 16–22).");
  assert.match(answerQuestion(Q("owed"), w2).text, /self-employed/);
  assert.equal(answerQuestion(Q("income"), w2).link.href, "/app/earnings");
});

console.log("pages and helpers");

test("pages", () => {
  const ctx = { today: TODAY, workspaceType: "independent", clientRows: DATA.clientRows };
  const open = (page, extra = {}) => pageHref({ intent: "open", topic: null, period: null, comparePeriod: null, category: null, client: null, page, form: null, ...extra }, ctx);
  assert.equal(open("pl", { period: P("month", { month: 10 }) }).href, "/app/profitloss?type=month&key=2026-10");
  assert.equal(open("pl", { period: P("this_quarter") }).href, "/app/profitloss?type=quarter&key=2026-Q4");
  assert.equal(open("overdue").href, "/app/invoices?filter=overdue");
  assert.equal(open("client", { client: "Jenna Smith" }).href, "/app/invoices/client?id=c2");
  assert.equal(open("client", { client: "Nobody" }), null);
  assert.equal(open("booking", { period: P("day", { date: "2026-11-20" }) }).href, "/app/booking?date=2026-11-20");
  assert.equal(pageHref({ intent: "open", page: "invoices", period: null, client: null }, { ...ctx, workspaceType: "w2" }), null);
});

test("income paid one way (Venmo, cash tips) counts only those lines", () => {
  const line = (paymentMethod, services, tips = 0) => ({ paymentMethod, services, tips });
  const entry = (date, lines, extra = {}) => ({ date, workspace: "independent", independent: { incomeBreakdowns: lines, unreportedCash: 0, unreportedCashTips: 0, ...extra } });
  const data = {
    ...DATA,
    entries: [
      entry("2026-10-03", [line("venmo", 200, 20), line("cash", 100, 15)]),
      entry("2026-10-20", [line("venmo", 300)]),
      entry("2026-10-25", [line("venmo", -50)]), // a refund line
      entry("2026-11-02", [line("venmo", 999)]),
    ],
  };
  const october = answerQuestion(Q("income", { period: P("month", { month: 10 }), paymentMethod: "venmo" }), data);
  assert.equal(october.text, "You made $470 through Venmo in October.");
  assert.equal(october.link.href, "/app/profitloss?type=month&key=2026-10");
  const cashTips = answerQuestion(Q("tips", { period: P("month", { month: 10 }), paymentMethod: "cash" }), data);
  assert.equal(cashTips.text, "$15 in tips in cash in October.");
  const zelle = answerQuestion(Q("income", { period: P("month", { month: 10 }), paymentMethod: "zelle" }), data);
  assert.equal(zelle.text, "Nothing came in through Zelle in October.");
  assert.equal(
    answerQuestion(Q("expenses", { paymentMethod: "venmo" }), data).text,
    "I can only split income and tips by how you were paid."
  );
  assert.match(answerQuestion(Q("income", { paymentMethod: "venmo" }), { ...data, workspaceType: "w2" }).text, /W-2 entries/);
});

test("Show me lights up where each answer came from", () => {
  // A whole month: its statement, one spot.
  const october = answerQuestion(Q("income", { period: P("last_month") }), DATA).link;
  assert.equal(october.href, "/app/profitloss?type=month&key=2026-10");
  assert.equal(october.focus.spot, "income");
  assert.equal(october.focus.banner, "Income last month (October) · $860");
  assert.deepEqual(october.focus.lines, []);
  // Part of a month: only the lines inside it, their rows opened.
  const week = answerQuestion(Q("income", { period: P("this_week") }), DATA).link;
  assert.equal(week.focus.spot, null);
  assert.deepEqual(week.focus.lines, ["2026-11-16-150", "2026-11-17-120", "2026-11-17-30", "2026-11-17-20"]);
  assert.deepEqual(week.focus.open, ["income-services", "income-tips", "income-refunds"]);
  assert.equal(week.focus.note, null);
  // A week that starts in the month before says so.
  const early = answerQuestion(Q("income", { period: P("day", { date: "2026-11-02" }) }), { ...DATA, today: "2026-11-04" }).link;
  assert.equal(early.focus.note, null);
  const spanning = answerQuestion(Q("tips", { period: P("this_week") }), { ...DATA, today: "2026-11-01" }).link; // a Sunday: Oct 26 – Nov 1
  assert.equal(spanning.href, "/app/profitloss?type=month&key=2026-11");
  assert.match(spanning.focus.note, /Some of this is in October/);
  // Tips, a spending category (spelled as the statement spells it), total spending, profit.
  assert.equal(answerQuestion(Q("tips", { period: P("last_month") }), DATA).link.focus.spot, "income-tips");
  assert.equal(answerQuestion(Q("expenses", { period: P("last_month"), category: "supplies" }), DATA).link.focus.spot, "expense-Supplies");
  assert.equal(answerQuestion(Q("expenses", { period: P("last_month") }), DATA).link.focus.spot, "expenses-total");
  assert.equal(answerQuestion(Q("profit", { period: P("last_month") }), DATA).link.focus.spot, "net");
  const weekSpend = answerQuestion(Q("expenses", { period: P("this_week"), category: "Supplies" }), DATA).link.focus;
  assert.deepEqual([weekSpend.lines, weekSpend.open], [["2026-11-16-25.5"], ["expense-Supplies"]]);
  // Invoices and appointments.
  assert.deepEqual(answerQuestion(Q("owed"), DATA).link.focus.lines, ["i2", "i1"]);
  const tomorrow = answerQuestion(Q("appointments", { period: P("day", { date: "2026-11-19" }) }), DATA).link;
  assert.deepEqual([tomorrow.href, tomorrow.focus.lines], ["/app/booking?date=2026-11-19", ["a2", "a1"]]);
  assert.equal(answerQuestion(Q("owed"), { ...DATA, invoices: [] }).link.focus, undefined);
  // W-2: Earnings, nothing to light.
  assert.equal(answerQuestion(Q("income"), { ...DATA, workspaceType: "w2" }).link.focus, undefined);
});

test("Show me for one payment method lights only those lines", () => {
  const line = (paymentMethod, services, tips = 0) => ({ paymentMethod, services, tips });
  const data = {
    ...DATA,
    entries: [
      { id: "e1", date: "2026-10-03", workspace: "independent", independent: { incomeBreakdowns: [line("venmo", 200, 20), line("cash", 100, 15)] } },
      { id: "e2", date: "2026-10-20", workspace: "independent", independent: { incomeBreakdowns: [line("venmo", 300)] } },
    ],
  };
  const venmo = answerQuestion(Q("income", { period: P("month", { month: 10 }), paymentMethod: "venmo" }), data).link.focus;
  assert.equal(venmo.banner, "Venmo in October · $520");
  assert.deepEqual(venmo.lines, ["e1-0-services", "e1-0-tips", "e2-0-services"]);
  assert.deepEqual(venmo.open.sort(), ["income-services", "income-tips"]);
  const cashTips = answerQuestion(Q("tips", { period: P("month", { month: 10 }), paymentMethod: "cash" }), data).link.focus;
  assert.deepEqual([cashTips.banner, cashTips.lines], ["Cash tips in October · $15", ["e1-1-tips"]]);
});

test("a filter it can't split by says so instead of a bigger number", () => {
  const reply = answerQuestion(Q("income", { period: P("last_month"), unsupported: "PayPal" }), DATA);
  assert.equal(reply.text, "I can't narrow that down to \u201cPayPal\u201d yet.");
  assert.equal(reply.speak, "I can't narrow that down to PayPal yet.");
});

test("money, P&L links, log targets, request schema", () => {
  assert.equal(money(1840), "$1,840");
  assert.equal(money(91.2), "$91.20");
  assert.equal(money(-12.5), "-$12.50");
  assert.equal(plHref(resolvePeriod(P("last_year"), TODAY)), "/app/profitloss?type=year&key=2025");
  assert.equal(logTargetAllowed("invoice", "w2"), false);
  assert.equal(logTargetAllowed("entry", "w2"), true);
  assert.ok(VoiceAskRequestSchema.safeParse({ kind: "ask", transcript: "who owes me", today: TODAY, workspaceType: "independent" }).success);
});

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
