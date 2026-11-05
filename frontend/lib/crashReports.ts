import { Capacitor, registerPlugin } from "@capacitor/core"

// Errors from the web app, sent to Firebase Crashlytics as non-fatal reports
// through a custom native plugin (frontend/ios/App/App/CrashReportsPlugin.swift),
// for the same Firebase-version reason as lib/appCheck/registerAppCheck.ts.
// The native side decides whether reports go out at all (release builds only).
//
// Nothing personal is sent: messages are scrubbed of emails, numbers and long
// ids, the screen is the path without its query (ids live there), and no
// account id is attached.
interface CrashReportsPlugin {
  recordError(options: { kind: string; message: string; screen: string; frames: CrashFrame[] }): Promise<void>
}

type CrashFrame = { symbol: string; file: string; line: number }

const CrashReports = registerPlugin<CrashReportsPlugin>("CrashReports")

// Per app session: the same error once, and no more than this many in all.
const MAX_REPORTS = 20
const sent = new Set<string>()

// Dropped connections aren't bugs; offline replay handles them.
const NETWORK_NOISE = /failed to fetch|load failed|networkerror|network connection was lost|internet connection appears to be offline/i

function isSupportedPlatform(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios"
}

export function scrubCrashMessage(message: string): string {
  return message
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/[A-Za-z0-9_-]{20,}/g, "[id]")
    .replace(/[$€£]\s?\d[\d,.]*/g, "[amount]")
    .replace(/\+?\d[\d\s().,-]{2,}\d/g, "[number]")
    .slice(0, 300)
}

// Safari ("fn@file:line:col") and V8 ("at fn (file:line:col)") stack lines;
// files keep only their path, not the app's origin.
export function crashFrames(stack: string | undefined): CrashFrame[] {
  if (!stack) return []
  const frames: CrashFrame[] = []
  for (const raw of stack.split("\n")) {
    const line = raw.trim()
    const match = /^(?:at\s+)?(?:(.*?)\s*[@(])?((?:[a-z]+:\/\/[^/\s]*)?\/[^\s()]*?):(\d+):\d+\)?$/i.exec(line)
    if (!match) continue
    frames.push({
      symbol: match[1]?.replace(/^at\s+/, "") || "?",
      file: match[2].replace(/^[a-z]+:\/\/[^/]*/i, ""),
      line: Number(match[3]),
    })
    if (frames.length >= 30) break
  }
  return frames
}

/** Reports an error to Crashlytics (iOS app only); never throws. */
export function reportCrash(kind: string, error: unknown): void {
  if (!isSupportedPlatform() || sent.size >= MAX_REPORTS) return
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Non-error thrown"
  if (NETWORK_NOISE.test(raw)) return
  const message = scrubCrashMessage(raw || "Empty error message")
  const dedupeKey = `${kind}|${message}`
  if (sent.has(dedupeKey)) return
  sent.add(dedupeKey)
  void CrashReports.recordError({
    kind,
    message,
    screen: typeof window === "undefined" ? "" : window.location.pathname,
    frames: crashFrames(error instanceof Error ? error.stack : undefined),
  }).catch(() => {})
}
