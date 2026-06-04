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
  createEmptySettingsSyncSnapshot,
  getSettingsConflictDetails,
  getSettingsSyncStatusCopy,
  getSettingsSyncStatusMessage,
  mergeSettings,
  mergeSettingsPatch,
  normalizeSettingsPatch,
  parseSettingsSyncSnapshot,
  resolveSettingsNavigationGuardMode,
  shouldBlockSettingsUnload,
} = require("../frontend/lib/domain/settingsSync.ts")

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
  assert.equal(
    resolveSettingsNavigationGuardMode({
      isInitialSetup: true,
      hasPendingDraft: false,
      syncState: "synced",
    }),
    "block"
  )

  assert.equal(
    resolveSettingsNavigationGuardMode({
      isInitialSetup: false,
      hasPendingDraft: true,
      syncState: "synced",
    }),
    "background"
  )

  assert.equal(
    resolveSettingsNavigationGuardMode({
      isInitialSetup: false,
      hasPendingDraft: false,
      syncState: "retrying",
    }),
    "background"
  )

  assert.equal(
    resolveSettingsNavigationGuardMode({
      isInitialSetup: false,
      hasPendingDraft: false,
      syncState: "failed",
    }),
    "none"
  )
}

function testWindowUnloadBlocking() {
  assert.equal(
    shouldBlockSettingsUnload({
      isInitialSetup: false,
      hasPendingDraft: true,
      isSaving: false,
    }),
    false
  )

  assert.equal(
    shouldBlockSettingsUnload({
      isInitialSetup: false,
      hasPendingDraft: false,
      isSaving: true,
    }),
    false
  )

  assert.equal(
    shouldBlockSettingsUnload({
      isInitialSetup: true,
      hasPendingDraft: true,
      isSaving: false,
    }),
    true
  )

  assert.equal(
    shouldBlockSettingsUnload({
      isInitialSetup: true,
      hasPendingDraft: false,
      isSaving: true,
    }),
    true
  )

  assert.equal(
    shouldBlockSettingsUnload({
      isInitialSetup: true,
      hasPendingDraft: false,
      isSaving: false,
    }),
    false
  )
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
  const base = createEmptySettingsSyncSnapshot()
  assert.deepEqual(getSettingsSyncStatusCopy(base), {
    label: "Synced",
    tone: "success",
  })

  assert.deepEqual(
    getSettingsSyncStatusCopy({
      ...base,
      hasPendingDraft: true,
    }),
    {
      label: "Saving…",
      tone: "saving",
    }
  )

  assert.deepEqual(
    getSettingsSyncStatusCopy({
      ...base,
      state: "offline_pending",
    }),
    {
      label: "Offline",
      tone: "neutral",
    }
  )

  assert.equal(
    getSettingsSyncStatusMessage({
      ...base,
      hasPendingDraft: true,
    }),
    "Your latest settings changes are syncing now."
  )
}

function testSnapshotConflictDetailsParsing() {
  const parsed = parseSettingsSyncSnapshot({
    state: "failed",
    lastSuccessfulSyncAt: null,
    lastAttemptedSyncAt: 10,
    lastQueuedAt: 9,
    retryCount: 1,
    failureKind: "conflict",
    lastErrorMessage: "conflict",
    pendingPatch: {
      common: { timeZone: "America/Los_Angeles" },
    },
    pendingMutationId: "mutation-1",
    remoteMeta: {
      version: 8,
      updatedAt: "2026-05-29T00:00:00.000Z",
    },
    conflictDetails: {
      currentSettings: {
        common: { timeZone: "America/New_York" },
      },
      currentMeta: {
        version: 8,
        updatedAt: "2026-05-29T00:00:00.000Z",
      },
    },
  })

  assert.deepEqual(parsed?.conflictDetails, {
    currentSettings: {
      common: { timeZone: "America/New_York" },
    },
    currentMeta: {
      version: 8,
      updatedAt: "2026-05-29T00:00:00.000Z",
    },
  })
}

testPatchMerging()
testOptimisticMerge()
testNavigationModes()
testWindowUnloadBlocking()
testErrorClassification()
testStatusCopy()
testSnapshotConflictDetailsParsing()

console.log("settings sync regression checks passed")
