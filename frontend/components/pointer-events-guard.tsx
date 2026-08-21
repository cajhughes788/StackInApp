// /components/pointer-events-guard.tsx

"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

// Radix menus/dialogs (via react-dismissable-layer) set body.style.pointerEvents = "none"
// while open, and react-remove-scroll-bar sets body[data-scroll-locked] to lock scrolling.
// Both are restored by cleanup effects tied to the component unmounting cleanly. When a menu
// item's onClick triggers router.push in the same tick that closes the menu, Next.js can tear
// down the old page (and the menu inside it) before those cleanup effects finish, stranding the
// lock on <body> forever — every tap goes nowhere even though scroll/other overlays still work.
// This clears both locks defensively on every route change.
function resetStuckBodyLocks() {
  if (typeof document === "undefined") return
  document.body.style.pointerEvents = ""
  document.body.removeAttribute("data-scroll-locked")
}

export function PointerEventsGuard() {
  const pathname = usePathname()

  useEffect(() => {
    resetStuckBodyLocks()
    const immediateTimer = window.setTimeout(resetStuckBodyLocks, 0)
    const shortDelayTimer = window.setTimeout(resetStuckBodyLocks, 100)
    const delayedTimer = window.setTimeout(resetStuckBodyLocks, 250)
    const longDelayTimer = window.setTimeout(resetStuckBodyLocks, 1000)

    return () => {
      window.clearTimeout(immediateTimer)
      window.clearTimeout(shortDelayTimer)
      window.clearTimeout(delayedTimer)
      window.clearTimeout(longDelayTimer)
    }
  }, [pathname])

  return null
}
