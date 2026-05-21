const { auth, db } = require("../backend/functions/lib/backend/functions/src/admin.js");

async function main() {
  const [, , emailArg, workspaceNameArg] = process.argv;
  const email = (emailArg || "").trim();
  const workspaceName = (workspaceNameArg || "").trim();

  if (!email || !workspaceName) {
    throw new Error(
      "Usage: node scripts/inspect-workspace-tax-setup.cjs <user-email> <workspace-name>"
    );
  }

  const userRecord = await auth.getUserByEmail(email);
  const uid = userRecord.uid;

  const membershipsSnap = await db
    .collection("users")
    .doc(uid)
    .collection("memberships")
    .get();

  const workspaceIds = membershipsSnap.docs.map((doc) => doc.id);
  const workspaceSnaps = await Promise.all(
    workspaceIds.map((workspaceId) => db.doc(`workspaces/${workspaceId}`).get())
  );

  const workspace = workspaceSnaps
    .filter((snap) => snap.exists)
    .map((snap) => ({ id: snap.id, ...snap.data() }))
    .find(
      (item) =>
        String(item.name || "").trim().toLowerCase() === workspaceName.toLowerCase()
    );

  if (!workspace) {
    throw new Error(`Could not find workspace named "${workspaceName}" for ${email}.`);
  }

  const [settingsSnap, taxProfileSnap, payStubsSnap] = await Promise.all([
    db.doc(`workspaces/${workspace.id}/settings/current`).get(),
    db.doc(`workspaces/${workspace.id}/taxProfile/current`).get(),
    db
      .collection(`workspaces/${workspace.id}/payStubs`)
      .orderBy("periodStart", "desc")
      .limit(5)
      .get(),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        user: {
          email,
          uid,
        },
        workspace: {
          id: workspace.id,
          name: workspace.name,
          type: workspace.type,
          status: workspace.status,
        },
        settings: settingsSnap.exists ? settingsSnap.data() : null,
        taxProfile: taxProfileSnap.exists ? taxProfileSnap.data() : null,
        recentPayStubs: payStubsSnap.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            periodStart: data.periodStart ?? null,
            periodEnd: data.periodEnd ?? null,
            grossIncome: data.grossIncome ?? null,
            netIncome: data.netIncome ?? null,
            breakdown: data.breakdown ?? null,
            totalUnreported: data.totalUnreported ?? null,
            ytdTotals: data.ytdTotals ?? null,
            sourceUpdatedThrough: data.sourceUpdatedThrough ?? null,
            entryCount: Array.isArray(data.entries) ? data.entries.length : 0,
          };
        }),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      },
      null,
      2
    )
  );
  process.exit(1);
});
