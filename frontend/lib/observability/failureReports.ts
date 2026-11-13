"use client"

import { Capacitor } from "@capacitor/core"

import { API_ENDPOINTS } from "@/lib/api/core/endpoints"
import { scrubCrashMessage } from "@/lib/crashReports"
import { getAuthSafe } from "@/lib/firebase"
import { getIsOnline, onNetworkChange } from "@/lib/network/status"

// Failure notes: when something fails on the phone (a request, a write to the
// phone's own storage, or a code error), a short note goes to the server's
// logs (backend routes/logClientFailure.ts) so it can be looked up after the
// app is closed. Notes say what broke and where, never what was being saved:
// messages are scrubbed like crash reports (no emails, amounts, numbers or
// long ids).
//
// Sent with a plain fetch, not apiFetch, so a broken request path or a broken
// local storage can't stop the note, and a failed note never makes another.
// Reporting never throws.

export type FailureKind = "request" | "local_storage" | "app_error" | "user_saw_error"

export type FailureNote = {
  kind: FailureKind
  // Which step broke, e.g. "server", "timeout", "no_connection", "before_send",
  // "write", "read", "window_error".
  step: string
  // What was being done: a server function name, a storage area or a screen.
  where: string
  method?: string
  status?: number
  error?: unknown
  workspaceId?: string | null
  sentRequest?: boolean
}

type QueuedNote = {
  kind: FailureKind
  step: string
  where: string
  method?: string
  status?: number
  errorName?: string
  message: string
  workspaceId?: string | null
  screen?: string
  online?: boolean
  sentRequest?: boolean
  msSinceOpen?: number
  msSinceForeground?: number | null
  lastBackgroundMs?: number | null
  platform?: string
  buildId?: string | null
  count?: number
  happenedAt: string
}

const MAX_PER_SESSION = 60
const REPEAT_WINDOW_MS = 60_000
const MAX_QUEUED = 20
const SEND_DELAY_MS = 1500
const TOKEN_WAIT_MS = 2500
const SEND_TIMEOUT_MS = 8000

const openedAt = Date.now()
let foregroundAt: number | null = openedAt
let hiddenAt: number | null = null
let lastBackgroundMs: number | null = null
let sentThisSession = 0
const lastSeen = new Map<string, { at: number; note: QueuedNote }>()
let queue: QueuedNote[] = []
let sendTimer: ReturnType<typeof setTimeout> | null = null
let sending = false

// How long the app sat in the background before the failure is the main
// clue for failures that only a restart fixes.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now()
    } else {
      if (hiddenAt !== null) lastBackgroundMs = Date.now() - hiddenAt
      hiddenAt = null
      foregroundAt = Date.now()
    }
  })
}

// Notes made while offline go out once the connection is back.
onNetworkChange((online) => {
  if (online && queue.length > 0) scheduleSend()
})

function describeError(error: unknown): { errorName?: string; message: string } {
  if (error instanceof Error) {
    return { errorName: error.name, message: scrubCrashMessage(error.message || "Empty error message") }
  }
  if (typeof error === "string") return { message: scrubCrashMessage(error) }
  if (error == null) return { message: "No error message" }
  try {
    return { message: scrubCrashMessage(JSON.stringify(error)) }
  } catch {
    return { message: "Unreadable error" }
  }
}

function buildId(): string | null {
  if (typeof window === "undefined") return null
  return (window as Window & { __NEXT_DATA__?: { buildId?: string } }).__NEXT_DATA__?.buildId ?? null
}

/** Records a failure and sends it to the server logs soon after. Never throws. */
export function reportFailure(note: FailureNote): void {
  try {
    if (typeof window === "undefined") return
    // An error already noted (say, by the request layer) that later goes
    // unhandled isn't noted twice.
    const error = note.error as { __failureNoted?: boolean } | null | undefined
    const isObject = typeof error === "object" && error !== null
    if (note.kind === "app_error" && isObject && error.__failureNoted) return
    if (isObject) {
      try {
        error.__failureNoted = true
      } catch {
        // Frozen error objects can't be marked.
      }
    }
    const { errorName, message } = describeError(note.error)
    const now = Date.now()

    // The same failure again within a minute only bumps a counter.
    const key = `${note.kind}|${note.step}|${note.where}|${note.status ?? ""}|${message}`
    const previous = lastSeen.get(key)
    if (previous && now - previous.at < REPEAT_WINDOW_MS) {
      // (Only counted while that note is still waiting to go out.)
      previous.note.count = (previous.note.count ?? 1) + 1
      return
    }
    if (sentThisSession >= MAX_PER_SESSION) return
    sentThisSession += 1

    const queued: QueuedNote = {
      kind: note.kind,
      step: note.step.slice(0, 40),
      where: note.where.slice(0, 120),
      method: note.method,
      status: note.status,
      errorName: errorName?.slice(0, 80),
      message,
      workspaceId: note.workspaceId ?? null,
      screen: window.location.pathname.slice(0, 200),
      online: getIsOnline(),
      sentRequest: note.sentRequest,
      msSinceOpen: now - openedAt,
      msSinceForeground: foregroundAt === null ? null : now - foregroundAt,
      lastBackgroundMs,
      platform: Capacitor.getPlatform(),
      buildId: buildId(),
      count: 1,
      happenedAt: new Date(now).toISOString(),
    }
    lastSeen.set(key, { at: now, note: queued })
    queue.push(queued)
    if (queue.length > MAX_QUEUED) queue = queue.slice(-MAX_QUEUED)
    scheduleSend()
  } catch {
    // Reporting must never cause a failure of its own.
  }
}

function scheduleSend(): void {
  if (sendTimer !== null) return
  sendTimer = setTimeout(() => {
    sendTimer = null
    void sendQueued()
  }, SEND_DELAY_MS)
}

async function signInToken(): Promise<string | null> {
  try {
    const user = getAuthSafe().currentUser
    if (!user) return null
    return await Promise.race([
      user.getIdToken(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_WAIT_MS)),
    ])
  } catch {
    return null
  }
}

async function sendQueued(): Promise<void> {
  if (sending || queue.length === 0 || !getIsOnline()) return
  sending = true
  const batch = queue
  queue = []
  try {
    const token = await signInToken()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
    try {
      const res = await fetch(API_ENDPOINTS.clientFailures.post, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ failures: batch }),
        mode: "cors",
        credentials: "omit",
        keepalive: true,
        signal: controller.signal,
      })
      // A rejected batch won't do better on a retry; drop it.
      if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`)
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Couldn't reach the server: keep the notes for the next try.
    queue = [...batch, ...queue].slice(-MAX_QUEUED)
  } finally {
    sending = false
  }
}

/** The server function a request URL belongs to, e.g. "createexpense". */
export function requestTarget(url: string): string {
  try {
    const parsed = new URL(url, typeof window === "undefined" ? "https://app.invalid" : window.location.href)
    const host = parsed.hostname
    const runApp = /^([a-z0-9]+)-[a-z0-9]+-[a-z]+\.a\.run\.app$/.exec(host)
    if (runApp) return runApp[1]
    // Paths can hold ids, so only the host.
    return host.slice(0, 120)
  } catch {
    return "unknown"
  }
}

/** The workspace id in a request URL, if any. */
export function requestWorkspaceId(url: string): string | null {
  const query = /[?&]workspaceId=([^&]+)/.exec(url)
  if (query) return decodeURIComponent(query[1])
  const path = /\/workspaces\/([^/?]+)/.exec(url)
  return path ? decodeURIComponent(path[1]) : null
}
