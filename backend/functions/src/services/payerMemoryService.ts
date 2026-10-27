import { db } from "../admin"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { NotFoundError } from "../lib/httpErrors"
import {
  PayerMemorySchema,
  type PayerMemoryMode,
  type PayerMemoryType,
} from "@shared/schemas/payerMemory"
import { applyPayerDecision, type PayerDecision } from "@shared/payerMemory"
import type { IncomeCategory } from "@shared/schemas/entry"

// Payer memory for app statement imports — see shared/schemas/payerMemory.ts
// for what it stores and shared/payerMemory.ts for the rules.

function payerMemoryCol(workspaceId: string) {
  return db.collection(`workspaces/${workspaceId}/payerMemory`)
}

function parseMemory(data: unknown): PayerMemoryType | null {
  const parsed = PayerMemorySchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

/** Memories for the given keys (no membership check — callers have done it). */
export async function readPayerMemories(
  workspaceId: string,
  payerKeys: string[]
): Promise<Map<string, PayerMemoryType>> {
  const unique = Array.from(new Set(payerKeys))
  const out = new Map<string, PayerMemoryType>()
  if (unique.length === 0) return out
  const refs = unique.map((key) => payerMemoryCol(workspaceId).doc(key))
  // getAll takes a bounded list; chunk to stay well inside limits.
  for (let i = 0; i < refs.length; i += 300) {
    const snaps = await db.getAll(...refs.slice(i, i + 300))
    for (const snap of snaps) {
      if (!snap.exists) continue
      const memory = parseMemory(snap.data())
      if (memory) out.set(snap.id, memory)
    }
  }
  return out
}

/**
 * Records one user decision about a payer (no membership check — callers
 * have done it). Returns whether to offer "Always treat X as personal?".
 */
export async function recordPayerDecision(
  decision: PayerDecision
): Promise<{ memory: PayerMemoryType; suggestAlwaysPersonal: boolean }> {
  const ref = payerMemoryCol(decision.workspaceId).doc(decision.payerKey)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const existing = snap.exists ? parseMemory(snap.data()) : null
    const result = applyPayerDecision(existing, decision)
    tx.set(ref, result.memory)
    return result
  })
}

// "People who pay you" management (the ?kind=app_payer variants of the
// merchant memory routes).
export async function listPayerMemory(workspaceId: string, uid: string): Promise<PayerMemoryType[]> {
  await assertWorkspaceMembership(workspaceId, uid)
  const snap = await payerMemoryCol(workspaceId).orderBy("updatedAt", "desc").get()
  return snap.docs
    .map((doc) => parseMemory(doc.data()))
    .filter((memory): memory is PayerMemoryType => memory !== null)
}

export async function updatePayerMemory(
  workspaceId: string,
  uid: string,
  payerKey: string,
  patch: { mode?: PayerMemoryMode; incomeCategory?: IncomeCategory | null }
): Promise<PayerMemoryType> {
  await assertWorkspaceMembership(workspaceId, uid)
  const ref = payerMemoryCol(workspaceId).doc(payerKey)
  const snap = await ref.get()
  if (!snap.exists) throw new NotFoundError("No remembered payer found for this key")
  await ref.set(
    {
      ...(patch.mode ? { mode: patch.mode } : {}),
      ...(patch.incomeCategory !== undefined ? { incomeCategory: patch.incomeCategory } : {}),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  )
  const memory = parseMemory((await ref.get()).data())
  if (!memory) throw new NotFoundError("No remembered payer found for this key")
  return memory
}

/** Forgets a payer. Items already imported keep their decisions. */
export async function resetPayerMemory(workspaceId: string, uid: string, payerKey: string): Promise<void> {
  await assertWorkspaceMembership(workspaceId, uid)
  await payerMemoryCol(workspaceId).doc(payerKey).delete()
}
