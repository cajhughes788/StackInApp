// Turns a voice invoice reply (shared/voiceInvoice.ts) into what the
// invoice/quote form should fill in. The spoken client is matched to a saved
// client here; when a name fits several ("Jenna"), that's a question with
// buttons instead of a guess. Due dates from terms ("net 15") and quote
// lengths ("good for 30 days") are worked out here, not by Claude.

import { clientKey } from "@shared/clients"
import { dueDateForTerms } from "@shared/invoiceDisplay"
import { addQuoteDays } from "@shared/quotes"
import type { VoiceInvoiceCurrent, VoiceInvoiceLine, VoiceInvoiceResult } from "@shared/voiceInvoice"

export type VoiceSavedClient = {
  id: string
  name: string
  nameKey: string
  aliases: string[]
  email?: string | null
  phone?: string | null
  address?: string | null
}

export type InvoiceClientPick = { kind: "saved"; client: VoiceSavedClient } | { kind: "new"; name: string }

export type InvoiceVoiceQuestion = {
  id: string
  kind: "client"
  prompt: string
  // The name as said, for the "new client" button.
  spokenName: string
  options: VoiceSavedClient[]
}

export type InvoiceFillPlan = {
  client: InvoiceClientPick | null
  clientEmail: string | null
  clientPhone: string | null
  // The whole new list of lines; null = leave the lines alone.
  lines: VoiceInvoiceLine[] | null
  issueDate: string | null
  dueDate: string | null
  note: string | null
  questions: InvoiceVoiceQuestion[]
  // Short notes for the person about what was left out and why.
  skipped: string[]
}

export type InvoiceFillContext = {
  isQuote: boolean
  savedClients: VoiceSavedClient[]
  // The form's dates now.
  issueDate: string
  dueDate: string
  // When only the date moves: the due date that keeps the chosen terms
  // (the same rule as changing the date by hand).
  keepDue: (newIssueDate: string) => string
  fixing: boolean
}

/** Saved clients a spoken name could mean: an exact name or alias wins;
 * a first name alone fits everyone with that first name. */
export function matchSavedClients(spoken: string, clients: VoiceSavedClient[]): VoiceSavedClient[] {
  const key = clientKey(spoken)
  if (!key) return []
  const exact = clients.find((client) => client.nameKey === key || client.aliases.includes(key))
  if (exact) return [exact]
  if (key.includes(" ")) return []
  return clients.filter((client) => client.nameKey.split(" ")[0] === key)
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places

export function planInvoiceFill(result: VoiceInvoiceResult, ctx: InvoiceFillContext): InvoiceFillPlan {
  const skipped: string[] = []
  const questions: InvoiceVoiceQuestion[] = []

  let client: InvoiceClientPick | null = null
  const spoken = result.clientName?.trim() || null
  if (spoken) {
    const matches = matchSavedClients(spoken, ctx.savedClients)
    if (matches.length === 1) {
      client = { kind: "saved", client: matches[0] }
    } else if (matches.length > 1) {
      questions.push({
        id: "client",
        kind: "client",
        prompt: `Which ${spoken}?`,
        spokenName: spoken,
        options: matches.slice(0, 4),
      })
    } else {
      client = { kind: "new", name: spoken }
    }
  }

  let lines: VoiceInvoiceLine[] | null = null
  if (result.lines && (result.lines.length > 0 || ctx.fixing)) {
    lines = result.lines.slice(0, 50).map((line) => ({
      ...line,
      description: line.description.trim(),
      quantity: round(line.quantity, 2),
      rate: round(line.rate, 2),
    }))
  }

  const issueDate = result.issueDate
  const startsOn = issueDate ?? ctx.issueDate
  let dueDate =
    result.dueDate ??
    (!ctx.isQuote && result.dueTerms ? dueDateForTerms(startsOn, result.dueTerms) : null) ??
    (ctx.isQuote && result.validDays ? addQuoteDays(startsOn, result.validDays) : null) ??
    (issueDate ? ctx.keepDue(issueDate) : null)
  if (dueDate && dueDate < startsOn) {
    skipped.push(
      ctx.isQuote
        ? "The valid-until day was before the quote date, so it wasn't changed."
        : "The due day was before the invoice date, so it wasn't changed."
    )
    dueDate = issueDate ? ctx.keepDue(issueDate) : null
  }

  return {
    client,
    clientEmail: result.clientEmail,
    clientPhone: result.clientPhone,
    lines,
    issueDate,
    dueDate,
    note: result.note?.trim() || null,
    questions,
    skipped,
  }
}

export type InvoiceFormSnapshot = {
  clientName: string
  clientEmail: string
  clientPhone: string
  lines: Array<{ description: string; quantity: string; rate: string; category: VoiceInvoiceLine["category"] }>
  issueDate: string
  dueDate: string
  note: string
}

/** What's on the form now, for a "Fix by voice" request. Lines that aren't
 * complete yet (no description or price) are left out. */
export function voiceInvoiceCurrentFor(form: InvoiceFormSnapshot): VoiceInvoiceCurrent {
  const lines: VoiceInvoiceLine[] = []
  for (const line of form.lines) {
    const quantity = Number(line.quantity.trim() || "1")
    const rate = Number(line.rate.replace(/[$,\s]/g, ""))
    const description = line.description.trim().slice(0, 200)
    if (!description || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(quantity) || quantity <= 0) continue
    lines.push({ description, quantity: round(quantity, 2), rate: round(rate, 2), category: line.category })
  }
  return {
    clientName: form.clientName.trim().slice(0, 80) || null,
    clientEmail: form.clientEmail.trim().slice(0, 254) || null,
    clientPhone: form.clientPhone.trim().slice(0, 40) || null,
    lines: lines.slice(0, 50),
    issueDate: form.issueDate,
    dueDate: form.dueDate,
    note: form.note.trim().slice(0, 1000) || null,
  }
}

/** Words for the phone's speech recognition to listen for on this form:
 * the person's saved client names, and billing words. */
export function voiceInvoiceHints(clientNames: string[]): string[] {
  const hints = new Set<string>(["invoice", "quote", "due on receipt", "net 15", "net 30", "each", "per hour", "deposit", "tip"])
  for (const name of clientNames.slice(0, 90)) if (name.trim()) hints.add(name.trim())
  return [...hints].slice(0, 100)
}
