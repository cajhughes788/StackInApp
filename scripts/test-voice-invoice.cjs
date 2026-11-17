require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

// Voice invoice: how a reply from the server fills the invoice/quote form
// (frontend/lib/voiceInvoiceFill.ts) and the reply's shape (shared/voiceInvoice.ts).
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
const { planInvoiceFill, matchSavedClients, voiceInvoiceCurrentFor, voiceInvoiceHints } = require("../frontend/lib/voiceInvoiceFill.ts");
const { VoiceInvoiceResultSchema, VoiceInvoiceRequestSchema } = require("../shared/voiceInvoice.ts");

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

const saved = (name, extra = {}) => ({ id: `c_${name}`, name, nameKey: name.toLowerCase(), aliases: [], ...extra });
const CLIENTS = [saved("Jenna Morales", { email: "jenna@x.com" }), saved("Jenna Smith"), saved("Bright Smiles Dental", { aliases: ["bright smiles"] }), saved("Marcus Lee")];

const reply = (fields) => VoiceInvoiceResultSchema.parse({
  isInvoice: true, clientName: null, clientEmail: null, clientPhone: null, lines: null,
  issueDate: null, dueDate: null, dueTerms: null, validDays: null, note: null, ...fields,
});
const ctx = (overrides = {}) => ({
  isQuote: false,
  savedClients: CLIENTS,
  issueDate: "2026-11-16",
  dueDate: "2026-12-16",
  keepDue: (issue) => `kept-${issue}`,
  fixing: false,
  ...overrides,
});

console.log("clients");

test("an exact saved name or alias is that client", () => {
  assert.equal(matchSavedClients("jenna  morales", CLIENTS)[0].id, "c_Jenna Morales");
  assert.equal(matchSavedClients("Bright Smiles", CLIENTS)[0].id, "c_Bright Smiles Dental");
});

test("a first name for one client is that client", () => {
  const plan = planInvoiceFill(reply({ clientName: "Marcus" }), ctx());
  assert.equal(plan.client.kind, "saved");
  assert.equal(plan.client.client.id, "c_Marcus Lee");
});

test("a first name for several clients asks which", () => {
  const plan = planInvoiceFill(reply({ clientName: "Jenna" }), ctx());
  assert.equal(plan.client, null);
  assert.equal(plan.questions.length, 1);
  assert.equal(plan.questions[0].prompt, "Which Jenna?");
  assert.deepEqual(plan.questions[0].options.map((c) => c.name), ["Jenna Morales", "Jenna Smith"]);
});

test("an unknown name is a new client", () => {
  const plan = planInvoiceFill(reply({ clientName: "Priya Patel" }), ctx());
  assert.deepEqual(plan.client, { kind: "new", name: "Priya Patel" });
  assert.equal(planInvoiceFill(reply({ clientName: "Jenna Moralez" }), ctx()).client.kind, "new");
});

console.log("lines");

test("lines are rounded and kept in order", () => {
  const plan = planInvoiceFill(reply({ lines: [
    { description: " Cut and color ", quantity: 1, rate: 120, category: "services" },
    { description: "Gloss", quantity: 1.257, rate: 39.999, category: "services" },
  ] }), ctx());
  assert.deepEqual(plan.lines.map((l) => [l.description, l.quantity, l.rate]), [["Cut and color", 1, 120], ["Gloss", 1.26, 40]]);
});

test("no lines said leaves lines alone; a fix may empty them", () => {
  assert.equal(planInvoiceFill(reply({ lines: [] }), ctx()).lines, null);
  assert.deepEqual(planInvoiceFill(reply({ lines: [] }), ctx({ fixing: true })).lines, []);
});

console.log("dates");

test("net 15 is worked out from the invoice date", () => {
  assert.equal(planInvoiceFill(reply({ dueTerms: "net_15" }), ctx()).dueDate, "2026-12-01");
  assert.equal(planInvoiceFill(reply({ dueTerms: "due_on_receipt" }), ctx()).dueDate, "2026-11-16");
  assert.equal(planInvoiceFill(reply({ dueTerms: "net_15", issueDate: "2026-11-20" }), ctx()).dueDate, "2026-12-05");
});

test("a quote's good-for days are worked out; terms ignored on a quote", () => {
  assert.equal(planInvoiceFill(reply({ validDays: 14 }), ctx({ isQuote: true })).dueDate, "2026-11-30");
  assert.equal(planInvoiceFill(reply({ dueTerms: "net_15" }), ctx({ isQuote: true })).dueDate, null);
});

test("a day said wins; a new date alone keeps the terms", () => {
  assert.equal(planInvoiceFill(reply({ dueDate: "2026-11-20", dueTerms: "net_30" }), ctx()).dueDate, "2026-11-20");
  assert.equal(planInvoiceFill(reply({ issueDate: "2026-11-10" }), ctx()).dueDate, "kept-2026-11-10");
});

test("a due day before the invoice date isn't used", () => {
  const plan = planInvoiceFill(reply({ dueDate: "2026-11-10" }), ctx());
  assert.equal(plan.dueDate, null);
  assert.match(plan.skipped[0], /before the invoice date/);
});

console.log("current, hints, schema");

test("voiceInvoiceCurrentFor keeps complete lines and blanks as null", () => {
  const current = voiceInvoiceCurrentFor({
    clientName: " Jenna Morales ", clientEmail: "", clientPhone: "",
    lines: [
      { description: "Cut", quantity: "1", rate: "120.00", category: "services" },
      { description: "", quantity: "1", rate: "", category: "services" },
      { description: "Hours", quantity: "", rate: "$1,250", category: "services" },
    ],
    issueDate: "2026-11-16", dueDate: "2026-12-16", note: "",
  });
  assert.equal(current.clientName, "Jenna Morales");
  assert.equal(current.clientEmail, null);
  assert.equal(current.note, null);
  assert.deepEqual(current.lines, [
    { description: "Cut", quantity: 1, rate: 120, category: "services" },
    { description: "Hours", quantity: 1, rate: 1250, category: "services" },
  ]);
});

test("hints include client names, capped at 100", () => {
  const hints = voiceInvoiceHints(Array.from({ length: 200 }, (_, i) => `Client ${i}`));
  assert.ok(hints.includes("Client 0"));
  assert.ok(hints.includes("net 15"));
  assert.ok(hints.length <= 100);
});

test("request schema: kind invoice, invoice or quote", () => {
  const base = { kind: "invoice", document: "invoice", transcript: "invoice Jenna 120", today: "2026-11-16", clients: ["Jenna Morales"] };
  assert.ok(VoiceInvoiceRequestSchema.safeParse(base).success);
  assert.ok(VoiceInvoiceRequestSchema.safeParse({ ...base, document: "quote" }).success);
  assert.ok(!VoiceInvoiceRequestSchema.safeParse({ ...base, document: "receipt" }).success);
  assert.ok(!VoiceInvoiceRequestSchema.safeParse({ ...base, kind: "expense" }).success);
});

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
