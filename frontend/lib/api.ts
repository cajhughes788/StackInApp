// frontend/lib/api.ts
// Responsibilities:
//   • Stable public API facade for the frontend app
//   • Re-exports core transport/utilities
//   • Re-exports domain-specific backend request functions
//
// Internal implementation now lives in:
//   • core/endpoints.ts
//   • core/errors.ts
//   • core/client.ts
//   • core/offlineReplay.ts
//   • domain API files under /lib/api/
//
export { API_ENDPOINTS } from "@/lib/api/core/endpoints";
export { ApiError, shouldQueueOfflineMutation } from "@/lib/api/core/errors";
export { apiFetch, clearApiCaches } from "@/lib/api/core/client";
export { replayPending } from "@/lib/api/core/offlineReplay";
export { getAppBootstrap } from "@/lib/api/bootstrapApi";
export { getSettings, patchSettings } from "@/lib/api/settingsApi";
export { type CanonicalEntryResponse, postEntry, editEntry, getEntries, getEntriesForPeriod, deleteEntry, } from "@/lib/api/entriesApi";
export { postExpense, editExpense, deleteExpenseAPI, getExpensesForPeriod, } from "@/lib/api/expensesApi";
export { createImportBatch, getImportBatches, getImportItems, updateImportItem, } from "@/lib/api/importsApi";
export { getTaxProfile, saveTaxProfile } from "@/lib/api/taxProfileApi";
export { getPayStubs, generatePayStub, generateCurrentPayStub } from "@/lib/api/payStubsApi";
export { getProfitLossStatements, generateProfitLossStatement, } from "@/lib/api/profitLossApi";
export { createWorkspaceAPI, deleteWorkspaceAPI } from "@/lib/api/workspaceApi";
