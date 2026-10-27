import type { IncomeCategory } from "./schemas/entry"
import type {
  PayerMemorySource,
  PayerMemoryType,
  PayerOutcome,
} from "./schemas/payerMemory"

/* ------------------------------------------------------------
 * PAYER MEMORY RULES (see shared/schemas/payerMemory.ts)
 * Pure so the backend and tests share one copy.
 * ------------------------------------------------------------ */

// "Always treat X as personal?" is offered after this many one-by-one
// personal decisions.
export const SUGGEST_ALWAYS_PERSONAL_AFTER = 2

export type PayerDecision = {
  workspaceId: string
  payerKey: string
  displayName: string
  source: PayerMemorySource
  outcome: PayerOutcome
  // The category the payment was saved under (business only).
  incomeCategory: IncomeCategory | null
  nowIso: string
}

/**
 * Folds one user decision into a payer's memory. A decision that
 * contradicts an "always" mode (saving an always-personal payer's payment as
 * business, or the reverse) puts the payer back to ask-every-time, so the
 * app never keeps auto-sorting against what the user just did.
 */
export function applyPayerDecision(
  existing: PayerMemoryType | null,
  decision: PayerDecision
): { memory: PayerMemoryType; suggestAlwaysPersonal: boolean } {
  const isBusiness = decision.outcome === "business"
  const businessCount = (existing?.businessCount ?? 0) + (isBusiness ? 1 : 0)
  const personalCount = (existing?.personalCount ?? 0) + (isBusiness ? 0 : 1)

  let mode = existing?.mode ?? "ask_every_time"
  if (isBusiness && mode === "always_personal") mode = "ask_every_time"
  if (!isBusiness && mode === "always_business") mode = "ask_every_time"

  const alreadySuggested = existing?.suggestedAlwaysPersonalAt != null
  const suggestAlwaysPersonal =
    !isBusiness &&
    mode === "ask_every_time" &&
    !alreadySuggested &&
    personalCount >= SUGGEST_ALWAYS_PERSONAL_AFTER

  const memory: PayerMemoryType = {
    id: decision.payerKey,
    workspaceId: decision.workspaceId,
    payerKey: decision.payerKey,
    displayName: decision.displayName,
    source: decision.source,
    lastOutcome: decision.outcome,
    incomeCategory: isBusiness
      ? decision.incomeCategory ?? existing?.incomeCategory ?? null
      : existing?.incomeCategory ?? null,
    mode,
    businessCount,
    personalCount,
    lastDecisionAt: decision.nowIso,
    suggestedAlwaysPersonalAt: suggestAlwaysPersonal
      ? decision.nowIso
      : existing?.suggestedAlwaysPersonalAt ?? null,
    createdAt: existing?.createdAt ?? decision.nowIso,
    updatedAt: decision.nowIso,
  }
  return { memory, suggestAlwaysPersonal }
}

export type PayerMemoryEffect =
  // Import it already sorted as personal (the user opted in).
  | { action: "sort_personal" }
  // Pre-fill business with the remembered category; the user still saves it.
  | { action: "prefill_business"; incomeCategory: IncomeCategory | null }
  // Only show what was chosen last time.
  | { action: "hint"; lastOutcome: PayerOutcome; incomeCategory: IncomeCategory | null }
  | { action: "none" }

export function payerMemoryEffect(memory: PayerMemoryType | null): PayerMemoryEffect {
  if (!memory) return { action: "none" }
  if (memory.mode === "always_personal") return { action: "sort_personal" }
  if (memory.mode === "always_business") {
    return { action: "prefill_business", incomeCategory: memory.incomeCategory }
  }
  return {
    action: "hint",
    lastOutcome: memory.lastOutcome,
    incomeCategory: memory.lastOutcome === "business" ? memory.incomeCategory : null,
  }
}
