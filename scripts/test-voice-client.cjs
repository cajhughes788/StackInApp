require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

// Voice client: how a reply fills the Add client form or a client note
// (frontend/lib/voiceClientFill.ts), and the server.s phone tidying.
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
  planClientFill, findExistingClient, clientsWithFirstName, appendNote, datedNote, detailsForExisting, voiceClientCurrentFor,
} = require("../frontend/lib/voiceClientFill.ts");
const { VoiceClientResultSchema, VoiceClientRequestSchema, tidyPhone } = require("../shared/voiceClient.ts");

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
const CLIENTS = [saved("Jenna Morales", { phone: "(509) 555-0142", notes: "Prefers Tuesdays." }), saved("Jenna Smith"), saved("Bright Smiles Dental", { aliases: ["bright smiles"] })];
const reply = (fields) => VoiceClientResultSchema.parse({ isClient: true, name: null, phone: null, email: null, address: null, notes: null, ...fields });

console.log("add client");

test("an exact name or alias is an existing client; a shared first name is only a heads-up", () => {
  assert.equal(findExistingClient("jenna  morales", CLIENTS).id, "c_Jenna Morales");
  assert.equal(findExistingClient("Bright Smiles", CLIENTS).id, "c_Bright Smiles Dental");
  assert.equal(findExistingClient("Jenna", CLIENTS), null);
  assert.deepEqual(clientsWithFirstName("Jenna Lopez", CLIENTS), ["Jenna Morales", "Jenna Smith"]);
  assert.deepEqual(clientsWithFirstName("Jenna Morales", CLIENTS), ["Jenna Smith"]);
});

test("a new client fills the form; an unclear email and other names get notes", () => {
  const plan = planClientFill(reply({ name: "Priya Patel", phone: "(208) 555-0199", emailUnclear: true, others: ["Mia Lopez"] }), { savedClients: CLIENTS, fixing: false, formName: "" });
  assert.equal(plan.name, "Priya Patel");
  assert.equal(plan.existing, null);
  assert.match(plan.skipped[0], /email clearly/);
  assert.match(plan.skipped[1], /add Mia Lopez next/);
});

test("a fix without a name checks the name already on the form", () => {
  const plan = planClientFill(reply({ email: "j@x.com" }), { savedClients: CLIENTS, fixing: true, formName: "Jenna Morales" });
  assert.equal(plan.existing.id, "c_Jenna Morales");
});

console.log("existing client details");

test("only blanks are filled; a different phone is a conflict; notes add on", () => {
  const update = detailsForExisting(CLIENTS[0], { phone: "509-555-0199", email: "jenna@gmail.com", address: null, notes: "Allergic to ammonia." });
  assert.deepEqual(update.patch, { email: "jenna@gmail.com", notes: "Prefers Tuesdays.\nAllergic to ammonia." });
  assert.deepEqual(update.conflicts, [{ label: "Phone", theirs: "(509) 555-0142", said: "509-555-0199" }]);
});

test("the same phone written differently isn't a conflict", () => {
  const update = detailsForExisting(CLIENTS[0], { phone: "1 509 555 0142", email: null, address: null, notes: null });
  assert.deepEqual(update, { patch: {}, conflicts: [] });
});

console.log("notes");

test("notes add on a new line; dated notes", () => {
  assert.equal(appendNote("", "Hi"), "Hi");
  assert.equal(appendNote("Line one.\n", " Line two. "), "Line one.\nLine two.");
  assert.equal(datedNote("2026-11-16", " Wants it lighter. "), "Nov 16: Wants it lighter.");
});

test("voiceClientCurrentFor", () => {
  assert.deepEqual(voiceClientCurrentFor({ name: " Jenna ", phone: "", email: "j@x.com", address: "", notes: "" }), {
    name: "Jenna", phone: null, email: "j@x.com", address: null, notes: null,
  });
});

test("phones: US numbers tidied, others as said, too short dropped", () => {
  assert.equal(tidyPhone("509 555 0142"), "(509) 555-0142");
  assert.equal(tidyPhone("1-509-555-0142"), "(509) 555-0142");
  assert.equal(tidyPhone("5550142"), "555-0142");
  assert.equal(tidyPhone("+44 20 7946 0958"), "+44 20 7946 0958");
  assert.equal(tidyPhone("555"), null);
  assert.equal(tidyPhone(null), null);
});

test("request schema", () => {
  assert.ok(VoiceClientRequestSchema.safeParse({ kind: "client", mode: "add", transcript: "new client Jenna" }).success);
  assert.ok(VoiceClientRequestSchema.safeParse({ kind: "client", mode: "note", transcript: "lighter next time" }).success);
  assert.ok(!VoiceClientRequestSchema.safeParse({ kind: "client", mode: "edit", transcript: "x" }).success);
});

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
