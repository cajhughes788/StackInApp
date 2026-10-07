// /components/pointer-events-guard.tsx

"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"

// Radix menus/dialogs (via react-dismissable-layer) set body.style.pointerEvents = "none"
// while open, and react-remove-scroll-bar sets body[data-scroll-locked] to lock scrolling.
// Both are restored by cleanup effects tied to the component unmounting cleanly. When a menu
// item's onClick triggers router.push in the same tick that closes the menu, Next.js can tear
// down the old page (and the menu inside it) before those cleanup effects finish, stranding the
// lock on <body> forever — every tap goes nowhere even though scroll/other overlays still work.
// This clears both locks defensively on every route change and workspace switch (the
// switcher always pushes /app/home, which is no route change when already on home), and a
// body observer clears a lock that's still set once no Radix layer is actually open.
const OPEN_LAYER_SELECTOR = [
  "[data-radix-popper-content-wrapper]",
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
].join(",")

function resetStuckBodyLocks() {
  if (typeof document === "undefined") return
  document.body.style.pointerEvents = ""
  document.body.removeAttribute("data-scroll-locked")
}

export function PointerEventsGuard() {
  const pathname = usePathname()
  const activeWorkspaceId = useWorkspaceStore((s) =>
    s.state.status === "ready" ? s.state.activeWorkspaceId : null
  )

  useEffect(() => {
    let checkTimer: number | undefined
    const observer = new MutationObserver(() => {
      if (document.body.style.pointerEvents !== "none") return
      window.clearTimeout(checkTimer)
      // Give an opening/closing layer time to mount or finish its own cleanup.
      checkTimer = window.setTimeout(() => {
        if (
          document.body.style.pointerEvents === "none" &&
          !document.querySelector(OPEN_LAYER_SELECTOR)
        ) {
          resetStuckBodyLocks()
        }
      }, 500)
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ["style"] })
    return () => {
      observer.disconnect()
      window.clearTimeout(checkTimer)
    }
  }, [])

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
  }, [pathname, activeWorkspaceId])

  return null
}
