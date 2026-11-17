"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight, Mic, Plus, Search, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { cardClass } from "@/components/invoices/invoice-ui"
import { createClientInBackground, updateClientInBackground } from "@/lib/domain/clientService"
import { useSpeechCapture } from "@/hooks/useSpeechCapture"
import { listWords, scrollToVoiceReview, VoiceReviewFooter, VoiceReviewLabel, type VoiceAsk } from "@/components/voice-review"
import { parseVoiceClient, wakeVoiceEntry } from "@/lib/api/voiceEntryApi"
import { useVoiceHandoffStore } from "@/lib/stores/useVoiceHandoffStore"
import { appendNote, detailsForExisting, planClientFill, voiceClientCurrentFor, type ClientFillPlan } from "@/lib/voiceClientFill"
import { useInvoicesStore } from "@/lib/stores/useInvoicesStore"
import { useClientsStore } from "@/lib/stores/useClientsStore"
import { cn } from "@/lib/utils"
import { buildClientRows, type ClientRow } from "@shared/clients"
import { formatInvoiceMoney } from "@shared/invoiceDisplay"
import type { InvoiceType } from "@shared/schemas/invoice"

type Sort = "name" | "earned"

export function clientHref(row: Pick<ClientRow, "client" | "name">): string {
  return row.client
    ? `/app/invoices/client?id=${encodeURIComponent(row.client.id)}`
    : `/app/invoices/client?name=${encodeURIComponent(row.name)}`
}

// Saved clients (plus invoice names that match none), with search, sort by
// what they paid this year, and a Repeat badge.
export default function ClientList({
  workspaceId,
  invoices,
  today,
}: {
  workspaceId: string
  invoices: InvoiceType[]
  today: string
}) {
  const router = useRouter()
  const entry = useClientsStore((state) => state.byWorkspaceId[workspaceId])
  const load = useClientsStore((state) => state.load)
  const upsert = useClientsStore((state) => state.upsert)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<Sort>("name")
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [newAddress, setNewAddress] = useState("")
  const [newNotes, setNewNotes] = useState("")
  const [addError, setAddError] = useState<string | null>(null)

  useEffect(() => {
    void load(workspaceId, { force: true }).catch(() => {})
  }, [load, workspaceId])

  const rows = useMemo(
    () => buildClientRows(entry?.clients ?? [], entry?.payments ?? {}, invoices, today),
    [entry?.clients, entry?.payments, invoices, today]
  )
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? rows.filter(
          (row) =>
            row.name.toLowerCase().includes(q) ||
            (row.client?.email ?? "").toLowerCase().includes(q) ||
            (row.client?.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "") || "\u0000")
        )
      : rows
    return sort === "earned" ? [...filtered].sort((a, b) => b.thisYear - a.thisYear) : filtered
  }, [rows, query, sort])

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault()
    if (!newName.trim()) {
      setAddError("What's their name?")
      return
    }
    setAddError(null)
    // Shown at once; saved in the background.
    if (newEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      setAddError("That email doesn't look right.")
      return
    }
    const result = createClientInBackground(workspaceId, {
      name: newName.trim(),
      phone: newPhone.trim() || null,
      email: newEmail.trim() || null,
      address: newAddress.trim() || null,
      ...(newNotes.trim() ? { notes: newNotes.trim() } : {}),
    })
    if ("error" in result) {
      setAddError(result.error)
      return
    }
    resetVoice()
    router.push(`/app/invoices/client?id=${encodeURIComponent(result.client.id)}`)
  }

  /** ------------------------------------------------
   * VOICE — say a new client, check the form, tap Add client. Only the
   * typed-out words go to the server; whether they're already a client is
   * checked here. Nothing is saved by voice.
   * ------------------------------------------------ */
  const [voicePhase, setVoicePhase] = useState<"idle" | "thinking">("idle")
  const [voiceNotes, setVoiceNotes] = useState<string[]>([])
  const [voiceFilled, setVoiceFilled] = useState(false)
  const [voiceHeard, setVoiceHeard] = useState("")
  const [voicePlan, setVoicePlan] = useState<ClientFillPlan | null>(null)
  const voiceRunRef = useRef(0)
  const voiceFixingRef = useRef(false)
  // What the review's voice button asked for ("phone or email"), sent with that fix.
  const voiceAskingRef = useRef<string[]>([])
  const voiceSnapshot = () => ({ name: newName, phone: newPhone, email: newEmail, address: newAddress, notes: newNotes })
  type VoiceSnapshot = ReturnType<typeof voiceSnapshot>
  // The form as it was before voice first filled it, for the note's undo (X).
  const voiceUndoRef = useRef<VoiceSnapshot | null>(null)
  const savedClients = useMemo(() => (entry?.clients ?? []).filter((client) => !client.archived), [entry?.clients])

  function restoreForm(snap: VoiceSnapshot) {
    setNewName(snap.name)
    setNewPhone(snap.phone)
    setNewEmail(snap.email)
    setNewAddress(snap.address)
    setNewNotes(snap.notes)
  }

  async function handleVoiceTranscript(transcript: string) {
    const run = ++voiceRunRef.current
    const fixing = voiceFixingRef.current
    const now = voiceSnapshot()
    setVoicePhase("thinking")
    setVoiceHeard(transcript)
    setVoiceNotes([])
    setAddError(null)
    if (!fixing) {
      setVoiceFilled(false)
      setVoicePlan(null)
    }
    try {
      const result = await parseVoiceClient({
        kind: "client",
        mode: "add",
        transcript,
        ...(fixing
          ? {
              asking: voiceAskingRef.current.length > 0 ? voiceAskingRef.current : undefined,
              current: voiceClientCurrentFor(now),
            }
          : {}),
      })
      if (run !== voiceRunRef.current) return
      const plan = planClientFill(result, { savedClients, fixing, formName: now.name })
      const nothing = !plan.name && !plan.phone && !plan.email && !plan.address && !plan.notes && plan.remove.length === 0
      if (!result.isClient || nothing) {
        setVoiceNotes([
          ...plan.skipped,
          fixing
            ? "Didn't catch a change in that. Try again, like \u201cthe number is 509 555 0124.\u201d"
            : "Didn't catch a client in that. Try again, like \u201cNew client Jenna Morales, 509 555 0142.\u201d",
        ])
        return
      }
      if (!voiceUndoRef.current) voiceUndoRef.current = now
      for (const field of plan.remove) {
        if (field === "phone") setNewPhone("")
        if (field === "email") setNewEmail("")
        if (field === "address") setNewAddress("")
        if (field === "notes") setNewNotes("")
      }
      if (plan.name) setNewName(plan.name)
      if (plan.phone) setNewPhone(plan.phone)
      if (plan.email) setNewEmail(plan.email)
      if (plan.address) setNewAddress(plan.address)
      // A fix adds to the notes; a first fill replaces them.
      if (plan.notes) setNewNotes(fixing && !plan.remove.includes("notes") ? appendNote(now.notes, plan.notes) : plan.notes)
      setVoicePlan(plan)
      setVoiceNotes(plan.skipped)
      setVoiceFilled(true)
      scrollToVoiceReview("voice-client-review")
    } catch (error) {
      if (run !== voiceRunRef.current) return
      console.warn("[VoiceClient] fill failed", error)
      // 429 = today's voice limit (server message says so); anything else is a plain failure.
      const limited = (error as { status?: number })?.status === 429
      setVoiceNotes([limited && error instanceof Error ? error.message : "Couldn't fill in the form just now. Try again or type it in."])
    } finally {
      if (run === voiceRunRef.current) setVoicePhase("idle")
    }
  }
  const speech = useSpeechCapture((transcript) => void handleVoiceTranscript(transcript))

  // Said to Ask 521 on Home ("new client Priya Patel…"): open Add client filled in.
  const voiceHandoff = useVoiceHandoffStore((state) => state.request)
  const takeVoiceHandoff = useVoiceHandoffStore((state) => state.take)
  const clientsReady = !!entry && entry.status !== "loading"
  useEffect(() => {
    if (voiceHandoff?.target !== "client" || !clientsReady || (voiceHandoff.listen && !speech.checked)) return
    const taken = takeVoiceHandoff(["client"], workspaceId)
    if (!taken) return
    setAdding(true)
    voiceFixingRef.current = false
    voiceUndoRef.current = null
    if (taken.listen) {
      setVoiceFilled(false)
      if (speech.supported) startVoice()
      return
    }
    void handleVoiceTranscript(taken.transcript)
    // handleVoiceTranscript reads the latest form each render; readiness is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceHandoff, clientsReady, workspaceId, takeVoiceHandoff, speech.checked])

  /** With the filled-in note showing, the mic fixes what voice filled instead of starting over. */
  function startVoice(ask?: VoiceAsk | null) {
    wakeVoiceEntry()
    setAdding(true)
    setVoiceNotes([])
    voiceFixingRef.current = voiceFilled
    voiceAskingRef.current = voiceFilled && ask ? ask.asking : []
    if (!voiceFilled) {
      voiceUndoRef.current = null
      setVoicePlan(null)
    }
    speech.resetStatus()
    void speech.start(["new client", "at gmail dot com", "dot com", "phone", "email", "address", "note"])
  }

  function resetVoice() {
    voiceRunRef.current += 1
    voiceUndoRef.current = null
    voiceFixingRef.current = false
    setVoicePhase("idle")
    setVoiceFilled(false)
    setVoiceNotes([])
    setVoiceHeard("")
    setVoicePlan(null)
  }

  /** The note's X: puts the form back as it was before voice filled it. */
  function undoVoiceFill() {
    if (voiceUndoRef.current) restoreForm(voiceUndoRef.current)
    resetVoice()
  }

  // Already a client: what "Add these details" would change (blanks only, notes added on).
  const existingClient = voicePlan?.existing ? savedClients.find((client) => client.id === voicePlan.existing?.id) ?? null : null
  const existingUpdate = existingClient
    ? detailsForExisting(existingClient, {
        phone: newPhone.trim() || null,
        email: newEmail.trim() || null,
        address: newAddress.trim() || null,
        notes: newNotes.trim() || null,
      })
    : null

  function addToExisting() {
    if (!existingClient || !existingUpdate || Object.keys(existingUpdate.patch).length === 0) return
    updateClientInBackground(workspaceId, existingClient, existingUpdate.patch, `Couldn't update ${existingClient.name}`)
    router.push(`/app/invoices/client?id=${encodeURIComponent(existingClient.id)}`)
  }

  const voiceListening = speech.status === "listening"
  const voiceBusy = voiceListening || voicePhase === "thinking"
  // The review's voice button asks for whatever the new client still needs.
  const voiceMissing: { word: string; asking: string }[] = []
  if (!newName.trim()) voiceMissing.push({ word: "their name", asking: "name" })
  if (!newPhone.trim() && !newEmail.trim()) voiceMissing.push({ word: "phone or email", asking: "phone or email" })
  const voiceAsk: VoiceAsk | null =
    voiceMissing.length > 0
      ? { label: `Say ${listWords(voiceMissing.map((m) => m.word))}`, asking: voiceMissing.map((m) => m.asking) }
      : null

  // Totals add up invoices too, so a saved clients list waits for them.
  const invoicesLoading = useInvoicesStore((state) => (state.byWorkspaceId[workspaceId]?.status ?? "loading") === "loading")
  const loading = !entry || (entry.status === "loading" && entry.clients.length === 0) || invoicesLoading

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search clients"
            aria-label="Search clients"
            className="h-10 rounded-full pl-9"
          />
        </div>
        <Button type="button" variant="outline" className="h-10 rounded-full" onClick={() => setAdding((v) => !v)}>
          <Plus className="size-4" aria-hidden="true" />
          Add client
        </Button>
        {speech.supported ? (
          voiceListening ? (
            <Button
              type="button"
              size="icon"
              className="size-10 shrink-0 animate-pulse rounded-full bg-[#2FA866] text-white hover:bg-[#2FA866]/90"
              onClick={speech.done}
              aria-label="Stop and fill in"
            >
              <Square className="fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-10 shrink-0 rounded-full"
              onClick={() => startVoice()}
              disabled={voiceBusy}
              aria-label="Say a new client"
            >
              <Mic className="size-4" />
            </Button>
          )
        ) : null}
      </div>

      {voiceListening ? (
        <div className="space-y-3 rounded-2xl bg-muted px-4 py-3" aria-live="polite">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden="true" />
            Listening…
          </div>
          <p className="text-base text-foreground">
            {speech.transcript || (
              <span className="text-muted-foreground">
                Say it like &ldquo;New client Jenna Morales, 509 555 0142, jenna at gmail dot com.&rdquo;
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
          The mic is off for 521. Turn on Microphone and Speech Recognition in Settings › 521, or type the client in.
        </p>
      ) : null}
      {speech.status === "error" ? (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">Couldn&apos;t hear that. Tap the mic to try again.</p>
      ) : null}
      {voiceHeard && !voiceFilled && !voiceListening ? (
        <p className="px-1 text-sm text-muted-foreground">Heard: &ldquo;{voiceHeard}&rdquo;</p>
      ) : null}
      {!voiceFilled
        ? voiceNotes.map((text) => (
            <p key={text} className="px-1 text-sm text-muted-foreground">
              {text}
            </p>
          ))
        : null}

      {adding ? (
        <form onSubmit={handleAdd} className={cn(cardClass, "space-y-3")}>
          {voiceFilled && !voiceBusy && existingClient ? (
            <div className="space-y-2 rounded-2xl bg-muted px-4 py-3">
              <p className="text-sm font-medium text-foreground">{existingClient.name} is already a client.</p>
              {existingUpdate?.conflicts.map((conflict) => (
                <p key={conflict.label} className="text-sm text-muted-foreground">
                  {conflict.label} on file: {conflict.theirs}. You said {conflict.said} (not changed).
                </p>
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                {existingUpdate && Object.keys(existingUpdate.patch).length > 0 ? (
                  <Button type="button" className="rounded-full" onClick={addToExisting}>
                    Add these details to {existingClient.name}
                  </Button>
                ) : null}
                <Button asChild type="button" variant="outline" className="rounded-full">
                  <Link href={`/app/invoices/client?id=${encodeURIComponent(existingClient.id)}`}>Open {existingClient.name}</Link>
                </Button>
              </div>
            </div>
          ) : null}
          {voiceFilled ? <VoiceReviewLabel id="voice-client-review" /> : null}
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" aria-label="Name" autoFocus={!voiceBusy} />
          <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Phone (optional)" aria-label="Phone" inputMode="tel" />
          <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email (optional)" aria-label="Email" inputMode="email" />
          <Textarea
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="Address (optional)"
            aria-label="Address"
            rows={2}
            maxLength={300}
            className="resize-none"
          />
          <Textarea
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder="Notes (optional) — preferences, allergies, the usual…"
            aria-label="Notes"
            rows={2}
            maxLength={2000}
            className="resize-none"
          />
          {voiceFilled && !voiceBusy ? (
            <VoiceReviewFooter heard={voiceHeard} ask={voiceAsk} onVoice={() => startVoice(voiceAsk)} onUndo={undoVoiceFill}>
              {!existingClient && voicePlan && voicePlan.sameFirstName.length > 0 ? (
                <p className="px-1 text-sm text-muted-foreground">You already have {voicePlan.sameFirstName.join(" and ")}.</p>
              ) : null}
              {voiceNotes.map((text) => (
                <p key={text} className="px-1 text-sm text-muted-foreground">
                  {text}
                </p>
              ))}
            </VoiceReviewFooter>
          ) : null}
          {addError ? <p className="text-sm text-destructive">{addError}</p> : null}
          <div className="flex gap-2">
            <Button type="submit">Add client</Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAdding(false)
                resetVoice()
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div role="group" aria-label="Sort clients" className="flex gap-2 text-sm">
        {(["name", "earned"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={sort === option}
            onClick={() => setSort(option)}
            className={cn(
              "h-8 rounded-full px-3",
              sort === option ? "bg-foreground font-semibold text-background" : "border border-card-border bg-card text-foreground"
            )}
          >
            {option === "name" ? "A–Z" : "Earned this year"}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full rounded-[18px]" />
      ) : visible.length === 0 ? (
        <div className={cn(cardClass, "text-sm text-muted-foreground")}>
          {query ? "No clients match that." : "No clients yet. Add one, or they're added when you send an invoice."}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-[18px] border border-card-border bg-card">
          {visible.map((row) => (
            <li key={row.key} className="border-b border-border last:border-0">
              <Link href={clientHref(row)} className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-foreground">{row.name}</span>
                    {row.isRepeat ? (
                      <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-foreground">
                        Repeat
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-sm text-muted-foreground">
                    {[
                      row.invoices.length > 0 ? `${row.invoices.length} invoice${row.invoices.length === 1 ? "" : "s"}` : null,
                      row.visitCount > 0 ? `${row.visitCount} other payment${row.visitCount === 1 ? "" : "s"}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No payments yet"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold tabular-nums text-foreground">
                    {formatInvoiceMoney(row.thisYear)}{" "}
                    <span className="text-xs font-medium text-muted-foreground">this year</span>
                  </div>
                  {row.overdue > 0 ? (
                    <div className="text-xs font-semibold text-red-700 dark:text-red-400">
                      {formatInvoiceMoney(row.overdue)} overdue
                    </div>
                  ) : row.open > 0 ? (
                    <div className="text-xs text-muted-foreground">{formatInvoiceMoney(row.open)} open</div>
                  ) : (
                    <div className="text-xs text-muted-foreground">{formatInvoiceMoney(row.lifetime)} all time</div>
                  )}
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
