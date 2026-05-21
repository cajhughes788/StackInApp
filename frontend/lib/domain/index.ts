// /lib/domain/index.ts

"use client"

import * as domainSettings from "@/lib/storage/domainSettings"
import * as domainEntries from "@/lib/storage/domainEntries"
import * as domainExpenses from "@/lib/storage/domainExpenses"
import * as taxProfileCache from "@/lib/storage/taxProfileCache"
import * as payStubsCache from "@/lib/storage/payStubsCache"
import * as profitLossCache from "@/lib/storage/profitLossCache"
import * as offlineQueue from "@/lib/storage/offlineQueue"
import * as receiptAssetsCache from "@/lib/storage/receiptAssetsCache"
import * as receiptDraftsCache from "@/lib/storage/receiptDraftsCache"
import { listKeysRaw, removeRaw } from "@/lib/storage/base"
import { debugError, debugLog } from "@/lib/debugLoop"

// Clear ALL entries from ALL periods
async function clearAllEntries() {
  const scopedKeys = await domainEntries.listCachedEntriesKeys()
  for (const scopedKey of scopedKeys) {
    await domainEntries.clearEntries(scopedKey)
  }
}

// PUBLIC — clear all user-specific cached data
export async function clearAllLocalDomainData() {
  const keysBeforeClear = await listKeysRaw()
  debugLog("domain-cache", "clear_all_local_domain_data_start", {
    keyCount: keysBeforeClear.length,
    sampleKeys: keysBeforeClear.slice(0, 20),
  })

  await Promise.all([
    domainSettings.invalidateSettings(),
    domainExpenses.clearAll(),
    taxProfileCache.clearTaxProfileCache(),
    payStubsCache.clearPayStubsCache(),
    profitLossCache.clearProfitLossCache(),
    receiptDraftsCache.clearReceiptDraftsCache(),
    receiptAssetsCache.clearReceiptMediaCache(),
    offlineQueue.clearQueue(),
    clearAllEntries(),
  ])

  const remainingKeys = await listKeysRaw()
  debugLog("domain-cache", "clear_all_local_domain_data_pre_remove_raw", {
    remainingKeyCount: remainingKeys.length,
    remainingKeys: remainingKeys.slice(0, 50),
  })
  await Promise.all(remainingKeys.map((key) => removeRaw(key)))
  const keysAfterRawRemoval = await listKeysRaw()

  debugLog("domain-cache", "clear_all_local_domain_data_complete", {
    removedKeyCount: keysBeforeClear.length,
    remainingKeyCount: remainingKeys.length,
    remainingKeys: remainingKeys.slice(0, 20),
    finalKeyCount: keysAfterRawRemoval.length,
    finalKeys: keysAfterRawRemoval.slice(0, 20),
  })
}

async function clearWorkspaceEntries(workspaceId: string) {
  const scopedKeys = await domainEntries.listCachedEntriesKeys()
  const workspacePrefix = `${workspaceId}::`
  const matchingKeys = scopedKeys.filter((scopedKey) =>
    scopedKey.startsWith(workspacePrefix)
  )

  await Promise.all(
    matchingKeys.map((scopedKey) => domainEntries.clearEntries(scopedKey))
  )
}

export async function clearWorkspaceLocalDomainData(
  workspaceId: string
) {
  debugLog("workspace-delete", "local_domain_clear_start", {
    workspaceId,
  })

  const steps: Array<{
    name: string
    run: () => Promise<void>
  }> = [
    {
      name: "settings",
      run: () => domainSettings.invalidateSettings(workspaceId),
    },
    {
      name: "expenses",
      run: () => domainExpenses.clearWorkspace(workspaceId),
    },
    {
      name: "tax_profile",
      run: () => taxProfileCache.clearTaxProfileCache(workspaceId),
    },
    {
      name: "pay_stubs",
      run: () => payStubsCache.clearPayStubsCache(workspaceId),
    },
    {
      name: "profit_loss",
      run: () => profitLossCache.clearProfitLossCache(workspaceId),
    },
    {
      name: "receipt_drafts",
      run: () => receiptDraftsCache.clearReceiptDraftsCache(workspaceId),
    },
    {
      name: "receipt_media",
      run: () => receiptAssetsCache.clearReceiptMediaCache(workspaceId),
    },
    {
      name: "offline_queue",
      run: () => offlineQueue.clearWorkspaceQueue(workspaceId),
    },
    {
      name: "entries",
      run: () => clearWorkspaceEntries(workspaceId),
    },
  ]

  for (const step of steps) {
    debugLog("workspace-delete", "local_domain_clear_step_start", {
      workspaceId,
      step: step.name,
    })
    try {
      await step.run()
      debugLog("workspace-delete", "local_domain_clear_step_complete", {
        workspaceId,
        step: step.name,
      })
    } catch (error) {
      debugError("workspace-delete", "local_domain_clear_step_failed", {
        workspaceId,
        step: step.name,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      })
      throw error
    }
  }

  debugLog("workspace-delete", "local_domain_clear_complete", {
    workspaceId,
  })
}
