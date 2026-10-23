"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { useGuideStore } from "@/lib/stores/useGuideStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import type { WorkspaceType } from "@shared/contracts/workspace"

// Part two of the first-run guide (part one is components/onboarding/
// setup-guide.tsx on Settings). Dims the home page and highlights one area at
// a time with a short note. Each step points at a `data-tour` attribute on
// the home page or header; a step whose area isn't on screen (e.g. Needs you
// before a bank is linked) is skipped.

type TourStep = { target: string; title: string; body: string }

const STEPS: Record<WorkspaceType, TourStep[]> = {
  independent: [
    {
      target: "mode-switch",
      title: "Income and expenses",
      body: "Switch between what you've earned and what you've spent. Everything below follows this switch.",
    },
    {
      target: "total",
      title: "Your month at a glance",
      body: "This month's total, and how close you are to the goal you set in Settings.",
    },
    {
      target: "needs-you",
      title: "Needs you",
      body: "Bank transactions and anything else waiting on you land here. Confirm them to add them to your records.",
    },
    {
      target: "entry-form",
      title: "Add an entry",
      body: "Log income or an expense by hand anytime, like a cash payment or a check.",
    },
    {
      target: "menu",
      title: "Everything else",
      body: "Invoices, receipts, Profit & Loss, bank connections and Settings are in this menu. You can replay this tour from here too.",
    },
    {
      target: "menu",
      title: "Light or dark",
      body: "Prefer a lighter screen? Switch between light and dark mode anytime in Settings, under Appearance.",
    },
  ],
  w2: [
    {
      target: "total",
      title: "Your pay period",
      body: "What you've earned this pay period, and how close you are to your goal.",
    },
    {
      target: "entry-form",
      title: "Add an entry",
      body: "Log each shift or payment here. 521 uses your Settings to work out your pay.",
    },
    {
      target: "records",
      title: "Your records",
      body: "Every entry you add shows up here, and this is where you edit them.",
    },
    {
      target: "menu",
      title: "Everything else",
      body: "Earnings, Settings and your account are in this menu. You can replay this tour from here too.",
    },
    {
      target: "menu",
      title: "Light or dark",
      body: "Prefer a lighter screen? Switch between light and dark mode anytime in Settings, under Appearance.",
    },
  ],
}

const SPOTLIGHT_PADDING = 8
const EDGE_GUTTER = 16
const CARD_GAP = 14
// The pointer stays this far from the card's rounded corners.
const POINTER_INSET = 24

type Rect = { top: number; left: number; width: number; height: number }

function findTarget(target: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
  if (!el) return null
  // `hidden` sections and collapsed wrappers have no box.
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 ? el : null
}

function sameRect(a: Rect | null, b: Rect | null) {
  if (!a || !b) return a === b
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  )
}

export default function HomeTour() {
  const homeTour = useGuideStore((s) => s.homeTour)
  const clearHomeTour = useGuideStore((s) => s.clearHomeTour)
  const workspaceState = useWorkspaceStore((s) => s.state)
  const activeWorkspaceId = workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null

  const isActive = !!homeTour && homeTour.workspaceId === activeWorkspaceId
  const steps = useMemo(() => (homeTour ? STEPS[homeTour.workspaceType] : []), [homeTour])

  // Steps whose area is on screen, worked out once when the tour starts so
  // the "2 of 4" count stays put.
  const [visibleSteps, setVisibleSteps] = useState<TourStep[] | null>(null)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [cardBox, setCardBox] = useState({ left: 0, width: 0, height: 0 })
  // The card stays hidden, without animating, until it has been measured and
  // placed once; otherwise it would slide in from the bottom of the screen.
  const [placed, setPlaced] = useState(false)
  useEffect(() => {
    if (!cardBox.height || placed) return
    const frame = window.requestAnimationFrame(() => setPlaced(true))
    return () => window.cancelAnimationFrame(frame)
  }, [cardBox.height, placed])

  // A request for a different workspace than the one showing is stale.
  useEffect(() => {
    if (homeTour && activeWorkspaceId && homeTour.workspaceId !== activeWorkspaceId) clearHomeTour()
  }, [homeTour, activeWorkspaceId, clearHomeTour])

  // Start once the page has settled (the cards load their data first).
  useEffect(() => {
    if (!isActive) {
      setVisibleSteps(null)
      return
    }
    const timer = window.setTimeout(() => {
      const available = steps.filter((step) => findTarget(step.target))
      if (available.length === 0) {
        clearHomeTour()
        return
      }
      setIndex(0)
      setVisibleSteps(available)
    }, 700)
    return () => window.clearTimeout(timer)
  }, [isActive, steps, clearHomeTour])

  const step = visibleSteps?.[index] ?? null

  // Bring the step's area into view; the menu lives in the header, which
  // hides while scrolling down, so that step goes back to the top.
  useEffect(() => {
    if (!step) return
    if (step.target === "menu") {
      window.scrollTo({ top: 0, behavior: "smooth" })
      return
    }
    const el = findTarget(step.target)
    if (!el) return
    const tall = el.getBoundingClientRect().height > window.innerHeight * 0.5
    el.scrollIntoView({ behavior: "smooth", block: tall ? "start" : "center" })
  }, [step])

  // Follow the area every frame: smooth scrolling and late-loading cards
  // both move it.
  useEffect(() => {
    if (!step) {
      setRect(null)
      return
    }
    let frame = 0
    const track = () => {
      const el = findTarget(step.target)
      const box = el?.getBoundingClientRect()
      const next = box ? { top: box.top, left: box.left, width: box.width, height: box.height } : null
      setRect((current) => (sameRect(current, next) ? current : next))
      const card = cardRef.current
      if (card) {
        const box = { left: card.offsetLeft, width: card.offsetWidth, height: card.offsetHeight }
        setCardBox((current) =>
          current.left === box.left && current.width === box.width && current.height === box.height ? current : box
        )
      }
      frame = window.requestAnimationFrame(track)
    }
    track()
    return () => window.cancelAnimationFrame(frame)
  }, [step])

  const finish = useCallback(() => {
    setVisibleSteps(null)
    setPlaced(false)
    setCardBox({ left: 0, width: 0, height: 0 })
    clearHomeTour()
  }, [clearHomeTour])

  const next = useCallback(() => {
    if (!visibleSteps) return
    if (index >= visibleSteps.length - 1) finish()
    else setIndex(index + 1)
  }, [visibleSteps, index, finish])

  const back = useCallback(() => setIndex((current) => Math.max(0, current - 1)), [])

  useEffect(() => {
    if (!step) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish()
      else if (event.key === "ArrowRight") next()
      else if (event.key === "ArrowLeft") back()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [step, finish, next, back])

  if (!step || !visibleSteps) return null

  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 0

  // Spotlight: the area plus padding, clipped to the screen.
  const spot = rect
    ? (() => {
        const top = Math.max(rect.top - SPOTLIGHT_PADDING, EDGE_GUTTER / 2)
        const bottom = Math.min(rect.top + rect.height + SPOTLIGHT_PADDING, viewportHeight - EDGE_GUTTER / 2)
        const left = Math.max(rect.left - SPOTLIGHT_PADDING, EDGE_GUTTER / 2)
        const right = Math.min(rect.left + rect.width + SPOTLIGHT_PADDING, viewportWidth - EDGE_GUTTER / 2)
        return { top, left, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) }
      })()
    : null

  // Note card: below the area if it fits, else above, else pinned to the
  // bottom of the screen over the area (no pointer then).
  const cardHeight = cardBox.height
  let cardTop = viewportHeight - cardHeight - EDGE_GUTTER
  let pointer: "up" | "down" | null = null
  if (spot) {
    const below = spot.top + spot.height + CARD_GAP
    const above = spot.top - CARD_GAP - cardHeight
    if (below + cardHeight <= viewportHeight - EDGE_GUTTER) {
      cardTop = below
      pointer = "up"
    } else if (above >= EDGE_GUTTER) {
      cardTop = above
      pointer = "down"
    }
  }
  const pointerLeft = spot
    ? Math.min(
        Math.max(spot.left + spot.width / 2 - cardBox.left, POINTER_INSET),
        Math.max(cardBox.width - POINTER_INSET, POINTER_INSET)
      )
    : 0

  const isLast = index === visibleSteps.length - 1

  return (
    <div className="fixed inset-0 z-[var(--stackin-z-modal-overlay)]" aria-live="polite">
      {/* Blocks taps on the page while the tour is up. */}
      <div className="absolute inset-0" onClick={(event) => event.stopPropagation()} />

      {spot ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-[22px] transition-all duration-300 ease-out"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            // Green ring around the area, then the dimming around everything else.
            boxShadow: "0 0 0 3px var(--primary), 0 0 0 9999px rgb(0 0 0 / 0.75)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-black/75" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-tour-title"
        aria-describedby="home-tour-body"
        className={`absolute left-4 right-4 mx-auto max-w-sm rounded-[22px] border-2 border-[var(--guide-border)] bg-[var(--guide-bg)] text-[var(--guide-fg)] p-5 shadow-xl duration-300 ease-out ${placed ? "transition-[top]" : "invisible"}`}
        style={{ top: Math.max(cardTop, EDGE_GUTTER) }}
      >
        {/* Guide colours (--guide-* in globals.css): a slate card outlined in
            green in light mode, an off-white card in dark mode. */}
        {pointer ? (
          <span
            aria-hidden="true"
            className={`absolute size-3.5 rotate-45 border-[var(--guide-border)] bg-[var(--guide-bg)] transition-[left] duration-300 ease-out ${
              pointer === "up" ? "-top-[9px] border-l-2 border-t-2" : "-bottom-[9px] border-b-2 border-r-2"
            }`}
            style={{ left: pointerLeft - 7 }}
          />
        ) : null}
        <p className="text-xs font-semibold text-[var(--guide-accent)] tabular-nums">
          {index + 1} of {visibleSteps.length}
        </p>
        <h2 id="home-tour-title" className="mt-1 text-lg font-semibold">
          {step.title}
        </h2>
        <p id="home-tour-body" className="mt-1 text-sm text-[var(--guide-muted)]">
          {step.body}
        </p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={finish}
            className="text-sm font-medium text-[var(--guide-muted)] hover:text-[var(--guide-fg)]"
          >
            {isLast ? "Close" : "Skip tour"}
          </button>
          <div className="flex gap-2">
            {index > 0 ? (
              <Button
                variant="outline"
                className="rounded-full border-[var(--guide-control)] bg-transparent px-4 text-[var(--guide-fg)] hover:bg-[var(--guide-subtle)] hover:text-[var(--guide-fg)] dark:border-[var(--guide-control)] dark:bg-transparent dark:hover:bg-[var(--guide-subtle)]"
                onClick={back}
              >
                Back
              </Button>
            ) : null}
            <Button className="rounded-full px-5" onClick={next} autoFocus>
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
