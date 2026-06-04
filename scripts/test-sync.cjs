require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
  },
});

const assert = require("node:assert/strict");

const {
  beginHydrationSync,
  beginRevalidationSync,
  completeSync,
  createResourceSyncMeta,
  shouldRevalidateByTtl,
} = require("../frontend/lib/sync/resourceSync.ts");

const {
  getForegroundRefreshThresholdMs,
  shouldForceForegroundRefresh,
  shouldRefreshForForegroundReason,
} = require("../frontend/lib/sync/foregroundRefreshPolicy.ts");

function run(name, fn) {
  fn();
  process.stdout.write(`ok - ${name}\n`);
}

run("hydration without cached data enters hydrating state", () => {
  const initial = createResourceSyncMeta();
  const next = beginHydrationSync(initial, { hasRenderableData: false });

  assert.equal(next.syncState, "hydrating");
  assert.equal(next.lastSyncSource, "cache");
});

run("hydration with cached data becomes silent revalidation", () => {
  const initial = createResourceSyncMeta();
  const next = beginHydrationSync(initial, { hasRenderableData: true });

  assert.equal(next.syncState, "revalidating");
  assert.equal(next.lastSyncSource, "cache");
});

run("completed sync preserves timestamps and source", () => {
  const initial = beginRevalidationSync(createResourceSyncMeta(), {
    source: "backend",
  });
  const next = completeSync(initial, {
    source: "backend",
    lastSuccessfulSyncAt: 123,
    localUpdatedAt: 456,
  });

  assert.equal(next.syncState, "ready");
  assert.equal(next.lastSuccessfulSyncAt, 123);
  assert.equal(next.localUpdatedAt, 456);
  assert.equal(next.lastSyncSource, "backend");
});

run("ttl revalidation only triggers after threshold", () => {
  assert.equal(shouldRevalidateByTtl(1_000, 500, 1_400), false);
  assert.equal(shouldRevalidateByTtl(1_000, 500, 1_600), true);
});

run("foreground refresh policy uses reason-specific thresholds", () => {
  assert.equal(getForegroundRefreshThresholdMs("focus"), 60_000);
  assert.equal(getForegroundRefreshThresholdMs("resume"), 20_000);
  assert.equal(shouldForceForegroundRefresh("initial"), true);
  assert.equal(shouldForceForegroundRefresh("focus"), false);
});

run("foreground refresh skips fresh resources on focus and refreshes stale ones", () => {
  const now = 100_000;

  assert.equal(
    shouldRefreshForForegroundReason([now - 10_000, now - 15_000], "focus", now),
    false
  );

  assert.equal(
    shouldRefreshForForegroundReason([now - 70_000, now - 15_000], "focus", now),
    true
  );
});

process.stdout.write("sync behavior checks passed\n");
