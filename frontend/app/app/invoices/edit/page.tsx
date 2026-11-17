"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Mic, Plus, Square, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { clientKey } from "@/components/invoices/invoice-clients"
import {
  InvoicesPage,
  cardClass,
  fieldLabelClass,
  localToday,
  useQueryParam,
  softInputClass,
  useInvoicesWorkspace,
} from "@/components/invoices/invoice-ui"
import { useToast } from "@/hooks/use-toast"
import { wakeInvoiceServers } from "@/lib/api/invoicesApi"
import { createQuote, editQuote } from "@/lib/api/quotesApi"
import { createInvoiceSchedule, updateInvoiceSchedule } from "@/lib/api/invoiceSchedulesApi"
import { useInvoiceSchedulesStore, useWorkspaceInvoiceSchedules } from "@/lib/stores/useInvoiceSchedulesStore"
import { RepeatOptions, newRepeatDraft, repeatDraftFrom, repeatEnd, type RepeatDraft } from "@/components/invoices/repeat-options"
import { addScheduleDays, daysBetween, scheduleNextDateFrom } from "@shared/invoiceSchedules"
import { useQuotesStore, useWorkspaceQuotes } from "@/lib/stores/useQuotesStore"
import { createInvoiceInBackground, currentInvoiceId, editInvoiceInBackground, invoiceSaved } from "@/lib/domain/invoiceService"
import { useClientsStore } from "@/lib/stores/useClientsStore"
import { buildClientKeyIndex } from "@shared/clients"
import type { ClientType } from "@shared/schemas/client"
import { cn } from "@/lib/utils"
import { dueDateForTerms, formatInvoiceDate, formatInvoiceMoney, INVOICE_TERMS_LABELS } from "@shared/invoiceDisplay"
import type { IncomeCategory } from "@shared/schemas/entry"
import { invoiceDepositOutstanding } from "@shared/invoicePayments"
import type { InvoiceTerms, InvoiceType } from "@shared/schemas/invoice"
import { DEFAULT_QUOTE_VALID_DAYS, addQuoteDays, quoteInvoicePrefill, quoteNumberLabel } from "@shared/quotes"
import { useSpeechCapture } from "@/hooks/useSpeechCapture"
import { listWords, scrollToVoiceReview, VoiceReviewFooter, VoiceReviewLabel, type VoiceAsk } from "@/components/voice-review"
import { useVoiceHandoffStore } from "@/lib/stores/useVoiceHandoffStore"
import { parseVoiceInvoice, wakeVoiceEntry } from "@/lib/api/voiceEntryApi"
import {
  planInvoiceFill,
  voiceInvoiceCurrentFor,
  voiceInvoiceHints,
  type InvoiceClientPick,
  type InvoiceVoiceQuestion,
} from "@/lib/voiceInvoiceFill"

// A line as typed: quantity × rate (the rate as dollars and cents).
type DraftLine = { key: number; description: string; quantity: string; rate: string; category: IncomeCategory }

const CATEGORY_OPTIONS: Array<{ value: IncomeCategory; label: string }> = [
  { value: "services", label: "Services" },
  { value: "products", label: "Products" },
  { value: "tips", label: "Tips" },
  { value: "other", label: "Other" },
]
const TERMS: InvoiceTerms[] = ["due_on_receipt", "net_15", "net_30"]
const TERMS_SHORT: Record<InvoiceTerms, string> = { due_on_receipt: "Due now", net_15: "15 days", net_30: "30 days" }
// How long a quote is good for, as quick picks (a date picker covers the rest).
const QUOTE_VALID_DAYS = [14, DEFAULT_QUOTE_VALID_DAYS, 60]

// "$1,250.5" → 1250.5; null when it isn't a positive amount in whole cents.
function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "")
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const value = Math.round(Number(cleaned) * 100) / 100
  return value > 0 ? value : null
}

// "1.5" → 1.5; null unless a positive number with up to two decimals.
function parseQuantity(text: string): number | null {
  const cleaned = text.trim()
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return value > 0 ? value : null
}

function termsFor(issueDate: string, dueDate: string): InvoiceTerms | null {
  return TERMS.find((terms) => dueDateForTerms(issueDate, terms) === dueDate) ?? null
}

let lineKey = 0
// "2026-10-01" + 7 days → "2026-10-08".
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

// A deposit that's been paid or waived can't change any more.
function depositSettled(invoice: InvoiceType | null): boolean {
  return !!invoice?.deposit && (invoice.deposit.waivedAt !== null || invoiceDepositOutstanding(invoice) === 0)
}

// The form as it was before voice first filled it, for the voice note's undo (X).
type VoiceFormSnapshot = {
  clientName: string
  clientId: string | null
  clientEmail: string
  clientPhone: string
  clientAddress: string
  lines: DraftLine[]
  issueDate: string
  dueDate: string
  note: string
}

// What the form sends for a quote (its "due date" is the valid-until date).
type QuoteFormBody = {
  clientName: string
  clientId: string | null
  clientEmail: string | null
  clientPhone: string | null
  clientAddress: string | null
  lines: Array<{ description: string; quantity: number; rate: number; amount: number; category: IncomeCategory }>
  issueDate: string
  dueDate: string
  note: string
  policies: string
}

function newLine(category: IncomeCategory = "services"): DraftLine {
  return { key: ++lineKey, description: "", quantity: "1", rate: "", category }
}

export default function InvoiceFormPageRoute() {
  return (
    <Suspense fallback={null}>
      <InvoiceFormPage />
    </Suspense>
  )
}

function InvoiceFormPage() {
  const router = useRouter()
  const { ready, workspaceId, invoices, settings, loadStatus } = useInvoicesWorkspace()
  // Sending, sharing and marking paid wait on these; wake them now.
  useEffect(() => {
    if (workspaceId) wakeInvoiceServers()
  }, [workspaceId])
  const invoiceId = useQueryParam("id")
  // ?kind=quote: the same form makes and edits quotes (shared/schemas/quote.ts);
  // ?id is then the quote's.
  const isQuote = useQueryParam("kind") === "quote"
  // ?fromQuote=<id>: "Turn into invoice" — a new invoice filled in from the quote.
  const fromQuoteId = useQueryParam("fromQuote")
  const { quotes, status: quotesStatus } = useWorkspaceQuotes(isQuote || fromQuoteId ? workspaceId : null)
  const upsertQuote = useQuotesStore((state) => state.upsertQuote)
  const existingQuote = isQuote && invoiceId ? quotes.find((quote) => quote.id === invoiceId) ?? null : null
  const sourceQuote = !isQuote && fromQuoteId ? quotes.find((quote) => quote.id === fromQuoteId) ?? null : null
  // ?schedule=<id>: edits a repeating invoice — what each future one bills,
  // and how it repeats (shared/schemas/invoiceSchedule.ts).
  const scheduleParam = useQueryParam("schedule")
  const isSchedule = !isQuote && !!scheduleParam
  const { schedules, status: schedulesStatus } = useWorkspaceInvoiceSchedules(isSchedule ? workspaceId : null)
  const upsertSchedule = useInvoiceSchedulesStore((state) => state.upsertSchedule)
  const existingSchedule = isSchedule ? schedules.find((schedule) => schedule.id === scheduleParam) ?? null : null
  const noun = isQuote ? "quote" : "invoice"
  const { toast } = useToast()
  // "New invoice for <client>" from a client's page.
  const prefillClient = useQueryParam("client")
  const prefillClientId = useQueryParam("clientId")
  const clientsEntry = useClientsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId] : undefined))
  const loadClients = useClientsStore((state) => state.load)
  useEffect(() => {
    if (workspaceId) void loadClients(workspaceId).catch(() => {})
  }, [loadClients, workspaceId])
  const savedClients = useMemo(() => (clientsEntry?.clients ?? []).filter((c) => !c.archived), [clientsEntry?.clients])
  // A new invoice keeps working by its temporary id once it has a real one.
  const existing = invoiceId && !isQuote ? invoices.find((invoice) => invoice.id === currentInvoiceId(invoiceId)) ?? null : null
  // One id per form, so a retried create can't make a second invoice.
  const clientMutationId = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now()}${Math.random().toString(36).slice(2)}`
  )

  const [clientName, setClientName] = useState("")
  // The saved client picked (shared/schemas/client.ts); null = the server
  // finds one by name or makes a new one when the invoice is saved.
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientEmail, setClientEmail] = useState("")
  const [clientPhone, setClientPhone] = useState("")
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()])
  const [issueDate, setIssueDate] = useState(localToday())
  const [dueDate, setDueDate] = useState(() => dueDateForTerms(localToday(), "net_30"))
  const [note, setNote] = useState("")
  const [policies, setPolicies] = useState("")
  const [clientAddress, setClientAddress] = useState("")
  const [depositOn, setDepositOn] = useState(false)
  const [depositMode, setDepositMode] = useState<"fixed" | "percent">("fixed")
  const [depositText, setDepositText] = useState("")
  const [depositDueDate, setDepositDueDate] = useState(() => addDays(localToday(), 7))
  const [saving, setSaving] = useState<null | "draft" | "share">(null)
  // "Repeat this invoice" on a new invoice (always on when editing a schedule).
  const [repeatOn, setRepeatOn] = useState(false)
  const [repeat, setRepeat] = useState<RepeatDraft>(newRepeatDraft)
  const [showErrors, setShowErrors] = useState(false)
  const initialized = useRef(false)
  const [formInitialized, setFormInitialized] = useState(false)

  // Fill the form once: from the invoice being edited, or from settings.
  useEffect(() => {
    if (initialized.current || loadStatus !== "ready") return
    if (isQuote ? invoiceId && !existingQuote : invoiceId && !existing) return
    if (fromQuoteId && !sourceQuote && quotesStatus !== "error") return
    if (isSchedule && !existingSchedule) return
    initialized.current = true
    setFormInitialized(true)
    if (existingSchedule) {
      setClientName(existingSchedule.clientName)
      setClientId(existingSchedule.clientId ?? null)
      setClientEmail(existingSchedule.clientEmail ?? "")
      setClientPhone(existingSchedule.clientPhone ?? "")
      setClientAddress(existingSchedule.clientAddress ?? "")
      setLines(
        existingSchedule.lines.map((line) => ({
          ...newLine(line.category),
          description: line.description,
          quantity: String(line.quantity),
          rate: line.rate.toFixed(2),
        }))
      )
      setNote(existingSchedule.note)
      setPolicies(existingSchedule.policies)
      // Terms are kept as "due N days after", shown from today.
      setIssueDate(localToday())
      setDueDate(addScheduleDays(localToday(), existingSchedule.dueInDays))
      setDepositOn(false)
      setRepeatOn(true)
      setRepeat(repeatDraftFrom(existingSchedule))
    } else if (existingQuote) {
      setClientName(existingQuote.clientName)
      setClientId(existingQuote.clientId ?? null)
      setClientEmail(existingQuote.clientEmail ?? "")
      setClientPhone(existingQuote.clientPhone ?? "")
      setClientAddress(existingQuote.clientAddress ?? "")
      setLines(
        existingQuote.lines.map((line) => ({
          ...newLine(line.category),
          description: line.description,
          quantity: String(line.quantity),
          rate: line.rate.toFixed(2),
        }))
      )
      setPolicies(existingQuote.policies)
      setIssueDate(existingQuote.issueDate)
      // A quote's "due date" field is the last day it can be accepted.
      setDueDate(existingQuote.validUntil)
      setNote(existingQuote.note)
      if (existingQuote.deposit) {
        setDepositOn(true)
        setDepositMode("fixed")
        setDepositText(existingQuote.deposit.amount.toFixed(2))
      }
    } else if (existing) {
      setClientName(existing.clientName)
      setClientId(existing.clientId ?? null)
      setClientEmail(existing.clientEmail ?? "")
      setClientPhone(existing.clientPhone ?? "")
      setLines(
        existing.lines.map((line) => ({
          ...newLine(line.category),
          description: line.description,
          quantity: String(line.quantity),
          rate: line.rate.toFixed(2),
        }))
      )
      setClientAddress(existing.clientAddress ?? "")
      setPolicies(existing.policies)
      setIssueDate(existing.issueDate)
      setDueDate(existing.dueDate)
      setNote(existing.note)
      if (existing.deposit) {
        setDepositOn(true)
        setDepositMode("fixed")
        setDepositText(existing.deposit.amount.toFixed(2))
        setDepositDueDate(existing.deposit.dueDate)
      }
    } else {
      if (settings) {
        const due = dueDateForTerms(localToday(), settings.defaultTerms)
        setDueDate(due)
        setNote(settings.defaultNote)
        setPolicies(settings.defaultPolicies)
        const preset = settings.defaultDeposit
        if (preset.type !== "none" && preset.value > 0) {
          setDepositOn(true)
          setDepositMode(preset.type)
          setDepositText(preset.type === "percent" ? String(preset.value) : preset.value.toFixed(2))
          const depositDue = addDays(localToday(), preset.dueInDays)
          setDepositDueDate(depositDue > due ? due : depositDue)
        }
      }
      if (isQuote) {
        setDueDate(addQuoteDays(localToday(), DEFAULT_QUOTE_VALID_DAYS))
        // The default note says how to pay — that's for the invoice.
        setNote("")
      }
      const prefilled = prefillClientId ? savedClients.find((c) => c.id === prefillClientId) : undefined
      if (sourceQuote) {
        // Everything from the quote but the dates, which start fresh today.
        const from = quoteInvoicePrefill(sourceQuote)
        setClientName(from.clientName)
        setClientId(from.clientId)
        setClientEmail(from.clientEmail)
        setClientPhone(from.clientPhone)
        setClientAddress(from.clientAddress)
        setLines(from.lines.map((line) => ({ ...newLine(line.category), description: line.description, quantity: String(line.quantity), rate: line.rate.toFixed(2) })))
        setNote([from.note, settings?.defaultNote ?? ""].filter((text) => text.trim()).join("\n\n"))
        setPolicies(from.policies)
        if (from.depositAmount !== null) {
          setDepositOn(true)
          setDepositMode("fixed")
          setDepositText(from.depositAmount.toFixed(2))
        } else {
          setDepositOn(false)
        }
      } else if (prefilled) {
        setClientName(prefilled.name)
        setClientId(prefilled.id)
        setClientEmail(prefilled.email ?? "")
        setClientPhone(prefilled.phone ?? "")
        setClientAddress(prefilled.address ?? "")
      } else if (prefillClient) {
        // Their contact details from the latest invoice to them.
        const last = invoices.find((invoice) => clientKey(invoice.clientName) === clientKey(prefillClient))
        setClientName(last?.clientName ?? prefillClient)
        setClientEmail(last?.clientEmail ?? "")
        setClientPhone(last?.clientPhone ?? "")
        setClientAddress(last?.clientAddress ?? "")
      }
    }
  }, [existing, existingQuote, existingSchedule, fromQuoteId, invoiceId, invoices, isQuote, isSchedule, loadStatus, prefillClient, prefillClientId, quotesStatus, savedClients, settings, sourceQuote])

  // Paid and void invoices can't be edited, nor a quote the client answered.
  useEffect(() => {
    if (existing && existing.status !== "draft" && existing.status !== "sent") {
      router.replace(`/app/invoices/view?id=${encodeURIComponent(existing.id)}`)
    }
    if (existingQuote && existingQuote.status !== "draft" && existingQuote.status !== "sent") {
      router.replace(`/app/invoices/quote?id=${encodeURIComponent(existingQuote.id)}`)
    }
  }, [existing, existingQuote, router])

  // Typing: saved clients whose name contains it. Empty: the 3 most recently
  // invoiced saved clients.
  const clientSuggestions = useMemo(() => {
    const q = clientKey(clientName)
    if (q) {
      return savedClients
        .filter((c) => c.nameKey.includes(q) || c.aliases.some((alias) => alias.includes(q)))
        .filter((c) => c.id !== clientId)
        .slice(0, 5)
    }
    const recent: ClientType[] = []
    const index = buildClientKeyIndex(savedClients)
    for (const invoice of invoices) {
      const id = invoice.clientId ?? index.get(clientKey(invoice.clientName))
      const match = savedClients.find((c) => c.id === id)
      if (match && !recent.includes(match)) recent.push(match)
      if (recent.length === 3) break
    }
    return recent
  }, [clientName, clientId, savedClients, invoices])
  const nameMatchesSavedClient =
    !!clientName.trim() && buildClientKeyIndex(savedClients).has(clientKey(clientName))

  function pickClient(client: ClientType) {
    setClientName(client.name)
    setClientId(client.id)
    // Their saved details; anything they don't have keeps what's typed.
    if (client.email) setClientEmail(client.email)
    if (client.phone) setClientPhone(client.phone)
    if (client.address) setClientAddress(client.address)
  }

  // Each line's amount is quantity × rate, to the cent (as the server works it out).
  const parsedLines = lines.map((line) => {
    const quantity = parseQuantity(line.quantity)
    const rate = parseAmount(line.rate)
    return { ...line, quantityValue: quantity, rateValue: rate, value: quantity !== null && rate !== null ? Math.round(quantity * rate * 100) / 100 : null }
  })
  const total = parsedLines.reduce((sum, line) => sum + Math.round((line.value ?? 0) * 100), 0) / 100
  const selectedTerms = termsFor(issueDate, dueDate)
  const selectedValidDays = QUOTE_VALID_DAYS.find((days) => addQuoteDays(issueDate, days) === dueDate) ?? null
  const filledLines = parsedLines.filter((line) => line.description.trim() || line.rate.trim())
  const depositLocked = depositSettled(existing)
  const depositInput = depositMode === "percent" ? Number(depositText.replace(/[%\s]/g, "")) : parseAmount(depositText)
  const depositAmount =
    depositInput === null || !Number.isFinite(depositInput) || depositInput <= 0
      ? null
      : depositMode === "percent"
        ? Math.round(total * depositInput) / 100
        : depositInput
  const depositError =
    !depositOn || depositLocked
      ? null
      : depositAmount === null || depositAmount <= 0
        ? "Enter the deposit amount."
        : Math.round(depositAmount * 100) >= Math.round(total * 100)
          ? "The deposit has to be less than the total."
          : !isQuote && (depositDueDate < issueDate || depositDueDate > dueDate)
            ? "The deposit has to be due between the invoice date and its due date."
            : null
  const errors = {
    client: !clientName.trim() ? `Who is this ${noun} for?` : null,
    lines:
      filledLines.length === 0
        ? "Add at least one line."
        : filledLines.some((line) => !line.description.trim() || line.value === null)
          ? "Each line needs a description, a quantity and a rate."
          : null,
    dates:
      dueDate < issueDate ? (isQuote ? "Valid until can't be before the quote date." : "The due date can't be before the invoice date.") : null,
    email:
      clientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail.trim()) ? "That email doesn't look right." : null,
  }
  // Repeating invoices don't take deposits.
  const repeating = repeatOn && !isQuote && !existing
  // Editing a schedule: its own next date, unless the frequency changes.
  // A new one: the next comes one period after this invoice, and after today.
  const scheduleNextDate = existingSchedule
    ? repeat.frequency === existingSchedule.frequency
      ? existingSchedule.nextDate
      : undefined
    : scheduleNextDateFrom(issueDate, repeat.frequency, localToday(), { includeToday: false })
  const repeatResult = repeating ? repeatEnd(repeat, existingSchedule ? existingSchedule.anchorDate : issueDate, scheduleNextDate) : null
  const repeatError = repeatResult && "error" in repeatResult ? repeatResult.error : null
  const valid = !errors.client && !errors.lines && !errors.dates && !errors.email && (repeating || !depositError) && !repeatError

  /** ------------------------------------------------
   * VOICE — say the invoice or quote, check the filled form, tap its own
   * buttons. Only the typed-out words and saved client names go to the
   * server (lib/api/voiceEntryApi.ts); nothing is saved or sent by voice.
   * ------------------------------------------------ */
  const [voicePhase, setVoicePhase] = useState<"idle" | "thinking">("idle")
  const [voiceQuestions, setVoiceQuestions] = useState<InvoiceVoiceQuestion[]>([])
  const [voiceNotes, setVoiceNotes] = useState<string[]>([])
  const [voiceFilled, setVoiceFilled] = useState(false)
  const [voiceHeard, setVoiceHeard] = useState("")
  const voiceRunRef = useRef(0)
  const voiceUndoRef = useRef<VoiceFormSnapshot | null>(null)
  // This recording fixes what voice already filled ("make the gloss 45").
  const voiceFixingRef = useRef(false)
  // What the review's voice button asked for ("client name"), sent with that fix.
  const voiceAskingRef = useRef<string[]>([])
  const voiceSnapshot = (): VoiceFormSnapshot => ({
    clientName,
    clientId,
    clientEmail,
    clientPhone,
    clientAddress,
    lines,
    issueDate,
    dueDate,
    note,
  })

  function restoreVoiceSnapshot(snap: VoiceFormSnapshot) {
    setClientName(snap.clientName)
    setClientId(snap.clientId)
    setClientEmail(snap.clientEmail)
    setClientPhone(snap.clientPhone)
    setClientAddress(snap.clientAddress)
    setLines(snap.lines)
    setIssueDate(snap.issueDate)
    setDueDate(snap.dueDate)
    setNote(snap.note)
  }

  /** Puts a client on the form. Contact details come from a saved client,
   * or stay as they were before voice filled anything. */
  function applyVoiceClient(pick: InvoiceClientPick, before: VoiceFormSnapshot) {
    if (pick.kind === "saved") {
      setClientName(pick.client.name)
      setClientId(pick.client.id)
      setClientEmail(pick.client.email || before.clientEmail)
      setClientPhone(pick.client.phone || before.clientPhone)
      setClientAddress(pick.client.address || before.clientAddress)
    } else {
      setClientName(pick.name)
      setClientId(null)
      setClientEmail(before.clientEmail)
      setClientPhone(before.clientPhone)
      setClientAddress(before.clientAddress)
    }
  }

  // When only the date moves, the terms (or quote length) chosen stay.
  function keepDueFor(nextIssueDate: string): string {
    if (isQuote) return selectedValidDays ? addQuoteDays(nextIssueDate, selectedValidDays) : dueDate
    return selectedTerms ? dueDateForTerms(nextIssueDate, selectedTerms) : dueDate
  }

  async function handleVoiceTranscript(transcript: string) {
    const run = ++voiceRunRef.current
    const fixing = voiceFixingRef.current
    const openQuestions = fixing ? voiceQuestions : []
    const now = voiceSnapshot()
    const before = voiceUndoRef.current ?? now
    setVoicePhase("thinking")
    setVoiceHeard(transcript)
    setVoiceNotes([])
    if (!fixing) {
      setVoiceQuestions([])
      setVoiceFilled(false)
    }
    try {
      const result = await parseVoiceInvoice({
        kind: "invoice",
        document: isQuote ? "quote" : "invoice",
        transcript,
        today: localToday(),
        clients: savedClients.map((c) => c.name).slice(0, 300),
        ...(fixing
          ? {
              asking: voiceAskingRef.current.length > 0 ? voiceAskingRef.current : undefined,
              current: voiceInvoiceCurrentFor({
                clientName: now.clientName,
                clientEmail: now.clientEmail,
                clientPhone: now.clientPhone,
                lines: now.lines,
                issueDate: now.issueDate,
                dueDate: now.dueDate,
                // The spoken part only; the note from settings stays put.
                note: now.note === before.note ? "" : now.note.slice(0, Math.max(0, now.note.length - before.note.length)).trim(),
              }),
            }
          : {}),
      })
      if (run !== voiceRunRef.current) return
      const plan = planInvoiceFill(result, {
        isQuote,
        savedClients,
        issueDate: now.issueDate,
        dueDate: now.dueDate,
        keepDue: keepDueFor,
        fixing,
      })
      const nothingFilled =
        !plan.client && plan.questions.length === 0 && !plan.clientEmail && !plan.clientPhone &&
        !plan.lines && !plan.issueDate && !plan.dueDate && !plan.note
      if (!result.isInvoice || nothingFilled) {
        setVoiceNotes([
          ...plan.skipped,
          fixing
            ? "Didn't catch a change in that. Try again, like \u201cmake the gloss 45.\u201d"
            : `Didn't catch ${isQuote ? "a quote" : "an invoice"} in that. Try again, like \u201c${isQuote ? "Quote" : "Invoice"} Jenna 120 for a cut and color.\u201d`,
        ])
        return
      }

      if (!voiceUndoRef.current) voiceUndoRef.current = now
      if (plan.client) applyVoiceClient(plan.client, before)
      if (plan.clientEmail) setClientEmail(plan.clientEmail)
      if (plan.clientPhone) setClientPhone(plan.clientPhone)
      if (plan.lines) {
        setLines(
          plan.lines.length > 0
            ? plan.lines.map((line) => ({
                ...newLine(line.category),
                description: line.description,
                quantity: String(line.quantity),
                rate: line.rate.toFixed(2),
              }))
            : [newLine()]
        )
      }
      if (plan.issueDate) setIssueDate(plan.issueDate)
      if (plan.dueDate) setDueDate(plan.dueDate)
      // What they said goes first; the note from settings (how to pay) stays under it.
      if (plan.note) setNote([plan.note, before.note].filter((text) => text.trim()).join("\n\n"))

      // New questions get ids from this run so they never clash with ones still open.
      const newQuestions = plan.questions.map((q) => ({ ...q, id: `${run}-${q.id}` }))
      setVoiceQuestions(
        fixing
          ? // A fix that names the client answers the open "Which Jenna?".
            [...(plan.client || newQuestions.length > 0 ? [] : openQuestions), ...newQuestions]
          : newQuestions
      )
      setVoiceNotes(plan.skipped)
      setVoiceFilled(true)
      scrollToVoiceReview("voice-invoice-review")
    } catch (error) {
      if (run !== voiceRunRef.current) return
      console.warn("[VoiceInvoice] fill failed", error)
      // 429 = today's voice limit (server message says so); anything else is a plain failure.
      const limited = (error as { status?: number })?.status === 429
      setVoiceNotes([limited && error instanceof Error ? error.message : "Couldn't fill in the form just now. Try again or type it in."])
    } finally {
      if (run === voiceRunRef.current) setVoicePhase("idle")
    }
  }
  const speech = useSpeechCapture((transcript) => void handleVoiceTranscript(transcript))

  /** With the filled-in note showing, the mic fixes what voice filled instead of starting over. */
  function startVoice(ask?: VoiceAsk | null) {
    wakeVoiceEntry()
    setVoiceNotes([])
    voiceFixingRef.current = voiceFilled
    voiceAskingRef.current = voiceFilled && ask ? ask.asking : []
    if (!voiceFilled) {
      setVoiceQuestions([])
      voiceUndoRef.current = null
    }
    speech.resetStatus()
    void speech.start(voiceInvoiceHints(savedClients.map((c) => c.name)))
  }

  /** The note's X: puts the form back as it was before voice filled it. */
  function undoVoiceFill() {
    if (voiceUndoRef.current) restoreVoiceSnapshot(voiceUndoRef.current)
    voiceRunRef.current += 1
    voiceUndoRef.current = null
    voiceFixingRef.current = false
    setVoicePhase("idle")
    setVoiceFilled(false)
    setVoiceQuestions([])
    setVoiceNotes([])
    setVoiceHeard("")
  }

  function answerVoiceQuestion(question: InvoiceVoiceQuestion, pick: InvoiceClientPick) {
    applyVoiceClient(pick, voiceUndoRef.current ?? voiceSnapshot())
    setVoiceQuestions((current) => current.filter((q) => q.id !== question.id))
  }

  // ?voice=1 (the mic on the Invoices list): start listening once the form is ready.
  const listenOnOpen = useQueryParam("voice") === "1"
  const listenedOnOpen = useRef(false)
  const formReady = formInitialized && loadStatus === "ready"
  useEffect(() => {
    if (!listenOnOpen || listenedOnOpen.current || !formReady || !speech.checked) return
    listenedOnOpen.current = true
    if (speech.supported) startVoice()
    // startVoice reads the latest form each render; only the readiness matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenOnOpen, formReady, speech.checked, speech.supported])

  // Said to Ask 521 on Home ("invoice Jenna 120 for a cut"): fill from those words once the form is ready.
  const voiceHandoff = useVoiceHandoffStore((state) => state.request)
  const takeVoiceHandoff = useVoiceHandoffStore((state) => state.take)
  useEffect(() => {
    if (!voiceHandoff || !formReady || isSchedule || (voiceHandoff.listen && !speech.checked)) return
    const taken = takeVoiceHandoff(isQuote ? ["quote"] : ["invoice"], workspaceId)
    if (!taken) return
    voiceFixingRef.current = false
    voiceUndoRef.current = null
    if (taken.listen) {
      if (speech.supported) startVoice()
      return
    }
    void handleVoiceTranscript(taken.transcript)
    // handleVoiceTranscript reads the latest form each render; readiness is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceHandoff, formReady, isQuote, isSchedule, workspaceId, takeVoiceHandoff, speech.checked])

  const voiceListening = speech.status === "listening"
  const voiceBusy = voiceListening || voicePhase === "thinking"
  // The review's voice button asks for whatever the invoice or quote still needs.
  const voiceMissing: { words: string[]; asking: string }[] = []
  if (!clientName.trim() && voiceQuestions.length === 0) voiceMissing.push({ words: ["who it's for"], asking: "client name" })
  if (!lines.some((line) => Number(line.rate) > 0)) {
    voiceMissing.push({ words: ["what it's for", "how much"], asking: "line items (what it's for and the price)" })
  }
  const voiceAsk: VoiceAsk | null =
    voiceMissing.length > 0
      ? { label: `Say ${listWords(voiceMissing.flatMap((m) => m.words))}`, asking: voiceMissing.map((m) => m.asking) }
      : null
  const voiceAllowed = speech.supported && !isSchedule

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  function save(mode: "draft" | "share") {
    if (!workspaceId) return
    // A client voice is still asking about isn't on the form yet.
    if (voiceQuestions.length > 0) {
      setVoiceNotes([`Pick who this ${noun} is for above, then save.`])
      document.getElementById(`voice-question-${voiceQuestions[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }
    if (!valid) {
      setShowErrors(true)
      return
    }
    const body = {
      clientName: clientName.trim(),
      clientId,
      clientEmail: clientEmail.trim() || null,
      clientPhone: clientPhone.trim() || null,
      clientAddress: clientAddress.trim() || null,
      lines: filledLines.map((line) => ({
        description: line.description.trim(),
        quantity: line.quantityValue as number,
        rate: line.rateValue as number,
        amount: line.value as number,
        category: line.category,
      })),
      issueDate,
      dueDate,
      note: note.trim(),
      policies: policies.trim(),
      // A settled deposit is left as it is (the server refuses to change it).
      ...(depositLocked
        ? {}
        : { deposit: depositOn && depositAmount !== null ? { amount: depositAmount, dueDate: depositDueDate } : null }),
    }
    if (isQuote) {
      void saveQuote(mode, body)
      return
    }
    if (existingSchedule) {
      void saveSchedule(existingSchedule.id, body)
      return
    }
    // Saved in the background (invoiceService) — the next screen shows it now.
    setSaving(mode)
    if (existing) {
      editInvoiceInBackground(workspaceId, existing, body)
      if (mode === "share") {
        router.replace(`/app/invoices/view?id=${encodeURIComponent(existing.id)}`)
      } else {
        router.replace("/app/invoices")
      }
    } else {
      const created = createInvoiceInBackground(workspaceId, {
        ...body,
        ...(repeating ? { deposit: null } : {}),
        clientMutationId: clientMutationId.current,
        ...(sourceQuote ? { quoteId: sourceQuote.id } : {}),
      })
      if (repeating && repeatResult && "end" in repeatResult) {
        void startRepeating(workspaceId, created.id, { frequency: repeat.frequency, end: repeatResult.end, sendMode: repeat.sendMode })
      }
      // The server marks the quote invoiced with it; show that now.
      if (sourceQuote) upsertQuote(workspaceId, { ...sourceQuote, status: "invoiced", invoiceId: created.id })
      if (mode === "share") {
        // A new invoice lands on its send step.
        router.replace(`/app/invoices/view?id=${encodeURIComponent(created.id)}&share=1`)
      } else {
        router.replace("/app/invoices")
      }
    }
  }

  // The repeat starts once the invoice is saved (it's the first one). The
  // form has moved on by then; a failure says so in a toast.
  async function startRepeating(workspaceId: string, invoiceTempId: string, options: Pick<Parameters<typeof createInvoiceSchedule>[1], "frequency" | "end" | "sendMode">) {
    try {
      const invoiceId = await invoiceSaved(invoiceTempId)
      const schedule = await createInvoiceSchedule(workspaceId, { ...options, invoiceId, clientMutationId: clientMutationId.current })
      upsertSchedule(workspaceId, schedule)
    } catch (error) {
      toast({
        title: "Couldn't set the invoice to repeat",
        description: `${error instanceof Error ? error.message : "Please try again."} Open the invoice and choose Repeat this invoice.`,
        variant: "destructive",
      })
    }
  }

  // A repeating invoice's changes apply to the ones still to come.
  async function saveSchedule(scheduleId: string, body: QuoteFormBody) {
    if (!workspaceId || !repeatResult || !("end" in repeatResult)) return
    setSaving("share")
    try {
      const schedule = await updateInvoiceSchedule(workspaceId, scheduleId, {
        action: "edit",
        clientName: body.clientName,
        clientEmail: body.clientEmail ?? "",
        clientPhone: body.clientPhone,
        clientAddress: body.clientAddress,
        lines: body.lines,
        note: body.note,
        policies: body.policies,
        dueInDays: Math.max(0, daysBetween(body.issueDate, body.dueDate)),
        frequency: repeat.frequency,
        end: repeatResult.end,
        sendMode: repeat.sendMode,
      })
      upsertSchedule(workspaceId, schedule)
      router.replace(`/app/invoices/repeating?id=${encodeURIComponent(schedule.id)}`)
    } catch (error) {
      setSaving(null)
      toast({
        title: "Couldn't save the changes",
        description: error instanceof Error ? error.message : "Check your connection and try again.",
        variant: "destructive",
      })
    }
  }

  // Quotes wait for the server (no background save), then open the quote.
  async function saveQuote(mode: "draft" | "share", body: QuoteFormBody) {
    if (!workspaceId) return
    const { dueDate: validUntil, ...rest } = body
    const fields = { ...rest, validUntil, deposit: depositOn && depositAmount !== null ? { amount: depositAmount } : null }
    setSaving(mode)
    try {
      const quote = existingQuote
        ? await editQuote(workspaceId, existingQuote.id, fields)
        : await createQuote(workspaceId, { ...fields, clientMutationId: clientMutationId.current })
      upsertQuote(workspaceId, quote)
      router.replace(
        mode === "share" || existingQuote
          ? `/app/invoices/quote?id=${encodeURIComponent(quote.id)}${mode === "share" && !existingQuote ? "&share=1" : ""}`
          : "/app/invoices?filter=quotes"
      )
    } catch (error) {
      setSaving(null)
      toast({
        title: "Couldn't save the quote",
        description: error instanceof Error ? error.message : "Check your connection and try again.",
        variant: "destructive",
      })
    }
  }

  const title = isSchedule
    ? "Edit repeating invoice"
    : isQuote
    ? existingQuote
      ? `Edit ${quoteNumberLabel(existingQuote.number)}`
      : "New quote"
    : existing
      ? `Edit #${existing.number}`
      : sourceQuote
        ? `Invoice from ${quoteNumberLabel(sourceQuote.number)}`
        : "New invoice"
  const waitingForInvoice =
    loadStatus === "loading" ||
    (isQuote && invoiceId && quotesStatus === "loading") ||
    (!!fromQuoteId && quotesStatus === "loading") ||
    (isSchedule && schedulesStatus === "loading") ||
    (invoiceId && !(isQuote ? existingQuote : existing) && loadStatus === "ready" && !initialized.current)
  const missing =
    (isSchedule && schedulesStatus !== "loading" && !existingSchedule) ||
    (!!invoiceId && loadStatus === "ready" && (isQuote ? quotesStatus !== "loading" && !existingQuote : !existing))
  const backHref = isSchedule
    ? `/app/invoices/repeating?id=${encodeURIComponent(scheduleParam!)}`
    : isQuote
    ? existingQuote
      ? `/app/invoices/quote?id=${encodeURIComponent(existingQuote.id)}`
      : "/app/invoices?filter=quotes"
    : existing
      ? `/app/invoices/view?id=${encodeURIComponent(existing.id)}`
      : sourceQuote
        ? `/app/invoices/quote?id=${encodeURIComponent(sourceQuote.id)}`
        : "/app/invoices"

  return (
    <InvoicesPage
      ready={ready}
      loadingLabel="Loading invoice..."
      title={title}
      backHref={backHref}
      backLabel="Cancel"
      action={
        existing?.status === "sent" || existingQuote?.status === "sent" || isSchedule ? null : (
          <Button
            type="button"
            variant="ghost"
            className="h-11 rounded-full px-3 font-semibold text-emerald-700 dark:text-emerald-400"
            disabled={saving !== null}
            onClick={() => void save("draft")}
          >
            {saving === "draft" ? "Saving..." : "Save draft"}
          </Button>
        )
      }
    >
      {missing ? (
        <div className={cn(cardClass, "text-sm text-muted-foreground")}>
          {isSchedule ? "This repeating invoice wasn't found." : <>This {noun} wasn&apos;t found.</>}
        </div>
      ) : waitingForInvoice ? (
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-28 w-full rounded-[18px]" />
          <Skeleton className="h-64 w-full rounded-[18px]" />
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save("share")
          }}
        >
          {voiceAllowed && !voiceListening && voicePhase !== "thinking" && !voiceFilled ? (
            <button
              type="button"
              onClick={() => startVoice()}
              disabled={saving !== null}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-muted text-base font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <Mic className="size-5" aria-hidden="true" />
              Say the {noun}
            </button>
          ) : null}

          {voiceListening ? (
            <div className="space-y-3 rounded-2xl bg-muted px-4 py-3" aria-live="polite">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden="true" />
                  Listening…
                </div>
                <Button
                  type="button"
                  size="icon"
                  className="size-10 shrink-0 animate-pulse rounded-full bg-[#2FA866] text-white hover:bg-[#2FA866]/90"
                  onClick={speech.done}
                  aria-label="Stop and fill in"
                >
                  <Square className="fill-current" />
                </Button>
              </div>
              <p className="text-base text-foreground">
                {speech.transcript || (
                  <span className="text-muted-foreground">
                    {isQuote
                      ? "Say it like \u201cQuote Jenna 450 for a full bathroom clean, good for 30 days.\u201d"
                      : "Say it like \u201cInvoice Jenna 120 for a cut and color and 40 for a gloss, due Friday.\u201d"}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">Tap the green button or pause when you&apos;re done.</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" className="rounded-full" onClick={speech.done} disabled={!speech.transcript}>
                  Done
                </Button>
                <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={speech.cancel}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {voicePhase === "thinking" ? (
            <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground" aria-live="polite">
              Filling in the form…
            </p>
          ) : null}

          {speech.status === "denied" ? (
            <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              The mic is off for 521. Turn on Microphone and Speech Recognition in Settings › 521, or type the {noun} below.
            </p>
          ) : null}
          {speech.status === "error" ? (
            <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              Couldn&apos;t hear that. Tap the mic to try again, or type the {noun} below.
            </p>
          ) : null}

          {voiceHeard && !voiceFilled && !voiceListening ? (
            <p className="px-1 text-sm text-muted-foreground">Heard: &ldquo;{voiceHeard}&rdquo;</p>
          ) : null}

          {voiceFilled ? <VoiceReviewLabel id="voice-invoice-review" /> : null}

          {!voiceFilled
            ? voiceNotes.map((text) => (
                <p key={text} className="px-1 text-sm text-muted-foreground">
                  {text}
                </p>
              ))
            : null}

          <section className={cn(cardClass, "space-y-3")}>
            <label className={fieldLabelClass}>
              {isQuote ? "Quote for" : "Bill to"}
              <input
                className={softInputClass}
                value={clientName}
                onChange={(event) => {
                  setClientName(event.target.value)
                  // Renaming away from the picked client unlinks it.
                  const picked = savedClients.find((c) => c.id === clientId)
                  if (picked && ![picked.nameKey, ...picked.aliases].includes(clientKey(event.target.value))) {
                    setClientId(null)
                    // Their details came with the pick, so they go with it
                    // (anything typed over them stays).
                    if (picked.email && clientEmail === picked.email) setClientEmail("")
                    if (picked.phone && clientPhone === picked.phone) setClientPhone("")
                    if (picked.address && clientAddress === picked.address) setClientAddress("")
                  }
                }}
                placeholder="Client or business name"
                maxLength={80}
                autoComplete="organization"
              />
            </label>
            {clientSuggestions.length > 0 && !(existing && clientId) ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{clientName.trim() ? "Clients:" : "Recent:"}</span>
                {clientSuggestions.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => pickClient(client)}
                    className="h-8 rounded-full border border-card-border bg-card px-3 text-sm text-foreground hover:bg-muted"
                  >
                    {client.name}
                  </button>
                ))}
              </div>
            ) : null}
            {clientName.trim() ? (
              <p className="text-xs text-muted-foreground">
                {clientId || nameMatchesSavedClient
                  ? "Saved client — their details stay on file."
                  : `New client — saved to your clients with this ${noun}.`}
              </p>
            ) : null}
            {showErrors && errors.client ? <p className="text-sm text-destructive">{errors.client}</p> : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={fieldLabelClass}>
                Client email
                <input
                  type="email"
                  className={softInputClass}
                  value={clientEmail}
                  onChange={(event) => setClientEmail(event.target.value)}
                  placeholder={`For sending the ${noun}`}
                  maxLength={254}
                  autoComplete="off"
                  inputMode="email"
                />
              </label>
              <label className={fieldLabelClass}>
                Client phone
                <input
                  type="tel"
                  className={softInputClass}
                  value={clientPhone}
                  onChange={(event) => setClientPhone(event.target.value)}
                  placeholder="Optional, for texting it"
                  maxLength={40}
                  autoComplete="off"
                />
              </label>
            </div>
            {showErrors && errors.email ? <p className="text-sm text-destructive">{errors.email}</p> : null}
            <label className={fieldLabelClass}>
              Client address
              <Textarea
                rows={2}
                value={clientAddress}
                onChange={(event) => setClientAddress(event.target.value)}
                maxLength={300}
                placeholder="Optional — business clients often need it"
                className="resize-none rounded-xl border-0 bg-muted text-[15px] text-foreground shadow-none"
              />
            </label>
          </section>

          <section className={cn(cardClass, "space-y-3.5")}>
            <h2 className="text-sm font-semibold text-muted-foreground">What it&apos;s for</h2>
            {lines.map((line, index) => (
              <div key={line.key} className="space-y-2 border-b border-border pb-3.5">
                <div className="flex items-end gap-2">
                  <label className={cn(fieldLabelClass, "flex-1")}>
                    Description
                    <input
                      className={softInputClass}
                      value={line.description}
                      onChange={(event) => updateLine(line.key, { description: event.target.value })}
                      placeholder="e.g. Logo design"
                      maxLength={200}
                    />
                  </label>
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`Remove line ${index + 1}`}
                      onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                      className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <label className={cn(fieldLabelClass, "w-[72px] shrink-0")}>
                    Qty
                    <input
                      className={cn(softInputClass, "tabular-nums")}
                      value={line.quantity}
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      inputMode="decimal"
                      placeholder="1"
                      aria-label={`Quantity, line ${index + 1}`}
                    />
                  </label>
                  <label className={cn(fieldLabelClass, "min-w-0 flex-1")}>
                    Rate
                    <input
                      className={cn(softInputClass, "tabular-nums")}
                      value={line.rate}
                      onChange={(event) => updateLine(line.key, { rate: event.target.value })}
                      onBlur={() => {
                        const value = parseAmount(line.rate)
                        if (value !== null) updateLine(line.key, { rate: value.toFixed(2) })
                      }}
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-label={`Rate, line ${index + 1}`}
                    />
                  </label>
                  <label className={cn(fieldLabelClass, "min-w-0 flex-1")}>
                    Type
                    <select
                      className={softInputClass}
                      value={line.category}
                      onChange={(event) => updateLine(line.key, { category: event.target.value as IncomeCategory })}
                    >
                      {CATEGORY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {parsedLines[index].value !== null && parsedLines[index].quantityValue !== 1 ? (
                  <p className="text-right text-sm tabular-nums text-muted-foreground">
                    {parsedLines[index].quantityValue} × {formatInvoiceMoney(parsedLines[index].rateValue ?? 0)} ={" "}
                    <span className="font-semibold text-foreground">{formatInvoiceMoney(parsedLines[index].value ?? 0)}</span>
                  </p>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLines((current) => [...current, newLine(current[current.length - 1]?.category)])}
              disabled={lines.length >= 50}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-input font-semibold text-emerald-700 hover:bg-muted dark:text-emerald-400"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add a line
            </button>
            {showErrors && errors.lines ? <p className="text-sm text-destructive">{errors.lines}</p> : null}
            <div className="flex items-baseline justify-between pt-1">
              <span className="font-semibold text-foreground">Total</span>
              <span className="text-2xl font-bold tracking-tight tabular-nums text-foreground">
                {formatInvoiceMoney(total)}
              </span>
            </div>
          </section>

          <section className={cn(cardClass, "space-y-3")}>
            {isSchedule ? (
              <p className="text-sm text-muted-foreground">Each invoice is dated the day it&apos;s made. Its due date follows these terms:</p>
            ) : (
            <label className={fieldLabelClass}>
              {isQuote ? "Quote date" : "Invoice date"}
              <input
                type="date"
                className={softInputClass}
                value={issueDate}
                onChange={(event) => {
                  const next = event.target.value
                  if (!next) return
                  // Keep the chosen terms (or how long a quote is good for) when the start date moves.
                  if (isQuote) setDueDate(selectedValidDays ? addQuoteDays(next, selectedValidDays) : dueDate)
                  else setDueDate(selectedTerms ? dueDateForTerms(next, selectedTerms) : dueDate)
                  setIssueDate(next)
                }}
              />
            </label>
            )}
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-sm font-medium text-muted-foreground">{isQuote ? "Good for" : <>When it&apos;s due</>}</legend>
              <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-muted p-1">
                {isQuote
                  ? QUOTE_VALID_DAYS.map((days) => {
                      const active = selectedValidDays === days
                      return (
                        <button
                          key={days}
                          type="button"
                          aria-pressed={active}
                          aria-label={`Valid for ${days} days`}
                          onClick={() => setDueDate(addQuoteDays(issueDate, days))}
                          className={cn(
                            "h-10 rounded-[10px] text-sm transition-colors",
                            active ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground"
                          )}
                        >
                          {days} days
                        </button>
                      )
                    })
                  : TERMS.map((terms) => {
                  const active = selectedTerms === terms
                  return (
                    <button
                      key={terms}
                      type="button"
                      aria-pressed={active}
                      aria-label={INVOICE_TERMS_LABELS[terms]}
                      onClick={() => setDueDate(dueDateForTerms(issueDate, terms))}
                      className={cn(
                        "h-10 rounded-[10px] text-sm transition-colors",
                        active ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground"
                      )}
                    >
                      {TERMS_SHORT[terms]}
                    </button>
                  )
                })}
              </div>
              <label className="flex items-center justify-between gap-3 pt-1 text-sm text-muted-foreground">
                <span>
                  {isQuote ? "Valid until" : "Due"} {formatInvoiceDate(dueDate)}
                </span>
                <input
                  type="date"
                  aria-label={isQuote ? "Valid until" : "Due date"}
                  className="h-9 rounded-lg border-0 bg-transparent px-1 text-sm font-medium text-emerald-700 dark:text-emerald-400"
                  value={dueDate}
                  min={issueDate}
                  onChange={(event) => event.target.value && setDueDate(event.target.value)}
                />
              </label>
              {showErrors && errors.dates ? <p className="text-sm text-destructive">{errors.dates}</p> : null}
            </fieldset>
          </section>

          {repeating ? null : (
          <section className={cn(cardClass, "space-y-3")}>
            {depositLocked && existing?.deposit ? (
              <p className="text-sm text-muted-foreground">
                Deposit of <span className="tabular-nums">{formatInvoiceMoney(existing.deposit.amount)}</span>{" "}
                {existing.deposit.waivedAt ? "was waived" : "is paid"} — it can&apos;t be changed.
              </p>
            ) : (
              <>
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-sm font-medium text-foreground">Ask for a deposit</span>
                    <span className="block text-xs text-muted-foreground">
                      {isQuote ? "Asked for up front once it's an invoice." : "Paid up front; the rest is due by the due date."}
                    </span>
                  </span>
                  <Switch checked={depositOn} onCheckedChange={setDepositOn} aria-label="Ask for a deposit" />
                </label>
                {depositOn ? (
                  <>
                    <div className="flex gap-2.5">
                      <label className={cn(fieldLabelClass, "flex-1")}>
                        Deposit
                        <input
                          type="text"
                          inputMode="decimal"
                          className={cn(softInputClass, "tabular-nums")}
                          value={depositText}
                          placeholder={depositMode === "percent" ? "25" : "100.00"}
                          onChange={(event) => setDepositText(event.target.value)}
                        />
                      </label>
                      <div className="grid w-[104px] shrink-0 grid-cols-2 gap-1 self-end rounded-[14px] bg-muted p-1">
                        {(["fixed", "percent"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={depositMode === mode}
                            aria-label={mode === "fixed" ? "Dollar amount" : "Percent of total"}
                            onClick={() => setDepositMode(mode)}
                            className={cn(
                              "h-10 rounded-[10px] text-sm transition-colors",
                              depositMode === mode ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground"
                            )}
                          >
                            {mode === "fixed" ? "$" : "%"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {isQuote ? (
                      depositAmount !== null && depositMode === "percent" ? (
                        <p className="text-sm tabular-nums text-muted-foreground">{formatInvoiceMoney(depositAmount)}</p>
                      ) : null
                    ) : (
                    <label className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                      <span>
                        {depositAmount !== null && depositMode === "percent" ? (
                          <span className="tabular-nums">{formatInvoiceMoney(depositAmount)} · </span>
                        ) : null}
                        Due {formatInvoiceDate(depositDueDate)}
                      </span>
                      <input
                        type="date"
                        aria-label="Deposit due date"
                        className="h-9 rounded-lg border-0 bg-transparent px-1 text-sm font-medium text-emerald-700 dark:text-emerald-400"
                        value={depositDueDate}
                        min={issueDate}
                        max={dueDate}
                        onChange={(event) => event.target.value && setDepositDueDate(event.target.value)}
                      />
                    </label>
                    )}
                    {showErrors && depositError ? <p className="text-sm text-destructive">{depositError}</p> : null}
                  </>
                ) : null}
              </>
            )}
          </section>
          )}

          <section className={cn(cardClass, "space-y-1.5")}>
            <label className={fieldLabelClass}>
              Note to customer
              <Textarea
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={1000}
                placeholder={isQuote ? "What's included, timing, anything they should know" : "How to pay you, e.g. Venmo @yourname"}
                className="resize-none rounded-xl border-0 bg-muted text-[15px] text-foreground shadow-none"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              {isQuote
                ? "Shown on the quote. How to pay goes on the invoice."
                : settings?.defaultNote
                  ? "From your default note in Invoice settings"
                  : "Set a default note in Invoice settings"}
            </p>
          </section>

          <section className={cn(cardClass, "space-y-1.5")}>
            <label className={fieldLabelClass}>
              Policies &amp; terms
              <Textarea
                rows={3}
                value={policies}
                onChange={(event) => setPolicies(event.target.value)}
                maxLength={2000}
                placeholder="e.g. Deposits are non-refundable. Reschedule with 48 hours' notice."
                className="resize-none rounded-xl border-0 bg-muted text-[15px] text-foreground shadow-none"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              {settings?.defaultPolicies
                ? `From your default policies in Invoice settings. Changes here apply to this ${noun} only.`
                : "Set default policies in Invoice settings to add them to every new invoice."}
            </p>
          </section>

          {!isQuote && !existing ? (
            <section className={cn(cardClass, "space-y-3")}>
              {isSchedule ? (
                <h2 className="text-sm font-semibold text-muted-foreground">How it repeats</h2>
              ) : (
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block text-sm font-medium text-foreground">Repeat this invoice</span>
                    <span className="block text-xs text-muted-foreground">
                      {repeatOn ? "This is the first one; 521 makes the rest on their dates." : "For clients you bill the same amount on a schedule."}
                    </span>
                  </span>
                  <Switch checked={repeatOn} onCheckedChange={setRepeatOn} aria-label="Repeat this invoice" />
                </label>
              )}
              {repeating ? (
                <>
                  <RepeatOptions
                    draft={repeat}
                    onChange={setRepeat}
                    firstDate={existingSchedule ? existingSchedule.anchorDate : issueDate}
                    clientHasEmail={!!clientEmail.trim()}
                    nextDate={scheduleNextDate}
                    error={showErrors ? repeatError : null}
                  />
                  {!isSchedule && depositOn ? (
                    <p className="text-xs text-muted-foreground">Repeating invoices don&apos;t ask for a deposit, so this one won&apos;t either.</p>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          {voiceFilled && !voiceBusy ? (
            <VoiceReviewFooter
              heard={voiceHeard}
              ask={voiceAsk}
              onVoice={() => startVoice(voiceAsk)}
              onUndo={undoVoiceFill}
              disabled={saving !== null}
            >
              {voiceQuestions.map((question) => (
                <div key={question.id} id={`voice-question-${question.id}`} className="space-y-2 rounded-2xl bg-muted px-4 py-3">
                  <p className="text-sm font-medium text-foreground">{question.prompt}</p>
                  <div className="flex flex-wrap gap-2">
                    {question.options.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => answerVoiceQuestion(question, { kind: "saved", client: option })}
                        className="rounded-full bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
                      >
                        {option.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => answerVoiceQuestion(question, { kind: "new", name: question.spokenName })}
                      className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary"
                    >
                      New client: {question.spokenName}
                    </button>
                  </div>
                </div>
              ))}
              {voiceNotes.map((text) => (
                <p key={text} className="px-1 text-sm text-muted-foreground">
                  {text}
                </p>
              ))}
            </VoiceReviewFooter>
          ) : null}

          <div className="flex gap-2.5 pt-1">
            <Button
              type="submit"
              disabled={saving !== null}
              className="h-[52px] flex-1 rounded-full text-base font-semibold"
            >
              {saving === "share" ? "Saving..." : existing || existingQuote || isSchedule ? "Save" : "Review & send"}
            </Button>
          </div>
        </form>
      )}
    </InvoicesPage>
  )
}
