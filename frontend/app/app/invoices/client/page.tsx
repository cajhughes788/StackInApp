"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Mail, MessageSquare, Mic, Phone, Plus, Square, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  InvoiceRow,
  InvoicesPage,
  QuoteRow,
  ScheduleRow,
  cardClass,
  localToday,
  useInvoicesWorkspace,
  useQueryParam,
} from "@/components/invoices/invoice-ui"
import { getClientDetail, mergeClients } from "@/lib/api/clientsApi"
import { createClientInBackground, updateClientInBackground } from "@/lib/domain/clientService"
import { currentYear, useClientsStore } from "@/lib/stores/useClientsStore"
import { useWorkspaceQuotes } from "@/lib/stores/useQuotesStore"
import { useWorkspaceInvoiceSchedules } from "@/lib/stores/useInvoiceSchedulesStore"
import { cn } from "@/lib/utils"
import { useSpeechCapture } from "@/hooks/useSpeechCapture"
import { parseVoiceClient, wakeVoiceEntry } from "@/lib/api/voiceEntryApi"
import { appendNote, datedNote } from "@/lib/voiceClientFill"
import { buildClientRows, clientKey } from "@shared/clients"
import { formatInvoiceDate, formatInvoiceMoney } from "@shared/invoiceDisplay"
import type { ClientPayment } from "@shared/schemas/client"

// One client: contact actions, totals (invoices and other payments), notes,
// their payments outside invoices and every invoice, newest first.
// ?id= a saved client; ?name= invoices under a name that matches no client.
export default function InvoiceClientPageRoute() {
  return (
    <Suspense fallback={null}>
      <InvoiceClientPage />
    </Suspense>
  )
}

function InvoiceClientPage() {
  const router = useRouter()
  const { ready, workspaceId, invoices, loadStatus } = useInvoicesWorkspace()
  const id = useQueryParam("id")
  const name = useQueryParam("name") ?? ""
  const today = localToday()
  const entry = useClientsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId] : undefined))
  const load = useClientsStore((state) => state.load)
  const upsert = useClientsStore((state) => state.upsert)
  const remove = useClientsStore((state) => state.remove)

  const [payments, setPayments] = useState<ClientPayment[] | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "" })
  const [notes, setNotes] = useState("")
  const [mergeTarget, setMergeTarget] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // "Say a note": what's said goes under the notes with today's date. It
  // isn't saved until Save notes is tapped; X takes it back out.
  const [notePhase, setNotePhase] = useState<"idle" | "thinking">("idle")
  const [noteHeard, setNoteHeard] = useState("")
  const [noteMessage, setNoteMessage] = useState<string | null>(null)
  const notesBeforeVoice = useRef<string | null>(null)
  const noteRunRef = useRef(0)
  async function handleNoteTranscript(transcript: string) {
    const run = ++noteRunRef.current
    setNotePhase("thinking")
    setNoteHeard(transcript)
    setNoteMessage(null)
    try {
      const result = await parseVoiceClient({ kind: "client", mode: "note", transcript })
      if (run !== noteRunRef.current) return
      if (!result.isClient || !result.notes) {
        setNoteMessage("Didn't catch a note in that. Try again.")
        return
      }
      if (notesBeforeVoice.current === null) notesBeforeVoice.current = notes
      setNotes((current) => appendNote(current, datedNote(localToday(), result.notes as string)))
    } catch (err) {
      if (run !== noteRunRef.current) return
      const limited = (err as { status?: number })?.status === 429
      setNoteMessage(limited && err instanceof Error ? err.message : "Couldn't add that just now. Try again or type it.")
    } finally {
      if (run === noteRunRef.current) setNotePhase("idle")
    }
  }
  const noteSpeech = useSpeechCapture((transcript) => void handleNoteTranscript(transcript))
  function startNote() {
    wakeVoiceEntry()
    setNoteMessage(null)
    noteSpeech.resetStatus()
    void noteSpeech.start(["note", "next time", "allergic", "prefers"])
  }
  function undoVoiceNote() {
    if (notesBeforeVoice.current !== null) setNotes(notesBeforeVoice.current)
    notesBeforeVoice.current = null
    setNoteHeard("")
    setNoteMessage(null)
  }
  const noteListening = noteSpeech.status === "listening"

  useEffect(() => {
    if (workspaceId) void load(workspaceId).catch(() => {})
  }, [load, workspaceId])

  const rows = useMemo(
    () => buildClientRows(entry?.clients ?? [], entry?.payments ?? {}, invoices, today, { includeArchived: true }),
    [entry?.clients, entry?.payments, invoices, today]
  )
  const row = useMemo(
    () =>
      id
        ? rows.find((r) => r.client?.id === id) ?? null
        : rows.find((r) => !r.client && clientKey(r.name) === clientKey(name)) ??
          rows.find((r) => r.client && clientKey(r.name) === clientKey(name)) ??
          null,
    [rows, id, name]
  )
  const client = row?.client ?? null
  // Their quotes: linked to the saved client, or by name before one is saved.
  const { quotes } = useWorkspaceQuotes(workspaceId)
  const { schedules } = useWorkspaceInvoiceSchedules(workspaceId)
  // Their repeating invoices that are still going.
  const clientSchedules = useMemo(
    () =>
      row
        ? schedules.filter(
            (schedule) =>
              schedule.status !== "ended" &&
              (client ? schedule.clientId === client.id : clientKey(schedule.clientName) === clientKey(row.name))
          )
        : [],
    [client, schedules, row]
  )
  const clientQuotes = useMemo(
    () =>
      row
        ? quotes.filter((quote) => (client ? quote.clientId === client.id : clientKey(quote.clientName) === clientKey(row.name)))
        : [],
    [client, quotes, row]
  )

  const loadPayments = useCallback(async () => {
    if (!workspaceId || !client) return
    try {
      const detail = await getClientDetail(workspaceId, client.id, currentYear())
      setPayments(detail.payments)
    } catch {
      setPayments([])
    }
  }, [workspaceId, client?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadPayments()
  }, [loadPayments])

  useEffect(() => {
    if (!client) return
    setNotes(client.notes)
    setForm({ name: client.name, email: client.email ?? "", phone: client.phone ?? "", address: client.address ?? "" })
  }, [client?.id, client?.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label)
    setError(null)
    try {
      await task()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setBusy(null)
    }
  }

  // Shown at once and saved in the background (clientService.ts).
  const saveDetails = () => {
    if (!workspaceId || !client) return
    if (!form.name.trim()) {
      setError("What's their name?")
      return
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError("That email doesn't look right.")
      return
    }
    setError(null)
    updateClientInBackground(
      workspaceId,
      client,
      {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
      },
      "Couldn't save the details"
    )
    setEditing(false)
  }

  const saveNotes = () => {
    if (!workspaceId || !client) return
    updateClientInBackground(workspaceId, client, { notes: notes.trim() }, "Couldn't save the notes")
    notesBeforeVoice.current = null
    setNoteHeard("")
  }

  const setArchived = (archived: boolean) => {
    if (!workspaceId || !client) return
    updateClientInBackground(workspaceId, client, { archived }, archived ? "Couldn't archive" : "Couldn't restore")
  }

  const merge = () =>
    run("merge", async () => {
      if (!workspaceId || !client || !mergeTarget) return
      const kept = await mergeClients(workspaceId, client.id, mergeTarget)
      remove(workspaceId, client.id)
      upsert(workspaceId, kept)
      await load(workspaceId, { force: true })
      router.replace(`/app/invoices/client?id=${encodeURIComponent(kept.id)}`)
    })

  const saveAsClient = () => {
    if (!workspaceId || !row) return
    const latest = row.invoices[0]
    const result = createClientInBackground(workspaceId, {
      name: row.name,
      email: latest?.clientEmail ?? null,
      phone: latest?.clientPhone ?? null,
      address: latest?.clientAddress ?? null,
    })
    if ("error" in result) {
      setError(result.error)
      return
    }
    router.replace(`/app/invoices/client?id=${encodeURIComponent(result.client.id)}`)
  }

  const otherClients = (entry?.clients ?? [])
    .filter((c) => c.id !== client?.id && !c.archived)
    .sort((a, b) => a.name.localeCompare(b.name))
  const phoneDigits = client?.phone?.replace(/[^\d+]/g, "") ?? ""
  const stillLoading = !row && (loadStatus === "loading" || !entry || entry.status === "loading")

  return (
    <InvoicesPage
      ready={ready}
      loadingLabel="Loading client..."
      title={row?.name ?? name}
      backHref="/app/clients"
      backLabel="Back to clients"
    >
      {!row ? (
        stillLoading ? (
          <div className="space-y-3" aria-hidden="true">
            <Skeleton className="h-28 w-full rounded-[18px]" />
            <Skeleton className="h-64 w-full rounded-[18px]" />
          </div>
        ) : (
          <div className={cn(cardClass, "text-sm text-muted-foreground")}>
            Client not found.{" "}
            <Link href="/app/clients" className="font-medium text-foreground underline">
              Back to clients
            </Link>
          </div>
        )
      ) : (
        <>
          {client?.archived ? (
            <div className={cn(cardClass, "flex items-center justify-between gap-3 text-sm")}>
              <span className="text-muted-foreground">Archived — hidden from your client list.</span>
              <Button size="sm" variant="outline" onClick={() => setArchived(false)} disabled={busy !== null}>
                Restore
              </Button>
            </div>
          ) : null}

          {client && (client.phone || client.email) ? (
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Call", href: phoneDigits ? `tel:${phoneDigits}` : null, icon: Phone },
                { label: "Text", href: phoneDigits ? `sms:${phoneDigits}` : null, icon: MessageSquare },
                { label: "Email", href: client.email ? `mailto:${client.email}` : null, icon: Mail },
              ].map((action) =>
                action.href ? (
                  <a
                    key={action.label}
                    href={action.href}
                    className="flex h-11 items-center justify-center gap-2 rounded-full border border-card-border bg-card text-sm font-semibold text-foreground hover:bg-muted"
                  >
                    <action.icon className="size-4" aria-hidden="true" />
                    {action.label}
                  </a>
                ) : (
                  <span
                    key={action.label}
                    aria-disabled="true"
                    className="flex h-11 items-center justify-center gap-2 rounded-full border border-dashed border-card-border text-sm text-muted-foreground"
                  >
                    <action.icon className="size-4" aria-hidden="true" />
                    {action.label}
                  </span>
                )
              )}
            </div>
          ) : null}

          <section className={cn(cardClass, "grid grid-cols-2 gap-3")}>
            <div>
              <div className="text-sm text-muted-foreground">This year</div>
              <div className="text-2xl font-bold tracking-tight tabular-nums text-foreground">
                {formatInvoiceMoney(row.thisYear)}
              </div>
              <div className="text-sm text-muted-foreground">{formatInvoiceMoney(row.lifetime)} all time</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Open</div>
              <div className="text-2xl font-bold tracking-tight tabular-nums text-foreground">
                {formatInvoiceMoney(row.open)}
              </div>
              {row.overdue > 0 ? (
                <div className="text-sm font-semibold text-red-700 dark:text-red-400">
                  {formatInvoiceMoney(row.overdue)} overdue
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Nothing overdue</div>
              )}
            </div>
            <div className="col-span-2 border-t border-border pt-2 text-sm text-muted-foreground">
              Invoices {formatInvoiceMoney(row.invoiceEarned)} · Other payments {formatInvoiceMoney(row.otherPayments)}
            </div>
          </section>

          {error ? <p className="px-1 text-sm text-destructive">{error}</p> : null}

          {!client ? (
            <div className={cn(cardClass, "flex items-center justify-between gap-3 text-sm")}>
              <span className="text-muted-foreground">Save {row.name} as a client to keep their details and notes.</span>
              <Button size="sm" onClick={saveAsClient} disabled={busy !== null}>
                Save as client
              </Button>
            </div>
          ) : (
            <>
              <section className={cn(cardClass, "space-y-3")}>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">Details</h2>
                  {!editing ? (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                  ) : null}
                </div>
                {editing ? (
                  <div className="space-y-2">
                    <Input aria-label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    <Input aria-label="Email" placeholder="Email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    <Input aria-label="Phone" placeholder="Phone" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    <Textarea aria-label="Address" placeholder="Address" rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveDetails} disabled={busy !== null || !form.name.trim()}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <dl className="space-y-1 text-sm">
                    {[
                      ["Email", client.email],
                      ["Phone", client.phone],
                      ["Address", client.address],
                    ].map(([label, value]) => (
                      <div key={label} className="flex gap-3">
                        <dt className="w-16 shrink-0 text-muted-foreground">{label}</dt>
                        <dd className="min-w-0 whitespace-pre-line break-words text-foreground">{value || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>

              <section className={cn(cardClass, "space-y-2")}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">Notes</h2>
                  {noteSpeech.supported ? (
                    noteListening ? (
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 animate-pulse rounded-full bg-[#2FA866] text-white hover:bg-[#2FA866]/90"
                        onClick={noteSpeech.done}
                        aria-label="Stop and add the note"
                      >
                        <Square className="size-3.5 fill-current" /> Done
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-full"
                        onClick={startNote}
                        disabled={notePhase === "thinking"}
                      >
                        <Mic className="size-3.5" /> Say a note
                      </Button>
                    )
                  ) : null}
                </div>
                {noteListening ? (
                  <p className="rounded-xl bg-muted px-3 py-2 text-sm text-foreground" aria-live="polite">
                    {noteSpeech.transcript || <span className="text-muted-foreground">Listening… say it like &ldquo;She wants to go lighter next time.&rdquo;</span>}
                  </p>
                ) : null}
                {notePhase === "thinking" ? <p className="text-sm text-muted-foreground">Adding the note…</p> : null}
                {noteSpeech.status === "denied" ? (
                  <p className="text-sm text-muted-foreground">The mic is off for 521. Turn on Microphone and Speech Recognition in Settings › 521.</p>
                ) : null}
                {noteSpeech.status === "error" ? <p className="text-sm text-muted-foreground">Couldn&apos;t hear that. Try again.</p> : null}
                {noteMessage ? <p className="text-sm text-muted-foreground">{noteMessage}</p> : null}
                {noteHeard && notePhase === "idle" && !noteListening && notesBeforeVoice.current !== null ? (
                  <div className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2">
                    <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                      Heard: &ldquo;{noteHeard}&rdquo; — added below. Tap Save notes to keep it.
                    </p>
                    <button
                      type="button"
                      onClick={undoVoiceNote}
                      aria-label="Take the spoken note back out"
                      className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-card"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : null}
                <Textarea
                  aria-label="Notes"
                  placeholder="Preferences, allergies, the usual…"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                {notes.trim() !== client.notes.trim() ? (
                  <Button size="sm" onClick={saveNotes} disabled={busy !== null}>
                    Save notes
                  </Button>
                ) : null}
              </section>
            </>
          )}

          {client ? (
            <section className="space-y-2">
              <h2 className="px-1 text-sm font-semibold text-muted-foreground">Other payments</h2>
              {payments === null ? (
                <Skeleton className="h-16 w-full rounded-[18px]" />
              ) : payments.length === 0 ? (
                <div className={cn(cardClass, "text-sm text-muted-foreground")}>
                  None yet. Venmo payments and &quot;Other income&quot; under {client.name}&apos;s name show up here.
                </div>
              ) : (
                <ul className="overflow-hidden rounded-[18px] border border-card-border bg-card">
                  {payments.map((payment) => (
                    <li
                      key={`${payment.entryId}-${payment.label}`}
                      className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-0"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground">{formatInvoiceDate(payment.date)}</div>
                        <div className="truncate text-xs text-muted-foreground">{payment.label}</div>
                      </div>
                      <div className="shrink-0 font-semibold tabular-nums text-foreground">
                        {formatInvoiceMoney(payment.amount)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <section className="space-y-2">
            <h2 className="px-1 text-sm font-semibold text-muted-foreground">
              {row.invoices.length} invoice{row.invoices.length === 1 ? "" : "s"}
            </h2>
            {row.invoices.length > 0 ? (
              <ul className="overflow-hidden rounded-[18px] border border-card-border bg-card">
                {row.invoices.map((invoice) => (
                  <InvoiceRow key={invoice.id} invoice={invoice} title={formatInvoiceDate(invoice.issueDate)} today={today} />
                ))}
              </ul>
            ) : null}
          </section>

          {clientSchedules.length > 0 ? (
            <section className="space-y-2">
              <h2 className="px-1 text-sm font-semibold text-muted-foreground">Repeating</h2>
              <ul className="overflow-hidden rounded-[18px] border border-card-border bg-card">
                {clientSchedules.map((schedule) => (
                  <ScheduleRow key={schedule.id} schedule={schedule} />
                ))}
              </ul>
            </section>
          ) : null}

          {clientQuotes.length > 0 ? (
            <section className="space-y-2">
              <h2 className="px-1 text-sm font-semibold text-muted-foreground">
                {clientQuotes.length} quote{clientQuotes.length === 1 ? "" : "s"}
              </h2>
              <ul className="overflow-hidden rounded-[18px] border border-card-border bg-card">
                {clientQuotes.map((quote) => (
                  <QuoteRow key={quote.id} quote={quote} title={formatInvoiceDate(quote.issueDate)} today={today} />
                ))}
              </ul>
            </section>
          ) : null}

          {client && otherClients.length > 0 ? (
            <section className={cn(cardClass, "space-y-2")}>
              <h2 className="text-sm font-semibold text-foreground">Duplicate?</h2>
              <p className="text-xs text-muted-foreground">
                Merge {client.name} into another client. Their invoices move over and this name keeps matching
                payments.
              </p>
              <div className="flex gap-2">
                <Select value={mergeTarget} onValueChange={setMergeTarget}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Merge into…" />
                  </SelectTrigger>
                  <SelectContent>
                    {otherClients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={merge} disabled={!mergeTarget || busy !== null}>
                  {busy === "merge" ? "Merging..." : "Merge"}
                </Button>
              </div>
            </section>
          ) : null}

          {client && !client.archived ? (
            <div className="px-1">
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setArchived(true)} disabled={busy !== null}>
                Archive client
              </Button>
            </div>
          ) : null}
        </>
      )}

      {row ? (
        <div className="sticky bottom-[calc(1rem+var(--safe-area-inset-bottom))] flex gap-2.5 pt-2">
          <Link
            href={`/app/invoices/edit?client=${encodeURIComponent(row.name)}${client ? `&clientId=${encodeURIComponent(client.id)}` : ""}`}
            className="flex h-[52px] min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground shadow-sm"
          >
            <Plus className="size-5 shrink-0" aria-hidden="true" />
            <span className="truncate">New invoice for {row.name}</span>
          </Link>
          <Link
            href={`/app/invoices/edit?kind=quote&client=${encodeURIComponent(row.name)}${client ? `&clientId=${encodeURIComponent(client.id)}` : ""}`}
            className="flex h-[52px] shrink-0 items-center justify-center gap-2 rounded-full border border-card-border bg-card px-5 text-base font-semibold text-foreground shadow-sm"
          >
            <Plus className="size-5 shrink-0" aria-hidden="true" />
            Quote
          </Link>
        </div>
      ) : null}
    </InvoicesPage>
  )
}
