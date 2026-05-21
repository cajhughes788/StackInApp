"use client"

import { Capacitor } from "@capacitor/core"

type Primitive = string | number | boolean | null
type TraceMetadata = Record<string, Primitive | Primitive[] | undefined>

export type ProfileTraceEvent = {
  traceId: string
  flow: string
  step: string
  phase: "instant" | "start" | "end" | "error"
  seq: number
  ts: number
  wallTime: string
  elapsedMs: number
  deltaMs: number
  durationMs?: number
  platform: "web" | "native"
  buildType: "development" | "production"
  metadata?: TraceMetadata
}

type BrowserWithProfileState = Window & {
  __STACKIN_PROFILE_EVENTS__?: ProfileTraceEvent[]
}

type ProfileTrace = {
  traceId: string
  flow: string
  mark: (step: string, metadata?: TraceMetadata) => void
  start: (step: string, metadata?: TraceMetadata) => void
  end: (step: string, metadata?: TraceMetadata) => void
  error: (step: string, error: unknown, metadata?: TraceMetadata) => void
  child: (step: string, metadata?: TraceMetadata) => ProfileTrace
}

const ENABLE_STORAGE_KEY = "stackin-profile-enabled"
const activeTraceByName = new Map<string, ProfileTrace>()

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now()
  }

  return Date.now()
}

function isEnabled(): boolean {
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
    return true
  }

  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_ENABLE_PROFILE_TRACING === "true"
  ) {
    return true
  }

  if (typeof window === "undefined") {
    return false
  }

  try {
    if (window.localStorage.getItem(ENABLE_STORAGE_KEY) === "true") {
      return true
    }
  } catch {}

  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get("profile") === "1") {
      return true
    }
  } catch {}

  return false
}

function getPlatform(): "web" | "native" {
  return Capacitor.isNativePlatform() ? "native" : "web"
}

function getBuildType(): "development" | "production" {
  return process.env.NODE_ENV === "production" ? "production" : "development"
}

function getEventStore(): ProfileTraceEvent[] | null {
  if (typeof window === "undefined") return null

  const host = window as BrowserWithProfileState
  host.__STACKIN_PROFILE_EVENTS__ ??= []
  return host.__STACKIN_PROFILE_EVENTS__
}

function sanitizeError(error: unknown): TraceMetadata {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
    }
  }

  return {
    errorMessage: String(error),
  }
}

function emitEvent(event: ProfileTraceEvent): void {
  if (!isEnabled()) return

  getEventStore()?.push(event)
  console.log("[profile-trace]", event)
}

function createTraceId(flow: string): string {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`

  return `${flow}-${randomPart}`
}

export function createProfileTrace(
  flow: string,
  metadata: TraceMetadata = {},
  traceId: string = createTraceId(flow)
): ProfileTrace {
  const traceCreatedAt = nowMs()
  let lastEventAt = traceCreatedAt
  let seq = 0
  const startedSteps = new Map<string, number>()

  const base = {
    traceId,
    flow,
    platform: getPlatform(),
    buildType: getBuildType(),
  } as const

  const send = (
    step: string,
    phase: ProfileTraceEvent["phase"],
    extra: TraceMetadata = {}
  ) => {
    const eventTs = nowMs()
    const durationMs =
      phase === "end" || phase === "error"
        ? startedSteps.has(step)
          ? Math.round(eventTs - (startedSteps.get(step) ?? eventTs))
          : undefined
        : undefined

    if (phase === "start") {
      startedSteps.set(step, eventTs)
    } else if (phase === "end" || phase === "error") {
      startedSteps.delete(step)
    }

    seq += 1

    emitEvent({
      ...base,
      step,
      phase,
      seq,
      ts: eventTs,
      wallTime: new Date().toISOString(),
      elapsedMs: Math.round(eventTs - traceCreatedAt),
      deltaMs: Math.round(eventTs - lastEventAt),
      ...(durationMs !== undefined ? { durationMs } : {}),
      metadata: {
        ...metadata,
        ...extra,
      },
    })

    lastEventAt = eventTs
  }

  return {
    traceId,
    flow,
    mark(step, extra = {}) {
      send(step, "instant", extra)
    },
    start(step, extra = {}) {
      send(step, "start", extra)
    },
    end(step, extra = {}) {
      send(step, "end", extra)
    },
    error(step, error, extra = {}) {
      send(step, "error", {
        ...sanitizeError(error),
        ...extra,
      })
    },
    child(step, extra = {}) {
      return createProfileTrace(flow, {
        parentTraceId: traceId,
        parentStep: step,
        ...metadata,
        ...extra,
      })
    },
  }
}

export function setActiveProfileTrace(name: string, trace: ProfileTrace | null): void {
  if (!trace) {
    activeTraceByName.delete(name)
    return
  }

  activeTraceByName.set(name, trace)
}

export function getActiveProfileTrace(name: string): ProfileTrace | null {
  return activeTraceByName.get(name) ?? null
}

export function withProfileStep<T>(
  trace: ProfileTrace | null | undefined,
  step: string,
  fn: () => Promise<T>,
  metadata: TraceMetadata = {}
): Promise<T> {
  if (!trace) {
    return fn()
  }

  trace.start(step, metadata)

  return fn()
    .then((result) => {
      trace.end(step, metadata)
      return result
    })
    .catch((error) => {
      trace.error(step, error, metadata)
      throw error
    })
}

export function getProfileTraceEvents(): ProfileTraceEvent[] {
  return [...(getEventStore() ?? [])]
}

export function clearProfileTraceEvents(): void {
  const store = getEventStore()
  if (!store) return
  store.length = 0
}

export function setProfileTracingEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(ENABLE_STORAGE_KEY, String(enabled))
}
