import { setGlobalOptions } from "firebase-functions/v2"
setGlobalOptions({ region: "us-central1" })
export {
  signup,
  stripeWebhook,
  createEntry,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  editEntry,
  deleteEntry,
  getEntries,
  getSettings,
  saveSettings,
  getTaxProfile,
  saveTaxProfile,
  getPayStubs,
  generatePayStub,
  generateCurrentPayStub,
  getProfitLossStatements,
  generateProfitLossStatement,
  deleteUserData,
  createExpense,
  editExpense,
  deleteExpense,
  getExpenses,
  createRecurringRule,
  editRecurringRule,
  deleteRecurringRule,
  getRecurringRules,
  createImportBatch,
  getImportBatches,
  getImportItems,
  updateImportItem,
  createReceiptAsset,
  getReceiptAsset,
  deleteReceiptAsset,
  createReceiptDraft,
  getReceiptDrafts,
  updateReceiptDraft,
  commitReceiptDraft,
  checkDuplicateExpense,
  // analyzeReceipt, // OCR_DISABLED — Textract removed from active paths. Code preserved in api.ts for future reactivation.
  createCheckoutSession,
  getSubscription,
  getAppBootstrap,
  submitSupportReport,
  requestAccountDeletion,
  cancelAccountDeletionRequest,
} from "./api"

export { generatePayStubsDaily } from "./scheduled/generatePayStubsDaily"
export { generateRecurringTransactionsDaily } from "./scheduled/generateRecurringTransactionsDaily"
export { generateProfitLossStatementsMonthly } from "./scheduled/generateProfitLossStatementsMonthly"
export { deleteScheduledAccounts } from "./scheduled/deleteScheduledAccounts"
export { cleanupOrphanReceiptAssets } from "./scheduled/cleanupOrphanReceiptAssets"
export { notifySupportReportCreated } from "./triggers/notifySupportReportCreated"
