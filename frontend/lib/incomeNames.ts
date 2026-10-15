import type { SettingsType } from "@shared/schemas/settings"
import { useSettingsStore } from "@/lib/stores/useSettingsStore"
import * as settingsService from "@/lib/domain/settingsService"

// One shared list of "other income" names — who paid you or which platform
// (DoorDash, Acme Corp, Cash App). Stored as the workspace's
// customIncomeFields, so the entry form's Other income section, the bank
// deposit review's "Who paid you?" and Settings all draw from the same list.
// Keeping one spelling per payer is what makes per-payer totals line up with
// the 1099s they send.

export function getSavedIncomeNames(settings: SettingsType | null | undefined): string[] {
  return (settings?.independent?.customIncomeFields ?? [])
    .map((field) => field.label.trim())
    .filter((label) => label.length > 0)
}

// Trims and collapses spaces, and reuses an existing name's spelling when the
// typed one only differs by case ("doordash" → "DoorDash").
export function canonicalIncomeName(label: string, savedNames: string[]): string {
  const cleaned = label.trim().replace(/\s+/g, " ")
  const match = savedNames.find((name) => name.toLowerCase() === cleaned.toLowerCase())
  return match ?? cleaned
}

// Adds any names not already on the list. Best-effort and optimistic, like
// expense-category-picker's custom categories: a failed save only means the
// name isn't suggested next time — the income itself is already recorded.
export async function saveNewIncomeNames(workspaceId: string, labels: string[]): Promise<void> {
  const { byWorkspaceId, setSettings } = useSettingsStore.getState()
  const settings = byWorkspaceId[workspaceId]?.data ?? null
  if (!settings) return
  const saved = getSavedIncomeNames(settings)
  const additions: string[] = []
  for (const label of labels) {
    const name = canonicalIncomeName(label, [...saved, ...additions])
    if (name && ![...saved, ...additions].some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      additions.push(name)
    }
  }
  if (additions.length === 0) return

  const nextFields = [
    ...(settings.independent?.customIncomeFields ?? []),
    ...additions.map((label) => ({ label })),
  ]
  setSettings(
    workspaceId,
    { ...settings, independent: { ...(settings.independent ?? {}), customIncomeFields: nextFields } },
    { source: "optimistic", localUpdatedAt: Date.now() }
  )
  try {
    const result = await settingsService.save(workspaceId, { independent: { customIncomeFields: nextFields } })
    if (result.source === "backend" && result.data) {
      setSettings(workspaceId, result.data, {
        source: "backend",
        remoteMeta: result.remoteMeta,
        lastSuccessfulSyncAt: result.lastSuccessfulSyncAt,
        localUpdatedAt: result.localUpdatedAt,
      })
    }
  } catch {
    // Non-fatal — see above.
  }
}
