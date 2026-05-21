const { auth, db } = require("../backend/functions/lib/backend/functions/src/admin.js");
const { generatePayStub } = require("../backend/functions/lib/backend/functions/src/services/payStubsService.js");
const { getCurrentPayPeriodAt } = require("../backend/functions/lib/shared/payPeriods.js");

async function main() {
  const [, , emailArg, workspaceNameArg] = process.argv;
  const email = (emailArg || "").trim();
  const workspaceName = (workspaceNameArg || "").trim();

  if (!email || !workspaceName) {
    throw new Error(
      "Usage: node scripts/generate-current-paycheck.cjs <user-email> <workspace-name>"
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
  if (workspaceIds.length === 0) {
    throw new Error(`No workspaces found for ${email}.`);
  }

  const workspaceSnaps = await Promise.all(
    workspaceIds.map((workspaceId) => db.doc(`workspaces/${workspaceId}`).get())
  );

  const matchingWorkspace = workspaceSnaps
    .filter((snap) => snap.exists)
    .map((snap) => ({ id: snap.id, ...snap.data() }))
    .find((workspace) =>
      String(workspace.name || "").trim().toLowerCase() === workspaceName.toLowerCase()
    );

  if (!matchingWorkspace) {
    throw new Error(
      `Could not find workspace named "${workspaceName}" for ${email}.`
    );
  }

  const settingsSnap = await db
    .doc(`workspaces/${matchingWorkspace.id}/settings/current`)
    .get();

  if (!settingsSnap.exists) {
    throw new Error(
      `Workspace "${matchingWorkspace.name}" does not have a settings/current document.`
    );
  }

  const settings = settingsSnap.data();
  const currentPeriod = getCurrentPayPeriodAt(settings);

  const result = await generatePayStub(matchingWorkspace.id, uid, {
    start: currentPeriod.start,
    end: currentPeriod.end,
    periodId: currentPeriod.periodId,
    force: true,
  });

  const payStubSnap = await db
    .doc(`workspaces/${matchingWorkspace.id}/payStubs/${currentPeriod.periodId}`)
    .get();

  const payStub = payStubSnap.exists ? payStubSnap.data() : null;

  console.log(
    JSON.stringify(
      {
        ok: true,
        email,
        uid,
        workspace: {
          id: matchingWorkspace.id,
          name: matchingWorkspace.name,
          type: matchingWorkspace.type,
        },
        period: currentPeriod,
        generation: result,
        payStubSummary: payStub
          ? {
              periodStart: payStub.periodStart,
              periodEnd: payStub.periodEnd,
              grossIncome: payStub.grossIncome,
              netIncome: payStub.netIncome,
              totalUnreported: payStub.totalUnreported,
              breakdown: payStub.breakdown || null,
              entryCount: Array.isArray(payStub.entries) ? payStub.entries.length : 0,
            }
          : null,
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
