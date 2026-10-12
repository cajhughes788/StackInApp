"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  Banknote,
  ChevronDown,
  Clock3,
  CreditCard,
  type LucideIcon,
} from "lucide-react"
import { formatCurrency } from "@/lib/helpers"

type SegmentId = "hourly" | "cash" | "card"

type SegmentDefinition = {
  id: SegmentId
  label: string
  value: number
  color: string
  iconColor: string
  icon: LucideIcon
  note: string
}

type YearlyEarningsGaugeCardProps = {
  year: number
  totalGross: number
  payPeriods: number
  breakdown: {
    hourly: number
    cash: number
    card: number
  }
  cashBreakdown: {
    reported: number
    unreported: number
  }
  avgPerHour: number
}

type ArcSegment = SegmentDefinition & {
  path: string
  percentage: number
}

const GAUGE_SIZE = 320
const CENTER = GAUGE_SIZE / 2
const RADIUS = 112
const START_ANGLE = -90
const GAP_ANGLE = 4

function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180

  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  }
}

function describeArc(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number
) {
  const start = polarToCartesian(centerX, centerY, radius, endAngle)
  const end = polarToCartesian(centerX, centerY, radius, startAngle)
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1"

  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`
}

export default function YearlyEarningsGaugeCard({
  year,
  totalGross,
  payPeriods,
  breakdown,
  cashBreakdown,
  avgPerHour,
}: YearlyEarningsGaugeCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedId, setSelectedId] = useState<SegmentId | null>(null)

  const segments = useMemo<SegmentDefinition[]>(
    () => [
      {
        id: "hourly",
        label: "Hourly",
        value: breakdown.hourly,
        color: "#1D4ED8",
        iconColor: "#1D4ED8",
        icon: Clock3,
        note: "Base hourly pay",
      },
      {
        id: "cash",
        label: "Cash",
        value: breakdown.cash,
        color: "#2FA866",
        iconColor: "#26755E",
        icon: Banknote,
        note: "Reported and personal cash earnings",
      },
      {
        id: "card",
        label: "Card",
        value: breakdown.card,
        color: "#EA580C",
        iconColor: "#EA580C",
        icon: CreditCard,
        note: "Card tip earnings",
      },
    ],
    [breakdown.card, breakdown.cash, breakdown.hourly]
  )

  const activeSegments = useMemo(
    () => segments.filter((segment) => segment.value > 0),
    [segments]
  )

  const defaultSelectedId = useMemo<SegmentId>(() => {
    if (activeSegments.length === 0) {
      return "hourly"
    }

    return [...activeSegments].sort((left, right) => right.value - left.value)[0].id
  }, [activeSegments])

  useEffect(() => {
    if (selectedId && !activeSegments.some((segment) => segment.id === selectedId)) {
      setSelectedId(null)
    }
  }, [activeSegments, defaultSelectedId, selectedId])

  const arcSegments = useMemo<ArcSegment[]>(() => {
    if (totalGross <= 0 || activeSegments.length === 0) {
      return []
    }

    const totalGap =
      activeSegments.length > 1 ? GAP_ANGLE * activeSegments.length : 0
    const availableAngle = Math.max(360 - totalGap, 0)
    let currentStart = START_ANGLE

    return activeSegments.map((segment) => {
      const percentage = segment.value / totalGross
      const sweep = percentage * availableAngle
      const start = currentStart
      const end = currentStart + sweep
      currentStart = end + GAP_ANGLE

      return {
        ...segment,
        percentage,
        path: describeArc(CENTER, CENTER, RADIUS, start, end),
      }
    })
  }, [activeSegments, totalGross])

  const selectedSegment =
    selectedId != null
      ? segments.find((segment) => segment.id === selectedId) ?? null
      : null
  const focusedSegment =
    segments.find((segment) => segment.id === (selectedId ?? defaultSelectedId)) ??
    segments[0]

  const CenterIcon = focusedSegment.icon
  const centerColor = focusedSegment.iconColor
  const SelectedIcon = selectedSegment?.icon
  const selectedPercentage =
    selectedSegment && totalGross > 0
      ? `${Math.round((selectedSegment.value / totalGross) * 100)}%`
      : null

  return (
    <div className="overflow-hidden rounded-[22px] bg-card">
      <button
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-muted/70 min-[420px]:px-5 sm:px-6"
        aria-expanded={isExpanded}
      >
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{year} earnings</p>
          <div className="mt-1 text-4xl font-semibold tracking-tight tabular-nums text-foreground sm:text-5xl">
            {formatCurrency(totalGross)}
          </div>
          <p className="mt-1 text-sm text-muted-foreground sm:hidden">
            {payPeriods} {payPeriods === 1 ? "pay period" : "pay periods"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden text-right sm:block">
            <div className="text-xs text-muted-foreground">
              Pay periods
            </div>
            <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">
              {payPeriods}
            </div>
          </div>
          <motion.span
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground"
          >
            <ChevronDown className="h-5 w-5" />
          </motion.span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded ? (
          <motion.div
            key="expanded-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-border/70"
          >
            <div className="px-4 py-5 min-[420px]:px-5 sm:px-6 lg:px-8">
              <div className="mx-auto flex w-full max-w-[22rem] flex-col items-center gap-4 min-[420px]:max-w-[24rem] sm:max-w-[28rem] lg:max-w-[34rem]">
                <div className="relative w-full max-w-[15.5rem] p-1 min-[390px]:max-w-[17.5rem] min-[420px]:max-w-[18.5rem] sm:max-w-[20rem] md:max-w-[22rem]">
                  <svg
                    viewBox={`0 0 ${GAUGE_SIZE} ${GAUGE_SIZE}`}
                    className="h-auto w-full"
                    aria-label={`${year} yearly gross earnings`}
                  >
                    <circle
                      cx={CENTER}
                      cy={CENTER}
                      r={RADIUS}
                      fill="none"
                      className="stroke-muted"
                      strokeWidth="26"
                    />

                    {arcSegments.map((segment, index) => {
                      const isSelected = selectedId === segment.id

                      return (
                        <motion.path
                          key={segment.id}
                          d={segment.path}
                          fill="none"
                          stroke={segment.color}
                          strokeLinecap="butt"
                          initial={{ pathLength: 0, opacity: 0 }}
                          animate={{
                            pathLength: 1,
                            opacity: selectedId == null || isSelected ? 1 : 0.62,
                            strokeWidth: isSelected ? 32 : 26,
                          }}
                          transition={{
                            pathLength: {
                              duration: 0.7,
                              ease: [0.22, 1, 0.36, 1],
                              delay: index * 0.08,
                            },
                            opacity: { duration: 0.22 },
                            strokeWidth: {
                              type: "spring",
                              stiffness: 280,
                              damping: 22,
                            },
                          }}
                          role="button"
                          tabIndex={0}
                          aria-pressed={isSelected}
                          aria-label={`${segment.label} ${formatCurrency(segment.value)}`}
                          className="cursor-pointer outline-none"
                          style={{
                            filter: isSelected
                              ? "drop-shadow(0 8px 18px rgba(15, 23, 42, 0.18))"
                              : "none",
                          }}
                          onClick={() => setSelectedId(segment.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault()
                              setSelectedId(segment.id)
                            }
                          }}
                        />
                      )
                    })}
                  </svg>

                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={focusedSegment.id}
                        initial={{ opacity: 0, scale: 0.92 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.92 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        className="flex h-[4.6rem] w-[4.6rem] flex-col items-center justify-center rounded-[1.55rem] bg-card px-1 sm:h-[5.35rem] sm:w-[5.35rem]"
                      >
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-[1rem] text-white shadow-sm sm:h-12 sm:w-12"
                          style={{
                            background: `linear-gradient(135deg, ${centerColor}, ${centerColor}CC)`,
                          }}
                        >
                          <CenterIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                        </div>
                        {selectedPercentage ? (
                          <div className="mt-1 text-xs font-medium text-muted-foreground">
                            {selectedPercentage}
                          </div>
                        ) : null}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>

                <div
                  className={`grid w-full grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:gap-4 ${
                    selectedSegment ? "lg:grid-cols-3" : ""
                  }`}
                >
                  {selectedSegment ? (
                    <div className="rounded-2xl bg-muted p-3.5 min-[420px]:p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs text-muted-foreground">
                            Selected
                          </div>
                          <div className="mt-1.5 text-base font-semibold text-foreground">
                            {selectedSegment.label}
                          </div>
                        </div>
                        <div
                          className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
                          style={{
                            background: `linear-gradient(135deg, ${selectedSegment.iconColor}, ${selectedSegment.iconColor}CC)`,
                          }}
                        >
                          {SelectedIcon ? <SelectedIcon className="h-4 w-4" /> : null}
                        </div>
                      </div>
                      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
                        {formatCurrency(selectedSegment.value)}
                      </div>
                      {selectedSegment.id === "cash" ? (
                        <div className="mt-2.5 grid gap-1.5 text-sm text-muted-foreground">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs text-muted-foreground">
                              Reported
                            </span>
                            <span className="font-semibold tabular-nums text-foreground">
                              {formatCurrency(cashBreakdown.reported)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs text-muted-foreground">
                              Personal
                            </span>
                            <span className="font-semibold tabular-nums text-foreground">
                              {formatCurrency(cashBreakdown.unreported)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-muted-foreground">
                          {selectedSegment.note}
                        </div>
                      )}
                    </div>
                  ) : null}

                  <div className="rounded-2xl bg-muted p-3.5 min-[420px]:p-4">
                    <div className="text-xs text-muted-foreground">
                      Total gross
                    </div>
                    <div className="mt-1.5 text-[clamp(1.85rem,4vw,2.45rem)] font-semibold tabular-nums leading-none text-foreground">
                      {formatCurrency(totalGross)}
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      {selectedSegment
                        ? `Across ${payPeriods} ${payPeriods === 1 ? "pay period" : "pay periods"} this year.`
                        : "Tap a segment to inspect the yearly mix."}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-muted p-3.5 min-[420px]:p-4">
                    <div className="text-xs text-muted-foreground">
                      Avg / Hour
                    </div>
                    <div className="mt-1.5 text-[clamp(1.85rem,4vw,2.45rem)] font-semibold tabular-nums leading-none text-foreground">
                      {avgPerHour > 0 ? formatCurrency(avgPerHour) : "—"}
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      Total gross earnings divided by hours worked.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
