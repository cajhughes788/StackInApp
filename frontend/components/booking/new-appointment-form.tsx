"use client"

import { useMemo, useRef, useState } from "react"
import { TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { PickerInput } from "@/components/booking/picker-input"
import { cardClass, fieldLabelClass, localToday, softInputClass } from "@/components/invoices/invoice-ui"
import { cn } from "@/lib/utils"
import { bookingHoursWarning, formatBookingTime, appointmentEndTime } from "@shared/appointments"
import { clientKey } from "@shared/clients"
import { formatInvoiceMoney } from "@shared/invoiceDisplay"
import type { AppointmentCreateInput, AppointmentType } from "@shared/schemas/appointment"
import { BOOKING_MAX_LOCATION, bookingServiceProblem, type BookingDeposit, type BookingSettings } from "@shared/schemas/booking"
import type { ClientType } from "@shared/schemas/client"

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
  onCreate,
}: {
  settings: BookingSettings
  savedClients: ClientType[]
  // Resolves once it's booked; throws with the reason (e.g. a double-booking) if not.
  onCreate: (input: AppointmentCreateInput) => Promise<{ appointment: AppointmentType; shareUrl: string | null }>
}) {
  const services = settings.services.filter((service) => service.active)
  const today = localToday()

  const [clientName, setClientName] = useState("")
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientEmail, setClientEmail] = useState("")
  const [clientPhone, setClientPhone] = useState("")

  // A saved service's id, "custom", or nothing picked yet.
  const [serviceChoice, setServiceChoice] = useState<string | null>(services.length === 0 ? "custom" : null)
  const [serviceName, setServiceName] = useState("")
  const [priceText, setPriceText] = useState("")
  const [minutes, setMinutes] = useState(60)
  const [bufferMinutes, setBufferMinutes] = useState(0)
  const [depositType, setDepositType] = useState<BookingDeposit["type"]>("none")
  const [depositText, setDepositText] = useState("")
  const [saveAsService, setSaveAsService] = useState(false)

  const [date, setDate] = useState(today)
  const [startTime, setStartTime] = useState("")
  const [askToConfirm, setAskToConfirm] = useState(true)
  // Starts from Booking setup; changing it here is for this appointment only.
  const [location, setLocation] = useState(settings.location)

  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // One id per appointment being made, so a retry after a dropped
  // connection returns the same booking instead of making two.
  const mutationId = useRef(newMutationId())

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

  const deposit: BookingDeposit =
    depositType === "none" ? { type: "none", value: 0 } : { type: depositType, value: parseAmount(depositText) ?? 0 }

  const errors = {
    client: clientName.trim() ? null : "Who's the appointment for?",
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
  const hoursWarning = date && startTime ? bookingHoursWarning(settings, date, startTime, minutes) : null

  async function submit() {
    setShowErrors(true)
    if (hasErrors || saving || price === null) return
    setSaving(true)
    setSaveError(null)
    try {
      await onCreate({
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
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Couldn't book it. Check your connection and try again.")
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
              placeholder="Optional"
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
              placeholder="Optional"
              maxLength={40}
              autoComplete="off"
            />
          </label>
        </div>
        {fieldError(errors.email)}
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
            ? "You get a link to text or email them. The time is held for 48 hours while they confirm."
            : "Confirmed now — you've already agreed on it with them."}
        </p>
      </section>

      {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
      {showErrors && hasErrors ? <p className="text-sm text-destructive">Fix the highlighted fields above.</p> : null}
      <Button type="submit" disabled={saving} className="h-[52px] w-full rounded-full text-base font-semibold">
        {saving ? "Booking..." : askToConfirm ? "Book and get link" : "Book it"}
      </Button>
    </form>
  )
}
