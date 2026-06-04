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
  analyzeReceipt,
  createCheckoutSession,
  getSubscription,
  getAppBootstrap,
  submitSupportReport,
  requestAccountDeletion,
  cancelAccountDeletionRequest,
} from "./api"

export { generatePayStubsDaily } from "./scheduled/generatePayStubsDaily"
export { generateProfitLossStatementsMonthly } from "./scheduled/generateProfitLossStatementsMonthly"
export { deleteScheduledAccounts } from "./scheduled/deleteScheduledAccounts"
export { cleanupOrphanReceiptAssets } from "./scheduled/cleanupOrphanReceiptAssets"
export { notifySupportReportCreated } from "./triggers/notifySupportReportCreated"
