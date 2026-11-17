// Turns a voice client reply (shared/voiceClient.ts) into what the Add
// client form should fill in, or a note for a client's page. Whether the
// person is already a client is checked here on the phone (the client list
// never goes to the server). Details for an existing client only ever fill
// boxes they don't have yet; a different email or phone is shown, not saved.

import { clientKey } from "@shared/clients"
import type { VoiceClientCurrent, VoiceClientResult } from "@shared/voiceClient"
import type { VoiceSavedClient } from "@/lib/voiceInvoiceFill"

export type VoiceClientRecord = VoiceSavedClient & { notes?: string | null }

export type ClientFillPlan = {
  name: string | null
  phone: string | null
  email: string | null
  address: string | null
  // Words to add to the notes (after what's there).
  notes: string | null
  remove: VoiceClientResult["remove"]
  // A saved client with exactly this name (or alias).
  existing: VoiceClientRecord | null
  // Saved clients who share the first name, for a heads-up line.
  sameFirstName: string[]
  skipped: string[]
}

/** The saved client with exactly this name or alias, if any. */
export function findExistingClient(name: string, clients: VoiceClientRecord[]): VoiceClientRecord | null {
  const key = clientKey(name)
  if (!key) return null
  return clients.find((client) => client.nameKey === key || client.aliases.includes(key)) ?? null
}

/** Saved clients whose first name is this name's first name (the exact one left out). */
export function clientsWithFirstName(name: string, clients: VoiceClientRecord[]): string[] {
  const first = clientKey(name).split(" ")[0]
  if (!first) return []
  const key = clientKey(name)
  return clients.filter((client) => client.nameKey !== key && client.nameKey.split(" ")[0] === first).map((client) => client.name)
}

export function planClientFill(
  result: VoiceClientResult,
  ctx: { savedClients: VoiceClientRecord[]; fixing: boolean; formName: string }
): ClientFillPlan {
  const skipped: string[] = []
  if (result.emailUnclear) skipped.push("Didn't catch the email clearly. Type it in, or say it again slowly.")
  if (result.others.length > 0) {
    const names = result.others.join(" and ")
    skipped.push(`One client at a time: add ${names} next.`)
  }
  const name = result.name?.trim() || null
  const lookFor = name ?? (ctx.fixing ? ctx.formName.trim() : "")
  return {
    name,
    phone: result.phone,
    email: result.email,
    address: result.address,
    notes: result.notes?.trim() || null,
    remove: result.remove,
    existing: lookFor ? findExistingClient(lookFor, ctx.savedClients) : null,
    sameFirstName: lookFor ? clientsWithFirstName(lookFor, ctx.savedClients).slice(0, 3) : [],
    skipped,
  }
}

/** Notes with more added on a new line. */
export function appendNote(existing: string, addition: string): string {
  const add = addition.trim()
  if (!add) return existing
  return existing.trim() ? `${existing.trimEnd()}\n${add}` : add
}

/** "Nov 16: She wants to go lighter next time." */
export function datedNote(today: string, text: string): string {
  const [y, m, d] = today.split("-").map(Number)
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
  return `${label}: ${text.trim()}`
}

export type ExistingClientUpdate = {
  // Only boxes they don't have yet, plus notes added on.
  patch: { phone?: string; email?: string; address?: string; notes?: string }
  // Said, but they already have a different one: shown, never saved by voice.
  conflicts: Array<{ label: string; theirs: string; said: string }>
}

const sameValue = (a: string, b: string, phone: boolean) =>
  phone ? a.replace(/\D/g, "").slice(-10) === b.replace(/\D/g, "").slice(-10) : a.trim().toLowerCase() === b.trim().toLowerCase()

/** What "Add these details to her" would change on a saved client. */
export function detailsForExisting(
  existing: { phone?: string | null; email?: string | null; address?: string | null; notes?: string | null },
  said: { phone: string | null; email: string | null; address: string | null; notes: string | null }
): ExistingClientUpdate {
  const patch: ExistingClientUpdate["patch"] = {}
  const conflicts: ExistingClientUpdate["conflicts"] = []
  const fields = [
    ["phone", "Phone"],
    ["email", "Email"],
    ["address", "Address"],
  ] as const
  for (const [key, label] of fields) {
    const value = said[key]
    if (!value) continue
    const theirs = existing[key]?.trim() || ""
    if (!theirs) patch[key] = value
    else if (!sameValue(theirs, value, key === "phone")) conflicts.push({ label, theirs, said: value })
  }
  if (said.notes) patch.notes = appendNote(existing.notes ?? "", said.notes)
  return { patch, conflicts }
}

export type ClientFormSnapshot = { name: string; phone: string; email: string; address: string; notes: string }

/** What's on the Add client form now, for a "Fix by voice" request. */
export function voiceClientCurrentFor(form: ClientFormSnapshot): VoiceClientCurrent {
  return {
    name: form.name.trim().slice(0, 80) || null,
    phone: form.phone.trim().slice(0, 40) || null,
    email: form.email.trim().slice(0, 254) || null,
    address: form.address.trim().slice(0, 300) || null,
    notes: form.notes.trim().slice(0, 2000) || null,
  }
}
