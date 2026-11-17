// Scores voice on the invoice/quote form (including "Fix by voice"
// corrections, the cases with `current`) against real-style sentences
// (scripts/voice-invoice-cases.json), using the exact parser the server runs
// (backend/functions/src/services/voiceInvoiceService.ts). It calls Claude,
// so it needs a key and costs a few cents a run. Not part of `npm test`.
//
//   ANTHROPIC_API_KEY=... node scripts/eval-voice-invoice.cjs --thinking=off
//
// Prints each miss, the pass rate, and how long replies took.

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", esModuleInterop: true },
});

const path = require("node:path");
const Module = require("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@shared/")) {
    request = path.join(__dirname, "..", "shared", request.slice("@shared/".length));
  }
  return originalResolve.call(this, request, ...rest);
};

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY first (the same key the server uses).");
  process.exit(2);
}

const Anthropic = require("@anthropic-ai/sdk").default;
const { parseVoiceInvoiceWith } = require("../backend/functions/src/services/voiceInvoiceService.ts");
const sheet = require("./voice-invoice-cases.json");

const thinkingArg = process.argv.find((arg) => arg.startsWith("--thinking="));
const thinking = thinkingArg ? thinkingArg.split("=")[1] : "adaptive";
const CONCURRENCY = 4;

const oneOf = (allowed, value) => (Array.isArray(allowed) ? allowed.includes(value) : allowed === value);
const lower = (value) => (typeof value === "string" ? value.trim().toLowerCase() : value);
const digits = (value) => (typeof value === "string" ? value.replace(/\D/g, "") : value);

function compare(expect, got) {
  const problems = [];
  const wantInvoice = expect.isInvoice ?? true;
  if (got.isInvoice !== wantInvoice) problems.push(`isInvoice ${got.isInvoice}, wanted ${wantInvoice}`);
  if (!wantInvoice) return problems;
  for (const key of ["clientName", "clientEmail"]) {
    const want = expect[key] ?? null;
    if (!(Array.isArray(want) ? want.map(lower) : [lower(want)]).includes(lower(got[key]))) {
      problems.push(`${key} ${JSON.stringify(got[key])}, wanted ${JSON.stringify(want)}`);
    }
  }
  if (digits(got.clientPhone ?? null) !== digits(expect.clientPhone ?? null)) {
    problems.push(`clientPhone ${JSON.stringify(got.clientPhone)}, wanted ${JSON.stringify(expect.clientPhone ?? null)}`);
  }
  for (const key of ["issueDate", "dueDate", "dueTerms", "validDays"]) {
    const want = expect[key] ?? null;
    if (!oneOf(want, got[key])) problems.push(`${key} ${JSON.stringify(got[key])}, wanted ${JSON.stringify(want)}`);
  }
  if (expect.noteHas) {
    if (!got.note || !got.note.toLowerCase().includes(expect.noteHas.toLowerCase())) problems.push(`note ${JSON.stringify(got.note)}, wanted "${expect.noteHas}" in it`);
  } else if (got.note !== null) {
    problems.push(`note ${JSON.stringify(got.note)}, wanted null`);
  }
  const wantLines = expect.lines ?? null;
  if (wantLines === null) {
    if (got.lines !== null) problems.push(`lines ${JSON.stringify(got.lines)}, wanted null`);
  } else if (!got.lines || got.lines.length !== wantLines.length) {
    problems.push(`lines ${JSON.stringify(got.lines)}, wanted ${wantLines.length}`);
  } else {
    wantLines.forEach((want, i) => {
      const line = got.lines[i];
      const ok =
        Math.abs(line.quantity - want.quantity) < 0.001 &&
        Math.abs(line.rate - want.rate) < 0.001 &&
        oneOf(want.category, line.category) &&
        (!want.desc || line.description.toLowerCase().includes(want.desc.toLowerCase()));
      if (!ok) problems.push(`line ${i + 1} ${JSON.stringify(line)}, wanted ${JSON.stringify(want)}`);
    });
  }
  return problems;
}

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
  const queue = sheet.cases.map((testCase, index) => ({ ...testCase, index }));
  const results = [];

  const worker = async () => {
    for (let testCase = queue.shift(); testCase; testCase = queue.shift()) {
      const request = {
        kind: "invoice",
        document: testCase.document,
        transcript: testCase.say,
        today: sheet.today,
        clients: sheet.clients,
        ...(testCase.current ? { current: testCase.current } : {}), ...(testCase.asking ? { asking: testCase.asking } : {}),
      };
      const started = Date.now();
      try {
        const got = await parseVoiceInvoiceWith(client, request, thinking);
        results.push({ testCase, ms: Date.now() - started, problems: compare(testCase.expect, got), got });
      } catch (error) {
        results.push({ testCase, ms: Date.now() - started, problems: [`failed: ${error.message}`], got: null });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  results.sort((a, b) => a.testCase.index - b.testCase.index);

  let passed = 0;
  for (const { testCase, problems, got } of results) {
    if (problems.length === 0) {
      passed += 1;
      continue;
    }
    console.log(`MISS  [${testCase.document}${testCase.current ? ", fix" : ""}] "${testCase.say}"`);
    for (const problem of problems) console.log(`      ${problem}`);
    if (got) console.log(`      got ${JSON.stringify(got)}`);
  }

  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const pick = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
  console.log(
    `\nthinking=${thinking}: ${passed}/${results.length} passed (${Math.round((passed / results.length) * 100)}%)` +
      ` · reply time median ${pick(0.5)}ms, slowest 10% ${pick(0.9)}ms`
  );
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
