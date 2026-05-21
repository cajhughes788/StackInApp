// /shared/schemas/index.ts
// ---------------------------------------------------------
// Centralized schema registry for all Track’d domains.
// Uses namespaced exports for clarity and scalability.
//
// Example usage:
// import { Settings, Entry } from "@shared/schemas"
// Settings.Schema.safeParse(...)
// Entry.Schema.parse(...)
// ---------------------------------------------------------

export * as Settings from "./settings"
export * as TaxProfile from "./taxProfile"
export * as Entry from "./entry"
export * as PayStub from "./paystub"
export * as ProfitLoss from "./profitLoss"
export * as User from "./user"
export * as Expense from "./expense"
export * as Import from "./import"
export * as ReceiptAsset from "./receiptAsset"
export * as ReceiptAnalysis from "./receiptAnalysis"
