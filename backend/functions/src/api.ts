// /functions/src/api.ts
// Unified API entrypoint using modular Firebase v2 functions
// compatible with new handler/function split and withCorsAuth middleware

import type { Request, Response } from "express"
import { onRequest } from "firebase-functions/v2/https"
import { withCorsAuth } from "./middleware/withCorsAuth"

// ---------------------------------------------------------------------------
// 🔹 Route Handlers — Plain handler imports
// ---------------------------------------------------------------------------

import { signupHandler } from "./routes/signup"
import { createEntryHandler } from "./routes/createEntry"
import { createWorkspaceHandler } from "./routes/createWorkspace"
import { getEntriesHandler } from "./routes/getEntries"
import { editEntryHandler } from "./routes/editEntry"
import { deleteEntryHandler } from "./routes/deleteEntry"
import { generatePayStubHandler } from "./routes/generatePayStub"
import { generateCurrentPayStubHandler } from "./routes/generateCurrentPayStub"
import { getPayStubsHandler } from "./routes/getPayStubs"
import { getProfitLossStatementsHandler } from "./routes/getProfitLossStatements"
import { generateProfitLossStatementHandler } from "./routes/generateProfitLossStatement"
import { getSettingsHandler } from "./routes/getSettings"
import { saveSettingsHandler } from "./routes/saveSettings"
import { getTaxProfileHandler } from "./routes/getTaxProfile"
import { saveTaxProfileHandler } from "./routes/saveTaxProfile"
import { deleteUserDataHandler } from "./routes/deleteUserData"
import { createExpenseHandler } from "./routes/createExpense"
import { editExpenseHandler } from "./routes/editExpense"
import { deleteExpenseHandler } from "./routes/deleteExpense"
import { getExpensesHandler } from "./routes/getExpenses"
import { createImportBatchHandler } from "./routes/createImportBatch"
import { getImportBatchesHandler } from "./routes/getImportBatches"
import { getImportItemsHandler } from "./routes/getImportItems"
import { updateImportItemHandler } from "./routes/updateImportItem"
import { createReceiptAssetHandler } from "./routes/createReceiptAsset"
import { updateReceiptAssetHandler } from "./routes/updateReceiptAsset"
import { getReceiptAssetHandler } from "./routes/getReceiptAsset"
import { analyzeReceiptHandler } from "./routes/analyzeReceipt"
import { finalizeReceiptAnalysisHandler } from "./routes/finalizeReceiptAnalysis"
import { getReceiptAnalysisHandler } from "./routes/getReceiptAnalysis"
import { createReceiptDraftHandler } from "./routes/createReceiptDraft"
import { getReceiptDraftsHandler } from "./routes/getReceiptDrafts"
import { updateReceiptDraftHandler } from "./routes/updateReceiptDraft"
import {
  AWS_TEXTRACT_ACCESS_KEY_ID,
  AWS_TEXTRACT_REGION,
  AWS_TEXTRACT_SECRET_ACCESS_KEY,
} from "./services/textractService"
import {
  createCheckoutSessionHandler,
  STRIPE_SECRET_KEY as CHECKOUT_STRIPE_SECRET_KEY,
} from "./routes/createCheckoutSession"
import {
  stripeWebhookHandler,
  STRIPE_SECRET_KEY as WEBHOOK_STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
} from "./routes/stripeWebhook"
import { getSubscriptionHandler } from "./routes/getSubscription"
import { getAppBootstrapHandler } from "./routes/getAppBootstrap"
import { submitSupportReportHandler } from "./routes/submitSupportReport"
import {
  requestAccountDeletionHandler,
  STRIPE_SECRET_KEY as REQUEST_DELETION_STRIPE_SECRET_KEY,
} from "./routes/requestAccountDeletion"
import {
  cancelAccountDeletionRequestHandler,
  STRIPE_SECRET_KEY as CANCEL_DELETION_STRIPE_SECRET_KEY,
} from "./routes/cancelAccountDeletionRequest"
import { updateWorkspaceHandler } from "./routes/updateWorkspace"
import { deleteWorkspaceHandler } from "./routes/deleteWorkspace"

// ---------------------------------------------------------------------------
// 🔸 Public Routes (no auth required)
// ---------------------------------------------------------------------------

export const signup = withCorsAuth(async (req: Request, res: Response) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" })
    return
  }
  await signupHandler(req, res)
}, false)

export const stripeWebhook = onRequest(
  {
    secrets: [WEBHOOK_STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
  },
  async (req, res) => {
    await stripeWebhookHandler(req as any, res as any)
  }
)

// ---------------------------------------------------------------------------
// 🔸 Protected Routes (auth required)
// ---------------------------------------------------------------------------

// Entries
export const createEntry   = withCorsAuth(createEntryHandler)
export const createWorkspace  = withCorsAuth(createWorkspaceHandler)
export const updateWorkspace  = withCorsAuth(updateWorkspaceHandler)
export const deleteWorkspace  = withCorsAuth(deleteWorkspaceHandler)
export const editEntry     = withCorsAuth(editEntryHandler)
export const deleteEntry   = withCorsAuth(deleteEntryHandler)
export const getEntries    = withCorsAuth(getEntriesHandler)

//Expenses
export const createExpense = withCorsAuth(createExpenseHandler)
export const editExpense   = withCorsAuth(editExpenseHandler)
export const deleteExpense = withCorsAuth(deleteExpenseHandler)
export const getExpenses   = withCorsAuth(getExpensesHandler)
export const createImportBatch = withCorsAuth(createImportBatchHandler)
export const getImportBatches = withCorsAuth(getImportBatchesHandler)
export const getImportItems = withCorsAuth(getImportItemsHandler)
export const updateImportItem = withCorsAuth(updateImportItemHandler)
export const createReceiptAsset = withCorsAuth(createReceiptAssetHandler)
export const updateReceiptAsset = withCorsAuth(updateReceiptAssetHandler)
export const getReceiptAsset = withCorsAuth(getReceiptAssetHandler)
export const createReceiptDraft = withCorsAuth(createReceiptDraftHandler)
export const getReceiptDrafts = withCorsAuth(getReceiptDraftsHandler)
export const updateReceiptDraft = withCorsAuth(updateReceiptDraftHandler)
export const analyzeReceipt = withCorsAuth(analyzeReceiptHandler, true, {
  secrets: [
    AWS_TEXTRACT_ACCESS_KEY_ID,
    AWS_TEXTRACT_SECRET_ACCESS_KEY,
    AWS_TEXTRACT_REGION,
  ],
})
export const finalizeReceiptAnalysis = withCorsAuth(finalizeReceiptAnalysisHandler)
export const getReceiptAnalysis = withCorsAuth(getReceiptAnalysisHandler)
export const createCheckoutSession = withCorsAuth(
  createCheckoutSessionHandler,
  true,
  {
    secrets: [CHECKOUT_STRIPE_SECRET_KEY],
  }
)
export const getSubscription = withCorsAuth(getSubscriptionHandler)
export const getAppBootstrap = withCorsAuth(getAppBootstrapHandler)
export const submitSupportReport = withCorsAuth(submitSupportReportHandler)
export const requestAccountDeletion = withCorsAuth(
  requestAccountDeletionHandler,
  true,
  {
    secrets: [REQUEST_DELETION_STRIPE_SECRET_KEY],
  }
)
export const cancelAccountDeletionRequest = withCorsAuth(
  cancelAccountDeletionRequestHandler,
  true,
  {
    secrets: [CANCEL_DELETION_STRIPE_SECRET_KEY],
  }
)
// Pay Stubs
export const getPayStubs   = withCorsAuth(getPayStubsHandler)
export const generatePayStub = withCorsAuth(generatePayStubHandler)
export const generateCurrentPayStub = withCorsAuth(generateCurrentPayStubHandler)
export const getProfitLossStatements = withCorsAuth(getProfitLossStatementsHandler)
export const generateProfitLossStatement = withCorsAuth(generateProfitLossStatementHandler)

// Settings
export const getSettings   = withCorsAuth(getSettingsHandler)
export const saveSettings  = withCorsAuth(saveSettingsHandler)

// Tax Profile
export const getTaxProfile = withCorsAuth(getTaxProfileHandler)
export const saveTaxProfile = withCorsAuth(saveTaxProfileHandler)
export const deleteUserData = withCorsAuth(deleteUserDataHandler)
