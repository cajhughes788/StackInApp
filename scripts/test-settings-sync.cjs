require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
})

const assert = require("node:assert/strict")

const { ApiError } = require("../frontend/lib/api/core/errors.ts")
const {
  classifySettingsSyncError,
  getSettingsConflictDetails,
  getSettingsSaveStatusCopy,
  mergeSettings,
  mergeSettingsPatch,
  normalizeSettingsPatch,
  resolveSettingsNavigationGuardMode,
  shouldBlockSettingsUnload,
} = require("../frontend/lib/domain/settingsSync.ts")

// Save states as useSettingsSaveStore holds them.
const IDLE = { status: "idle" }
const SAVING = { status: "saving" }
const SYNCED = { status: "synced", at: 1 }
const PENDING = { status: "pending", message: null }
const ERROR_KEPT = { status: "error", message: "x", retryable: true, preservedPatch: true }
const ERROR_LOST = { status: "error", message: "x", retryable: false, preservedPatch: false }

function testPatchMerging() {
  const merged = mergeSettingsPatch(
    {
      common: { timeZone: "America/Los_Angeles" },
      w2: { useHours: true },
    },
    {
      common: { useNotes: true },
      w2: { defaultHourlyRate: 22 },
    }
  )

  assert.deepEqual(merged, {
    common: {
      timeZone: "America/Los_Angeles",
      useNotes: true,
    },
    w2: {
      useHours: true,
      defaultHourlyRate: 22,
    },
  })

  assert.equal(normalizeSettingsPatch({ common: {}, w2: {} }), null)
}

function testOptimisticMerge() {
  const merged = mergeSettings(
    {
      common: { timeZone: "America/Los_Angeles" },
      w2: { useHours: true, defaultHourlyRate: 20 },
    },
    {
      w2: { defaultHourlyRate: 25 },
    }
  )

  assert.deepEqual(merged?.w2, {
    useHours: true,
    defaultHourlyRate: 25,
  })
}

function testNavigationModes() {
  // First-time setup always blocks leaving.
  for (const state of [IDLE, SAVING, SYNCED, PENDING, ERROR_KEPT]) {
    assert.equal(resolveSettingsNavigationGuardMode(true, state), "block")
  }
  // A save still going (or kept after an error) finishes in the background.
  assert.equal(resolveSettingsNavigationGuardMode(false, PENDING), "background")
  assert.equal(resolveSettingsNavigationGuardMode(false, SAVING), "background")
  assert.equal(resolveSettingsNavigationGuardMode(false, ERROR_KEPT), "background")
  // Nothing in flight: nothing to guard.
  assert.equal(resolveSettingsNavigationGuardMode(false, IDLE), "none")
  assert.equal(resolveSettingsNavigationGuardMode(false, SYNCED), "none")
  assert.equal(resolveSettingsNavigationGuardMode(false, ERROR_LOST), "none")
}

function testWindowUnloadBlocking() {
  // After setup, saves finish on their own — never ask "Leave site?".
  assert.equal(shouldBlockSettingsUnload({ isInitialSetup: false, saveState: SAVING, persistInFlight: true }), false)
  // During setup, only while a save is still going.
  assert.equal(shouldBlockSettingsUnload({ isInitialSetup: true, saveState: SAVING, persistInFlight: false }), true)
  assert.equal(shouldBlockSettingsUnload({ isInitialSetup: true, saveState: IDLE, persistInFlight: true }), true)
  assert.equal(shouldBlockSettingsUnload({ isInitialSetup: true, saveState: SYNCED, persistInFlight: false }), false)
  assert.equal(shouldBlockSettingsUnload({ isInitialSetup: true, saveState: PENDING, persistInFlight: false }), false)
}

function testErrorClassification() {
  assert.deepEqual(
    classifySettingsSyncError(new ApiError("offline"), false),
    {
      failureKind: "transient",
      retryable: true,
      nextState: "offline_pending",
    }
  )

  assert.deepEqual(
    classifySettingsSyncError(new ApiError("validation", { status: 400 }), true),
    {
      failureKind: "validation",
      retryable: false,
      nextState: "failed",
    }
  )

  const conflict = new ApiError("conflict", {
    status: 409,
    details: {
      currentSettings: {
        common: { timeZone: "America/New_York" },
      },
      currentMeta: {
        version: 7,
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
    },
  })

  assert.deepEqual(getSettingsConflictDetails(conflict), {
    currentSettings: {
      common: { timeZone: "America/New_York" },
    },
    currentMeta: {
      version: 7,
      updatedAt: "2026-05-28T00:00:00.000Z",
    },
  })
}

function testStatusCopy() {
  assert.deepEqual(getSettingsSaveStatusCopy(SAVING), { label: "Saving…", tone: "saving" })
  assert.deepEqual(getSettingsSaveStatusCopy(SYNCED), { label: "Saved", tone: "success" })
  assert.deepEqual(getSettingsSaveStatusCopy(PENDING), { label: "Pending Sync", tone: "neutral" })
  assert.deepEqual(getSettingsSaveStatusCopy(ERROR_KEPT), { label: "Needs Attention", tone: "error" })
  assert.deepEqual(getSettingsSaveStatusCopy(IDLE), { label: "Saved", tone: "neutral" })
}

testPatchMerging()
testOptimisticMerge()
testNavigationModes()
testWindowUnloadBlocking()
testErrorClassification()
testStatusCopy()

console.log("settings sync regression checks passed")
