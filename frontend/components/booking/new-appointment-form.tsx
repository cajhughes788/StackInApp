"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Mic, Square, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { PickerInput } from "@/components/booking/picker-input"
import { cardClass, fieldLabelClass, localToday, softInputClass } from "@/components/invoices/invoice-ui"
import { cn } from "@/lib/utils"
import { bookingHoursWarning, formatBookingTime, appointmentEndTime, appointmentTimes } from "@shared/appointments"
import { findBusyConflict } from "@shared/busyTimes"
import { clientKey } from "@shared/clients"
import { formatInvoiceMoney } from "@shared/invoiceDisplay"
import type { AppointmentDraft } from "@/lib/domain/appointmentService"
import type { AppointmentCreateInput } from "@shared/schemas/appointment"
import { BOOKING_MAX_LOCATION, bookingServiceProblem, type BookingDeposit, type BookingSettings } from "@shared/schemas/booking"
import type { ClientType } from "@shared/schemas/client"
import type { VoiceBookingResult } from "@shared/voiceBooking"
import { useSpeechCapture } from "@/hooks/useSpeechCapture"
import { listWords, scrollToVoiceReview, VoiceReviewFooter, VoiceReviewLabel, type VoiceAsk } from "@/components/voice-review"
import { parseVoiceBooking, wakeVoiceEntry } from "@/lib/api/voiceEntryApi"
import {
  planBookingFill,
  voiceBookingCurrentFor,
  voiceBookingHints,
  type BookingClientPick,
  type BookingFillPlan,
  type BookingServicePick,
  type BookingVoiceQuestion,
} from "@/lib/voiceBookingFill"

const LENGTHS = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240]
const BUFFERS = [0, 5, 10, 15, 30, 45, 60]
const DEPOSIT_TYPES: Array<{ value: BookingDeposit["type"]; label: string }> = [
  { value: "none", label: "None" },
  { value: "fixed", label: "$ amount" },
  { value: "percent", label: "% of price" },
]

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[$,%\s]/g, "")
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  return Number(cleaned)
}

function formatLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`
}

function newMutationId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return `appt_${random.slice(0, 24)}`
}

const segmentClass = (active: boolean) =>
  cn("h-10 rounded-[10px] text-sm transition-colors", active ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground")

export function NewAppointmentForm({
  settings,
  savedClients,
  draft,
  initialDate,
  initialTime,
  busy = [],
  voiceFill = null,
  onCreate,
}: {
  settings: BookingSettings
  savedClients: ClientType[]
  // A booking the server refused ("Fix it"): the form comes back as it was.
  draft?: AppointmentDraft | null
  // A spot tapped on the calendar.
  initialDate?: string | null
  initialTime?: string | null
  // When the owner is busy in their own calendars (Booking setup → Block
  // busy times): booking then is allowed, with a warning.
  busy?: Array<{ start: string; end: string; calendar: string }>
  // A booking said on the Booking page: fill the form with it on open.
  voiceFill?: { transcript: string; result: VoiceBookingResult } | null
  // Books it (in the background) and moves on, or says now why it can't.
  onCreate: (input: AppointmentCreateInput & { clientMutationId: string }) => string | null
}) {
  const before = draft?.input
  const services = settings.services.filter((service) => service.active)
  const today = localToday()

  const [clientName, setClientName] = useState(before?.clientName ?? "")
  const [clientId, setClientId] = useState<string | null>(before?.clientId ?? null)
  const [clientEmail, setClientEmail] = useState(before?.clientEmail ?? "")
  const [clientPhone, setClientPhone] = useState(before?.clientPhone ?? "")

  // A saved service's id, "custom", or nothing picked yet.
  const [serviceChoice, setServiceChoice] = useState<string | null>(
    before
      ? before.serviceId && services.some((service) => service.id === before.serviceId)
        ? before.serviceId
        : "custom"
      : services.length === 0
        ? "custom"
        : null
  )
  const [serviceName, setServiceName] = useState(before?.serviceName ?? "")
  const [priceText, setPriceText] = useState(before ? String(before.price) : "")
  const [minutes, setMinutes] = useState(before?.minutes ?? 60)
  const [bufferMinutes, setBufferMinutes] = useState(before?.bufferMinutes ?? 0)
  const [depositType, setDepositType] = useState<BookingDeposit["type"]>(before?.deposit.type ?? "none")
  const [depositText, setDepositText] = useState(before && before.deposit.type !== "none" ? String(before.deposit.value) : "")
  const [saveAsService, setSaveAsService] = useState(before?.saveAsService ?? false)

  const [date, setDate] = useState(before?.date ?? initialDate ?? today)
  const [startTime, setStartTime] = useState(before?.startTime ?? initialTime ?? "")
  const [askToConfirm, setAskToConfirm] = useState(before?.askToConfirm ?? true)
  // Starts from Booking setup; changing it here is for this appointment only.
  const [location, setLocation] = useState(before?.location ?? settings.location)

  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(draft?.error ?? null)
  // One id per appointment being made, so a retry after a dropped
  // connection returns the same booking instead of making two.
  // A retry of the refused booking keeps its id until something changes,
  // so it can't be booked twice.
  const mutationId = useRef(before?.clientMutationId ?? newMutationId())

  const pickedService = services.find((service) => service.id === serviceChoice) ?? null
  const isCustom = serviceChoice === "custom"
  const savedPrice = pickedService ? pickedService.price : null
  const price = parseAmount(priceText)

  function pickService(id: string) {
    setSaveError(null)
    setServiceChoice(id)
    const service = services.find((item) => item.id === id)
    if (!service) {
      // Custom starts blank (keeping whatever length was there).
      setServiceName("")
      setPriceText("")
      setDepositType("none")
      setDepositText("")
      return
    }
    setServiceName(service.name)
    setPriceText(String(service.price))
    setMinutes(service.minutes)
    setBufferMinutes(service.bufferMinutes)
    setDepositType(service.deposit.type)
    setDepositText(service.deposit.type === "none" ? "" : String(service.deposit.value))
    setSaveAsService(false)
  }

  // Typing: saved clients whose name contains it.
  const clientSuggestions = useMemo(() => {
    const q = clientKey(clientName)
    if (!q || clientId) return []
    return savedClients.filter((client) => client.nameKey.includes(q) || client.aliases.some((alias) => alias.includes(q))).slice(0, 5)
  }, [clientId, clientName, savedClients])

  function pickClient(client: ClientType) {
    setClientId(client.id)
    setClientName(client.name)
    if (client.email) setClientEmail(client.email)
    if (client.phone) setClientPhone(client.phone)
  }

  /** ------------------------------------------------
   * VOICE — say the appointment, check the filled form, tap Book. Only the
   * typed-out words and saved client and service names go to the server
   * (lib/api/voiceEntryApi.ts); nothing is booked by voice.
   * ------------------------------------------------ */
  const [voicePhase, setVoicePhase] = useState<"idle" | "thinking">("idle")
  const [voiceQuestions, setVoiceQuestions] = useState<BookingVoiceQuestion[]>([])
  const [voiceNotes, setVoiceNotes] = useState<string[]>([])
  const [voiceFilled, setVoiceFilled] = useState(false)
  const [voiceHeard, setVoiceHeard] = useState("")
  const voiceRunRef = useRef(0)
  // This recording fixes what voice already filled ("make it 3 instead").
  const voiceFixingRef = useRef(false)
  // What the review's voice button asked for ("service"), sent with that fix.
  const voiceAskingRef = useRef<string[]>([])
  const voiceSnapshot = () => ({
    clientName, clientId, clientEmail, clientPhone, serviceChoice, serviceName, priceText, minutes,
    bufferMinutes, depositType, depositText, saveAsService, date, startTime, askToConfirm, location,
  })
  type VoiceSnapshot = ReturnType<typeof voiceSnapshot>
  // The form as it was before voice first filled it, for the note's undo (X).
  const voiceUndoRef = useRef<VoiceSnapshot | null>(null)

  function restoreVoiceSnapshot(snap: VoiceSnapshot) {
    setClientName(snap.clientName)
    setClientId(snap.clientId)
    setClientEmail(snap.clientEmail)
    setClientPhone(snap.clientPhone)
    setServiceChoice(snap.serviceChoice)
    setServiceName(snap.serviceName)
    setPriceText(snap.priceText)
    setMinutes(snap.minutes)
    setBufferMinutes(snap.bufferMinutes)
    setDepositType(snap.depositType)
    setDepositText(snap.depositText)
    setSaveAsService(snap.saveAsService)
    setDate(snap.date)
    setStartTime(snap.startTime)
    setAskToConfirm(snap.askToConfirm)
    setLocation(snap.location)
  }

  /** A client from voice. Contact details come from a saved client, or stay as before voice. */
  function applyVoiceClient(pick: BookingClientPick, before: VoiceSnapshot) {
    if (pick.kind === "saved") {
      setClientId(pick.client.id)
      setClientName(pick.client.name)
      setClientEmail(pick.client.email || before.clientEmail)
      setClientPhone(pick.client.phone || before.clientPhone)
    } else {
      setClientId(null)
      setClientName(pick.name)
      setClientEmail(before.clientEmail)
      setClientPhone(before.clientPhone)
    }
  }

  /** A service from voice: a saved one brings its price, length and deposit, like tapping it. */
  function applyVoiceService(pick: BookingServicePick) {
    if (pick.kind === "saved") {
      pickService(pick.service.id)
    } else {
      pickService("custom")
      setServiceName(pick.name)
    }
  }

  function applyBookingPlan(plan: BookingFillPlan, before: VoiceSnapshot) {
    setSaveError(null)
    if (plan.client) applyVoiceClient(plan.client, before)
    if (plan.clientEmail) setClientEmail(plan.clientEmail)
    if (plan.clientPhone) setClientPhone(plan.clientPhone)
    if (plan.service) applyVoiceService(plan.service)
    // A price or length said is for this appointment only (after the service's own).
    if (plan.price !== null) setPriceText(String(plan.price))
    if (plan.minutes !== null) setMinutes(plan.minutes)
    if (plan.date) setDate(plan.date)
    if (plan.startTime) setStartTime(plan.startTime)
    if (plan.location) setLocation(plan.location)
    if (plan.askToConfirm !== null) setAskToConfirm(plan.askToConfirm)
  }

  function planFor(result: VoiceBookingResult, fixing: boolean, formDate: string) {
    return planBookingFill(result, {
      services: services.map((service) => ({ id: service.id, name: service.name })),
      savedClients: savedClients.filter((client) => !client.archived),
      hours: settings,
      today,
      currentDate: formDate || null,
      fixing,
    })
  }

  /** Fills the form from a reply; false when there was nothing to fill. */
  function fillFromVoice(result: VoiceBookingResult, fixing: boolean, run: number): boolean {
    const now = voiceSnapshot()
    const before = voiceUndoRef.current ?? now
    const plan = planFor(result, fixing, now.date)
    const nothing =
      !plan.client && !plan.service && plan.questions.length === 0 && !plan.clientEmail && !plan.clientPhone &&
      plan.price === null && plan.minutes === null && !plan.date && !plan.startTime && !plan.location && plan.askToConfirm === null
    if (result.action !== "book" || nothing) {
      setVoiceNotes([
        ...plan.skipped,
        fixing
          ? "Didn't catch a change in that. Try again, like \u201cmake it 3 instead.\u201d"
          : "Didn't catch an appointment in that. Try again, like \u201cBook Jenna Thursday at 2 for a cut.\u201d",
      ])
      return false
    }
    if (!voiceUndoRef.current) voiceUndoRef.current = now
    applyBookingPlan(plan, before)
    // New questions get ids from this run so they never clash with ones still open.
    const newQuestions = plan.questions.map((q) => ({ ...q, id: `${run}-${q.id}` }) as BookingVoiceQuestion)
    setVoiceQuestions((open) =>
      fixing
        ? [
            // A fix that names the client (or service) answers its open question.
            ...open.filter(
              (q) => !(q.kind === "client" && (plan.client || newQuestions.some((n) => n.kind === "client"))) &&
                !(q.kind === "service" && (plan.service || newQuestions.some((n) => n.kind === "service")))
            ),
            ...newQuestions,
          ]
        : newQuestions
    )
    setVoiceNotes(plan.skipped)
    setVoiceFilled(true)
    scrollToVoiceReview("voice-booking-review")
    return true
  }

  async function handleVoiceTranscript(transcript: string) {
    const run = ++voiceRunRef.current
    const fixing = voiceFixingRef.current
    const now = voiceSnapshot()
    setVoicePhase("thinking")
    setVoiceHeard(transcript)
    setVoiceNotes([])
    if (!fixing) {
      setVoiceQuestions([])
      setVoiceFilled(false)
    }
    try {
      const result = await parseVoiceBooking({
        kind: "booking",
        mode: "book",
        transcript,
        today,
        clients: savedClients.filter((c) => !c.archived).map((c) => c.name).slice(0, 300),
        services: services.map((service) => service.name).slice(0, 100),
        ...(fixing
          ? {
              asking: voiceAskingRef.current.length > 0 ? voiceAskingRef.current : undefined,
              current: voiceBookingCurrentFor({
                clientName: now.clientName,
                clientEmail: now.clientEmail,
                clientPhone: now.clientPhone,
                serviceName: now.serviceName,
                priceText: now.priceText,
                minutes: now.minutes,
                date: now.date,
                startTime: now.startTime,
                location: now.location === settings.location ? "" : now.location,
              }),
            }
          : {}),
      })
      if (run !== voiceRunRef.current) return
      fillFromVoice(result, fixing, run)
    } catch (error) {
      if (run !== voiceRunRef.current) return
      console.warn("[VoiceBooking] fill failed", error)
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
    void speech.start(voiceBookingHints(savedClients.filter((c) => !c.archived).map((c) => c.name), services.map((s) => s.name)))
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

  function answerVoiceQuestion(question: BookingVoiceQuestion, pick: BookingClientPick | BookingServicePick) {
    if (question.kind === "client") applyVoiceClient(pick as BookingClientPick, voiceUndoRef.current ?? voiceSnapshot())
    else applyVoiceService(pick as BookingServicePick)
    setVoiceQuestions((current) => current.filter((q) => q.id !== question.id))
  }

  // Said on the Booking page: fill the form with it once, on open.
  const voiceFillApplied = useRef(false)
  useEffect(() => {
    if (!voiceFill || voiceFillApplied.current) return
    voiceFillApplied.current = true
    voiceFixingRef.current = false
    setVoiceHeard(voiceFill.transcript)
    fillFromVoice(voiceFill.result, false, ++voiceRunRef.current)
    // Only once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceFill])

  const voiceListening = speech.status === "listening"
  const voiceBusy = voiceListening || voicePhase === "thinking"
  // The review's voice button asks for whatever the appointment still needs.
  const voiceMissing: { word: string; asking: string }[] = []
  if (!clientName.trim() && !voiceQuestions.some((q) => q.kind === "client")) voiceMissing.push({ word: "client's name", asking: "client name" })
  if (!clientEmail.trim() && !clientPhone.trim()) voiceMissing.push({ word: "client's email or phone", asking: "client email or phone" })
  if (!serviceName.trim() && !voiceQuestions.some((q) => q.kind === "service")) voiceMissing.push({ word: "service", asking: "service" })
  if (!date || !startTime) voiceMissing.push({ word: "day and time", asking: "date and start time" })
  const voiceAsk: VoiceAsk | null =
    voiceMissing.length > 0
      ? { label: `Say the ${listWords(voiceMissing.map((m) => m.word))}`, asking: voiceMissing.map((m) => m.asking) }
      : null

  const deposit: BookingDeposit =
    depositType === "none" ? { type: "none", value: 0 } : { type: depositType, value: parseAmount(depositText) ?? 0 }

  // Who gets the link, and how: the server fills a saved client's details in.
  const matchedClient = clientId
    ? savedClients.find((client) => client.id === clientId)
    : savedClients.find((client) => clientName.trim() && client.nameKey === clientKey(clientName))
  const errors = {
    client: clientName.trim() ? null : "Who's the appointment for?",
    // Every client gets their appointment link, by email or text.
    contact:
      clientEmail.trim() || clientPhone.trim() || matchedClient?.email || matchedClient?.phone
        ? null
        : "Add their phone or email so they get their appointment link.",
    service: serviceChoice ? (serviceName.trim() ? null : "Name the service.") : "Pick a service, or Custom.",
    price: serviceChoice && price === null ? "Enter the price, like 60 or 45.50." : null,
    deposit:
      serviceChoice && price !== null
        ? bookingServiceProblem({ name: "", price, deposit })?.replace(/^.*?: /, "").replace(/^./, (c) => c.toUpperCase()) ?? null
        : null,
    email:
      clientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail.trim()) ? "That email doesn't look right." : null,
    when: !date || !startTime ? "Pick a date and time." : date < today ? "That date has already passed." : null,
  }
  const hasErrors = Object.values(errors).some(Boolean)
  const emailsLink = settings.emailClients && !errors.email && !!(clientEmail.trim() || matchedClient?.email)
  const firstName = clientName.trim().split(/\s+/)[0] || "them"
  const hoursWarning = date && startTime ? bookingHoursWarning(settings, date, startTime, minutes) : null
  const busyWarning = useMemo(() => {
    if (!date || !startTime || busy.length === 0) return null
    const times = appointmentTimes({ date, startTime, timeZone: settings.timeZone, minutes, bufferMinutes })
    const conflict = times ? findBusyConflict(times, busy) : null
    if (!conflict) return null
    const clock = (iso: string) =>
      new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: settings.timeZone || undefined }).toLowerCase().replace(" ", "").replace(":00", "")
    return `You're busy ${clock(conflict.start)} – ${clock(conflict.end)} (${conflict.calendar} calendar).`
  }, [busy, date, startTime, settings.timeZone, minutes, bufferMinutes])

  async function submit() {
    // A client or service voice is still asking about isn't on the form yet.
    if (voiceQuestions.length > 0) {
      setVoiceNotes(["Answer the question above, then book it."])
      document.getElementById(`voice-question-${voiceQuestions[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      return
    }
    setShowErrors(true)
    if (hasErrors || saving || price === null) return
    setSaving(true)
    setSaveError(null)
    const problem = onCreate({
      clientMutationId: mutationId.current,
      clientId,
      clientName: clientName.trim(),
      clientEmail: clientEmail.trim() || null,
      clientPhone: clientPhone.trim() || null,
      serviceId: pickedService?.id ?? null,
      serviceName: serviceName.trim(),
      price,
      minutes,
      bufferMinutes,
      deposit,
      saveAsService: isCustom && saveAsService,
      date,
      startTime,
      askToConfirm,
      location: location.trim(),
    })
    if (problem) {
      setSaveError(problem)
      setSaving(false)
    }
  }

  // Anything changed after a refused save is a new attempt.
  function edited() {
    if (saveError) {
      setSaveError(null)
      mutationId.current = newMutationId()
    }
  }

  const fieldError = (message: string | null) =>
    showErrors && message ? <p className="text-sm text-destructive">{message}</p> : null

  return (
    <form
      className="space-y-4"
      onChange={edited}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {speech.supported && !voiceListening && voicePhase !== "thinking" && !voiceFilled ? (
        <button
          type="button"
          onClick={() => startVoice()}
          disabled={saving}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-muted text-base font-medium text-foreground transition-colors hover:bg-secondary"
        >
          <Mic className="size-5" aria-hidden="true" />
          Say the appointment
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
              <span className="text-muted-foreground">Say it like &ldquo;Book Jenna Thursday at 2 for a cut.&rdquo;</span>
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
          The mic is off for 521. Turn on Microphone and Speech Recognition in Settings › 521, or fill in the appointment below.
        </p>
      ) : null}
      {speech.status === "error" ? (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          Couldn&apos;t hear that. Tap the mic to try again, or fill in the appointment below.
        </p>
      ) : null}

      {voiceHeard && !voiceFilled && !voiceListening ? (
        <p className="px-1 text-sm text-muted-foreground">Heard: &ldquo;{voiceHeard}&rdquo;</p>
      ) : null}

      {voiceFilled ? <VoiceReviewLabel id="voice-booking-review" /> : null}

      {!voiceFilled
        ? voiceNotes.map((text) => (
            <p key={text} className="px-1 text-sm text-muted-foreground">
              {text}
            </p>
          ))
        : null}

      <section className={cn(cardClass, "space-y-3")}>
        <h2 className="text-sm font-semibold text-muted-foreground">Client</h2>
        <label className={fieldLabelClass}>
          Name
          <input
            className={softInputClass}
            value={clientName}
            onChange={(event) => {
              setClientName(event.target.value)
              if (clientId) {
                // Their details came with the pick, so they go with it.
                const picked = savedClients.find((client) => client.id === clientId)
                if (picked && clientKey(event.target.value) !== picked.nameKey) {
                  setClientId(null)
                  if (picked.email && clientEmail === picked.email) setClientEmail("")
                  if (picked.phone && clientPhone === picked.phone) setClientPhone("")
                }
              }
            }}
            placeholder="Client name"
            maxLength={80}
            autoComplete="off"
          />
        </label>
        {clientSuggestions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Clients:</span>
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
            {clientId || savedClients.some((client) => client.nameKey === clientKey(clientName))
              ? "Saved client."
              : "New client — saved to your clients with this appointment."}
          </p>
        ) : null}
        {fieldError(errors.client)}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={fieldLabelClass}>
            Email
            <input
              type="email"
              className={softInputClass}
              value={clientEmail}
              onChange={(event) => setClientEmail(event.target.value)}
              placeholder="client@email.com"
              maxLength={254}
              autoComplete="off"
              inputMode="email"
            />
          </label>
          <label className={fieldLabelClass}>
            Phone
            <input
              type="tel"
              className={softInputClass}
              value={clientPhone}
              onChange={(event) => setClientPhone(event.target.value)}
              placeholder="(512) 555-0100"
              maxLength={40}
              autoComplete="off"
            />
          </label>
        </div>
        {fieldError(errors.email)}
        {showErrors && errors.contact ? null : (
          <p className="text-xs text-muted-foreground">Email or phone, so they get their appointment link.</p>
        )}
        {fieldError(errors.contact)}
      </section>

      <section className={cn(cardClass, "space-y-3")}>
        <h2 className="text-sm font-semibold text-muted-foreground">Service</h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Service">
          {services.map((service) => (
            <button
              key={service.id}
              type="button"
              role="radio"
              aria-checked={serviceChoice === service.id}
              onClick={() => pickService(service.id)}
              className={cn(
                "rounded-full border px-3.5 py-2 text-sm",
                serviceChoice === service.id
                  ? "border-primary bg-primary font-semibold text-primary-foreground"
                  : "border-card-border bg-card text-foreground hover:bg-muted"
              )}
            >
              {service.name}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={isCustom}
            onClick={() => pickService("custom")}
            className={cn(
              "rounded-full border border-dashed px-3.5 py-2 text-sm",
              isCustom ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-input text-foreground hover:bg-muted"
            )}
          >
            Custom
          </button>
        </div>
        {services.length === 0 ? (
          <p className="text-xs text-muted-foreground">Save services in Booking setup to pick them here in one tap.</p>
        ) : null}
        {fieldError(serviceChoice ? null : errors.service)}

        {serviceChoice ? (
          <div className="space-y-3 pt-1">
            {isCustom ? (
              <label className={fieldLabelClass}>
                Service name
                <input
                  className={softInputClass}
                  value={serviceName}
                  onChange={(event) => setServiceName(event.target.value)}
                  maxLength={80}
                  placeholder="e.g. Kids cut"
                />
              </label>
            ) : null}
            {isCustom ? fieldError(errors.service) : null}
            <div className="flex gap-2.5">
              <label className={cn(fieldLabelClass, "flex-1")}>
                Price
                <input
                  type="text"
                  inputMode="decimal"
                  className={cn(softInputClass, "tabular-nums")}
                  value={priceText}
                  onChange={(event) => setPriceText(event.target.value)}
                  placeholder="40.00"
                />
              </label>
              <label className={cn(fieldLabelClass, "flex-1")}>
                Length
                <select className={softInputClass} value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
                  {[...new Set([...LENGTHS, minutes])]
                    .sort((a, b) => a - b)
                    .map((value) => (
                      <option key={value} value={value}>
                        {formatLength(value)}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {pickedService && price !== null && savedPrice !== null && price !== savedPrice ? (
              <p className="text-xs text-muted-foreground">
                Custom price for this appointment only — {pickedService.name} stays {formatInvoiceMoney(savedPrice)} in your services.
              </p>
            ) : null}
            {fieldError(errors.price)}
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-sm font-medium text-muted-foreground">Deposit</legend>
              <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-muted p-1">
                {DEPOSIT_TYPES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={depositType === option.value}
                    onClick={() => setDepositType(option.value)}
                    className={segmentClass(depositType === option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {depositType !== "none" ? (
                <label className={cn(fieldLabelClass, "pt-1")}>
                  {depositType === "percent" ? "Percent" : "Amount"}
                  <input
                    type="text"
                    inputMode="decimal"
                    className={cn(softInputClass, "tabular-nums")}
                    value={depositText}
                    onChange={(event) => setDepositText(event.target.value)}
                    placeholder={depositType === "percent" ? "25" : "20.00"}
                  />
                </label>
              ) : null}
              {fieldError(errors.deposit)}
              <p className="text-xs text-muted-foreground">Collected at the appointment for now; online deposits come next.</p>
            </fieldset>
            <label className={fieldLabelClass}>
              Time after (buffer)
              <select
                className={softInputClass}
                value={bufferMinutes}
                onChange={(event) => setBufferMinutes(Number(event.target.value))}
              >
                {[...new Set([...BUFFERS, bufferMinutes])]
                  .sort((a, b) => a - b)
                  .map((value) => (
                    <option key={value} value={value}>
                      {value === 0 ? "None" : `${value} min`}
                    </option>
                  ))}
              </select>
            </label>
            {isCustom ? (
              <label className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-sm font-medium text-foreground">Save as a new service</span>
                  <span className="block text-xs text-muted-foreground">So you can pick it in one tap next time.</span>
                </span>
                <Switch checked={saveAsService} onCheckedChange={setSaveAsService} aria-label="Save as a new service" />
              </label>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={cn(cardClass, "space-y-3")}>
        <h2 className="text-sm font-semibold text-muted-foreground">When</h2>
        <div className="flex gap-2.5">
          <label className={cn(fieldLabelClass, "min-w-0 flex-1")}>
            Date
            <PickerInput
              type="date"
              min={today}
              placeholder="Pick a date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className={cn(fieldLabelClass, "min-w-0 flex-1")}>
            Start time
            <PickerInput
              type="time"
              step={300}
              placeholder="Pick a time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </label>
        </div>
        {date && startTime ? (
          <p className="text-xs text-muted-foreground">
            {formatBookingTime(startTime)} – {formatBookingTime(appointmentEndTime(startTime, minutes))}
            {bufferMinutes ? `, then ${bufferMinutes} min buffer` : ""} · {settings.timeZone.replace(/_/g, " ")}
          </p>
        ) : null}
        {hoursWarning ? (
          <p className="flex items-start gap-2 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{hoursWarning} You can still book it.</span>
          </p>
        ) : null}
        {busyWarning ? (
          <p className="flex items-start gap-2 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{busyWarning} You can still book it.</span>
          </p>
        ) : null}
        {fieldError(errors.when)}
        <label className={fieldLabelClass}>
          Location
          <Textarea
            rows={2}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            maxLength={BOOKING_MAX_LOCATION}
            placeholder="Address the client should come to"
            autoComplete="off"
            className="resize-none rounded-xl border-0 bg-muted text-[15px] text-foreground shadow-none"
          />
        </label>
        {location.trim() !== settings.location.trim() && settings.location.trim() ? (
          <p className="text-xs text-muted-foreground">For this appointment only — your usual address stays in Booking setup.</p>
        ) : null}
      </section>

      <section className={cn(cardClass, "space-y-2")}>
        <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-muted p-1">
          <button type="button" aria-pressed={askToConfirm} onClick={() => setAskToConfirm(true)} className={segmentClass(askToConfirm)}>
            Ask them to confirm
          </button>
          <button type="button" aria-pressed={!askToConfirm} onClick={() => setAskToConfirm(false)} className={segmentClass(!askToConfirm)}>
            Book it now
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {askToConfirm
            ? emailsLink
              ? `We'll email ${firstName} a link to confirm. The time is held for 48 hours.`
              : "You'll text or share them a link to confirm. The time is held for 48 hours."
            : emailsLink
              ? `Confirmed now. We'll email ${firstName} the details.`
              : "Confirmed now — you've already agreed on it with them."}
        </p>
      </section>

      {voiceFilled && !voiceBusy ? (
        <VoiceReviewFooter
          heard={voiceHeard}
          ask={voiceAsk}
          onVoice={() => startVoice(voiceAsk)}
          onUndo={undoVoiceFill}
          disabled={saving}
        >
          {voiceQuestions.map((question) => (
            <div key={question.id} id={`voice-question-${question.id}`} className="space-y-2 rounded-2xl bg-muted px-4 py-3">
              <p className="text-sm font-medium text-foreground">{question.prompt}</p>
              <div className="flex flex-wrap gap-2">
                {question.kind === "client"
                  ? question.options.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => answerVoiceQuestion(question, { kind: "saved", client: option })}
                        className="rounded-full bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
                      >
                        {option.name}
                      </button>
                    ))
                  : question.options.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => answerVoiceQuestion(question, { kind: "saved", service: option })}
                        className="rounded-full bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
                      >
                        {option.name}
                      </button>
                    ))}
                <button
                  type="button"
                  onClick={() =>
                    answerVoiceQuestion(
                      question,
                      question.kind === "client" ? { kind: "new", name: question.spokenName } : { kind: "custom", name: question.spokenName }
                    )
                  }
                  className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary"
                >
                  {question.kind === "client" ? `New client: ${question.spokenName}` : `Custom: ${question.spokenName}`}
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

      {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
      {showErrors && hasErrors ? <p className="text-sm text-destructive">Fix the highlighted fields above.</p> : null}
      <Button type="submit" disabled={saving} className="h-[52px] w-full rounded-full text-base font-semibold">
        {saving ? "Booking..." : "Book"}
      </Button>
    </form>
  )
}
