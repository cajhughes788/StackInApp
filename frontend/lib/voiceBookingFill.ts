// Turns a voice booking reply (shared/voiceBooking.ts) into what the app
// should do: fill the New appointment form, or open one appointment's
// Change time with the new time filled in. All of it happens on the phone:
// AM or PM is picked from the person's booking hours, names are matched to
// saved clients and services, and "my 3" is found among their appointments
// (which never go to the server). Anything that fits more than one thing is
// a question with buttons, never a guess.

import { clientKey } from "@shared/clients"
import { BOOKING_DAYS, bookingMinutesOfDay, type BookingSettings } from "@shared/schemas/booking"
import type { VoiceBookingCurrent, VoiceBookingResult, VoiceTime } from "@shared/voiceBooking"
import { matchSavedClients, type VoiceSavedClient } from "@/lib/voiceInvoiceFill"

export type BookingHours = Pick<BookingSettings, "weeklyHours" | "daysOff">

const pad = (n: number) => String(n).padStart(2, "0")
const clock = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`

/** A start time that falls inside one of that day's open blocks. */
export function startsInHours(hours: BookingHours | null, date: string, time: string): boolean {
  if (!hours || hours.daysOff.includes(date)) return false
  const blocks = hours.weeklyHours[BOOKING_DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]] ?? []
  const start = bookingMinutesOfDay(time)
  return blocks.some((block) => start >= bookingMinutesOfDay(block.start) && start < bookingMinutesOfDay(block.end))
}

/** The 24-hour times a spoken time could mean: one when AM/PM was said, else both. */
export function timeReadings(time: VoiceTime): string[] {
  const { hour, minute, meridiem } = time
  if (hour === 0 || hour >= 13) return [clock(hour, minute)]
  if (meridiem === "am") return [clock(hour === 12 ? 0 : hour, minute)]
  if (meridiem === "pm") return [clock(hour === 12 ? 12 : hour + 12, minute)]
  if (hour === 12) return [clock(12, minute)]
  return [clock(hour, minute), clock(hour + 12, minute)]
}

/** A spoken time as "HH:MM". With no AM/PM said: the reading that falls in
 * their hours that day when only one does; otherwise 7–11 is morning and
 * 12–6 is afternoon (nobody books a 3 AM haircut). */
export function resolveTime(time: VoiceTime, date: string | null, hours: BookingHours | null): string {
  const readings = timeReadings(time)
  if (readings.length === 1) return readings[0]
  const [am, pm] = readings
  if (date && hours) {
    const amFits = startsInHours(hours, date, am)
    const pmFits = startsInHours(hours, date, pm)
    if (amFits !== pmFits) return amFits ? am : pm
  }
  return time.hour >= 7 ? am : pm
}

export type VoiceService = { id: string; name: string }

const WORD_SKIP = new Set(["the", "and", "for", "with", "a", "an", "of"])
const words = (text: string) => clientKey(text).split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !WORD_SKIP.has(word))

/** Saved services a spoken name could mean: the exact name wins; then names
 * that contain it or that it contains ("cut" → "Haircut"); then shared words. */
export function matchServices(spoken: string, services: VoiceService[]): VoiceService[] {
  const key = clientKey(spoken)
  if (!key) return []
  const exact = services.find((service) => clientKey(service.name) === key)
  if (exact) return [exact]
  const squash = (text: string) => clientKey(text).replace(/[^a-z0-9]/g, "")
  const contains = services.filter((service) => squash(service.name).includes(squash(spoken)) || squash(spoken).includes(squash(service.name)))
  if (contains.length > 0) return contains
  const said = new Set(words(spoken))
  return services.filter((service) => words(service.name).some((word) => said.has(word)))
}

export type BookingVoiceQuestion =
  | { id: string; kind: "client"; prompt: string; spokenName: string; options: VoiceSavedClient[] }
  | { id: string; kind: "service"; prompt: string; spokenName: string; options: VoiceService[] }

export type BookingClientPick = { kind: "saved"; client: VoiceSavedClient } | { kind: "new"; name: string }
export type BookingServicePick = { kind: "saved"; service: VoiceService } | { kind: "custom"; name: string }

export type BookingFillPlan = {
  client: BookingClientPick | null
  clientEmail: string | null
  clientPhone: string | null
  service: BookingServicePick | null
  price: number | null
  minutes: number | null
  date: string | null
  startTime: string | null
  location: string | null
  // false = "Book it now"; true = "Ask them to confirm"; null = leave it.
  askToConfirm: boolean | null
  questions: BookingVoiceQuestion[]
  skipped: string[]
}

export type BookingFillContext = {
  services: VoiceService[]
  savedClients: VoiceSavedClient[]
  hours: BookingHours | null
  today: string
  // The form's date now (a time said alone is on that day).
  currentDate: string | null
  fixing: boolean
}

export function planBookingFill(result: VoiceBookingResult, ctx: BookingFillContext): BookingFillPlan {
  const skipped: string[] = []
  const questions: BookingVoiceQuestion[] = []

  let client: BookingClientPick | null = null
  const spokenClient = result.clientName?.trim() || null
  if (spokenClient) {
    const matches = matchSavedClients(spokenClient, ctx.savedClients)
    if (matches.length === 1) client = { kind: "saved", client: matches[0] }
    else if (matches.length > 1) {
      questions.push({ id: "client", kind: "client", prompt: `Which ${spokenClient}?`, spokenName: spokenClient, options: matches.slice(0, 4) })
    } else client = { kind: "new", name: spokenClient }
  }

  let service: BookingServicePick | null = null
  const spokenService = result.serviceName?.trim() || null
  if (spokenService) {
    const matches = matchServices(spokenService, ctx.services)
    if (matches.length === 1) service = { kind: "saved", service: matches[0] }
    else if (matches.length > 1) {
      questions.push({ id: "service", kind: "service", prompt: `Which ${spokenService.toLowerCase()}?`, spokenName: spokenService, options: matches.slice(0, 5) })
    } else service = { kind: "custom", name: spokenService }
  }

  let date = result.date
  if (date && date < ctx.today) {
    skipped.push("That day has already passed, so the date wasn't changed.")
    date = null
  }
  const day = date ?? ctx.currentDate
  const startTime = result.time ? resolveTime(result.time, day, ctx.hours) : null

  return {
    client,
    clientEmail: result.clientEmail,
    clientPhone: result.clientPhone,
    service,
    price: result.price !== null ? Math.round(result.price * 100) / 100 : null,
    minutes: result.minutes,
    date,
    startTime,
    location: result.location?.trim() || null,
    askToConfirm: result.confirmNow === null ? null : !result.confirmNow,
    questions,
    skipped,
  }
}

export type BookingFormSnapshot = {
  clientName: string
  clientEmail: string
  clientPhone: string
  serviceName: string
  priceText: string
  minutes: number
  date: string
  startTime: string
  location: string
}

/** What's on the New appointment form now, for a "Fix by voice" request. */
export function voiceBookingCurrentFor(form: BookingFormSnapshot): VoiceBookingCurrent {
  const price = Number(form.priceText.replace(/[$,\s]/g, ""))
  return {
    clientName: form.clientName.trim().slice(0, 80) || null,
    clientEmail: form.clientEmail.trim().slice(0, 254) || null,
    clientPhone: form.clientPhone.trim().slice(0, 40) || null,
    serviceName: form.serviceName.trim().slice(0, 80) || null,
    price: form.priceText.trim() && Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : null,
    minutes: Math.max(1, Math.min(1440, Math.round(form.minutes))),
    date: /^\d{4}-\d{2}-\d{2}$/.test(form.date) ? form.date : null,
    startTime: /^\d{2}:\d{2}$/.test(form.startTime) ? form.startTime : null,
    location: form.location.trim().slice(0, 500) || null,
  }
}

/** Words for the phone's speech recognition: client and service names, and booking words. */
export function voiceBookingHints(clientNames: string[], serviceNames: string[]): string[] {
  const hints = new Set<string>(["book", "move", "appointment", "tomorrow", "next week", "already confirmed"])
  for (const name of serviceNames.slice(0, 40)) if (name.trim()) hints.add(name.trim())
  for (const name of clientNames.slice(0, 60)) if (name.trim()) hints.add(name.trim())
  return [...hints].slice(0, 100)
}

/* ---------------- Moving: "move my 3 to 4" ---------------- */

export type MovableAppointment = { id: string; clientName: string; serviceName: string; date: string; startTime: string }

export type MoveChoice = { appointment: MovableAppointment; date: string; startTime: string }

export type MovePlan =
  | { kind: "go"; choice: MoveChoice }
  | { kind: "pick"; prompt: string; options: MoveChoice[] }
  | { kind: "none"; message: string }

function clientFits(spoken: string, name: string): boolean {
  const said = clientKey(spoken)
  const full = clientKey(name)
  if (!said) return false
  if (full === said || full.includes(said)) return true
  return !said.includes(" ") && full.split(" ")[0] === said
}

export type MoveContext = {
  // Booked or waiting to be confirmed, and not started yet; soonest first.
  appointments: MovableAppointment[]
  // The day shown on the calendar ("my 3" is on it), or today.
  viewedDate: string
  today: string
  hours: BookingHours | null
}

export function planMove(result: VoiceBookingResult, ctx: MoveContext): MovePlan {
  if (!result.fromClient && !result.fromDate && !result.fromTime) {
    return { kind: "none", message: "Didn't catch which appointment to move. Try “move my 3 to 4” or “move Jenna to Friday at 10.”" }
  }
  if (!result.date && !result.time) {
    return { kind: "none", message: "Didn't catch when to move it to. Try “move my 3 to 4.”" }
  }

  let found = ctx.appointments
  if (result.fromClient) found = found.filter((item) => clientFits(result.fromClient as string, item.clientName))
  const fromDate = result.fromDate ?? (result.fromTime && !result.fromClient ? ctx.viewedDate : null)
  if (fromDate) found = found.filter((item) => item.date === fromDate)
  if (result.fromTime) {
    const readings = new Set(timeReadings(result.fromTime))
    found = found.filter((item) => readings.has(item.startTime))
  }
  found = [...found].sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))

  // Only a client said: their next appointment (one per client when the name fits several).
  if (result.fromClient && !result.fromDate && !result.fromTime) {
    const firstPerClient: MovableAppointment[] = []
    for (const item of found) {
      if (!firstPerClient.some((other) => clientKey(other.clientName) === clientKey(item.clientName))) firstPerClient.push(item)
    }
    found = firstPerClient
  }

  const target = (item: MovableAppointment): MoveChoice => {
    const date = result.date ?? item.date
    return { appointment: item, date, startTime: result.time ? resolveTime(result.time, date, ctx.hours) : item.startTime }
  }
  const choices = found.map(target).filter((choice) => choice.date >= ctx.today)

  if (choices.length === 0) {
    return {
      kind: "none",
      message: found.length > 0 ? "That day has already passed. Pick a day from today on." : "Couldn't find that appointment among your upcoming ones.",
    }
  }
  if (choices.length === 1) return { kind: "go", choice: choices[0] }
  return { kind: "pick", prompt: "Which appointment?", options: choices.slice(0, 5) }
}

/* ---------------- Booking page → New appointment ---------------- */

// A booking said on the Booking page, handed to the New appointment form
// it opens (so it isn't sent to the server twice).
let pendingBookingFill: { transcript: string; result: VoiceBookingResult } | null = null

export function stashBookingFill(fill: { transcript: string; result: VoiceBookingResult }): void {
  pendingBookingFill = fill
}

export function peekBookingFill(): { transcript: string; result: VoiceBookingResult } | null {
  return pendingBookingFill
}

export function clearBookingFill(): void {
  pendingBookingFill = null
}
