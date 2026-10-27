require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" },
});

const assert = require("node:assert/strict");
const {
  clientKey,
  buildClientKeyIndex,
  entryClientPayments,
  summarizeClientPayments,
  buildClientRows,
} = require("../shared/clients.ts");
const { invoiceKeptAmount, invoiceKeptIn } = require("../shared/invoiceMoney.ts");
const { ClientSchema } = require("../shared/schemas/client.ts");
const { InvoiceSchema } = require("../shared/schemas/invoice.ts");
const { EntrySchema } = require("../shared/schemas/entry.ts");

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

function client(id, name, extra = {}) {
  return ClientSchema.parse({
    id, workspaceId: "ws", name, nameKey: clientKey(name),
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...extra,
  });
}

function entry(id, date, extra = {}) {
  return {
    id, date, workspace: "independent",
    independent: { incomeBreakdowns: [{ paymentMethod: "venmo", services: 50, tips: 10 }], customIncome: [] },
    ...extra,
  };
}

function invoice(id, clientName, extra = {}) {
  return {
    id, workspaceId: "ws", number: id, clientName, clientId: null, status: "paid",
    lines: [], total: 100, issueDate: "2026-03-01", dueDate: "2026-03-15",
    payments: [{ id: "p1", amount: 100, tipAmount: 0, receivedOn: "2026-03-10" }],
    refunds: [], dispute: null, deposit: null, pendingPayment: null,
    ...extra,
  };
}

const jane = client("c1", "Jane Doe", { aliases: ["janie d"] });
const bob = client("c2", "Bob Ray");
const index = buildClientKeyIndex([jane, bob]);

console.log("matching payments");

test("a Venmo payer name counts the whole entry, any capitalisation", () => {
  const out = entryClientPayments(entry("e1", "2026-05-01", { payerName: "  JANE   doe " }), index);
  assert.deepEqual(out.map((o) => [o.clientId, o.payment.amount]), [["c1", 60]]);
});

test("aliases match too", () => {
  const out = entryClientPayments(entry("e1", "2026-05-01", { payerName: "Janie D" }), index);
  assert.equal(out[0].clientId, "c1");
});

test("custom income lines match one by one", () => {
  const e = entry("e2", "2026-05-02", {
    independent: {
      incomeBreakdowns: [{ paymentMethod: "other", services: 70, other: 30 }],
      customIncome: [{ label: "Bob Ray", amount: 30 }, { label: "Someone Else", amount: 40 }],
    },
  });
  const out = entryClientPayments(e, index);
  assert.deepEqual(out.map((o) => [o.clientId, o.payment.amount]), [["c2", 30]]);
});

test("entries booked from an invoice payment are never counted again", () => {
  const e = entry("e3", "2026-05-03", {
    clientMutationId: "invoice_inv1_pay1",
    independent: { incomeBreakdowns: [{ paymentMethod: "other", other: 100 }], customIncome: [{ label: "Jane Doe", amount: 100 }] },
  });
  assert.deepEqual(entryClientPayments(e, index), []);
});

test("a refund of an invoice is skipped; a refund to a named client subtracts", () => {
  const invoiceRefund = entry("r1", "2026-06-01", {
    kind: "refund",
    refund: { invoiceId: "inv1", clientName: "Jane Doe" },
    independent: { incomeBreakdowns: [{ paymentMethod: "venmo", services: -20 }] },
  });
  assert.deepEqual(entryClientPayments(invoiceRefund, index), []);
  const plainRefund = { ...invoiceRefund, id: "r2", refund: { invoiceId: null, clientName: "Jane Doe" } };
  assert.deepEqual(entryClientPayments(plainRefund, index).map((o) => o.payment.amount), [-20]);
});

test("W-2 entries and unknown names don't count", () => {
  assert.deepEqual(entryClientPayments(entry("e4", "2026-05-01", { workspace: "w2", payerName: "Jane Doe" }), index), []);
  assert.deepEqual(entryClientPayments(entry("e5", "2026-05-01", { payerName: "Stranger" }), index), []);
});

test("summary: totals, this year, visits exclude refunds, newest first", () => {
  const { summaries, payments } = summarizeClientPayments(
    [jane, bob],
    [
      entry("a", "2025-12-30", { payerName: "Jane Doe" }),
      entry("b", "2026-02-01", { payerName: "Jane Doe" }),
      entry("c", "2026-03-01", {
        kind: "refund",
        refund: { invoiceId: null, clientName: "Jane Doe" },
        independent: { incomeBreakdowns: [{ paymentMethod: "venmo", services: -10 }] },
      }),
    ],
    "2026"
  );
  assert.deepEqual(summaries.c1, { total: 110, thisYear: 50, count: 2, lastDate: "2026-03-01" });
  assert.deepEqual(payments.c1.map((p) => p.entryId), ["c", "b", "a"]);
  assert.equal(summaries.c2, undefined);
});

test("entries keep payerName", () => {
  const parsed = EntrySchema.parse({
    workspace: "independent", date: "2026-05-01", payerName: "Jane Doe",
    independent: { hours: 0, incomeBreakdowns: [], unreportedCash: 0, unreportedCashTips: 0, customIncome: [] },
  });
  assert.equal(parsed.payerName, "Jane Doe");
});

console.log("invoice money");

test("kept this year counts payments, refunds and disputes by date", () => {
  const inv = invoice("i1", "Jane Doe", {
    payments: [
      { id: "p1", amount: 100, tipAmount: 15, receivedOn: "2025-12-20" },
      { id: "p2", amount: 50, tipAmount: 0, receivedOn: "2026-01-05" },
    ],
    refunds: [{ id: "r", amount: 20, date: "2026-02-01", paymentId: "p1" }],
    dispute: { status: "lost", amount: 50, fundsWithdrawn: true, paymentId: "p2" },
  });
  assert.equal(invoiceKeptAmount(inv), 95);
  assert.equal(invoiceKeptIn(inv, "2026"), -20);
  assert.equal(invoiceKeptIn(inv, "2025"), 115);
});

console.log("client rows");

test("invoices group by clientId, then name or alias, else their own row", () => {
  const rows = buildClientRows(
    [jane, bob],
    { c1: { total: 340, thisYear: 340, count: 1, lastDate: "2026-05-01" } },
    [
      invoice("1", "Totally Different", { clientId: "c1" }),
      invoice("2", "janie  d"),
      invoice("3", "New Person"),
    ],
    "2026-10-26"
  );
  const janeRow = rows.find((r) => r.key === "c1");
  assert.equal(janeRow.invoices.length, 2);
  assert.equal(janeRow.invoiceEarned, 200);
  assert.equal(janeRow.otherPayments, 340);
  assert.equal(janeRow.lifetime, 540);
  assert.equal(janeRow.thisYear, 540);
  assert.equal(janeRow.isRepeat, true);
  const loose = rows.find((r) => r.key === "name:new person");
  assert.equal(loose.client, null);
  assert.equal(loose.name, "New Person");
  assert.ok(rows.find((r) => r.key === "c2"), "a client with no invoices still shows");
  assert.deepEqual(rows.map((r) => r.name), ["Bob Ray", "Jane Doe", "New Person"]);
});

test("repeat badge: 2+ paid invoices or visits", () => {
  const rows = buildClientRows([bob], { c2: { total: 30, thisYear: 30, count: 1, lastDate: null } }, [invoice("1", "Bob Ray")], "2026-10-26");
  assert.equal(rows[0].isRepeat, true);
  const single = buildClientRows([bob], {}, [invoice("1", "Bob Ray")], "2026-10-26");
  assert.equal(single[0].isRepeat, false);
});

test("open and overdue come from sent invoices", () => {
  const rows = buildClientRows([bob], {}, [
    invoice("1", "Bob Ray", { status: "sent", payments: [], total: 80, dueDate: "2026-10-01", lines: [{ amount: 80 }] }),
  ], "2026-10-26");
  assert.equal(rows[0].open, 80);
  assert.equal(rows[0].overdue, 80);
});

test("archived clients are hidden unless asked for", () => {
  const gone = client("c3", "Old Client", { archived: true });
  assert.equal(buildClientRows([gone], {}, [], "2026-10-26").length, 0);
  assert.equal(buildClientRows([gone], {}, [], "2026-10-26", { includeArchived: true }).length, 1);
});

if (failures > 0) {
  console.error(`\n${failures} failing`);
  process.exit(1);
}
console.log("\nall passed");
