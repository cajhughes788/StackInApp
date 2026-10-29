"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ChevronDown, Minus, Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { OnlineBookingSection } from "@/components/booking/online-booking-section"
import { PickerInput } from "@/components/booking/picker-input"
import { WebsiteButtonSection } from "@/components/booking/website-button-section"
import { useToast } from "@/hooks/use-toast"
import { cardClass, fieldLabelClass, localToday, softInputClass } from "@/components/invoices/invoice-ui"
import { cn } from "@/lib/utils"
import {
  BOOKING_DAYS,
  BOOKING_DAY_NAMES,
  BOOKING_MAX_BLOCKS_PER_DAY,
  BOOKING_MAX_DAYS_OFF,
  BOOKING_MAX_LOCATION,
  BOOKING_MAX_REMINDERS,
  BOOKING_MAX_SERVICES,
  BOOKING_REMINDER_OPTIONS,
  BOOKING_REFUND_CUTOFF_OPTIONS,
  BOOKING_SLOT_STEPS,
  BookingSettingsSchema,
  bookingDatesInRange,
  bookingDayHoursProblem,
  bookingDayOffRanges,
  bookingServiceProblem,
  type BookingDay,
  type BookingDeposit,
  type BookingService,
  type BookingSettings,
  type BookingSettingsInput,
} from "@shared/schemas/booking"
import type { InvoiceSettings } from "@shared/schemas/invoice"
import { cancellationPolicyText, refundCutoffLabel } from "@shared/appointmentDeposits"
import { bookingSlugProblem } from "@shared/onlineBooking"

const LENGTHS = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240]
const BUFFERS = [0, 5, 10, 15, 30, 45, 60]
const NOTICE_HOURS = [0, 1, 2, 4, 12, 24, 48]
const DAYS_AHEAD = [14, 30, 60, 90, 180, 365]
const DEPOSIT_TYPES: Array<{ value: BookingDeposit["type"]; label: string }> = [
  { value: "none", label: "None" },
  { value: "fixed", label: "$ amount" },
  { value: "percent", label: "% of price" },
]
// Shown when the device can't list every zone.
const COMMON_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
]

type Draft = Omit<BookingSettings, "updatedAt">

// A service being added or changed. Amounts are typed as text so "12." isn't
// rewritten mid-typing; parsed when it's done.
type ServiceDraft = {
  id: string
  name: string
  priceText: string
  minutes: number
  depositType: BookingDeposit["type"]
  depositText: string
  bufferMinutes: number
  active: boolean
}

function toDraft(settings: BookingSettings | null): Draft {
  const { updatedAt: _updatedAt, ...rest } = settings ?? BookingSettingsSchema.parse({})
  return rest
}

function newServiceId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return `svc_${random.slice(0, 16)}`
}

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[$,%\s]/g, "")
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  return Number(cleaned)
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

function formatMoney(value: number): string {
  return money.format(value).replace(/\.00$/, "")
}

function formatLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`
}

function depositLabel(service: BookingService): string | null {
  if (service.deposit.type === "fixed") return `${formatMoney(service.deposit.value)} deposit`
  if (service.deposit.type === "percent") return `${service.deposit.value}% deposit`
  return null
}

function formatTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number)
  const suffix = hours < 12 ? "am" : "pm"
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return minutes ? `${hour12}:${String(minutes).padStart(2, "0")}${suffix}` : `${hour12}${suffix}`
}

function formatDayOff(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
}

// "Dec 20 – 25, 2026", "Nov 28 – Dec 2, 2026", "Dec 28, 2026 – Jan 2, 2027".
function formatDayOffRange(start: string, end: string): string {
  if (start === end) return formatDayOff(start)
  const [startYear, startMonth] = start.split("-")
  const [endYear, endMonth] = end.split("-")
  const day = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Date(`${date}T12:00:00`).toLocaleDateString("en-US", options)
  if (startYear !== endYear) {
    return `${day(start, { month: "short", day: "numeric", year: "numeric" })} – ${day(end, { month: "short", day: "numeric", year: "numeric" })}`
  }
  const endPart = startMonth === endMonth ? day(end, { day: "numeric" }) : day(end, { month: "short", day: "numeric" })
  return `${day(start, { month: "short", day: "numeric" })} – ${endPart}, ${endYear}`
}

// Every zone the device knows; the common list on older devices.
// The weekly hours in a few lines, days with the same hours run together:
// ["Mon – Fri · 9am – 5pm", "Sat · 10am – 2pm", "Closed Sun"].
function weeklyHoursSummary(weeklyHours: Draft["weeklyHours"]): string[] {
  const short = (day: BookingDay) => BOOKING_DAY_NAMES[day].slice(0, 3)
  // Monday first, as people read a week.
  const days = [...BOOKING_DAYS.slice(1), BOOKING_DAYS[0]]
  const hoursOf = (day: BookingDay) =>
    weeklyHours[day].map((block) => `${formatTime(block.start)} – ${formatTime(block.end)}`).join(", ")
  const lines: string[] = []
  for (let i = 0; i < days.length; ) {
    const hours = hoursOf(days[i])
    let j = i
    while (j + 1 < days.length && hoursOf(days[j + 1]) === hours) j += 1
    if (hours) lines.push(`${short(days[i])}${j > i ? ` – ${short(days[j])}` : ""} · ${hours}`)
    i = j + 1
  }
  const closed = days.filter((day) => weeklyHours[day].length === 0)
  if (closed.length === days.length) return ["Closed every day"]
  if (closed.length > 0) lines.push(`Closed ${closed.map(short).join(", ")}`)
  return lines
}

const AUTOSAVE_DELAY_MS = 1000

// What a save would send, for "has anything changed?": past days off and
// the all-day switch (saved on its own) don't count.
function draftKey(draft: Draft, today: string): string {
  const { busyAllDay: _busyAllDay, updatedAt: _updatedAt, ...rest } = draft as Draft & { updatedAt?: string }
  return JSON.stringify({ ...rest, daysOff: draft.daysOff.filter((date) => date >= today) })
}

function deviceTimeZones(): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone")
    if (all && all.length > 0) return all
  } catch {
    // Fall through to the common list.
  }
  return COMMON_TIME_ZONES
}

// New services start from the invoice default deposit.
function blankService(invoiceSettings: InvoiceSettings | null): ServiceDraft {
  const deposit = invoiceSettings?.defaultDeposit
  const type = deposit && deposit.type !== "none" && deposit.value > 0 ? deposit.type : "none"
  return {
    id: newServiceId(),
    name: "",
    priceText: "",
    minutes: 60,
    depositType: type,
    depositText: type === "none" ? "" : String(deposit?.value ?? ""),
    bufferMinutes: 0,
    active: true,
  }
}

function serviceToDraft(service: BookingService): ServiceDraft {
  return {
    id: service.id,
    name: service.name,
    priceText: String(service.price),
    minutes: service.minutes,
    depositType: service.deposit.type,
    depositText: service.deposit.type === "none" ? "" : String(service.deposit.value),
    bufferMinutes: service.bufferMinutes,
    active: service.active,
  }
}

/** The service this draft makes, or why it can't be saved. */
function draftToService(draft: ServiceDraft): { service: BookingService } | { error: string } {
  const name = draft.name.trim()
  if (!name) return { error: "Give the service a name." }
  const price = parseAmount(draft.priceText)
  if (price === null) return { error: "Enter the price, like 60 or 45.50." }
  let deposit: BookingDeposit = { type: "none", value: 0 }
  if (draft.depositType !== "none") {
    const value = parseAmount(draft.depositText)
    deposit = { type: draft.depositType, value: value ?? 0 }
  }
  const service: BookingService = {
    id: draft.id,
    name,
    price,
    minutes: draft.minutes,
    deposit,
    bufferMinutes: draft.bufferMinutes,
    active: draft.active,
  }
  const problem = bookingServiceProblem(service)
  return problem ? { error: problem.replace(/^.*?: /, "").replace(/^./, (c) => c.toUpperCase()) } : { service }
}

export function BookingSetupForm({
  initial,
  invoiceSettings,
  onlinePayments,
  onSave,
}: {
  initial: BookingSettings
  // New services start from its default deposit.
  invoiceSettings: InvoiceSettings | null
  // Card payments are on (Stripe connected): clients pay deposits from their link.
  onlinePayments: boolean
  onSave: (input: BookingSettingsInput) => Promise<BookingSettings>
}) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  // What's saved: the booking link works only once it's saved and on.
  const [saved, setSaved] = useState<BookingSettings>(initial)
  const [editing, setEditing] = useState<{ service: ServiceDraft; isNew: boolean } | null>(null)
  // One day off, or a range (vacation).
  const [dayOffMode, setDayOffMode] = useState<"one" | "range">("one")
  const [dayOffFrom, setDayOffFrom] = useState("")
  const [dayOffTo, setDayOffTo] = useState("")
  // "Request these days off?" and "Open this back up?" confirmations.
  const [confirmingDaysOff, setConfirmingDaysOff] = useState(false)
  const [reopening, setReopening] = useState<string | null>(null)
  const [showDaysOff, setShowDaysOff] = useState(false)
  const [saving, setSaving] = useState(false)
  // Weekly hours fold into a summary once they've been saved (open for a
  // first setup); Done folds them again.
  const [hoursOpen, setHoursOpen] = useState(!initial.updatedAt)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Changes save themselves, like Settings: a moment after the last change.
  // A change that failed isn't retried until it's changed again.
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [savedOnce, setSavedOnce] = useState(false)
  const today = localToday()

  function update(patch: Partial<Draft>) {
    setSaveError(null)
    setDraft((current) => ({ ...current, ...patch }))
  }

  function setDay(day: BookingDay, blocks: Draft["weeklyHours"][BookingDay]) {
    update({ weeklyHours: { ...draft.weeklyHours, [day]: blocks } })
  }

  const dayProblems = useMemo(
    () =>
      Object.fromEntries(BOOKING_DAYS.map((day) => [day, bookingDayHoursProblem(draft.weeklyHours[day])])) as Record<
        BookingDay,
        string | null
      >,
    [draft.weeklyHours]
  )
  const hasDayProblem = BOOKING_DAYS.some((day) => dayProblems[day])
  const hasLinkProblem =
    (!!draft.bookingSlug && bookingSlugProblem(draft.bookingSlug) !== null) ||
    (draft.onlineBookingEnabled && (!draft.bookingSlug || !draft.services.some((service) => service.active)))
  const upcomingDaysOff = draft.daysOff.filter((date) => date >= today)
  const dayOffRanges = bookingDayOffRanges(upcomingDaysOff)
  const newDaysOff = /^\d{4}-\d{2}-\d{2}$/.test(dayOffFrom) && dayOffFrom >= today
    ? bookingDatesInRange(dayOffFrom, dayOffMode === "range" && dayOffTo ? dayOffTo : dayOffFrom)
    : []
  const dayOffError =
    dayOffMode === "range" && dayOffFrom && dayOffTo && dayOffTo < dayOffFrom
      ? "The last day off can't be before the first."
      : new Set([...upcomingDaysOff, ...newDaysOff]).size > BOOKING_MAX_DAYS_OFF
        ? "That's more than a year of days off."
        : null
  // Listed after mount: the server's list differs from the device's.
  const [allZones, setAllZones] = useState<string[]>(COMMON_TIME_ZONES)
  useEffect(() => setAllZones(deviceTimeZones()), [])
  const zones = draft.timeZone && !allZones.includes(draft.timeZone) ? [draft.timeZone, ...allZones] : allZones

  function finishEditing() {
    if (!editing) return
    const result = draftToService(editing.service)
    if ("error" in result) return
    const services = editing.isNew
      ? [...draft.services, result.service]
      : draft.services.map((service) => (service.id === result.service.id ? result.service : service))
    update({ services })
    setEditing(null)
  }

  // Picking the first day of a range fills in the last too, so its
  // picker opens on that month (and the range is never backwards).
  function pickDayOffFrom(value: string) {
    setDayOffFrom(value)
    if (dayOffMode === "range" && value && (!dayOffTo || dayOffTo < value)) setDayOffTo(value)
  }

  // Confirmed days off (or ones opened back up) save at once, so clients
  // can't book them from that moment — along with anything else changed.
  function saveDaysOff(daysOff: string[], message: string) {
    const next = { ...draft, daysOff }
    setDraft(next)
    // Fixing a problem above saves it along with everything else.
    if (saving || hasDayProblem || hasLinkProblem || editing) return
    void save(next, message)
  }

  // Overlapping or back-to-back ranges join up when they're shown.
  function addDaysOff() {
    if (newDaysOff.length === 0 || dayOffError) return
    saveDaysOff([...new Set([...upcomingDaysOff, ...newDaysOff])].sort(), "Days off saved")
    setDayOffFrom("")
    setDayOffTo("")
    setConfirmingDaysOff(false)
    setShowDaysOff(true)
  }

  function reopenDaysOff(range: { start: string; end: string }) {
    saveDaysOff(
      upcomingDaysOff.filter((date) => date < range.start || date > range.end),
      "Open for booking again"
    )
    setReopening(null)
  }

  async function save(next: Draft = draft, message?: string) {
    if (saving || hasDayProblem || hasLinkProblem || editing) return
    const sentKey = draftKey(next, today)
    setSaving(true)
    setSaveError(null)
    try {
      // "All-day events block the whole day" saves on its own, beside the
      // busy calendars (BusyCalendarsSection): never sent from here.
      const { busyAllDay: _busyAllDay, ...rest } = next
      const result = await onSave({ ...rest, daysOff: next.daysOff.filter((date) => date >= today) })
      // Only take the server's copy if nothing changed meanwhile (typing
      // carries on while a save is out).
      if (draftKey(latestDraft.current, today) === sentKey) setDraft(toDraft(result))
      setSaved(result)
      setFailedKey(null)
      setSavedOnce(true)
      if (message) toast({ title: message })
    } catch (error) {
      setFailedKey(sentKey)
      setSaveError(error instanceof Error ? error.message : "Couldn't save. Check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  // Autosave: a second after the last change, once nothing above needs
  // fixing. Leaving the page saves what's waiting right away.
  const latestDraft = useRef(draft)
  latestDraft.current = draft
  const dirty = draftKey(draft, today) !== draftKey(toDraft(saved), today)
  const blocked = hasDayProblem || hasLinkProblem || editing !== null
  const pendingSave = useRef<(() => void) | null>(null)
  pendingSave.current = dirty && !blocked && !saving && draftKey(draft, today) !== failedKey ? () => void save(draft) : null
  useEffect(() => {
    if (!dirty || blocked || saving || draftKey(draft, today) === failedKey) return
    const timer = window.setTimeout(() => pendingSave.current?.(), AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(timer)
    // draft covers every change; save is read through pendingSave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty, blocked, saving, failedKey])
  useEffect(() => () => pendingSave.current?.(), [])

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        pendingSave.current?.()
      }}
    >
      <p className="text-sm leading-relaxed text-muted-foreground">
        Set up what customers can book and when you&apos;re open. Customers see your services and open times once
        you turn on online booking below. Changes save automatically.
      </p>

      <section className={cn(cardClass, "space-y-3")}>
        <h2 className="text-sm font-semibold text-muted-foreground">Services</h2>
        {draft.services.length === 0 && !editing ? (
          <p className="text-sm text-muted-foreground">Add what you offer, like &ldquo;Haircut, 45 min, $40&rdquo;.</p>
        ) : null}
        <ul className="space-y-2">
          {draft.services.map((service) =>
            editing && !editing.isNew && editing.service.id === service.id ? (
              <li key={service.id}>
                <ServiceEditor
                  value={editing.service}
                  onChange={(next) => setEditing({ ...editing, service: next })}
                  onDone={finishEditing}
                  onCancel={() => setEditing(null)}
                  onRemove={() => {
                    update({ services: draft.services.filter((item) => item.id !== service.id) })
                    setEditing(null)
                  }}
                />
              </li>
            ) : (
              <li key={service.id}>
                <button
                  type="button"
                  disabled={editing !== null}
                  onClick={() => setEditing({ service: serviceToDraft(service), isNew: false })}
                  className="flex w-full items-center gap-3 rounded-xl bg-muted px-3.5 py-3 text-left disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate font-medium", !service.active && "text-muted-foreground")}>
                      {service.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[formatLength(service.minutes), formatMoney(service.price), depositLabel(service)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {!service.active ? (
                    <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">Off</span>
                  ) : null}
                </button>
              </li>
            )
          )}
          {editing?.isNew ? (
            <li>
              <ServiceEditor
                value={editing.service}
                onChange={(next) => setEditing({ ...editing, service: next })}
                onDone={finishEditing}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : null}
        </ul>
        {!editing && draft.services.length < BOOKING_MAX_SERVICES ? (
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full rounded-full border-card-border bg-card font-semibold"
            onClick={() => setEditing({ service: blankService(invoiceSettings), isNew: true })}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add a service
          </Button>
        ) : null}
      </section>

      <section className={cn(cardClass, "space-y-3")}>
        <h2 className="text-sm font-semibold text-muted-foreground">Where appointments happen</h2>
        <Textarea
          rows={2}
          value={draft.location}
          onChange={(event) => update({ location: event.target.value })}
          maxLength={BOOKING_MAX_LOCATION}
          placeholder={"123 Main St, Suite 4\nBoise, ID 83702"}
          aria-label="Where appointments happen"
          autoComplete="street-address"
          className="resize-none rounded-xl border-0 bg-muted text-[15px] text-foreground shadow-none"
        />
        <p className="text-xs text-muted-foreground">
          Shown to clients with each appointment, with directions. You can change it on any appointment, like a house
          call. Leave it blank if you don&apos;t have a fixed place.
        </p>
      </section>

      <section className={cn(cardClass, "space-y-3")}>
        <button
          type="button"
          aria-expanded={hoursOpen || hasDayProblem}
          className="flex w-full items-start justify-between gap-3 text-left"
          onClick={() => setHoursOpen((value) => !value)}
          disabled={hasDayProblem}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-muted-foreground">Weekly hours</span>
            {hoursOpen || hasDayProblem ? null : (
              <span className="mt-1 block space-y-0.5">
                {weeklyHoursSummary(draft.weeklyHours).map((line) => (
                  <span key={line} className="block text-sm text-foreground">
                    {line}
                  </span>
                ))}
              </span>
            )}
          </span>
          <ChevronDown
            className={cn("mt-0.5 size-5 shrink-0 text-muted-foreground transition-transform", (hoursOpen || hasDayProblem) && "rotate-180")}
            aria-hidden="true"
          />
        </button>
        {hoursOpen || hasDayProblem ? (
          <ul className="divide-y divide-card-border">
            {BOOKING_DAYS.map((day) => {
              const blocks = draft.weeklyHours[day]
              const open = blocks.length > 0
              return (
                <li key={day} className="space-y-2 py-2.5 first:pt-0 last:pb-0">
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground">{BOOKING_DAY_NAMES[day]}</span>
                    <span className="flex items-center gap-2.5">
                      <span className="text-xs text-muted-foreground">{open ? "Open" : "Closed"}</span>
                      <Switch
                        checked={open}
                        onCheckedChange={(checked) => setDay(day, checked ? [{ start: "09:00", end: "17:00" }] : [])}
                        aria-label={`Open on ${BOOKING_DAY_NAMES[day]}`}
                      />
                    </span>
                  </label>
                  {blocks.map((block, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="time"
                        step={300}
                        className={cn(softInputClass, "h-10 min-w-0 flex-1 px-1.5 text-center text-sm tabular-nums")}
                        value={block.start}
                        aria-label={`${BOOKING_DAY_NAMES[day]} opens`}
                        onChange={(event) =>
                          event.target.value &&
                          setDay(
                            day,
                            blocks.map((item, i) => (i === index ? { ...item, start: event.target.value } : item))
                          )
                        }
                      />
                      <span className="text-xs text-muted-foreground">to</span>
                      <input
                        type="time"
                        step={300}
                        className={cn(softInputClass, "h-10 min-w-0 flex-1 px-1.5 text-center text-sm tabular-nums")}
                        value={block.end}
                        aria-label={`${BOOKING_DAY_NAMES[day]} closes`}
                        onChange={(event) =>
                          event.target.value &&
                          setDay(
                            day,
                            blocks.map((item, i) => (i === index ? { ...item, end: event.target.value } : item))
                          )
                        }
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${formatTime(block.start)}–${formatTime(block.end)} on ${BOOKING_DAY_NAMES[day]}`}
                        className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => setDay(day, blocks.filter((_, i) => i !== index))}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  {open && blocks.length < BOOKING_MAX_BLOCKS_PER_DAY ? (
                    <button
                      type="button"
                      className="text-sm font-medium text-primary"
                      onClick={() => {
                        const last = blocks[blocks.length - 1]
                        const start = last && last.end < "22:00" ? last.end : "18:00"
                        const startHour = Number(start.slice(0, 2))
                        const end = `${String(Math.min(startHour + 2, 23)).padStart(2, "0")}:${start.slice(3)}`
                        setDay(day, [...blocks, { start, end }])
                      }}
                    >
                      + Add hours
                    </button>
                  ) : null}
                  {dayProblems[day] ? <p className="text-sm text-destructive">{dayProblems[day]}</p> : null}
                </li>
              )
            })}
          </ul>
        ) : null}
        {hoursOpen && !hasDayProblem ? (
          <Button type="button" variant="outline" className="h-10 w-full rounded-full" onClick={() => setHoursOpen(false)}>
            Done
          </Button>
        ) : null}
      </section>

      <section className={cn(cardClass, "space-y-3")}>
        <h2 className="text-sm font-semibold text-muted-foreground">Days off</h2>
        <div role="radiogroup" aria-label="Days off" className="grid grid-cols-2 gap-1 rounded-[14px] bg-muted p-1">
          {(
            [
              { value: "one", label: "One day" },
              { value: "range", label: "Several days" },
            ] as const
          ).map((option) => {
            const active = dayOffMode === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setDayOffMode(option.value)
                  setConfirmingDaysOff(false)
                  if (option.value === "range" && dayOffFrom && (!dayOffTo || dayOffTo < dayOffFrom)) setDayOffTo(dayOffFrom)
                }}
                className={cn(
                  "h-10 rounded-[10px] text-sm transition-colors",
                  active ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground"
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
        {dayOffMode === "one" ? (
          <label className={fieldLabelClass}>
            Day off
            <PickerInput
              type="date"
              min={today}
              placeholder="Pick a date"
              value={dayOffFrom}
              onChange={(event) => {
                setDayOffFrom(event.target.value)
                setConfirmingDaysOff(false)
              }}
            />
          </label>
        ) : (
          <div className="flex items-end gap-2">
            <label className={cn(fieldLabelClass, "min-w-0 flex-1")}>
              From
              <PickerInput
                type="date"
                min={today}
                placeholder="First day"
                value={dayOffFrom}
                onChange={(event) => {
                  pickDayOffFrom(event.target.value)
                  setConfirmingDaysOff(false)
                }}
              />
            </label>
            <label className={cn(fieldLabelClass, "min-w-0 flex-1")}>
              To
              <PickerInput
                type="date"
                min={dayOffFrom || today}
                placeholder="Last day"
                value={dayOffTo}
                onChange={(event) => {
                  setDayOffTo(event.target.value)
                  setConfirmingDaysOff(false)
                }}
              />
            </label>
          </div>
        )}
        {confirmingDaysOff && newDaysOff.length > 0 ? (
          <div className="space-y-2 rounded-[14px] bg-muted p-3">
            <p className="text-sm text-foreground">
              Request {newDaysOff.length === 1 ? "this day" : "these days"} off?{" "}
              <span className="font-semibold">{formatDayOffRange(newDaysOff[0], newDaysOff[newDaysOff.length - 1])}</span>
            </p>
            <p className="text-xs text-muted-foreground">Clients won&apos;t be able to book {newDaysOff.length === 1 ? "this day" : "these days"}.</p>
            <div className="flex gap-2">
              <Button type="button" className="h-10 flex-1 rounded-full" disabled={saving} onClick={addDaysOff}>
                Yes
              </Button>
              <Button type="button" variant="outline" className="h-10 flex-1 rounded-full" onClick={() => setConfirmingDaysOff(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            // Green once dates are picked, so it's clear what to tap next.
            variant={newDaysOff.length > 0 && dayOffError === null ? "default" : "outline"}
            className={cn(
              "h-10 w-full rounded-full font-semibold",
              !(newDaysOff.length > 0 && dayOffError === null) && "border-card-border bg-card"
            )}
            disabled={newDaysOff.length === 0 || dayOffError !== null}
            onClick={() => setConfirmingDaysOff(true)}
          >
            {dayOffMode === "one" ? "Add day off" : "Add days off"}
          </Button>
        )}
        {dayOffError ? <p className="text-sm text-destructive">{dayOffError}</p> : null}
        {dayOffRanges.length > 0 ? (
          <div className="rounded-[14px] border border-card-border">
            <button
              type="button"
              aria-expanded={showDaysOff}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-foreground"
              onClick={() => {
                setShowDaysOff((open) => !open)
                setReopening(null)
              }}
            >
              Requested days off ({dayOffRanges.length})
              <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", showDaysOff && "rotate-180")} aria-hidden="true" />
            </button>
            {showDaysOff ? (
              <ul className="divide-y divide-card-border border-t border-card-border">
                {dayOffRanges.map((range) => {
                  const label = formatDayOffRange(range.start, range.end)
                  return (
                    <li key={range.start} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-foreground">{label}</span>
                        {reopening === range.start ? null : (
                          <button
                            type="button"
                            aria-label={`Open ${label} back up`}
                            className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => setReopening(range.start)}
                          >
                            <Minus className="size-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                      {reopening === range.start ? (
                        <div className="mt-2 space-y-2">
                          <p className="text-sm text-muted-foreground">
                            Open {range.start === range.end ? "this day" : "these days"} back up for booking?
                          </p>
                          <div className="flex gap-2">
                            <Button type="button" className="h-9 flex-1 rounded-full" disabled={saving} onClick={() => reopenDaysOff(range)}>
                              Yes
                            </Button>
                            <Button type="button" variant="outline" className="h-9 flex-1 rounded-full" onClick={() => setReopening(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Holidays or vacation: no one can book these dates.</p>
        )}
      </section>

      <section className={cn(cardClass, "space-y-3")}>
        <h2 className="text-sm font-semibold text-muted-foreground">Booking rules</h2>
        <div className="flex gap-2.5">
          <label className={cn(fieldLabelClass, "flex-1")}>
            Minimum notice
            <select
              className={softInputClass}
              value={draft.minNoticeHours}
              onChange={(event) => update({ minNoticeHours: Number(event.target.value) })}
            >
              {[...new Set([...NOTICE_HOURS, draft.minNoticeHours])]
                .sort((a, b) => a - b)
                .map((hours) => (
                  <option key={hours} value={hours}>
                    {hours === 0 ? "None" : hours === 1 ? "1 hour" : `${hours} hours`}
                  </option>
                ))}
            </select>
          </label>
          <label className={cn(fieldLabelClass, "flex-1")}>
            Book up to
            <select
              className={softInputClass}
              value={draft.maxDaysAhead}
              onChange={(event) => update({ maxDaysAhead: Number(event.target.value) })}
            >
              {[...new Set([...DAYS_AHEAD, draft.maxDaysAhead])]
                .sort((a, b) => a - b)
                .map((days) => (
                  <option key={days} value={days}>
                    {days === 365 ? "1 year ahead" : `${days} days ahead`}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="mb-1.5 text-sm font-medium text-muted-foreground">Start times every</legend>
          <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-muted p-1">
            {BOOKING_SLOT_STEPS.map((step) => {
              const active = draft.slotStepMinutes === step
              return (
                <button
                  key={step}
                  type="button"
                  aria-pressed={active}
                  onClick={() => update({ slotStepMinutes: step })}
                  className={cn(
                    "h-10 rounded-[10px] text-sm transition-colors",
                    active ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground"
                  )}
                >
                  {step === 60 ? "1 hour" : `${step} min`}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            With {draft.slotStepMinutes === 60 ? "1 hour" : `${draft.slotStepMinutes} min`}, customers see{" "}
            {draft.slotStepMinutes === 15 ? "9:00, 9:15, 9:30" : draft.slotStepMinutes === 30 ? "9:00, 9:30, 10:00" : "9:00, 10:00, 11:00"}…
            whenever the whole service fits.
          </p>
        </fieldset>
        <label className={fieldLabelClass}>
          Time zone
          <select className={softInputClass} value={draft.timeZone} onChange={(event) => update({ timeZone: event.target.value })}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">Your hours are in this time zone, wherever your customer is.</p>
      </section>

      <section className={cn(cardClass, "space-y-3")}>
        <h2 className="text-sm font-semibold text-muted-foreground">Deposits</h2>
        <label className={fieldLabelClass}>
          Cancellation
          <select
            className={softInputClass}
            value={draft.refundCutoffHours === null ? "never" : String(draft.refundCutoffHours)}
            onChange={(event) =>
              update({ refundCutoffHours: event.target.value === "never" ? null : Number(event.target.value) })
            }
          >
            {[...new Set<number>([...BOOKING_REFUND_CUTOFF_OPTIONS, ...(draft.refundCutoffHours === null ? [] : [draft.refundCutoffHours])])]
              .sort((a, b) => a - b)
              .map((hours) => (
                <option key={hours} value={hours}>
                  Free up to {refundCutoffLabel(hours)} before
                </option>
              ))}
            <option value="never">Deposit is never refunded</option>
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          Clients see: &ldquo;{cancellationPolicyText(draft.refundCutoffHours)}&rdquo; If you cancel, they always get the
          deposit back.
        </p>
        {draft.refundCutoffHours === null ? (
          // Otherwise clients can move it up to the cancellation cutoff.
          <label className={fieldLabelClass}>
            Clients can move their appointment
            <select
              className={softInputClass}
              value={draft.noRefundRescheduleHours === null ? "never" : String(draft.noRefundRescheduleHours)}
              onChange={(event) =>
                update({ noRefundRescheduleHours: event.target.value === "never" ? null : Number(event.target.value) })
              }
            >
              {[...new Set<number>([...BOOKING_REFUND_CUTOFF_OPTIONS, ...(draft.noRefundRescheduleHours === null ? [] : [draft.noRefundRescheduleHours])])]
                .sort((a, b) => a - b)
                .map((hours) => (
                  <option key={hours} value={hours}>
                    Up to {refundCutoffLabel(hours)} before
                  </option>
                ))}
              <option value="never">No, they contact you</option>
            </select>
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">
            Clients can move their appointment once themselves, up to {refundCutoffLabel(draft.refundCutoffHours)} before.
          </p>
        )}
        {!onlinePayments && draft.services.some((service) => service.deposit.type !== "none") ? (
          <p className="rounded-[12px] bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Connect Stripe to take deposits by card when clients confirm.{" "}
            <Link href="/app/invoices/settings" className="font-medium underline">
              Set up online payments
            </Link>
          </p>
        ) : null}
      </section>

      <section className={cn(cardClass, "space-y-3")}>
        <h2 className="text-sm font-semibold text-muted-foreground">Client emails</h2>
        <label className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">Email clients automatically</span>
            <span className="block text-xs text-muted-foreground">
              When you book, 521 emails the client their link: to confirm, or their booking details. They&apos;re also
              emailed if you cancel. Off, you share the link yourself.
            </span>
          </span>
          <Switch
            checked={draft.emailClients}
            onCheckedChange={(emailClients) => update({ emailClients })}
            aria-label="Email clients automatically"
          />
        </label>
      </section>

      <section className={cn(cardClass, "space-y-3")}>
        <h2 className="text-sm font-semibold text-muted-foreground">Reminders</h2>
        <label className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">Remind clients</span>
            <span className="block text-xs text-muted-foreground">
              521 emails clients before confirmed appointments. If a client has no email, you get a notification at
              your first reminder so you can text them.
            </span>
          </span>
          <Switch
            checked={draft.reminders.length > 0}
            onCheckedChange={(on) => update({ reminders: on ? [24] : [] })}
            aria-label="Remind clients"
          />
        </label>
        {draft.reminders.map((hours, index) => {
          // The other reminder's time can't be picked twice.
          const other = draft.reminders.find((_, at) => at !== index)
          const setAt = (next: number | null) => {
            const list = draft.reminders.flatMap((value, at) => (at === index ? (next === null ? [] : [next]) : [value]))
            update({ reminders: [...list].sort((a, b) => b - a) })
          }
          return (
            <div key={`${index}-${hours}`} className="flex items-end gap-2">
              <label className={cn(fieldLabelClass, "min-w-0 flex-1")}>
                {index === 0 ? "First reminder" : "Second reminder"}
                <select className={softInputClass} value={hours} onChange={(event) => setAt(Number(event.target.value))}>
                  {BOOKING_REMINDER_OPTIONS.filter((option) => option.hours !== other).map((option) => (
                    <option key={option.hours} value={option.hours}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {index > 0 ? (
                <button
                  type="button"
                  aria-label="Remove the second reminder"
                  className="mb-1 flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setAt(null)}
                >
                  <Minus className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          )
        })}
        {draft.reminders.length > 0 && draft.reminders.length < BOOKING_MAX_REMINDERS ? (
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm font-medium text-foreground"
            onClick={() => {
              // Starts at 2 hours before (a day-of nudge), else the next time closer in.
              const first = draft.reminders[0]
              const hours = BOOKING_REMINDER_OPTIONS.map((option) => option.hours)
              const pick = [2, ...hours.filter((value) => value < first), ...hours].find((value) => value !== first)!
              update({ reminders: [first, pick].sort((a, b) => b - a) })
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add a second reminder
          </button>
        ) : null}
      </section>

      <OnlineBookingSection
        enabled={draft.onlineBookingEnabled}
        slug={draft.bookingSlug}
        savedEnabled={saved.onlineBookingEnabled}
        savedSlug={saved.bookingSlug}
        businessName={invoiceSettings?.businessName ?? ""}
        hasActiveService={draft.services.some((service) => service.active)}
        onChange={update}
      />

      {draft.onlineBookingEnabled && saved.onlineBookingEnabled && saved.bookingSlug && draft.bookingSlug === saved.bookingSlug ? (
        <WebsiteButtonSection slug={saved.bookingSlug} accentColor={invoiceSettings?.accentColor ?? ""} />
      ) : null}

      {/* Where the Save button was: what autosave is doing, and why it's waiting. */}
      <div role="status" aria-live="polite" className="sticky bottom-3 z-10 flex justify-center">
        <span
          className={cn(
            "rounded-full border border-card-border bg-card px-3.5 py-1.5 text-xs font-medium shadow-sm",
            saveError ? "text-destructive" : blocked && dirty ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"
          )}
        >
          {saveError
            ? saveError
            : saving || (dirty && !blocked)
              ? "Saving…"
              : blocked && dirty
                ? editing
                  ? "Finish the service you're editing to save"
                  : "Fix the problem above to save"
                : savedOnce
                  ? "All changes saved"
                  : "Changes save automatically"}
        </span>
      </div>
    </form>
  )
}

function ServiceEditor({
  value,
  onChange,
  onDone,
  onCancel,
  onRemove,
}: {
  value: ServiceDraft
  onChange: (next: ServiceDraft) => void
  onDone: () => void
  onCancel: () => void
  onRemove?: () => void
}) {
  const [showErrors, setShowErrors] = useState(false)
  const result = draftToService(value)
  const error = "error" in result ? result.error : null

  function set(patch: Partial<ServiceDraft>) {
    onChange({ ...value, ...patch })
  }

  return (
    <div className="space-y-3 rounded-xl border border-card-border p-3.5">
      <label className={fieldLabelClass}>
        Name
        <input
          className={softInputClass}
          value={value.name}
          onChange={(event) => set({ name: event.target.value })}
          maxLength={80}
          placeholder="Haircut"
          autoFocus
        />
      </label>
      <div className="flex gap-2.5">
        <label className={cn(fieldLabelClass, "flex-1")}>
          Price
          <input
            type="text"
            inputMode="decimal"
            className={cn(softInputClass, "tabular-nums")}
            value={value.priceText}
            onChange={(event) => set({ priceText: event.target.value })}
            placeholder="40.00"
          />
        </label>
        <label className={cn(fieldLabelClass, "flex-1")}>
          Length
          <select className={softInputClass} value={value.minutes} onChange={(event) => set({ minutes: Number(event.target.value) })}>
            {[...new Set([...LENGTHS, value.minutes])]
              .sort((a, b) => a - b)
              .map((minutes) => (
                <option key={minutes} value={minutes}>
                  {formatLength(minutes)}
                </option>
              ))}
          </select>
        </label>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-sm font-medium text-muted-foreground">Deposit</legend>
        <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-muted p-1">
          {DEPOSIT_TYPES.map((option) => {
            const active = value.depositType === option.value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => set({ depositType: option.value })}
                className={cn(
                  "h-10 rounded-[10px] text-sm transition-colors",
                  active ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground"
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
        {value.depositType !== "none" ? (
          <label className={cn(fieldLabelClass, "pt-1")}>
            {value.depositType === "percent" ? "Percent" : "Amount"}
            <input
              type="text"
              inputMode="decimal"
              className={cn(softInputClass, "tabular-nums")}
              value={value.depositText}
              onChange={(event) => set({ depositText: event.target.value })}
              placeholder={value.depositType === "percent" ? "25" : "20.00"}
            />
          </label>
        ) : null}
        <p className="text-xs text-muted-foreground">Paid when they book, and taken off what they owe at the appointment.</p>
      </fieldset>
      <label className={fieldLabelClass}>
        Time after (buffer)
        <select
          className={softInputClass}
          value={value.bufferMinutes}
          onChange={(event) => set({ bufferMinutes: Number(event.target.value) })}
        >
          {[...new Set([...BUFFERS, value.bufferMinutes])]
            .sort((a, b) => a - b)
            .map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? "None" : `${minutes} min`}
              </option>
            ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-sm font-medium text-foreground">Customers can book this</span>
          <span className="block text-xs text-muted-foreground">Turn off to hide it without deleting it.</span>
        </span>
        <Switch checked={value.active} onCheckedChange={(active) => set({ active })} aria-label="Customers can book this" />
      </label>
      {showErrors && error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          className="h-10 flex-1 rounded-full font-semibold"
          onClick={() => {
            setShowErrors(true)
            if (!error) onDone()
          }}
        >
          Done
        </Button>
        <Button type="button" variant="outline" className="h-10 flex-1 rounded-full border-card-border bg-card" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {onRemove ? (
        <button type="button" className="w-full py-1 text-sm text-destructive" onClick={onRemove}>
          Remove service
        </button>
      ) : null}
    </div>
  )
}
