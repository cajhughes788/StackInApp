import { db } from "../admin"
import { ExpenseSchema } from "@shared/schemas/expense"
import { ReceiptDraftSchema } from "@shared/schemas/receiptDraft"
import { ReceiptAssetSchema } from "@shared/schemas/receiptAsset"
import { ProfitLossStatementSchema } from "@shared/schemas/profitLoss"

export type IntegrityIssueKind =
  | "orphan_asset"          // asset with no draft and no expense
  | "orphan_draft"          // draft pending > 7 days with no expense
  | "ghost_commit"          // committed draft with no linked expense
  | "broken_expense_link"   // expense.receiptAssetId points to missing asset
  | "stale_pl_statement"    // profitLoss statement with stale: true
  | "duplicate_asset_link"  // multiple expenses share the same receiptAssetId

export type IntegrityIssue = {
  kind: IntegrityIssueKind
  severity: "critical" | "high" | "medium" | "low"
  entityId: string
  entityType: "asset" | "draft" | "expense" | "profitLoss"
  detail: string
}

export type IntegrityReport = {
  workspaceId: string
  generatedAt: string
  issues: IntegrityIssue[]
  summary: Record<IntegrityIssueKind, number>
}

export async function auditWorkspaceIntegrity(
  workspaceId: string
): Promise<IntegrityReport> {
  const issues: IntegrityIssue[] = []

  const [assetsSnap, draftsSnap, expensesSnap, plSnap] = await Promise.all([
    db.collection(`workspaces/${workspaceId}/receiptAssets`).get(),
    db.collection(`workspaces/${workspaceId}/receiptDrafts`).get(),
    db.collection(`workspaces/${workspaceId}/expenses`).get(),
    db.collection(`workspaces/${workspaceId}/profitLossStatements`).get(),
  ])

  const assetIds = new Set(assetsSnap.docs.map((d) => d.id))

  const draftsByAssetId = new Map<string, string[]>()
  for (const doc of draftsSnap.docs) {
    const data = doc.data()
    const assetId = typeof data.receiptAssetId === "string" ? data.receiptAssetId : null
    if (assetId) {
      const existing = draftsByAssetId.get(assetId) ?? []
      existing.push(doc.id)
      draftsByAssetId.set(assetId, existing)
    }
  }

  const expensesByAssetId = new Map<string, string[]>()
  for (const doc of expensesSnap.docs) {
    const data = doc.data()
    const assetId = typeof data.receiptAssetId === "string" ? data.receiptAssetId : null
    if (assetId) {
      const existing = expensesByAssetId.get(assetId) ?? []
      existing.push(doc.id)
      expensesByAssetId.set(assetId, existing)
    }
  }

  const expenseIds = new Set(expensesSnap.docs.map((d) => d.id))

  // 1. Orphan assets: no linked draft and no linked expense
  for (const assetDoc of assetsSnap.docs) {
    const assetId = assetDoc.id
    const hasDraft = (draftsByAssetId.get(assetId)?.length ?? 0) > 0
    const hasExpense = (expensesByAssetId.get(assetId)?.length ?? 0) > 0
    if (!hasDraft && !hasExpense) {
      issues.push({
        kind: "orphan_asset",
        severity: "low",
        entityId: assetId,
        entityType: "asset",
        detail: "Receipt asset has no linked draft or expense",
      })
    }
  }

  // 2. Duplicate asset links: multiple expenses share one receipt asset
  for (const [assetId, expenseIdList] of expensesByAssetId.entries()) {
    if (expenseIdList.length > 1) {
      issues.push({
        kind: "duplicate_asset_link",
        severity: "critical",
        entityId: assetId,
        entityType: "asset",
        detail: `Receipt asset linked to ${expenseIdList.length} expenses: ${expenseIdList.join(", ")}`,
      })
    }
  }

  // 3. Orphan/stuck drafts and ghost commits
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  for (const draftDoc of draftsSnap.docs) {
    const draft = ReceiptDraftSchema.safeParse({ id: draftDoc.id, ...draftDoc.data() })
    if (!draft.success) continue

    if (draft.data.status === "committed" && !draft.data.committedExpenseId) {
      issues.push({
        kind: "ghost_commit",
        severity: "high",
        entityId: draftDoc.id,
        entityType: "draft",
        detail: "Draft is committed but has no committedExpenseId — atomic commit may have partially failed",
      })
    }

    if (
      (draft.data.status === "draft" || draft.data.status === "ready_to_review") &&
      draft.data.createdAt < sevenDaysAgo
    ) {
      issues.push({
        kind: "orphan_draft",
        severity: "medium",
        entityId: draftDoc.id,
        entityType: "draft",
        detail: `Draft has been pending since ${draft.data.createdAt} with no committed expense`,
      })
    }
  }

  // 4. Expenses with broken receipt asset links
  for (const expenseDoc of expensesSnap.docs) {
    const data = expenseDoc.data()
    const assetId = typeof data.receiptAssetId === "string" ? data.receiptAssetId : null
    if (assetId && !assetIds.has(assetId)) {
      issues.push({
        kind: "broken_expense_link",
        severity: "medium",
        entityId: expenseDoc.id,
        entityType: "expense",
        detail: `Expense references receiptAssetId "${assetId}" which does not exist`,
      })
    }
  }

  // 5. Stale P&L statements
  for (const plDoc of plSnap.docs) {
    const data = plDoc.data()
    if (data?.meta?.stale === true) {
      issues.push({
        kind: "stale_pl_statement",
        severity: "high",
        entityId: plDoc.id,
        entityType: "profitLoss",
        detail: `P&L statement for period ${data?.periodKey ?? plDoc.id} is marked stale`,
      })
    }
  }

  const summary = issues.reduce((acc, issue) => {
    acc[issue.kind] = (acc[issue.kind] ?? 0) + 1
    return acc
  }, {} as Record<IntegrityIssueKind, number>)

  return {
    workspaceId,
    generatedAt: new Date().toISOString(),
    issues,
    summary,
  }
}
