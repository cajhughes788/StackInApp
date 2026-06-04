"use client"

import { useLayoutEffect } from "react"

function resetScrollableElement(element: HTMLElement | null) {
  if (!element) {
    return
  }

  element.scrollTop = 0
  element.scrollLeft = 0
}

export function useRouteScrollReset(resetKey: string | null | undefined) {
  useLayoutEffect(() => {
    if (!resetKey || typeof window === "undefined") {
      return
    }

    window.scrollTo(0, 0)
    resetScrollableElement(document.scrollingElement as HTMLElement | null)
    resetScrollableElement(document.documentElement)
    resetScrollableElement(document.body)
  }, [resetKey])
}
