"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { appointmentTimeRange } from "@/components/booking/appointment-ui"
import { cardClass } from "@/components/invoices/invoice-ui"
import { cn } from "@/lib/utils"
import {
  addDays,
  calendarDayBlocks,
  calendarDayParts,
  calendarHourRange,
  calendarNowMinutes,
  calendarOpenBlocks,
  calendarSlotAt,
  calendarToday,
  calendarWeek,
  calendarWeekLabel,
} from "@shared/bookingCalendar"
import { appointmentStatus, formatBookingTime } from "@shared/appointments"
import { busyMinutesOnDate } from "@shared/busyTimes"
import type { AppointmentType } from "@shared/schemas/appointment"
import { BookingSettingsSchema, type BookingSettings } from "@shared/schemas/booking"

// Height of one hour on the timeline.
const HOUR_PX = 64
const MIN_BLOCK_PX = 24

// The Booking page's calendar: a week strip (Sunday first, dots for
// appointments) over the picked day's timeline. Tapping a block opens it;
// tapping an empty spot starts a new appointment then.
export function BookingCalendar({
  appointments,
  busy = [],
  settings,
  timeZone,
}: {
  // Only ones that are happening (no canceled, declined or expired).
  appointments: AppointmentType[]
  // When the owner is busy in their own calendars, drawn as gray "Busy" blocks.
  busy?: Array<{ start: string; end: string; calendar: string }>
  settings: BookingSettings | null
  timeZone: string
}) {
  const router = useRouter()
  const hours = settings ?? BookingSettingsSchema.parse({})
  const [today, setToday] = useState(() => calendarToday(timeZone))
  const [selected, setSelected] = useState(today)
  const [nowMinutes, setNowMinutes] = useState(() => calendarNowMinutes(timeZone))

  // The "now" line moves, and today rolls over at midnight.
  useEffect(() => {
    const tick = () => {
      setNowMinutes(calendarNowMinutes(timeZone))
      setToday(calendarToday(timeZone))
    }
    tick()
    const timer = window.setInterval(tick, 60_000)
    return () => window.clearInterval(timer)
  }, [timeZone])

  const week = useMemo(() => calendarWeek(selected), [selected])
  const byDate = useMemo(() => {
    const map = new Map<string, AppointmentType[]>()
    for (const appointment of appointments) map.set(appointment.date, [...(map.get(appointment.date) ?? []), appointment])
    return map
  }, [appointments])

  const dayAppointments = byDate.get(selected) ?? []
  const dayBusy = useMemo(() => busyMinutesOnDate(busy, selected, timeZone), [busy, selected, timeZone])
  const range = calendarHourRange(hours, dayAppointments)
  const blocks = calendarDayBlocks(dayAppointments)
  const open = calendarOpenBlocks(hours, selected)
  const dayOff = hours.daysOff.includes(selected)
  const top = (minutes: number) => ((minutes - range.start) / 60) * HOUR_PX
  const height = ((range.end - range.start) / 60) * HOUR_PX

  // Swipe the week strip to change weeks.
  const touchX = useRef<number | null>(null)
  const moveWeek = (weeks: number) => setSelected((date) => addDays(date, weeks * 7))

  function pickSpot(event: React.MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    const minutes = range.start + ((event.clientY - box.top) / HOUR_PX) * 60
    const time = calendarSlotAt(minutes, hours.slotStepMinutes)
    router.push(`/app/booking/new?date=${selected}&time=${time}`)
  }

  return (
    <section className={cn(cardClass, "space-y-3 p-3")}>
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold text-foreground">{calendarWeekLabel(week)}</h2>
        <div className="flex items-center gap-1">
          {selected !== today ? (
            <button
              type="button"
              className="h-8 rounded-full border border-card-border px-3 text-xs font-semibold text-foreground hover:bg-muted"
              onClick={() => setSelected(today)}
            >
              Today
            </button>
          ) : null}
          <button
            type="button"
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            onClick={() => moveWeek(-1)}
            aria-label="Previous week"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
            onClick={() => moveWeek(1)}
            aria-label="Next week"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div
        className="grid grid-cols-7 gap-1"
        onTouchStart={(event) => {
          touchX.current = event.touches[0]?.clientX ?? null
        }}
        onTouchEnd={(event) => {
          const start = touchX.current
          const end = event.changedTouches[0]?.clientX
          touchX.current = null
          if (start === null || end === undefined || Math.abs(end - start) < 50) return
          moveWeek(end < start ? 1 : -1)
        }}
      >
        {week.map((date) => {
          const { weekday, day } = calendarDayParts(date)
          const count = byDate.get(date)?.length ?? 0
          const isSelected = date === selected
          return (
            <button
              key={date}
              type="button"
              onClick={() => setSelected(date)}
              aria-pressed={isSelected}
              aria-label={`${weekday} ${day}${count ? `, ${count} appointment${count === 1 ? "" : "s"}` : ""}`}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-0.5 rounded-xl text-foreground",
                isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                !isSelected && date === today && "ring-1 ring-primary"
              )}
            >
              <span className={cn("text-[11px]", isSelected ? "opacity-80" : "text-muted-foreground")}>{weekday}</span>
              <span className="text-base font-semibold tabular-nums">{day}</span>
              <span className="flex h-1.5 items-center gap-0.5" aria-hidden="true">
                {Array.from({ length: Math.min(count, 3) }, (_, index) => (
                  <span key={index} className={cn("size-1.5 rounded-full", isSelected ? "bg-primary-foreground" : "bg-primary")} />
                ))}
                {count > 3 ? <span className="text-[9px] leading-none">+</span> : null}
              </span>
            </button>
          )
        })}
      </div>

      {dayOff ? <p className="rounded-xl bg-muted px-3 py-2 text-center text-sm text-muted-foreground">Day off</p> : null}

      <div className="relative flex" style={{ height }}>
        {/* Hour labels */}
        <div className="relative w-12 shrink-0" aria-hidden="true">
          {Array.from({ length: (range.end - range.start) / 60 }, (_, index) => {
            const minutes = range.start + index * 60
            return (
              <span
                key={minutes}
                className={cn("absolute right-2 text-[11px] tabular-nums text-muted-foreground", index > 0 && "-translate-y-1/2")}
                style={{ top: top(minutes) }}
              >
                {formatBookingTime(`${String(minutes / 60).padStart(2, "0")}:00`)}
              </span>
            )
          })}
        </div>

        {/* The day: closed time darker, open hours lighter; tap empty time to book. */}
        <div
          className="relative flex-1 cursor-pointer overflow-hidden rounded-xl bg-muted"
          onClick={pickSpot}
          role="presentation"
        >
          {open.map((block) => (
            <div
              key={`${block.start}-${block.end}`}
              className="absolute inset-x-0 bg-card"
              style={{ top: top(Math.max(block.start, range.start)), height: ((Math.min(block.end, range.end) - Math.max(block.start, range.start)) / 60) * HOUR_PX }}
              aria-hidden="true"
            />
          ))}
          {Array.from({ length: (range.end - range.start) / 60 - 1 }, (_, index) => (
            <div
              key={index}
              className="absolute inset-x-0 border-t border-card-border"
              style={{ top: (index + 1) * HOUR_PX }}
              aria-hidden="true"
            />
          ))}

          {dayBusy
            .filter((item) => item.end > range.start && item.start < range.end)
            .map((item) => {
              const start = Math.max(item.start, range.start)
              const end = Math.min(item.end, range.end)
              const blockHeight = ((end - start) / 60) * HOUR_PX
              return (
                <div
                  key={`busy-${item.block.start}-${item.block.calendar}`}
                  className="pointer-events-none absolute inset-x-0 overflow-hidden px-2 py-1 text-xs leading-tight text-muted-foreground"
                  style={{
                    top: top(start),
                    height: blockHeight,
                    backgroundImage:
                      "repeating-linear-gradient(135deg, color-mix(in srgb, var(--muted-foreground) 22%, transparent) 0 6px, transparent 6px 12px)",
                  }}
                >
                  {blockHeight >= 18 ? <span className="block truncate font-medium">Busy · {item.block.calendar}</span> : null}
                </div>
              )
            })}

          {blocks.map(({ appointment, start, end, bufferEnd, column, columns }) => {
            const status = appointmentStatus(appointment, new Date().toISOString())
            const waiting = status === "requested"
            const ended = status === "completed" || status === "no_show"
            const blockHeight = Math.max(MIN_BLOCK_PX, ((end - start) / 60) * HOUR_PX)
            const width = `calc(${100 / columns}% - 4px)`
            const left = `calc(${(100 / columns) * column}% + 2px)`
            return (
              <div key={appointment.id}>
                {bufferEnd > end ? (
                  <div
                    className="absolute rounded-b-md opacity-60"
                    style={{
                      top: top(end),
                      height: ((bufferEnd - end) / 60) * HOUR_PX,
                      left,
                      width,
                      backgroundImage:
                        "repeating-linear-gradient(135deg, color-mix(in srgb, var(--muted-foreground) 40%, transparent) 0 2px, transparent 2px 6px)",
                    }}
                    aria-hidden="true"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    router.push(`/app/booking/view?id=${encodeURIComponent(appointment.id)}`)
                  }}
                  className={cn(
                    "absolute overflow-hidden rounded-md px-2 py-1 text-left text-xs leading-tight",
                    waiting
                      ? "border border-dashed border-amber-500 bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100"
                      : ended
                        ? "bg-secondary text-muted-foreground"
                        : "bg-primary text-primary-foreground"
                  )}
                  style={{ top: top(start), height: blockHeight, left, width }}
                >
                  <span className="block truncate font-semibold">
                    {appointment.clientName}
                    {waiting ? " · Waiting" : status === "no_show" ? " · No-show" : ""}
                  </span>
                  {blockHeight >= 40 ? (
                    <span className="block truncate opacity-90">
                      {appointment.serviceName} · {appointmentTimeRange(appointment)}
                    </span>
                  ) : null}
                </button>
              </div>
            )
          })}

          {selected === today && nowMinutes >= range.start && nowMinutes <= range.end ? (
            <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: top(nowMinutes) }} aria-hidden="true">
              <div className="relative border-t-2 border-red-500">
                <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-red-500" />
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <p className="px-1 text-center text-xs text-muted-foreground">
        Tap an open time to book it ·{" "}
        <Link href="/app/booking/setup#calendar-sync" className="font-medium text-foreground underline-offset-2 hover:underline">
          Sync to your calendar
        </Link>
      </p>
    </section>
  )
}
