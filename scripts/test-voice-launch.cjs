require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

// Siri / Action Button launches: which mic a launch opens, taken once
// (frontend/lib/stores/useVoiceLaunchStore.ts, useVoiceHandoffStore.ts).
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

// The Capacitor plugin wrapper needs a browser; only its target check is used here.
const Module2 = require("node:module");
const realLoad = Module2._load;
Module2._load = function (request, ...rest) {
  if (request === "@capacitor/core") return { Capacitor: { isNativePlatform: () => false }, registerPlugin: () => ({}) };
  return realLoad.call(this, request, ...rest);
};

const assert = require("node:assert/strict");
const { useVoiceLaunchStore } = require("../frontend/lib/stores/useVoiceLaunchStore.ts");
const { useVoiceHandoffStore } = require("../frontend/lib/stores/useVoiceHandoffStore.ts");
const { isVoiceLaunchTarget } = require("../frontend/plugins/VoiceLaunch.ts");

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

test("a launch is taken once, only by its own mic", () => {
  useVoiceLaunchStore.getState().ask("expense");
  assert.equal(useVoiceLaunchStore.getState().take("ask"), null);
  assert.equal(useVoiceLaunchStore.getState().take("expense").target, "expense");
  assert.equal(useVoiceLaunchStore.getState().take("expense"), null);
});

test("a newer launch replaces an older one", () => {
  useVoiceLaunchStore.getState().ask("booking");
  useVoiceLaunchStore.getState().ask("ask");
  assert.equal(useVoiceLaunchStore.getState().take("booking"), null);
  assert.equal(useVoiceLaunchStore.getState().take("ask").target, "ask");
});

test("Ask 521 hand-offs go to the right form in the right workspace", () => {
  useVoiceHandoffStore.getState().send("invoice", "invoice Jenna 120", "w1");
  assert.equal(useVoiceHandoffStore.getState().take(["invoice"], "w2"), null, "another workspace");
  assert.equal(useVoiceHandoffStore.getState().take(["quote"], "w1"), null, "another form");
  assert.equal(useVoiceHandoffStore.getState().take(["invoice", "quote"], "w1").transcript, "invoice Jenna 120");
  assert.equal(useVoiceHandoffStore.getState().take(["invoice"], "w1"), null, "taken once");
});

test("only the four launch targets are accepted", () => {
  for (const target of ["ask", "entry", "expense", "booking"]) assert.ok(isVoiceLaunchTarget(target));
  for (const target of ["settings", "", null, 3]) assert.ok(!isVoiceLaunchTarget(target));
});

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
