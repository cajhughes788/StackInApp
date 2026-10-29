import ICAL from "ical.js"
import { DateTime } from "luxon"

import { BusyCalendarError, MAX_BUSY_BLOCKS, mergeBusyBlocks, type BusyBlock, type BusyDays, type ParsedBusyTimes } from "./busyTimes"

/* ------------------------------------------------------------
 * BUSY CALENDARS (server only: it uses the ical.js library) — the owner's own calendars (Google, Apple, Outlook) read
 * from their private iCal links, so the booking page never offers a time
 * they're busy. Pure rules shared by the server and tests; fetching and
 * saving live in backend busyCalendarsService.ts.
 *
 * Only when someone is busy is kept: never an event's name, place, notes
 * or guests. Free ("transparent") and canceled events don't count, repeats
 * are expanded, and events that came from 521's own calendar link are
 * skipped (they're appointments, already blocking their time — and a
 * canceled one shouldn't linger until the calendar app catches up).
 * All-day events are kept apart: they only block when Booking setup says so.
 * ------------------------------------------------------------ */

// 521's own events (shared/calendarFeed.ts writes UID:{id}@the521app.com).
const OWN_UID_SUFFIX = "@the521app.com"
// A runaway repeat (every minute for years) stops here.
const MAX_OCCURRENCES_PER_EVENT = 5000

function validZone(zone: string | null | undefined): zone is string {
  return !!zone && DateTime.local().setZone(zone).isValid
}

// An event time as an instant. Times with a time zone the file describes
// (or UTC) convert directly; a "floating" time, or one naming a zone the
// file doesn't describe, is read as that zone if it's a real one, else the
// business's own.
function instant(time: InstanceType<typeof ICAL.Time>, businessZone: string): string {
  const zoneId = time.zone?.tzid
  if (zoneId && zoneId !== "floating") return time.toJSDate().toISOString()
  const named = (time as unknown as { timezone?: string }).timezone
  const zone = validZone(named) ? named : businessZone
  return DateTime.fromObject(
    { year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second },
    { zone }
  ).toUTC().toISO()!
}

function dateOnly(time: InstanceType<typeof ICAL.Time>): string {
  return `${String(time.year).padStart(4, "0")}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`
}

function counts(event: InstanceType<typeof ICAL.Event>): boolean {
  const component = event.component
  const transp = String(component.getFirstPropertyValue("transp") ?? "").toUpperCase()
  const status = String(component.getFirstPropertyValue("status") ?? "").toUpperCase()
  return transp !== "TRANSPARENT" && status !== "CANCELLED"
}

/**
 * The busy times in an iCalendar file between `fromIso` and `toIso`.
 * Throws BusyCalendarError when it isn't a calendar.
 */
export function parseBusyTimes(ics: string, options: { fromIso: string; toIso: string; timeZone: string }): ParsedBusyTimes {
  if (!/BEGIN:VCALENDAR/i.test(ics.slice(0, 2000))) throw new BusyCalendarError("That link didn't give back a calendar. Check it's the iCal (.ics) link.")
  let calendar: InstanceType<typeof ICAL.Component>
  try {
    calendar = new ICAL.Component(ICAL.parse(ics))
  } catch {
    throw new BusyCalendarError("That calendar couldn't be read.")
  }
  const businessZone = validZone(options.timeZone) ? options.timeZone : "UTC"
  for (const zone of calendar.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(zone)
    } catch {
      // A broken zone: its times fall back to the business's zone.
    }
  }

  // Each event's moved or changed repeats (RECURRENCE-ID) belong to it.
  const masters = new Map<string, InstanceType<typeof ICAL.Event>>()
  const exceptions: Array<InstanceType<typeof ICAL.Event>> = []
  for (const component of calendar.getAllSubcomponents("vevent")) {
    let event: InstanceType<typeof ICAL.Event>
    try {
      event = new ICAL.Event(component)
    } catch {
      continue
    }
    const uid = event.uid ?? ""
    if (uid.endsWith(OWN_UID_SUFFIX)) continue
    if (component.hasProperty("recurrence-id")) exceptions.push(event)
    else masters.set(uid || `#${masters.size}`, event)
  }
  for (const exception of exceptions) {
    const master = masters.get(exception.uid ?? "")
    if (master) master.relateException(exception)
    else masters.set(`#x${masters.size}`, exception)
  }

  const from = Date.parse(options.fromIso)
  const to = Date.parse(options.toIso)
  const fromDate = DateTime.fromISO(options.fromIso, { zone: businessZone }).toISODate()!
  const toDate = DateTime.fromISO(options.toIso, { zone: businessZone }).toISODate()!
  const timed: BusyBlock[] = []
  const allDay: BusyDays[] = []
  const add = (start: InstanceType<typeof ICAL.Time>, end: InstanceType<typeof ICAL.Time> | null, item: InstanceType<typeof ICAL.Event>) => {
    if (!counts(item)) return
    if (start.isDate) {
      const startDate = dateOnly(start)
      const endDate = end ? dateOnly(end) : DateTime.fromISO(startDate).plus({ days: 1 }).toISODate()!
      if (endDate > fromDate && startDate <= toDate && startDate < endDate) allDay.push({ startDate, endDate })
      return
    }
    const startIso = instant(start, businessZone)
    const endIso = end ? instant(end, businessZone) : startIso
    if (Date.parse(endIso) > from && Date.parse(startIso) < to && startIso < endIso) timed.push({ start: startIso, end: endIso })
  }

  for (const event of masters.values()) {
    try {
      if (!event.isRecurring()) {
        add(event.startDate, event.endDate, event)
        continue
      }
      const iterator = event.iterator()
      for (let count = 0, next = iterator.next(); next && count < MAX_OCCURRENCES_PER_EVENT; count += 1, next = iterator.next()) {
        const details = event.getOccurrenceDetails(next)
        if (details.startDate.toJSDate().getTime() > to + 86_400_000) break
        add(details.startDate, details.endDate, details.item)
      }
    } catch {
      // One unreadable event doesn't lose the rest.
    }
  }
  return { timed: mergeBusyBlocks(timed).slice(0, MAX_BUSY_BLOCKS), allDay: allDay.slice(0, MAX_BUSY_BLOCKS) }
}
