import { randomBytes } from "node:crypto"
import { z } from "zod"
import { db } from "../admin"
import { assertWorkspaceMembership } from "../lib/workspaceMembership"
import { BadRequestError, ConflictError, NotFoundError } from "../lib/httpErrors"
import { SafeFetchError, fetchPublicText } from "../lib/safeFetch"
import { assertIndependentWorkspace, readBookingSettings } from "./bookingService"
import { parseBusyTimes } from "@shared/busyCalendar"
import {
  BUSY_CALENDAR_NAME_MAX,
  BUSY_REFRESH_MS,
  BusyCalendarError,
  MAX_BUSY_CALENDARS,
  activeBusyBlocks,
  busyCalendarHost,
  normalizeBusyCalendarUrl,
  type BusyBlock,
  type BusyDays,
} from "@shared/busyTimes"
import type { BookingSettings } from "@shared/schemas/booking"

// ---------------------------------------------------------------------------
// Busy calendars — workspaces/{workspaceId}/busyCalendars/{id}
//
// The owner's own calendars, read from their private iCal links so the
// booking page skips times they're busy (shared/busyTimes.ts). Each doc
// keeps the link (server only: firestore.rules lets no one read these, and
// the app is only ever told the website's name) and the busy times last
// read from it — start and end only. refreshBusyCalendars re-reads them
// every 15 minutes; the booking page re-reads a stale one first.
// ---------------------------------------------------------------------------

const MAX_ICS_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 10_000
// Tell the owner once a link has failed for this long (not on a blip).
const FAILURE_NOTICE_AFTER_MS = 60 * 60_000

const StoredCalendarSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  addedAt: z.string(),
  checkedAt: z.string().nullable().default(null),
  okAt: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  failingSince: z.string().nullable().default(null),
  failureNotifiedAt: z.string().nullable().default(null),
  timed: z.array(z.object({ start: z.string(), end: z.string() })).default([]),
  allDay: z.array(z.object({ startDate: z.string(), endDate: z.string() })).default([]),
})
type StoredCalendar = z.infer<typeof StoredCalendarSchema>

const AddInputSchema = z.object({
  name: z.string().trim().min(1, "Name the calendar.").max(BUSY_CALENDAR_NAME_MAX),
  url: z.string().trim().min(1, "Paste the calendar's link.").max(2000),
})

// What the app sees: never the link itself.
export type BusyCalendarSummary = {
  id: string
  name: string
  host: string
  checkedAt: string | null
  okAt: string | null
  error: string | null
  busyCount: number
}
export type BusyCalendarsView = {
  calendars: BusyCalendarSummary[]
  // The busy times that block booking now, each with its calendar's name.
  busy: Array<BusyBlock & { calendar: string }>
}

function calendarsCol(workspaceId: string) {
  return db.collection("workspaces").doc(workspaceId).collection("busyCalendars")
}

async function readCalendars(workspaceId: string): Promise<StoredCalendar[]> {
  const snap = await calendarsCol(workspaceId).get()
  return snap.docs
    .flatMap((doc) => {
      const parsed = StoredCalendarSchema.safeParse(doc.data())
      return parsed.success ? [parsed.data] : []
    })
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt))
}

function readWindow(booking: Pick<BookingSettings, "maxDaysAhead">, nowIso: string): { fromIso: string; toIso: string } {
  const now = Date.parse(nowIso)
  return {
    fromIso: new Date(now - 86_400_000).toISOString(),
    toIso: new Date(now + (booking.maxDaysAhead + 2) * 86_400_000).toISOString(),
  }
}

async function readBusyTimes(url: string, booking: BookingSettings, nowIso: string): Promise<{ timed: BusyBlock[]; allDay: BusyDays[] }> {
  let text: string
  try {
    text = await fetchPublicText(url, { maxBytes: MAX_ICS_BYTES, timeoutMs: FETCH_TIMEOUT_MS })
  } catch (error) {
    if (error instanceof SafeFetchError) throw new BusyCalendarError(error.message)
    throw error
  }
  return parseBusyTimes(text, { ...readWindow(booking, nowIso), timeZone: booking.timeZone })
}

function summary(calendar: StoredCalendar): BusyCalendarSummary {
  return {
    id: calendar.id,
    name: calendar.name,
    host: busyCalendarHost(calendar.url),
    checkedAt: calendar.checkedAt,
    okAt: calendar.okAt,
    error: calendar.error,
    busyCount: calendar.timed.length + calendar.allDay.length,
  }
}

function view(calendars: StoredCalendar[], booking: BookingSettings, nowIso: string): BusyCalendarsView {
  const busy = calendars.flatMap((calendar) =>
    activeBusyBlocks([calendar], { allDayBlocks: booking.busyAllDay, timeZone: booking.timeZone, nowIso }).map((block) => ({
      ...block,
      calendar: calendar.name,
    }))
  )
  return { calendars: calendars.map(summary), busy: busy.sort((a, b) => a.start.localeCompare(b.start)) }
}

/**
 * Reads one calendar again and saves what it found. A failure keeps the
 * busy times last read (they stop counting after a day) and, once it has
 * lasted an hour, tells the owner once.
 */
async function refreshCalendar(
  workspaceId: string,
  calendar: StoredCalendar,
  booking: BookingSettings,
  nowIso: string
): Promise<StoredCalendar> {
  let next: StoredCalendar
  try {
    const busy = await readBusyTimes(calendar.url, booking, nowIso)
    next = { ...calendar, ...busy, checkedAt: nowIso, okAt: nowIso, error: null, failingSince: null, failureNotifiedAt: null }
  } catch (error) {
    const message = error instanceof BusyCalendarError ? error.message : "The calendar couldn't be read."
    if (!(error instanceof BusyCalendarError)) console.error("busyCalendars: read failed", { workspaceId, id: calendar.id }, error)
    next = { ...calendar, checkedAt: nowIso, error: message, failingSince: calendar.failingSince ?? nowIso }
    if (!next.failureNotifiedAt && Date.parse(nowIso) - Date.parse(next.failingSince!) >= FAILURE_NOTICE_AFTER_MS) {
      next.failureNotifiedAt = nowIso
      await notifyOwnerOfFailure(workspaceId, calendar.name)
    }
  }
  // Removed meanwhile: don't bring it back.
  await db.runTransaction(async (txn) => {
    const ref = calendarsCol(workspaceId).doc(calendar.id)
    if (!(await txn.get(ref)).exists) return
    txn.set(ref, next)
  })
  return next
}

async function notifyOwnerOfFailure(workspaceId: string, calendarName: string): Promise<void> {
  try {
    const ownerUid = (await db.doc(`workspaces/${workspaceId}`).get()).data()?.ownerId as string | undefined
    if (!ownerUid) return
    const { sendTransactionNotification } = await import("./pushNotificationService.js")
    await sendTransactionNotification(ownerUid, {
      title: `Couldn't read your ${calendarName} calendar`,
      body: "Booking uses your last busy times for a day. Check the link in Booking setup.",
      data: { deepLink: "stackin://booking/setup", workspaceId },
    })
  } catch (error) {
    console.error("busyCalendars: failure push failed", { workspaceId }, error)
  }
}

// ---------------------------------------------------------------------------
// The owner's side (busyCalendars function)
// ---------------------------------------------------------------------------

export async function listBusyCalendars(workspaceId: string, uid: string): Promise<BusyCalendarsView> {
  await assertWorkspaceMembership(workspaceId, uid)
  await assertIndependentWorkspace(workspaceId)
  const [calendars, booking] = await Promise.all([readCalendars(workspaceId), readBookingSettings(workspaceId)])
  return view(calendars, booking, new Date().toISOString())
}

/** Adds a calendar once its link reads as a calendar (so a wrong link is caught now). */
export async function addBusyCalendar(workspaceId: string, uid: string, raw: unknown): Promise<BusyCalendarsView> {
  await assertWorkspaceMembership(workspaceId, uid)
  await assertIndependentWorkspace(workspaceId)
  const parsed = AddInputSchema.safeParse(raw)
  if (!parsed.success) throw new BadRequestError(parsed.error.issues[0]?.message ?? "Check the calendar's name and link.")
  let url: string
  try {
    url = normalizeBusyCalendarUrl(parsed.data.url)
  } catch (error) {
    throw new BadRequestError(error instanceof Error ? error.message : "That link can't be used.")
  }
  const [existing, booking] = await Promise.all([readCalendars(workspaceId), readBookingSettings(workspaceId)])
  if (existing.length >= MAX_BUSY_CALENDARS) throw new ConflictError(`You can add up to ${MAX_BUSY_CALENDARS} calendars.`)
  if (existing.some((calendar) => calendar.url === url)) throw new ConflictError("That calendar is already added.")

  const nowIso = new Date().toISOString()
  let busy: { timed: BusyBlock[]; allDay: BusyDays[] }
  try {
    busy = await readBusyTimes(url, booking, nowIso)
  } catch (error) {
    if (error instanceof BusyCalendarError) throw new BadRequestError(error.message)
    throw error
  }
  const calendar = StoredCalendarSchema.parse({
    id: randomBytes(9).toString("base64url"),
    name: parsed.data.name,
    url,
    addedAt: nowIso,
    checkedAt: nowIso,
    okAt: nowIso,
    ...busy,
  })
  await calendarsCol(workspaceId).doc(calendar.id).set(calendar)
  return view([...existing, calendar], booking, nowIso)
}

export async function removeBusyCalendar(workspaceId: string, uid: string, id: string): Promise<BusyCalendarsView> {
  await assertWorkspaceMembership(workspaceId, uid)
  await assertIndependentWorkspace(workspaceId)
  const ref = calendarsCol(workspaceId).doc(id)
  if (!(await ref.get()).exists) throw new NotFoundError("That calendar was already removed.")
  await ref.delete()
  const [calendars, booking] = await Promise.all([readCalendars(workspaceId), readBookingSettings(workspaceId)])
  return view(calendars, booking, new Date().toISOString())
}

// ---------------------------------------------------------------------------
// Booking: the busy times that block it now
// ---------------------------------------------------------------------------

/**
 * Busy blocks for the booking page and its double-booking checks. With
 * `refreshStale`, a calendar not read in 15 minutes is read first, giving up
 * after `timeoutMs` (the times last read are used then).
 */
export async function busyBlocksFor(
  workspaceId: string,
  booking: BookingSettings,
  options: { refreshStale: boolean; timeoutMs?: number } = { refreshStale: false }
): Promise<BusyBlock[]> {
  let calendars = await readCalendars(workspaceId)
  if (calendars.length === 0) return []
  const nowIso = new Date().toISOString()
  if (options.refreshStale) {
    const stale = calendars.filter((calendar) => !calendar.checkedAt || Date.parse(nowIso) - Date.parse(calendar.checkedAt) > BUSY_REFRESH_MS)
    if (stale.length > 0) {
      const refreshed = Promise.all(stale.map((calendar) => refreshCalendar(workspaceId, calendar, booking, nowIso).catch(() => calendar)))
      const done = await Promise.race([
        refreshed,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), options.timeoutMs ?? 4000)),
      ])
      if (done) calendars = calendars.map((calendar) => done.find((fresh) => fresh.id === calendar.id) ?? calendar)
    }
  }
  return activeBusyBlocks(calendars, { allDayBlocks: booking.busyAllDay, timeZone: booking.timeZone, nowIso })
}

/** Every workspace's calendars, re-read (refreshBusyCalendars, every 15 minutes). */
export async function refreshAllBusyCalendars(nowIso: string): Promise<{ read: number; failed: number }> {
  const snap = await db.collectionGroup("busyCalendars").get()
  const settings = new Map<string, Promise<BookingSettings>>()
  let read = 0
  let failed = 0
  for (const doc of snap.docs) {
    const workspaceRef = doc.ref.parent.parent
    if (!workspaceRef || workspaceRef.parent.id !== "workspaces") continue
    const parsed = StoredCalendarSchema.safeParse(doc.data())
    if (!parsed.success) continue
    // Read again a little early, so every run catches what the last one did.
    if (parsed.data.checkedAt && Date.parse(nowIso) - Date.parse(parsed.data.checkedAt) < BUSY_REFRESH_MS - 120_000) continue
    if (!settings.has(workspaceRef.id)) settings.set(workspaceRef.id, readBookingSettings(workspaceRef.id))
    try {
      const next = await refreshCalendar(workspaceRef.id, parsed.data, await settings.get(workspaceRef.id)!, nowIso)
      if (next.error) failed += 1
      else read += 1
    } catch (error) {
      failed += 1
      console.error("busyCalendars: refresh failed", { workspaceId: workspaceRef.id, id: parsed.data.id }, error)
    }
  }
  return { read, failed }
}

