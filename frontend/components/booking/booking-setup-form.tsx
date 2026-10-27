"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { PickerInput } from "@/components/booking/picker-input"
import { useToast } from "@/hooks/use-toast"
import { cardClass, fieldLabelClass, localToday, softInputClass } from "@/components/invoices/invoice-ui"
import { cn } from "@/lib/utils"
import {
  BOOKING_DAYS,
  BOOKING_DAY_NAMES,
  BOOKING_MAX_BLOCKS_PER_DAY,
  BOOKING_MAX_DAYS_OFF,
  BOOKING_MAX_LOCATION,
  BOOKING_MAX_SERVICES,
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
  onSave,
}: {
  initial: BookingSettings
  // New services start from its default deposit.
  invoiceSettings: InvoiceSettings | null
  onSave: (input: BookingSettingsInput) => Promise<BookingSettings>
}) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial))
  const [editing, setEditing] = useState<{ service: ServiceDraft; isNew: boolean } | null>(null)
  // A single day leaves "to" blank.
  const [dayOffFrom, setDayOffFrom] = useState("")
  const [dayOffTo, setDayOffTo] = useState("")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
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
  const upcomingDaysOff = draft.daysOff.filter((date) => date >= today)
  const dayOffRanges = bookingDayOffRanges(upcomingDaysOff)
  const newDaysOff = /^\d{4}-\d{2}-\d{2}$/.test(dayOffFrom) && dayOffFrom >= today
    ? bookingDatesInRange(dayOffFrom, dayOffTo || dayOffFrom)
    : []
  const dayOffError =
    dayOffFrom && dayOffTo && dayOffTo < dayOffFrom
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

  // Overlapping or back-to-back ranges join up when they're shown.
  function addDaysOff() {
    if (newDaysOff.length === 0 || dayOffError) return
    update({ daysOff: [...new Set([...upcomingDaysOff, ...newDaysOff])].sort() })
    setDayOffFrom("")
    setDayOffTo("")
  }

  async function save() {
    if (saving || hasDayProblem || editing) return
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await onSave({ ...draft, daysOff: upcomingDaysOff })
      setDraft(toDraft(saved))
      toast({ title: "Booking saved" })
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Couldn't save. Check your connection and try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <p className="text-sm leading-relaxed text-muted-foreground">
        Set up what customers can book and when you&apos;re open. Your booking link comes next — nothing here is
        visible to customers yet.
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
        <h2 className="text-sm font-semibold text-muted-foreground">Weekly hours</h2>
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
      </section>

      <section className={cn(cardClass, "space-y-3")}>
        <h2 className="text-sm font-semibold text-muted-foreground">Days off</h2>
        <div className="flex items-end gap-2">
          <label className={cn(fieldLabelClass, "min-w-0 flex-1")}>
            From
            <PickerInput
              type="date"
              min={today}
              placeholder="Pick a date"
              value={dayOffFrom}
              onChange={(event) => setDayOffFrom(event.target.value)}
            />
          </label>
          <label className={cn(fieldLabelClass, "min-w-0 flex-1")}>
            To
            <PickerInput
              type="date"
              min={dayOffFrom || today}
              placeholder="Optional"
              value={dayOffTo}
              onChange={(event) => setDayOffTo(event.target.value)}
            />
          </label>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full rounded-full border-card-border bg-card font-semibold"
          disabled={newDaysOff.length === 0 || dayOffError !== null}
          onClick={addDaysOff}
        >
          Add days off
        </Button>
        {dayOffError ? <p className="text-sm text-destructive">{dayOffError}</p> : null}
        {dayOffRanges.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {dayOffRanges.map((range) => {
              const label = formatDayOffRange(range.start, range.end)
              return (
                <li key={range.start} className="flex items-center gap-1 rounded-full bg-muted py-1 pl-3 pr-1 text-sm">
                  {label}
                  <button
                    type="button"
                    aria-label={`Remove ${label}`}
                    className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      update({ daysOff: draft.daysOff.filter((date) => date < range.start || date > range.end) })
                    }
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Holidays or vacation: no one can book these dates. For one day, leave To blank.</p>
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

      {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
      {editing ? <p className="text-sm text-muted-foreground">Finish the service you&apos;re editing first.</p> : null}
      <Button
        type="submit"
        disabled={saving || hasDayProblem || editing !== null}
        className="h-[52px] w-full rounded-full text-base font-semibold"
      >
        {saving ? "Saving..." : "Save"}
      </Button>
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
