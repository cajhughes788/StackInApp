"use client"

// Lights up where an Ask 521 answer came from (see useAskFocusStore): finds
// the page's marked spot and lines as they load, scrolls to the first one,
// and shows a strip at the bottom saying what was asked.

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"
import { X } from "lucide-react"

import { useAskFocusStore } from "@/lib/stores/useAskFocusStore"

const LIT = "data-ask-lit"
const trim = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path)

export default function AskFocusLayer() {
  const pathname = usePathname()
  const focus = useAskFocusStore((s) => s.focus)
  const clear = useAskFocusStore((s) => s.clear)
  const arrivedRef = useRef<number | null>(null)

  const here = !!focus && trim(pathname ?? "") === trim(focus.path)

  // Leaving the page (after getting there) ends it; so does never getting there.
  useEffect(() => {
    if (!focus) return
    if (here) {
      arrivedRef.current = focus.nonce
      return
    }
    if (arrivedRef.current === focus.nonce) {
      clear()
      return
    }
    const timer = window.setTimeout(clear, 15_000)
    return () => window.clearTimeout(timer)
  }, [focus, here, clear])

  useEffect(() => {
    if (!focus || !here) return
    const selectors = [
      ...(focus.spot ? [`[data-ask-spot="${CSS.escape(focus.spot)}"]`] : []),
      ...focus.lines.map((id) => `[data-ask-line="${CSS.escape(id)}"]`),
    ]
    if (selectors.length === 0) return
    let scrolled = false
    const started = Date.now()
    // Pages load their data after opening, and lists can redraw, so keep
    // looking (and relighting new copies) while the focus lasts.
    const light = () => {
      const found = Array.from(document.querySelectorAll<HTMLElement>(selectors.join(",")))
      for (const element of found) if (!element.hasAttribute(LIT)) element.setAttribute(LIT, "")
      if (!scrolled && found.length > 0) {
        // Give the rest of a list a moment to arrive, then go to the top-most one.
        if (Date.now() - started < 400 && found.length < selectors.length) return
        scrolled = true
        const first = found.reduce((top, element) =>
          element.getBoundingClientRect().top < top.getBoundingClientRect().top ? element : top
        )
        first.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    }
    light()
    const timer = window.setInterval(light, 250)
    return () => {
      window.clearInterval(timer)
      document.querySelectorAll(`[${LIT}]`).forEach((element) => element.removeAttribute(LIT))
    }
  }, [focus, here])

  if (!focus || !here) return null
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ bottom: "calc(var(--safe-area-inset-bottom) + 16px)" }}
    >
      <div
        role="status"
        className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border-2 border-primary bg-card px-4 py-2.5 shadow-lg"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{focus.banner}</p>
          {focus.note ? <p className="text-xs text-muted-foreground">{focus.note}</p> : null}
        </div>
        <button
          type="button"
          onClick={clear}
          aria-label="Stop highlighting"
          className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
