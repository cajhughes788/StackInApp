// Scores clients by voice (Add client, its "Fix by voice", and Say a note)
// against real-style sentences (scripts/voice-client-cases.json), using the
// exact parser the server runs (backend/functions/src/services/voiceClientService.ts).
// It calls Claude, so it needs a key and costs a few cents a run. Not part of `npm test`.
//
//   ANTHROPIC_API_KEY=... node scripts/eval-voice-client.cjs --thinking=off

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
const { parseVoiceClientWith } = require("../backend/functions/src/services/voiceClientService.ts");
const sheet = require("./voice-client-cases.json");

const thinkingArg = process.argv.find((arg) => arg.startsWith("--thinking="));
const thinking = thinkingArg ? thinkingArg.split("=")[1] : "adaptive";
const CONCURRENCY = 4;

const lower = (value) => (typeof value === "string" ? value.trim().toLowerCase() : value);
const digits = (value) => (typeof value === "string" ? value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") : value);
const allIn = (text, words) => !!text && words.every((word) => text.toLowerCase().includes(word.toLowerCase()));

function compare(expect, got) {
  const problems = [];
  const wantClient = expect.isClient ?? true;
  if (!(Array.isArray(wantClient) ? wantClient : [wantClient]).includes(got.isClient)) problems.push(`isClient ${got.isClient}, wanted ${wantClient}`);
  if (expect.nameOk || wantClient === false) return problems;
  for (const key of ["name", "email"]) {
    const want = expect[key] ?? null;
    if (!(Array.isArray(want) ? want.map(lower) : [lower(want)]).includes(lower(got[key]))) {
      problems.push(`${key} ${JSON.stringify(got[key])}, wanted ${JSON.stringify(want)}`);
    }
  }
  if (digits(got.phone ?? null) !== digits(expect.phone ?? null)) problems.push(`phone ${JSON.stringify(got.phone)}, wanted ${JSON.stringify(expect.phone ?? null)}`);
  if (got.emailUnclear !== (expect.emailUnclear ?? false)) problems.push(`emailUnclear ${got.emailUnclear}, wanted ${expect.emailUnclear ?? false}`);
  for (const [key, words] of [["address", expect.addressHas], ["notes", expect.notesHas]]) {
    if (words) {
      if (!allIn(got[key], words)) problems.push(`${key} ${JSON.stringify(got[key])}, wanted ${JSON.stringify(words)} in it`);
    } else if (got[key] !== null) {
      problems.push(`${key} ${JSON.stringify(got[key])}, wanted null`);
    }
  }
  const wantRemove = [...(expect.remove ?? [])].sort().join(",");
  if ([...got.remove].sort().join(",") !== wantRemove) problems.push(`remove ${JSON.stringify(got.remove)}, wanted [${wantRemove}]`);
  const wantOthers = expect.others ?? [[]];
  const gotOthers = got.others.map(lower).sort().join(",");
  if (!wantOthers.some((option) => option.map(lower).sort().join(",") === gotOthers)) problems.push(`others ${JSON.stringify(got.others)}, wanted ${JSON.stringify(wantOthers)}`);
  return problems;
}

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 30_000 });
  const queue = sheet.cases.map((testCase, index) => ({ ...testCase, index }));
  const results = [];
  const worker = async () => {
    for (let testCase = queue.shift(); testCase; testCase = queue.shift()) {
      const request = { kind: "client", mode: testCase.mode, transcript: testCase.say, ...(testCase.current ? { current: testCase.current } : {}), ...(testCase.asking ? { asking: testCase.asking } : {}) };
      const started = Date.now();
      try {
        const got = await parseVoiceClientWith(client, request, thinking);
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
    console.log(`MISS  [${testCase.mode}${testCase.current ? ", fix" : ""}] "${testCase.say}"`);
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
