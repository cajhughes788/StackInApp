"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, X } from "lucide-react"

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
import { createInvoiceInBackground, currentInvoiceId, editInvoiceInBackground } from "@/lib/domain/invoiceService"
import { useClientsStore } from "@/lib/stores/useClientsStore"
import { buildClientKeyIndex } from "@shared/clients"
import type { ClientType } from "@shared/schemas/client"
import { cn } from "@/lib/utils"
import { dueDateForTerms, formatInvoiceDate, formatInvoiceMoney, INVOICE_TERMS_LABELS } from "@shared/invoiceDisplay"
import type { IncomeCategory } from "@shared/schemas/entry"
import { invoiceDepositOutstanding } from "@shared/invoicePayments"
import type { InvoiceTerms, InvoiceType } from "@shared/schemas/invoice"

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
  const invoiceId = useQueryParam("id")
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
  const existing = invoiceId ? invoices.find((invoice) => invoice.id === currentInvoiceId(invoiceId)) ?? null : null
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
  const [showErrors, setShowErrors] = useState(false)
  const initialized = useRef(false)

  // Fill the form once: from the invoice being edited, or from settings.
  useEffect(() => {
    if (initialized.current || loadStatus !== "ready") return
    if (invoiceId && !existing) return
    initialized.current = true
    if (existing) {
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
      const prefilled = prefillClientId ? savedClients.find((c) => c.id === prefillClientId) : undefined
      if (prefilled) {
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
  }, [existing, invoiceId, invoices, loadStatus, prefillClient, prefillClientId, savedClients, settings])

  // Paid and void invoices can't be edited.
  useEffect(() => {
    if (existing && existing.status !== "draft" && existing.status !== "sent") {
      router.replace(`/app/invoices/view?id=${encodeURIComponent(existing.id)}`)
    }
  }, [existing, router])

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
          : depositDueDate < issueDate || depositDueDate > dueDate
            ? "The deposit has to be due between the invoice date and its due date."
            : null
  const errors = {
    client: !clientName.trim() ? "Who is this invoice for?" : null,
    lines:
      filledLines.length === 0
        ? "Add at least one line."
        : filledLines.some((line) => !line.description.trim() || line.value === null)
          ? "Each line needs a description, a quantity and a rate."
          : null,
    dates: dueDate < issueDate ? "The due date can't be before the invoice date." : null,
    email:
      clientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail.trim()) ? "That email doesn't look right." : null,
  }
  const valid = !errors.client && !errors.lines && !errors.dates && !errors.email && !depositError

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  function save(mode: "draft" | "share") {
    if (!workspaceId) return
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
      const created = createInvoiceInBackground(workspaceId, { ...body, clientMutationId: clientMutationId.current })
      if (mode === "share") {
        // A new invoice lands on its send step.
        router.replace(`/app/invoices/view?id=${encodeURIComponent(created.id)}&share=1`)
      } else {
        router.replace("/app/invoices")
      }
    }
  }

  const title = existing ? `Edit #${existing.number}` : "New invoice"
  const waitingForInvoice = loadStatus === "loading" || (invoiceId && !existing && loadStatus === "ready" && !initialized.current)

  return (
    <InvoicesPage
      ready={ready}
      loadingLabel="Loading invoice..."
      title={title}
      backHref={existing ? `/app/invoices/view?id=${encodeURIComponent(existing.id)}` : "/app/invoices"}
      backLabel="Cancel"
      action={
        existing?.status === "sent" ? null : (
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
      {invoiceId && loadStatus === "ready" && !existing ? (
        <div className={cn(cardClass, "text-sm text-muted-foreground")}>This invoice wasn&apos;t found.</div>
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
          <section className={cn(cardClass, "space-y-3")}>
            <label className={fieldLabelClass}>
              Bill to
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
                  : "New client — saved to your clients with this invoice."}
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
                  placeholder="For sending the invoice"
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
            <label className={fieldLabelClass}>
              Invoice date
              <input
                type="date"
                className={softInputClass}
                value={issueDate}
                onChange={(event) => {
                  const next = event.target.value
                  if (!next) return
                  // Keep the chosen terms when the start date moves.
                  setDueDate(selectedTerms ? dueDateForTerms(next, selectedTerms) : dueDate)
                  setIssueDate(next)
                }}
              />
            </label>
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-sm font-medium text-muted-foreground">When it&apos;s due</legend>
              <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-muted p-1">
                {TERMS.map((terms) => {
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
                <span>Due {formatInvoiceDate(dueDate)}</span>
                <input
                  type="date"
                  aria-label="Due date"
                  className="h-9 rounded-lg border-0 bg-transparent px-1 text-sm font-medium text-emerald-700 dark:text-emerald-400"
                  value={dueDate}
                  min={issueDate}
                  onChange={(event) => event.target.value && setDueDate(event.target.value)}
                />
              </label>
              {showErrors && errors.dates ? <p className="text-sm text-destructive">{errors.dates}</p> : null}
            </fieldset>
          </section>

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
                    <span className="block text-xs text-muted-foreground">Paid up front; the rest is due by the due date.</span>
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
                    {showErrors && depositError ? <p className="text-sm text-destructive">{depositError}</p> : null}
                  </>
                ) : null}
              </>
            )}
          </section>

          <section className={cn(cardClass, "space-y-1.5")}>
            <label className={fieldLabelClass}>
              Note to customer
              <Textarea
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={1000}
                placeholder="How to pay you, e.g. Venmo @yourname"
                className="resize-none rounded-xl border-0 bg-muted text-[15px] text-foreground shadow-none"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              {settings?.defaultNote ? "From your default note in Invoice settings" : "Set a default note in Invoice settings"}
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
                ? "From your default policies in Invoice settings. Changes here apply to this invoice only."
                : "Set default policies in Invoice settings to add them to every new invoice."}
            </p>
          </section>

          <div className="flex gap-2.5 pt-1">
            <Button
              type="submit"
              disabled={saving !== null}
              className="h-[52px] flex-1 rounded-full text-base font-semibold"
            >
              {saving === "share" ? "Saving..." : existing ? "Save" : "Review & send"}
            </Button>
          </div>
        </form>
      )}
    </InvoicesPage>
  )
}
