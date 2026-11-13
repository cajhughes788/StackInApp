"use client"

import type { MouseEvent, ReactNode } from "react"
import Link from "next/link"
import { Capacitor } from "@capacitor/core"

// The hosted copy of the app's pages (same build as the bundled ones).
const APP_HOSTING_URL =
  process.env.NEXT_PUBLIC_STACKIN_APP_HOSTING_URL?.trim() || "https://app.the521app.com"

// A link to /terms or /privacy. In the native app it opens the page in a
// browser sheet over the current screen instead of leaving it, so a
// half-filled sign-up or login form keeps what was typed. On the web it's
// an ordinary link.
export function LegalLink({
  href,
  className,
  children,
}: {
  href: "/terms" | "/privacy"
  className?: string
  children: ReactNode
}) {
  const handleClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    if (!Capacitor.isNativePlatform()) return
    event.preventDefault()
    // Keep the tap from also toggling a surrounding <label>'s checkbox.
    event.stopPropagation()
    const { Browser } = await import("@capacitor/browser")
    await Browser.open({ url: `${APP_HOSTING_URL}${href}`, presentationStyle: "popover" })
  }

  return (
    <Link href={href} className={className} onClick={handleClick}>
      {children}
    </Link>
  )
}
