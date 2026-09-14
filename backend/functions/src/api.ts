/**
 * Unified API entry point — Firebase Functions v2.
 *
 * ARCHITECTURE NOTE — dynamic handler imports
 * -------------------------------------------
 * Every handler is loaded via a dynamic import() inside its request wrapper,
 * NOT at the top of this file.  This is the critical pattern that keeps cold
 * starts fast.
 *
 * When any function cold-starts, Firebase evaluates this module.  With static
 * top-level imports, that evaluation used to load Stripe, SendGrid, AWS crypto,
 * and all 43 route trees — adding 4–8 s to every cold start regardless of
 * which function was invoked.
 *
 * With dynamic imports, module evaluation only touches:
 *   • withCorsAuth  (cors + firebase-admin/auth — unavoidable for auth)
 *   • secrets.ts    (defineSecret descriptors only — zero heavy deps)
 *   • onRequest     (firebase-functions/v2/https — small)
 *
 * The actual route module (and its heavy transitive deps like Stripe) is loaded
 * the first time a real request arrives at that specific function.  Node caches
 * it after that, so only the very first request per instance pays the ~100 ms
 * dynamic-import cost.  Every cold start is now ~1–2 s instead of 4–8 s.
 *
 * Rules for adding new routes:
 *   1. Add secrets to src/secrets.ts, not to the route file's exports.
 *   2. Use the dynamic-import pattern below — never add a top-level import.
 *   3. If the route needs secrets at runtime, pass them in the options object.
 */

import { onRequest } from "firebase-functions/v2/https"
import { withCorsAuth } from "./middleware/withCorsAuth"
import * as SECRETS from "./secrets"

// Referenced by deleteUserData below (account deletion revokes any linked
// Plaid items) as well as the Plaid routes further down this file.
const PLAID_SECRETS = [SECRETS.PLAID_CLIENT_ID, SECRETS.PLAID_SECRET, SECRETS.PLAID_ENV, SECRETS.PLAID_TOKEN_ENCRYPTION_KEY]

// ---------------------------------------------------------------------------
// Public routes (no auth)
// ---------------------------------------------------------------------------

export const signup = withCorsAuth(
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method not allowed" })
      return
    }
    const { signupHandler } = await import("./routes/signup.js")
    await signupHandler(req, res)
  },
  false
)

export const stripeWebhook = onRequest(
  { secrets: [SECRETS.STRIPE_SECRET_KEY, SECRETS.STRIPE_WEBHOOK_SECRET] },
  async (req, res) => {
    const { stripeWebhookHandler } = await import("./routes/stripeWebhook.js")
    await stripeWebhookHandler(req as any, res as any)
  }
)

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export const createWorkspace = withCorsAuth(async (req, res) => {
  const { createWorkspaceHandler } = await import("./routes/createWorkspace.js")
  await createWorkspaceHandler(req, res)
})

export const updateWorkspace = withCorsAuth(async (req, res) => {
  const { updateWorkspaceHandler } = await import("./routes/updateWorkspace.js")
  await updateWorkspaceHandler(req, res)
})

export const deleteWorkspace = withCorsAuth(async (req, res) => {
  const { deleteWorkspaceHandler } = await import("./routes/deleteWorkspace.js")
  await deleteWorkspaceHandler(req, res)
})

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export const createEntry = withCorsAuth(async (req, res) => {
  const { createEntryHandler } = await import("./routes/createEntry.js")
  await createEntryHandler(req, res)
})

export const editEntry = withCorsAuth(async (req, res) => {
  const { editEntryHandler } = await import("./routes/editEntry.js")
  await editEntryHandler(req, res)
})

export const deleteEntry = withCorsAuth(async (req, res) => {
  const { deleteEntryHandler } = await import("./routes/deleteEntry.js")
  await deleteEntryHandler(req, res)
})

export const getEntries = withCorsAuth(async (req, res) => {
  const { getEntriesHandler } = await import("./routes/getEntries.js")
  await getEntriesHandler(req, res)
})

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const createExpense = withCorsAuth(async (req, res) => {
  const { createExpenseHandler } = await import("./routes/createExpense.js")
  await createExpenseHandler(req, res)
})

export const editExpense = withCorsAuth(async (req, res) => {
  const { editExpenseHandler } = await import("./routes/editExpense.js")
  await editExpenseHandler(req, res)
})

export const deleteExpense = withCorsAuth(async (req, res) => {
  const { deleteExpenseHandler } = await import("./routes/deleteExpense.js")
  await deleteExpenseHandler(req, res)
})

export const getExpenses = withCorsAuth(async (req, res) => {
  const { getExpensesHandler } = await import("./routes/getExpenses.js")
  await getExpensesHandler(req, res)
})

// ---------------------------------------------------------------------------
// Recurring Rules
// ---------------------------------------------------------------------------

export const createRecurringRule = withCorsAuth(async (req, res) => {
  const { createRecurringRuleHandler } = await import("./routes/createRecurringRule.js")
  await createRecurringRuleHandler(req, res)
})

export const editRecurringRule = withCorsAuth(async (req, res) => {
  const { editRecurringRuleHandler } = await import("./routes/editRecurringRule.js")
  await editRecurringRuleHandler(req, res)
})

export const deleteRecurringRule = withCorsAuth(async (req, res) => {
  const { deleteRecurringRuleHandler } = await import("./routes/deleteRecurringRule.js")
  await deleteRecurringRuleHandler(req, res)
})

export const getRecurringRules = withCorsAuth(async (req, res) => {
  const { getRecurringRulesHandler } = await import("./routes/getRecurringRules.js")
  await getRecurringRulesHandler(req, res)
})

// ---------------------------------------------------------------------------
// Import batches
// ---------------------------------------------------------------------------

export const createImportBatch = withCorsAuth(async (req, res) => {
  const { createImportBatchHandler } = await import("./routes/createImportBatch.js")
  await createImportBatchHandler(req, res)
})

export const getImportBatches = withCorsAuth(async (req, res) => {
  const { getImportBatchesHandler } = await import("./routes/getImportBatches.js")
  await getImportBatchesHandler(req, res)
})

export const getImportItems = withCorsAuth(async (req, res) => {
  const { getImportItemsHandler } = await import("./routes/getImportItems.js")
  await getImportItemsHandler(req, res)
})

export const updateImportItem = withCorsAuth(async (req, res) => {
  const { updateImportItemHandler } = await import("./routes/updateImportItem.js")
  await updateImportItemHandler(req, res)
})

// ---------------------------------------------------------------------------
// Receipt assets
// ---------------------------------------------------------------------------

export const createReceiptAsset = withCorsAuth(async (req, res) => {
  const { createReceiptAssetHandler } = await import("./routes/createReceiptAsset.js")
  await createReceiptAssetHandler(req, res)
})


export const getReceiptAsset = withCorsAuth(async (req, res) => {
  const { getReceiptAssetHandler } = await import("./routes/getReceiptAsset.js")
  await getReceiptAssetHandler(req, res)
})

export const deleteReceiptAsset = withCorsAuth(async (req, res) => {
  const { deleteReceiptAssetHandler } = await import("./routes/deleteReceiptAsset.js")
  await deleteReceiptAssetHandler(req, res)
})

export const updateReceiptAssetUploadStatus = withCorsAuth(async (req, res) => {
  const { updateReceiptAssetUploadStatusHandler } = await import("./routes/updateReceiptAssetUploadStatus.js")
  await updateReceiptAssetUploadStatusHandler(req, res)
})

// ---------------------------------------------------------------------------
// Receipt analysis
// The client sends the compressed image (~4.5 MB) as base64 in the request
// body so the backend receives bytes directly and passes them straight to
// Textract without a GCS round-trip.
// timeoutSeconds: 60 gives the full 30 s client timeout plus 30 s of headroom
// for slow uploads or Textract variance before the function is force-killed.
// ---------------------------------------------------------------------------

export const analyzeReceipt = withCorsAuth(
  async (req, res) => {
    const { analyzeReceiptHandler } = await import("./routes/analyzeReceipt.js")
    await analyzeReceiptHandler(req, res)
  },
  true,
  {
    timeoutSeconds: 60,
    secrets: [
      SECRETS.AWS_TEXTRACT_ACCESS_KEY_ID,
      SECRETS.AWS_TEXTRACT_SECRET_ACCESS_KEY,
      SECRETS.AWS_TEXTRACT_REGION,
    ],
  }
)


// ---------------------------------------------------------------------------
// Receipt drafts
// ---------------------------------------------------------------------------

export const createReceiptDraft = withCorsAuth(async (req, res) => {
  const { createReceiptDraftHandler } = await import("./routes/createReceiptDraft.js")
  await createReceiptDraftHandler(req, res)
})

export const getReceiptDrafts = withCorsAuth(async (req, res) => {
  const { getReceiptDraftsHandler } = await import("./routes/getReceiptDrafts.js")
  await getReceiptDraftsHandler(req, res)
})

export const updateReceiptDraft = withCorsAuth(async (req, res) => {
  const { updateReceiptDraftHandler } = await import("./routes/updateReceiptDraft.js")
  await updateReceiptDraftHandler(req, res)
})

export const commitReceiptDraft = withCorsAuth(async (req, res) => {
  const { commitReceiptDraftHandler } = await import("./routes/commitReceiptDraft.js")
  await commitReceiptDraftHandler(req, res)
})

// ---------------------------------------------------------------------------
// Expense duplicate detection
// ---------------------------------------------------------------------------

export const checkDuplicateExpense = withCorsAuth(async (req, res) => {
  const { checkDuplicateExpenseHandler } = await import("./routes/checkDuplicateExpense.js")
  await checkDuplicateExpenseHandler(req, res)
})

// ---------------------------------------------------------------------------
// Payments (Stripe)
// ---------------------------------------------------------------------------

export const createCheckoutSession = withCorsAuth(
  async (req, res) => {
    const { createCheckoutSessionHandler } = await import("./routes/createCheckoutSession.js")
    await createCheckoutSessionHandler(req, res)
  },
  true,
  { secrets: [SECRETS.STRIPE_SECRET_KEY] }
)

export const getSubscription = withCorsAuth(async (req, res) => {
  const { getSubscriptionHandler } = await import("./routes/getSubscription.js")
  await getSubscriptionHandler(req, res)
})

export const requestAccountDeletion = withCorsAuth(
  async (req, res) => {
    const { requestAccountDeletionHandler } = await import("./routes/requestAccountDeletion.js")
    await requestAccountDeletionHandler(req, res)
  },
  true,
  { secrets: [SECRETS.STRIPE_SECRET_KEY] }
)

export const cancelAccountDeletionRequest = withCorsAuth(
  async (req, res) => {
    const { cancelAccountDeletionRequestHandler } = await import(
      "./routes/cancelAccountDeletionRequest.js"
    )
    await cancelAccountDeletionRequestHandler(req, res)
  },
  true,
  { secrets: [SECRETS.STRIPE_SECRET_KEY] }
)

// ---------------------------------------------------------------------------
// Pay stubs
// ---------------------------------------------------------------------------

export const getPayStubs = withCorsAuth(async (req, res) => {
  const { getPayStubsHandler } = await import("./routes/getPayStubs.js")
  await getPayStubsHandler(req, res)
})

export const generatePayStub = withCorsAuth(async (req, res) => {
  const { generatePayStubHandler } = await import("./routes/generatePayStub.js")
  await generatePayStubHandler(req, res)
})

export const generateCurrentPayStub = withCorsAuth(async (req, res) => {
  const { generateCurrentPayStubHandler } = await import("./routes/generateCurrentPayStub.js")
  await generateCurrentPayStubHandler(req, res)
})

// ---------------------------------------------------------------------------
// Profit & loss
// ---------------------------------------------------------------------------

export const getProfitLossStatements = withCorsAuth(async (req, res) => {
  const { getProfitLossStatementsHandler } = await import("./routes/getProfitLossStatements.js")
  await getProfitLossStatementsHandler(req, res)
})

export const generateProfitLossStatement = withCorsAuth(async (req, res) => {
  const { generateProfitLossStatementHandler } = await import(
    "./routes/generateProfitLossStatement.js"
  )
  await generateProfitLossStatementHandler(req, res)
})

// ---------------------------------------------------------------------------
// Settings & tax profile
// ---------------------------------------------------------------------------

export const getSettings = withCorsAuth(async (req, res) => {
  const { getSettingsHandler } = await import("./routes/getSettings.js")
  await getSettingsHandler(req, res)
})

export const saveSettings = withCorsAuth(async (req, res) => {
  const { saveSettingsHandler } = await import("./routes/saveSettings.js")
  await saveSettingsHandler(req, res)
})

export const getTaxProfile = withCorsAuth(async (req, res) => {
  const { getTaxProfileHandler } = await import("./routes/getTaxProfile.js")
  await getTaxProfileHandler(req, res)
})

export const saveTaxProfile = withCorsAuth(async (req, res) => {
  const { saveTaxProfileHandler } = await import("./routes/saveTaxProfile.js")
  await saveTaxProfileHandler(req, res)
})

// ---------------------------------------------------------------------------
// Account & bootstrap
// ---------------------------------------------------------------------------

export const deleteUserData = withCorsAuth(
  async (req, res) => {
    const { deleteUserDataHandler } = await import("./routes/deleteUserData.js")
    await deleteUserDataHandler(req, res)
  },
  true,
  { secrets: PLAID_SECRETS }
)

export const getAppBootstrap = withCorsAuth(async (req, res) => {
  const { getAppBootstrapHandler } = await import("./routes/getAppBootstrap.js")
  await getAppBootstrapHandler(req, res)
})

export const submitSupportReport = withCorsAuth(async (req, res) => {
  const { submitSupportReportHandler } = await import("./routes/submitSupportReport.js")
  await submitSupportReportHandler(req, res)
})

// ---------------------------------------------------------------------------
// Plaid bank integration
// ---------------------------------------------------------------------------

export const createPlaidLinkToken = withCorsAuth(
  async (req, res) => {
    const { createPlaidLinkTokenHandler } = await import("./routes/createPlaidLinkToken.js")
    await createPlaidLinkTokenHandler(req, res)
  },
  true,
  { secrets: PLAID_SECRETS }
)

export const createPlaidUpdateLinkToken = withCorsAuth(
  async (req, res) => {
    const { createPlaidUpdateLinkTokenHandler } = await import("./routes/createPlaidUpdateLinkToken.js")
    await createPlaidUpdateLinkTokenHandler(req, res)
  },
  true,
  { secrets: PLAID_SECRETS }
)

export const exchangePlaidPublicToken = withCorsAuth(
  async (req, res) => {
    const { exchangePlaidPublicTokenHandler } = await import("./routes/exchangePlaidPublicToken.js")
    await exchangePlaidPublicTokenHandler(req, res)
  },
  true,
  { secrets: PLAID_SECRETS }
)

export const unlinkPlaidItem = withCorsAuth(
  async (req, res) => {
    const { unlinkPlaidItemHandler } = await import("./routes/unlinkPlaidItem.js")
    await unlinkPlaidItemHandler(req, res)
  },
  true,
  { secrets: PLAID_SECRETS }
)

export const getPlaidItems = withCorsAuth(async (req, res) => {
  const { getPlaidItemsHandler } = await import("./routes/getPlaidItems.js")
  await getPlaidItemsHandler(req, res)
})

// Bulk historical backfill (see plaidService.importPlaidHistory) — not the
// same thing as a "sync now speeds up live detection" button. A multi-month
// pull can span several Plaid /transactions/sync pages, so this gets a
// longer timeout than the withCorsAuth default.
export const importPlaidHistory = withCorsAuth(
  async (req, res) => {
    const { importPlaidHistoryHandler } = await import("./routes/importPlaidHistory.js")
    await importPlaidHistoryHandler(req, res)
  },
  true,
  { secrets: PLAID_SECRETS, timeoutSeconds: 300 }
)

export const getPlaidPendingTransactions = withCorsAuth(async (req, res) => {
  const { getPlaidPendingTransactionsHandler } = await import("./routes/getPlaidPendingTransactions.js")
  await getPlaidPendingTransactionsHandler(req, res)
})

export const confirmPlaidPendingTransaction = withCorsAuth(async (req, res) => {
  const { confirmPlaidPendingTransactionHandler } = await import("./routes/confirmPlaidPendingTransaction.js")
  await confirmPlaidPendingTransactionHandler(req, res)
})

export const updatePlaidAccountDefault = withCorsAuth(async (req, res) => {
  const { updatePlaidAccountDefaultHandler } = await import("./routes/updatePlaidAccountDefault.js")
  await updatePlaidAccountDefaultHandler(req, res)
})

export const linkPlaidMerchantToRecurringRule = withCorsAuth(async (req, res) => {
  const { linkPlaidMerchantToRecurringRuleHandler } = await import("./routes/linkPlaidMerchantToRecurringRule.js")
  await linkPlaidMerchantToRecurringRuleHandler(req, res)
})

export const getPlaidMerchantMemory = withCorsAuth(async (req, res) => {
  const { getPlaidMerchantMemoryHandler } = await import("./routes/getPlaidMerchantMemory.js")
  await getPlaidMerchantMemoryHandler(req, res)
})

export const updatePlaidMerchantMemory = withCorsAuth(async (req, res) => {
  const { updatePlaidMerchantMemoryHandler } = await import("./routes/updatePlaidMerchantMemory.js")
  await updatePlaidMerchantMemoryHandler(req, res)
})

export const resetPlaidMerchantMemory = withCorsAuth(async (req, res) => {
  const { resetPlaidMerchantMemoryHandler } = await import("./routes/resetPlaidMerchantMemory.js")
  await resetPlaidMerchantMemoryHandler(req, res)
})

// Bare onRequest like stripeWebhook — Plaid's signature verification needs
// the raw request body, which withCorsAuth's express.json() parsing would
// otherwise consume before the handler sees it.
export const plaidWebhook = onRequest(
  { secrets: PLAID_SECRETS },
  async (req, res) => {
    const { plaidWebhookHandler } = await import("./routes/plaidWebhook.js")
    await plaidWebhookHandler(req as any, res as any)
  }
)

// ---------------------------------------------------------------------------
// Devices (push notifications)
// ---------------------------------------------------------------------------

export const registerDeviceToken = withCorsAuth(async (req, res) => {
  const { registerDeviceTokenHandler } = await import("./routes/registerDeviceToken.js")
  await registerDeviceTokenHandler(req, res)
})
